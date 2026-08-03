// Public API surface extractor.
//
// `src/index.ts` re-exports `export type * from "./api/types.js"`, so a type added or
// reshaped anywhere under that wildcard becomes a public compatibility obligation without
// anybody reviewing it (docs/api-stability-policy.md, "Pin the TypeScript surface"). This
// module renders the *built* declarations of every published entry point into one canonical,
// sorted document. test/integration/api-surface.test.ts compares that rendering against the
// committed snapshot, so unreviewed drift fails instead of shipping.
//
// It reads dist/, not src/: consumers resolve through the package `exports` map, and the
// declarations tsc emits are what they actually receive.
//
// UNSTABLE DEPENDENCY — read before upgrading TypeScript.
//
// The imports below are `typescript/unstable/*`. This repository is on the TypeScript 7 native
// compiler, which no longer ships the classic `ts.createProgram` JavaScript API; the checker is
// reachable only through these entry points, and their name says what Microsoft promises about
// them, which is nothing. A TypeScript minor upgrade can therefore break this file and, with it,
// the release gate — a bump is not a routine dependency update while this stands.
//
// The blast radius is contained: a broken entry point throws inside `buildApiSurface()`, so the
// guardrail fails loudly rather than silently passing an unchecked API surface. If these
// entry points ever move or disappear, the fix is confined to this file — the snapshot format,
// the committed snapshot, and the test that compares them do not depend on the compiler API.
// Adding a dedicated extractor dependency (api-extractor and similar) was rejected here to keep
// the release gate free of a new third-party package; revisit that trade only if this breaks.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";
import {
  API,
  type Checker,
  isTypeParameter,
  type Project,
  type Signature,
  SignatureKind,
  SymbolFlags,
  type Symbol as TsSymbol,
  type Type,
} from "typescript/unstable/sync";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const distDir = join(repoRoot, "dist");
export const snapshotPath = join(repoRoot, "test", "api-surface.snapshot.md");
const projectConfigPath = join(repoRoot, "test", "support", "tsconfig.api-surface.json");

/** NoTruncation. Without it the type builder elides long object types as `...`, which would
 *  leave the snapshot blind to whatever it elided. */
const NO_TRUNCATION = 1;
/** InTypeAlias. Expands the alias being rendered instead of printing back its own name. */
const IN_TYPE_ALIAS = 8388608;

export interface EntryPoint {
  /** The specifier a consumer imports, e.g. `weread-omni/cli`. */
  specifier: string;
  /** Repo-relative declaration file, e.g. `dist/cli.d.ts`. */
  declaration: string;
}

interface RenderedDeclaration {
  name: string;
  kind: string;
  file: string;
  body: string;
}

interface ExportEntry {
  name: string;
  kind: string;
  file: string;
}

export function distIsBuilt(): boolean {
  try {
    return statSync(join(distDir, "index.d.ts")).isFile();
  } catch {
    return false;
  }
}

/**
 * True when something under src/ is newer than every emitted declaration, which means dist/
 * predates the sources it claims to describe. Comparing the snapshot against that build would
 * check the *previous* public surface — a false pass, which is worse than a failure.
 */
export function distIsStale(): boolean {
  return newestMtime(join(repoRoot, "src"), ".ts") > newestMtime(distDir, ".d.ts");
}

function newestMtime(dir: string, suffix: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full, suffix));
    else if (entry.name.endsWith(suffix)) newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

/**
 * The published entry points, derived from `package.json` `exports` so a new subpath cannot be
 * added without the snapshot covering it. Each entry's `types` target is what gets loaded.
 */
