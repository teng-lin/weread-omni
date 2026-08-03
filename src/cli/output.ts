export interface OutputWriter {
  write(chunk: string): unknown;
}

export interface OutputOptions {
  json: boolean;
  stdout: OutputWriter;
}

export function output<T>(data: T, options: OutputOptions, humanFormat: (value: T) => string): void {
  const text = options.json ? (JSON.stringify(data) ?? "null") : humanFormat(data);
  options.stdout.write(`${text.replace(/\n+$/, "")}\n`);
}
