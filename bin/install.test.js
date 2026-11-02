import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const script = join(repo, "bin", "install");
const repoLayout = readFileSync(join(repo, "layouts", "workspaces.json"), "utf8");
const scratch = [];

function scratchDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(dir);
  return dir;
}

const freshHome = () => scratchDir("install-test-");

function install(home, { args = [], installScript = script } = {}) {
  return spawnSync("sh", [installScript, ...args, home], { encoding: "utf8" });
}

const buildScript = `
import { mkdirSync, writeFileSync } from "node:fs";
if (process.env.STUB_BUILD_FAILS) process.exit(1);
writeFileSync("build-ran", "yes");
for (const f of ["editor/main.js", "format/run.js"]) {
  mkdirSync("mods/editor/" + f.split("/")[0], { recursive: true });
  writeFileSync("mods/editor/" + f, "built " + f);
}
mkdirSync("mods/my-files/files", { recursive: true });
writeFileSync("mods/my-files/files/main.js", "built files/main.js");
`;

// A copy of the repository with a plugin whose build writes small files, so a test can alter the
// source layout or the build before installing without compiling the real plugin.
function stubRepo({ layoutText = repoLayout, build = "node build.mjs" } = {}) {
  const copy = scratchDir("install-repo-");
  for (const dir of ["bin", "mods", "layouts"]) cpSync(join(repo, dir), join(copy, dir), { recursive: true });
  if (layoutText === null) rmSync(join(copy, "layouts", "workspaces.json"));
  else writeFileSync(join(copy, "layouts", "workspaces.json"), layoutText);
  const plugin = join(copy, "plugins", "editor");
  cpSync(join(repo, "plugins", "editor", "bin"), join(plugin, "bin"), { recursive: true });
  writeFileSync(join(plugin, "package.json"), JSON.stringify({ name: "stub", scripts: { build } }));
  writeFileSync(join(plugin, "build.mjs"), buildScript);
  for (const [path, text] of [
    ["mods/editor/main.js", "export { default } from './editor/main.js';"],
    ["mods/editor/mod.json", "{}"],
    ["mods/my-files/main.js", "export {};"],
    ["mods/my-files/mod.json", "{}"],
    ["mods/my-files/icons/a.svg", "<svg/>"],
  ]) {
    mkdirSync(join(plugin, path, ".."), { recursive: true });
    writeFileSync(join(plugin, path), text);
  }
  return { copy, plugin, script: join(copy, "bin", "install") };
}

function assertNothingWritten(home) {
  assert.deepEqual(readdirSync(home), []);
}

function installedLayout(home) {
  return readFileSync(join(home, "layouts", "workspaces.json"), "utf8");
}