export function readEntryPoints(): EntryPoint[] {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    name: string;
    exports: Record<string, { types?: string }>;
  };
  const entries: EntryPoint[] = [];
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (!target.types) continue;
    entries.push({
      specifier: subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`,
      declaration: target.types.replace(/^\.\//, ""),
    });
  }
  return entries.sort((left, right) => compare(left.specifier, right.specifier));
}

/**
 * Declaration files the extractor's TypeScript project loads. Kept separate from
 * `readEntryPoints()` on purpose: the test asserts the two agree, so adding a package subpath
 * without extending the project config fails loudly instead of producing a snapshot that
 * quietly omits the new surface.
 */
export function readProjectRootFiles(): string[] {
  const config = JSON.parse(stripLineComments(readFileSync(projectConfigPath, "utf8"))) as { files: string[] };
  return config.files.map((file) => file.replace(/^(\.\.\/)+/, "")).sort(compare);
}

function stripLineComments(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, "");
}

export function buildApiSurface(): string {
  const api = new API({ cwd: repoRoot });
  try {
    // Priming the config parse populates the client-side source-file cache; without it the
    // checker rejects the program's source files as non-remote nodes.
    api.parseConfigFile(projectConfigPath);
    const snapshot = api.updateSnapshot({ openProjects: [projectConfigPath] });
    const project = snapshot.getProjects()[0];
    if (!project) throw new Error(`no project loaded from ${projectConfigPath}`);
    return render(project, project.checker);
  } finally {
    api.close();
  }
}

function render(project: Project, checker: Checker): string {
  const entryPoints = readEntryPoints();
  const declarations = new Map<string, RenderedDeclaration>();
  const entryExports = new Map<string, ExportEntry[]>();

  for (const entry of entryPoints) {
    const sourceFile = project.program.getSourceFile(join(repoRoot, entry.declaration));
    if (!sourceFile) throw new Error(`entry declaration not in program: ${entry.declaration}`);
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) throw new Error(`no module symbol for ${entry.declaration}`);

    const listed: ExportEntry[] = [];
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const rendered = renderSymbol(project, checker, exported.name, resolveAlias(checker, exported));
      if (!rendered) continue;
      listed.push({ name: exported.name, kind: rendered.kind, file: rendered.file });
      declarations.set(declarationKey(rendered), rendered);
    }
    entryExports.set(
      entry.specifier,
      listed.sort((left, right) => compare(left.name, right.name)),
    );
  }

  // Types the public surface references but no entry point re-exports — an option type
  // accepted by an exported function, say. They are exactly as breakable as the named
  // exports, so close over them until the rendering stops naming anything new.
  closeOverReferencedTypes(project, checker, declarations, indexPackageTypes(project, checker));

  const lines: string[] = [
    "# weread-omni public API surface",
    "",
    "<!--",
    "  GENERATED FILE — do not edit by hand.",
    "",
    "  Produced from the built declarations (dist/) by test/support/api-surface.ts and compared",
    "  by test/integration/api-surface.test.ts. A diff here is a public API change: review it,",
    "  then re-bless deliberately with",
    "",
    "      npm run build && npm run api-surface:update",
    "",
    "  Members are sorted, so a diff shows semantic change rather than source order.",
    "-->",
    "",
    "## Entry points",
  ];

  for (const entry of entryPoints) {
    const exported = entryExports.get(entry.specifier) ?? [];
    lines.push("", `### \`${entry.specifier}\` — ${entry.declaration} (${exported.length} exports)`, "");
    for (const item of exported) lines.push(`- \`${item.name}\` — ${item.kind} — ${item.file}`);
  }

  lines.push(
    "",
    "## Declarations",
    "",
    "Every exported symbol above, plus every package-declared type reachable from one.",
  );

  const ordered = [...declarations.values()].sort(
    (left, right) => compare(left.name, right.name) || compare(left.file, right.file),
  );
  for (const declaration of ordered) {
    lines.push("", `### \`${declaration.name}\` — ${declaration.file}`, "", "```ts", declaration.body, "```");
  }

  lines.push("");
  return lines.join("\n");
}

function declarationKey(declaration: RenderedDeclaration): string {
  return `${declaration.file}#${declaration.name}`;
}

/** Every named type exported by any file under dist/, so a referenced-but-not-re-exported type
 *  can be resolved by name during the reachability closure. */
function indexPackageTypes(project: Project, checker: Checker): Map<string, TsSymbol[]> {
  const index = new Map<string, TsSymbol[]>();
  for (const fileName of project.program.getSourceFileNames()) {
    if (!isPackageFile(fileName)) continue;
    const sourceFile = project.program.getSourceFile(fileName);
    if (!sourceFile) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const target = resolveAlias(checker, exported);
      const existing = index.get(exported.name);
      if (!existing) index.set(exported.name, [target]);
      else if (!existing.some((symbol) => symbol.id === target.id)) existing.push(target);
    }
  }
  return index;
}

