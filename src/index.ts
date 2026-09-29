/**
 * obix-compiler
 *
 * source -> sections -> AST -> semantic AST -> canonical DOP IR -> ES6 emit.
 *
 * Accessibility analysis (obix-accessibility) is a HARD, normal
 * dependency. It runs BEFORE emit and an a11y error blocks emit. There is no
 * supported mode equivalent to `--no-a11y`.
 */
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { compile, type CompileOptions, type CompileResult } from "./compile.js";

export { compile } from "./compile.js";
export type { CompileOptions, CompileResult } from "./compile.js";
export { emitModule } from "./emit.js";
export { buildIR } from "./ir.js";

/**
 * The path a component is identified by: relative to the working directory, with `/` separators. The CSS scope token is a hash of the
 * component name AND this path (Draft 0.2.1, Problem 10), so it must not depend on how the file was named on the command line —
 * `Timer.obix`, `./Timer.obix` and `D:\work\app\Timer.obix` are the same file and must emit the same bytes, on every machine and in every
 * checkout location. (The path used to be passed as typed, so the same build differed between an absolute and a relative invocation.)
 */
export function componentPath(file: string): string {
  return relative(process.cwd(), resolve(file)).split(sep).join("/");
}

/** Compile a `.obix` file from disk. */
export function compileFile(path: string, options: Omit<CompileOptions, "path"> = {}): CompileResult {
  const source = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return compile(source, { ...options, path: componentPath(path) });
}

/** Diagnostics only (used by obix-language-server / obix-cli check). */
export function checkSource(source: string, path?: string) {
  const result = compile(source, { path });
  return { ok: result.ok, diagnostics: result.diagnostics };
}