function lineDiff(a, b) {
  const left = a.split("\n");
  const right = b.split("\n");
  assert.equal(left.length, right.length);
  return left.flatMap((line, i) => (line === right[i] ? [] : [[line, right[i]]]));
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("with no flag the workspaces, editor and my-files mods are copied as real folders each carrying its marker", () => {
  const home = freshHome();
  const stub = stubRepo();
  const run = install(home, { installScript: stub.script });
  assert.equal(run.status, 0, run.stderr);
  for (const [mod, from] of [["workspaces", stub.copy], ["editor", stub.plugin], ["my-files", stub.plugin]]) {
    const dir = join(home, "mods", mod);
    assert.equal(lstatSync(dir).isSymbolicLink(), false);
    assert.equal(readFileSync(join(dir, ".installed-from"), "utf8"), from);
  }
  assert.ok(existsSync(join(home, "mods", "workspaces", "main.js")));
  assert.equal(readFileSync(join(home, "mods", "editor", "editor", "main.js"), "utf8"), "built editor/main.js");
  assert.equal(readFileSync(join(home, "mods", "editor", "format", "run.js"), "utf8"), "built format/run.js");
  assert.equal(readFileSync(join(home, "mods", "my-files", "files", "main.js"), "utf8"), "built files/main.js");
  assert.ok(existsSync(join(home, "mods", "my-files", "icons", "a.svg")));
});

test("the installed layout swaps only the Files mod to my-files", () => {
  const home = freshHome();
  const run = install(home, { installScript: stubRepo().script });
  assert.equal(run.status, 0, run.stderr);
  const diff = lineDiff(repoLayout, installedLayout(home));
  assert.equal(diff.length, 1);
  assert.equal(diff[0][0].trim(), '"mod": "files"');
  assert.equal(diff[0][1].trim(), '"mod": "my-files"');
  assert.match(run.stdout, /my-files/);
  assert.match(installedLayout(home), /"id": "files"/);
  assert.match(installedLayout(home), /"active": "files"/);
});

test("rerunning updates a copy in place and removes a file gone from the source", () => {
  const home = freshHome();
  const stub = stubRepo();
  assert.equal(install(home, { installScript: stub.script }).status, 0);
  const first = installedLayout(home);
  writeFileSync(join(stub.copy, "mods", "workspaces", "extra.js"), "x");
  assert.equal(install(home, { installScript: stub.script }).status, 0);
  assert.ok(existsSync(join(home, "mods", "workspaces", "extra.js")));
  rmSync(join(stub.copy, "mods", "workspaces", "extra.js"));
  rmSync(join(stub.plugin, "mods", "my-files", "icons", "a.svg"));
  writeFileSync(join(stub.plugin, "mods", "my-files", "main.js"), "changed");
  const run = install(home, { installScript: stub.script });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(!existsSync(join(home, "mods", "workspaces", "extra.js")));
  assert.ok(!existsSync(join(home, "mods", "my-files", "icons", "a.svg")));
  assert.equal(readFileSync(join(home, "mods", "my-files", "main.js"), "utf8"), "changed");
  assert.equal(installedLayout(home), first);
});

test("the workspaces mod is copied without test files", () => {
  const home = freshHome();
  install(home, { args: ["--without", "editor"], installScript: stubRepo().script });
  const mod = join(home, "mods", "workspaces");
  assert.ok(existsSync(join(mod, "main.js")));
  assert.ok(!existsSync(join(mod, "lib.test.js")));
});

test("without editor installs only the workspaces mod and the layout on the shipped Files mod, building nothing", () => {
  const home = freshHome();
  const stub = stubRepo();
  const run = install(home, { args: ["--without", "editor"], installScript: stub.script });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readdirSync(join(home, "mods")), ["workspaces"]);
  assert.equal(installedLayout(home), repoLayout);
  assert.ok(!existsSync(join(stub.plugin, "build-ran")));
});

test("without editor leaves the editor and my-files copies of an earlier full install on disk and puts the layout back on files", () => {
  const home = freshHome();
  const stub = stubRepo();
  assert.equal(install(home, { installScript: stub.script }).status, 0);
  rmSync(join(stub.plugin, "build-ran"));
  writeFileSync(join(stub.plugin, "mods", "editor", "main.js"), "changed after the first install");
  const run = install(home, { args: ["--without", "editor"], installScript: stub.script });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readdirSync(join(home, "mods")).sort(), ["editor", "my-files", "workspaces"]);
  assert.equal(readFileSync(join(home, "mods", "editor", "main.js"), "utf8"), "export { default } from './editor/main.js';");
  assert.ok(existsSync(join(home, "mods", "my-files", "files", "main.js")));
  assert.equal(installedLayout(home), repoLayout);
  assert.ok(!existsSync(join(stub.plugin, "build-ran")));
});

test("a foreign layout file makes the script refuse and write nothing", () => {
  const home = freshHome();
  mkdirSync(join(home, "layouts"), { recursive: true });
  writeFileSync(join(home, "layouts", "workspaces.json"), "foreign");
  const run = install(home, { installScript: stubRepo().script });
  assert.equal(run.status, 1);
  assert.equal(installedLayout(home), "foreign");
  assert.deepEqual(readdirSync(home), ["layouts"]);
});

test("a source layout naming the Files mod twice is refused before anything is written", () => {
  const home = freshHome();
  const run = install(home, { installScript: stubRepo({ layoutText: repoLayout + '"mod": "files"\n' }).script });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /exactly once/);
  assertNothingWritten(home);
});

test("a source layout without the Files mod is refused before anything is written", () => {
  const home = freshHome();
  const run = install(home, { installScript: stubRepo({ layoutText: repoLayout.replace('"mod": "files"', '"mod": "other"') }).script });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /exactly once/);
  assertNothingWritten(home);
});