function closeOverReferencedTypes(
  project: Project,
  checker: Checker,
  declarations: Map<string, RenderedDeclaration>,
  packageIndex: Map<string, TsSymbol[]>,
): void {
  const identifier = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let frontier = [...declarations.values()];
  // Bounded so a pathological reference cycle fails the run instead of hanging CI.
  for (let round = 0; round < 32 && frontier.length > 0; round += 1) {
    const discovered: RenderedDeclaration[] = [];
    for (const declaration of frontier) {
      for (const match of declaration.body.matchAll(identifier)) {
        for (const candidate of packageIndex.get(match[0]) ?? []) {
          const rendered = renderSymbol(project, checker, match[0], candidate);
          if (!rendered || declarations.has(declarationKey(rendered))) continue;
          declarations.set(declarationKey(rendered), rendered);
          discovered.push(rendered);
        }
      }
    }
    frontier = discovered;
  }
}

function resolveAlias(checker: Checker, symbol: TsSymbol): TsSymbol {
  if (!(symbol.flags & SymbolFlags.Alias)) return symbol;
  const aliased = checker.getAliasedSymbol(symbol);
  return checker.isUnknownSymbol(aliased) ? symbol : aliased;
}

function renderSymbol(
  project: Project,
  checker: Checker,
  name: string,
  symbol: TsSymbol,
): RenderedDeclaration | undefined {
  const file = declaringFile(symbol);
  if (!file) return undefined;
  const flags = symbol.flags;
  const of = (kind: string, body: string): RenderedDeclaration => ({ name, kind, file, body });

  if (flags & SymbolFlags.Class) return of("class", renderClass(project, checker, name, symbol));
  if (flags & SymbolFlags.Interface) return of("interface", renderInterface(project, checker, name, symbol));
  if (flags & SymbolFlags.TypeAlias) return of("type", renderTypeAlias(project, checker, name, symbol));
  if (flags & SymbolFlags.Enum) return of("enum", renderEnum(project, checker, name, symbol));
  if (flags & (SymbolFlags.Function | SymbolFlags.Method))
    return of("function", renderValue(project, checker, "function", name, symbol));
  if (flags & (SymbolFlags.Variable | SymbolFlags.Property))
    return of("const", renderValue(project, checker, "const", name, symbol));
  if (flags & SymbolFlags.Module) return of("namespace", renderNamespace(project, checker, name, symbol));
  return of("unknown", `unknown ${name}`);
}

function renderClass(project: Project, checker: Checker, name: string, symbol: TsSymbol): string {
  const instance = checker.getDeclaredTypeOfSymbol(symbol);
  const statics = checker.getTypeOfSymbol(symbol);
  const members: string[] = [];

  const bases = (instance.getBaseTypes() ?? []).map((base) => typeText(checker, base)).sort(compare);
  const heading = `class ${name}${typeParameterList(checker, instance)}${bases.length ? ` extends ${bases.join(", ")}` : ""}`;

  if (statics) {
    for (const signature of checker.getSignaturesOfType(statics, SignatureKind.Construct)) {
      members.push(`new ${signatureText(project, checker, signature)}`);
    }
    for (const member of sortedProperties(project, checker, statics)) {
      if (member.name === "prototype") continue;
      members.push(`static ${memberText(project, checker, member)}`);
    }
  }
  for (const member of sortedProperties(project, checker, instance)) members.push(memberText(project, checker, member));
  if (hasPrivateMembers(project, checker, [instance, statics])) {
    members.push("// nominal: not assignable from a structurally identical object");
  }
  return block(heading, members);
}

/**
 * A member this package declares, as opposed to one inherited from `Error`, `lib.dom`, or a
 * dependency. Inherited members are implied by the rendered `extends` clause, and folding a
 * `@types/node` upgrade into this snapshot would make the guardrail cry wolf.
 */
function isOwnMember(symbol: TsSymbol): boolean {
  if (symbol.declarations.length === 0) return true;
  return symbol.declarations.some((declaration) => isPackageFile(declaration.path));
}

