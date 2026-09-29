import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { compile, compileFile, componentPath } from "../dist/index.js";
import { referenceFold } from "obix-compiler-validator";
import { checkEquivalence } from "obix-compiler-equivalence";

const timerSrc = readFileSync(
  fileURLToPath(new URL("./fixtures/Timer.obix", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

const irUrl = import.meta.resolve("obix-core-ir");

test("compile(Timer.obix) succeeds and produces IR + code + a11y model", () => {
  const r = compile(timerSrc, { path: "Timer.obix", irImport: irUrl });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  assert.equal(r.ir.name, "Timer");
  assert.deepEqual(r.ir.stateShape.sort(), ["running", "seconds"]);
  assert.ok(r.ir.actionDecls.Tick.propDeps.includes("limitSeconds"));
  assert.equal(r.ir.style.css.includes("data-obix-scope"), true);
  assert.equal(r.a11y.liveRegions.length, 1);
});

test("emitted module executes and is adapter-equivalent to the oracle", async () => {
  const r = compile(timerSrc, { path: "Timer.obix", irImport: irUrl });
  const dir = mkdtempSync(join(tmpdir(), "obixc-test-"));
  try {
    const file = join(dir, "Timer.gen.mjs");
    writeFileSync(file, r.code, "utf8");
    const mod = await import(pathToFileURL(file).href);
    const artifact = mod.default;

    const fold = referenceFold(artifact, artifact.initialState, artifact.props, [["Start"], ["Tick"], ["Tick"], ["Stop"]]);
    assert.deepEqual(fold.finalState, { seconds: 2, running: false });

    const eq = checkEquivalence(artifact, { trace: [["Start"], ...Array(8).fill(["Tick"])] });
    assert.equal(eq.equivalent, true, eq.divergences.join("\n"));
    assert.deepEqual(eq.expected, { seconds: 5, running: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an accessibility error blocks emit — no --no-a11y", () => {
  const bad = timerSrc.replace('aria-live="polite"', 'aria-live="loud"');
  const r = compile(bad, { path: "Timer.obix" });
  assert.equal(r.ok, false);
  assert.equal(r.code, undefined);
  assert.ok(r.diagnostics.some((d) => d.code === "OBIX-A001"));
});

test("unknown binding reference is a semantic error", () => {
  const bad = timerSrc.replace("{formattedTime}", "{nope}");
  const r = compile(bad, { path: "Timer.obix" });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === "OBIX-S002"));
});

// ── Stage 6 ─────────────────────────────────────────────────────────────────────────────────────────

test("compileFile identifies a component by its working-directory-relative path: the same file emits the same bytes however it is named", () => {
  const dir = mkdtempSync(join(tmpdir(), "obix-emit-"));
  mkdirSync(join(dir, "src"));
  const file = join(dir, "src", "Timer.obix");
  writeFileSync(file, timerSrc);
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const typed = compileFile("src/Timer.obix");
    const dotted = compileFile("./src/Timer.obix");
    const absolute = compileFile(file);
    assert.equal(typed.ok && dotted.ok && absolute.ok, true);
    assert.equal(dotted.code, typed.code);
    assert.equal(absolute.code, typed.code);
    assert.equal(componentPath(file), "src/Timer.obix");
  } finally {
    process.chdir(cwd);
  }
});

test("the same project in two checkout locations emits identical bytes (a reproducible build)", () => {
  const codes = [0, 1].map((n) => {
    const dir = mkdtempSync(join(tmpdir(), `obix-emit-checkout${n}-`));
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app", "Timer.obix"), timerSrc);
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      return compileFile("app/Timer.obix").code;
    } finally {
      process.chdir(cwd);
    }
  });
  assert.ok(codes[0]);
  assert.equal(codes[0], codes[1]);
});

test("a missing section is reported with its documented code (P001 template, P002 script), and blocks emission", () => {
  const noTemplate = compile("<script>\nconst state = {};\nconst actions = { A(s) { return s; } };\n</script>", { path: "A.obix" });
  assert.equal(noTemplate.ok, false);
  assert.equal(noTemplate.code, undefined);
  assert.ok(noTemplate.diagnostics.some((d) => d.code === "OBIX-P001"));
  const noScript = compile("<template><div>x</div></template>", { path: "A.obix" });
  assert.ok(noScript.diagnostics.some((d) => d.code === "OBIX-P002"));
  assert.equal(noScript.code, undefined);
});

test("an emit mode outside the union is refused, not emitted as \"linked\" under a header that names it; \"bare\" is a supported alias", () => {
  const src = "<template><button type=\"button\" on:click=\"Go\">Go</button></template>\n<script>\nconst state = {};\nconst actions = { Go(s) { return s; } };\n</script>";
  for (const mode of ["cjs", "standalone", "", "inline", "shared-inline"]) {
    assert.throws(() => compile(src, { path: "Go.obix", mode }), (e) => e.name === "UnsupportedFeatureError", `mode ${JSON.stringify(mode)}`);
  }
  assert.equal(compile(src, { path: "Go.obix", mode: "bare" }).ok, true);
});