test("a missing source layout is refused before anything is written", () => {
  const home = freshHome();
  const run = install(home, { installScript: stubRepo({ layoutText: null }).script });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /exactly once/);
  assertNothingWritten(home);
});

test("an unknown plugin name is refused with a message and nothing is written", () => {
  const home = freshHome();
  const stub = stubRepo();
  const run = install(home, { args: ["--without", "nope"], installScript: stub.script });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /nope/);
  assertNothingWritten(home);
  assert.ok(!existsSync(join(stub.plugin, "build-ran")));
});

test("--without with no value is refused and nothing is written", () => {
  const home = freshHome();
  const run = spawnSync("sh", [stubRepo().script, home, "--without"], { encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /--without/);
  assertNothingWritten(home);
});

test("no app home, two app homes and an app home that is not a folder are refused", () => {
  const stub = stubRepo();
  const home = freshHome();
  const other = freshHome();
  const file = join(home, "plain");
  writeFileSync(file, "x");
  for (const args of [[], [home, other], [file], [join(home, "missing")]]) {
    const run = spawnSync("sh", [stub.script, ...args], { encoding: "utf8" });
    assert.notEqual(run.status, 0, args.join(" "));
    assert.match(run.stderr, /usage/);
  }
  assert.deepEqual(readdirSync(home), ["plain"]);
  assertNothingWritten(other);
});

for (const mod of ["editor", "my-files"]) {
  test(`a ${mod} link pointing outside the repository is refused and nothing is written`, () => {
    const home = freshHome();
    const elsewhere = scratchDir("install-elsewhere-");
    mkdirSync(join(home, "mods"));
    symlinkSync(elsewhere, join(home, "mods", mod));
    const run = install(home, { installScript: stubRepo().script });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /refusing/);
    assert.equal(lstatSync(join(home, "mods", mod)).isSymbolicLink(), true);
    assert.deepEqual(readdirSync(elsewhere), []);
    assert.deepEqual(readdirSync(join(home, "mods")), [mod]);
    assert.ok(!existsSync(join(home, "layouts")));
  });

  test(`a ${mod} folder whose marker names another path is refused and nothing is written`, () => {
    const home = freshHome();
    mkdirSync(join(home, "mods", mod), { recursive: true });
    writeFileSync(join(home, "mods", mod, ".installed-from"), "/some/other/repo");
    const run = install(home, { installScript: stubRepo().script });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /refusing/);
    assert.deepEqual(readdirSync(join(home, "mods")), [mod]);
    assert.equal(readFileSync(join(home, "mods", mod, ".installed-from"), "utf8"), "/some/other/repo");
    assert.ok(!existsSync(join(home, "layouts")));
  });

  test(`a ${mod} folder whose marker is a link is refused and not written through`, () => {
    const home = freshHome();
    const stub = stubRepo();
    const outside = join(scratchDir("install-outside-"), "marker");
    writeFileSync(outside, stub.plugin);
    mkdirSync(join(home, "mods", mod), { recursive: true });
    symlinkSync(outside, join(home, "mods", mod, ".installed-from"));
    const run = install(home, { installScript: stub.script });
    assert.notEqual(run.status, 0);
    assert.equal(readFileSync(outside, "utf8"), stub.plugin);
    assert.deepEqual(readdirSync(join(home, "mods")), [mod]);
    assert.ok(!existsSync(join(home, "layouts")));
  });
}

test("a plugin build that fails stops the install before any copy", () => {
  const home = freshHome();
  const run = install(home, { installScript: stubRepo({ build: "exit 1" }).script });
  assert.notEqual(run.status, 0);
  assertNothingWritten(home);
});

test("the real repository installs every mod with its built output", () => {
  const home = freshHome();
  const run = install(home);
  assert.equal(run.status, 0, run.stderr);
  const mods = join(home, "mods");
  assert.deepEqual(readdirSync(mods).sort(), ["editor", "my-files", "workspaces"]);
  for (const path of ["editor/editor/main.js", "editor/format/index.js", "my-files/files/main.js", "my-files/icons", "workspaces/main.js"]) {
    assert.ok(existsSync(join(mods, path)), path);
  }
  assert.match(installedLayout(home), /"mod": "my-files"/);
});