function renderInterface(project: Project, checker: Checker, name: string, symbol: TsSymbol): string {
  const declared = checker.getDeclaredTypeOfSymbol(symbol);
  const bases = (declared.getBaseTypes() ?? []).map((base) => typeText(checker, base)).sort(compare);
  const heading = `interface ${name}${typeParameterList(checker, declared)}${bases.length ? ` extends ${bases.join(", ")}` : ""}`;
  return block(heading, structuralMembers(project, checker, declared));
}

function renderTypeAlias(project: Project, checker: Checker, name: string, symbol: TsSymbol): string {
  const declared = checker.getDeclaredTypeOfSymbol(symbol);
  // An alias written as `Omit<…>`, an intersection, or `ReturnType<…>` prints as its own
  // recipe, which hides the members it resolves to — and those members are the surface.
  const heading = `type ${name}${typeParameterList(checker, declared)} = ${typeText(checker, declared, IN_TYPE_ALIAS)}`;
  return [heading, ...resolvedMembers(project, checker, declared)].join("\n");
}

function renderEnum(project: Project, checker: Checker, name: string, symbol: TsSymbol): string {
  const declared = checker.getDeclaredTypeOfSymbol(symbol);
  const members = sortedProperties(project, checker, declared).map((member) => memberText(project, checker, member));
  return block(`enum ${name}`, members);
}

function renderValue(project: Project, checker: Checker, keyword: string, name: string, symbol: TsSymbol): string {
  const type = checker.getTypeOfSymbol(symbol);
  if (!type) return `${keyword} ${name}: unknown`;
  const calls = checker.getSignaturesOfType(type, SignatureKind.Call);
  if (calls.length > 0) {
    return (
      calls
        // `function f(): R` for a declared function; `const f: (…) => R` for a value that
        // merely happens to be callable, matching how each is written in the declarations.
        .map((signature) =>
          keyword === "function"
            ? `function ${name}${signatureText(project, checker, signature)}`
            : `const ${name}: ${signatureText(project, checker, signature, "arrow")}`,
        )
        .join("\n")
    );
  }
  return [`${keyword} ${name}: ${typeText(checker, type)}`, ...resolvedMembers(project, checker, type)].join("\n");
}

/** The member list an opaque type name hides, as comments so the block stays readable TypeScript. */
function resolvedMembers(project: Project, checker: Checker, type: Type): string[] {
  // A pure function-type alias resolves to a call signature that just restates the alias body.
  if (sortedProperties(project, checker, type).length === 0 && checker.getIndexInfosOfType(type).length === 0)
    return [];
  const members = structuralMembers(project, checker, type);
  if (members.length === 0) return [];
  return ["// resolves to:", ...members.map((member) => `//   ${member}`)];
}

function renderNamespace(project: Project, checker: Checker, name: string, symbol: TsSymbol): string {
  const exports = [...symbol.getExports().values()].sort((left, right) => compare(left.name, right.name));
  return block(
    `namespace ${name}`,
    exports.map((member) => memberText(project, checker, member)),
  );
}

/** `<T extends WeReadClient>` rather than a bare name, so a tightened constraint shows up. */
function typeParameterList(checker: Checker, type: Type): string {
  // A generic type alias carries its parameters as the alias type arguments of its declared
  // type rather than as type parameters, so fall back to those.
  const own = type.isClassOrInterface() ? type.getTypeParameters() : [];
  const parameters = own.length > 0 ? own : type.getAliasTypeArguments().filter(isTypeParameter);
  if (parameters.length === 0) return "";
  return `<${parameters.map((parameter) => typeParameterText(checker, parameter)).join(", ")}>`;
}

/** Properties, index signatures, and call/construct signatures of an object type, sorted.
 *  Empty for primitives, unions, and anything else without members. */
