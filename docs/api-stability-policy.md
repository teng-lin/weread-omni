# API stability policy

weread-omni follows Semantic Versioning and is still pre-`1.0.0`. This
policy covers releases before `0.3.0`.

## Compatibility boundary

The public TypeScript SDK core is the compatibility boundary. Patch releases
keep that surface backward compatible; breaking SDK changes require a minor
release.

The `weread-omni` CLI, including its human-readable and JSON output, is experimental.
It may change in a minor release. The packaged agent skill follows the current
CLI and is not a separate compatibility contract.

## Emergency fixes

A security or data-loss fix may break an interface in a patch release when a
compatible fix would not be safe. The change will be called out prominently in
`CHANGELOG.md`.

## Pin the TypeScript surface

The release gate snapshots the declarations for every published entry point.
Any drift must be classified as additive, compatible, or breaking and reviewed
before the snapshot is updated. Internal files that are not exported from a
package entry point are not public API.
