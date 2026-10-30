// Minimal declarations for the Node built-ins this project uses.
// typescript is the only devDependency, so @types/node is not installed.

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}

declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function describe(name: string, fn: () => void): void;
}

declare module 'node:assert/strict' {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp): void;
  };
  export default assert;
}

interface ImportMeta {
  dirname: string;
}

declare const process: {
  argv: string[];
  exitCode: number | undefined;
  stdout: { write(text: string): boolean };
  stderr: { write(text: string): boolean };
};