function structuralMembers(project: Project, checker: Checker, type: Type | undefined): string[] {
  if (!type) return [];
  const members: string[] = [];
  for (const info of checker.getIndexInfosOfType(type)) {
    const readonlyPrefix = info.isReadonly ? "readonly " : "";
    members.push(`${readonlyPrefix}[key: ${typeText(checker, info.keyType)}]: ${typeText(checker, info.valueType)}`);
  }
  for (const signature of checker.getSignaturesOfType(type, SignatureKind.Call)) {
    members.push(signatureText(project, checker, signature));
  }
  for (const signature of checker.getSignaturesOfType(type, SignatureKind.Construct)) {
    members.push(`new ${signatureText(project, checker, signature)}`);
  }
  for (const property of sortedProperties(project, checker, type)) members.push(memberText(project, checker, property));
  return members;
}

function sortedProperties(project: Project, checker: Checker, type: Type): TsSymbol[] {
  return checker
    .getPropertiesOfType(type)
    .filter((symbol) => isOwnMember(symbol) && !isPrivateMember(project, symbol))
    .sort((left, right) => compare(displayName(left), displayName(right)));
}

/**
 * The one thing about private members that *is* observable: declaring any makes the class
 * nominal, so a structurally identical object stops being assignable to it. Recorded by
 * presence rather than by name, so the fact shows up while adding or renaming a private member
 * still moves nothing.
 */
function hasPrivateMembers(project: Project, checker: Checker, types: (Type | undefined)[]): boolean {
  return types.some((type) =>
    type
      ? checker.getPropertiesOfType(type).some((symbol) => isOwnMember(symbol) && isPrivateMember(project, symbol))
      : false,
  );
}

function memberText(project: Project, checker: Checker, symbol: TsSymbol): string {
  const name = displayName(symbol);
  // A `#private` brand makes the class nominal; its type is meaningless but its presence
  // is part of the contract, so record the brand and nothing else.
  if (name === "#private") return "#private";
  const type = checker.getTypeOfSymbol(symbol);
  const optional = symbol.flags & SymbolFlags.Optional ? "?" : "";
  const rendered = type ? typeText(checker, type) : "unknown";
  const trimmed = optional ? rendered.replace(/ \| undefined$/, "") : rendered;
  return `${modifierPrefix(project, symbol)}${name}${optional}: ${trimmed}`;
}

/** Optionality lives on the parameter's `?` token, not on its symbol flags. */
function isOptionalParameter(project: Project, symbol: TsSymbol): boolean {
  if (symbol.flags & SymbolFlags.Optional) return true;
  const handle = symbol.valueDeclaration ?? symbol.declarations[0];
  if (!handle) return false;
  try {
    const node = handle.resolve(project) as unknown as { questionToken?: unknown } | undefined;
    return node?.questionToken !== undefined;
  } catch {
    return false;
  }
}

function signatureText(
  project: Project,
  checker: Checker,
  signature: Signature,
  style: "declaration" | "arrow" = "declaration",
): string {
  const typeParameters = signature.getTypeParameters();
  const head =
    typeParameters.length > 0
      ? `<${typeParameters.map((parameter) => typeParameterText(checker, parameter)).join(", ")}>`
      : "";
  const all = signature.getParameters();
  const parameters = all.map((parameter, index) => {
    const rest = signature.hasRestParameter && index === all.length - 1 ? "..." : "";
    const optional = isOptionalParameter(project, parameter) ? "?" : "";
    const type = checker.getTypeOfSymbol(parameter);
    const rendered = type ? typeText(checker, type) : "unknown";
    // `?` already means "or undefined"; printing both is noise that hides real widening.
    const trimmed = optional ? rendered.replace(/ \| undefined$/, "") : rendered;
    return `${rest}${parameter.name}${optional}: ${trimmed}`;
  });
  const returned = checker.getReturnTypeOfSignature(signature);
  const returnText = returned ? typeText(checker, returned) : "unknown";
  const separator = style === "arrow" ? " => " : ": ";
  return `${head}(${parameters.join(", ")})${separator}${returnText}`;
}

function typeParameterText(checker: Checker, parameter: Type): string {
  const name = typeText(checker, parameter);
  const constraint = checker.getConstraintOfTypeParameter(parameter as never);
  return constraint ? `${name} extends ${typeText(checker, constraint)}` : name;
}

/** `readonly`, `get`/`set`, and visibility change what a consumer may do with a member, so
 *  they belong in the snapshot. They live on the declaration node, not on the symbol. */
function modifierPrefix(project: Project, symbol: TsSymbol): string {
  const parts = modifierKeywords(project, symbol);
  return parts.length > 0 ? `${[...new Set(parts)].sort(compare).join(" ")} ` : "";
}

function modifierKeywords(project: Project, symbol: TsSymbol): string[] {
  const handle = symbol.declarations[0];
  if (!handle) return [];
  const parts: string[] = [];
  const accessor = ACCESSOR_KEYWORDS[handle.kind];
  if (accessor) parts.push(accessor);
  let node: { modifiers?: readonly { kind: number }[] } | undefined;
  try {
    node = handle.resolve(project) as unknown as { modifiers?: readonly { kind: number }[] } | undefined;
  } catch {
    node = undefined;
  }
  for (const modifier of node?.modifiers ?? []) {
    const keyword = MODIFIER_KEYWORDS[modifier.kind];
    if (keyword) parts.push(keyword);
  }
  return parts;
}

/**
 * A `private` member is not surface. `tsc` still emits it into the declarations — as a bare
 * `private foo;` with no type, which is why one renders here as `private foo: any` — but a
 * consumer cannot name it, call it, or depend on its type. Rendering it makes an internal
 * refactor move the document that describes the *public* surface, and a guardrail that fires
 * on changes it is not there to guard is a guardrail that gets ignored.
 *
 * `protected` is deliberately not filtered: a subclass can use it, so it is surface.
 */
function isPrivateMember(project: Project, symbol: TsSymbol): boolean {
  return modifierKeywords(project, symbol).includes("private");
}

const MODIFIER_KEYWORDS: Record<number, string> = {
  [SyntaxKind.AbstractKeyword]: "abstract",
  [SyntaxKind.PrivateKeyword]: "private",
  [SyntaxKind.ProtectedKeyword]: "protected",
  [SyntaxKind.ReadonlyKeyword]: "readonly",
  [SyntaxKind.StaticKeyword]: "static",
};

const ACCESSOR_KEYWORDS: Record<number, string> = {
  [SyntaxKind.GetAccessor]: "get",
  [SyntaxKind.SetAccessor]: "set",
};

function typeText(checker: Checker, type: Type, extraFlags = 0): string {
  return normalize(checker.typeToString(type, undefined, NO_TRUNCATION | extraFlags));
}

/** `#private` brands arrive as `__#1@#private`; the instance id is not part of the API. */
function displayName(symbol: TsSymbol): string {
  return symbol.name.replace(/^__#\d+@/, "");
}

/** `import("…")` qualifiers embed the checkout location, which differs between a developer
 *  machine and CI. Strip them so the snapshot is machine-independent. */
function normalize(text: string): string {
  return text
    .replace(/import\("[^"]*"\)\./g, "")
    .replace(/import\("[^"]*"\)/g, "")
    .replaceAll(repoRoot, "")
    .replaceAll(repoRoot.toLowerCase(), "");
}

function block(heading: string, members: string[]): string {
  if (members.length === 0) return `${heading} {}`;
  return [`${heading} {`, ...members.map((member) => `  ${member}`), "}"].join("\n");
}

function declaringFile(symbol: TsSymbol): string | undefined {
  const handle = symbol.declarations[0];
  if (!handle || !isPackageFile(handle.path)) return undefined;
  return toRepoRelative(handle.path);
}

/** True for declarations emitted by this package's own build, excluding lib and dependencies. */
function isPackageFile(fileName: string): boolean {
  const relativePath = toRepoRelative(fileName);
  return relativePath.startsWith("dist/") && !relativePath.includes("node_modules");
}

function toRepoRelative(fileName: string): string {
  // The compiler server reports canonical (lower-cased on a case-insensitive file system)
  // paths, so the prefix match is case-insensitive while the suffix keeps its own casing.
  const rootLower = repoRoot.toLowerCase().replace(/[\\/]$/, "");
  if (fileName.toLowerCase().startsWith(rootLower)) {
    return fileName
      .slice(rootLower.length + 1)
      .split(sep)
      .join(posix.sep);
  }
  return relative(repoRoot, fileName).split(sep).join(posix.sep);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
