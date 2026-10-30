import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const script = join(repo, "bin", "install");
const repoLayout = readFileSync(join(repo, "layouts", "workspaces.json"), "utf8");
const homes = [];

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), "install-test-"));
  homes.push(home);
  return home;
}

function install(home, installScript = script) {
  return spawnSync("sh", [installScript, home], { encoding: "utf8" });
}

// A copy of the repository whose source layout the test can alter before installing.
function repoCopy(layoutText) {
  const copy = mkdtempSync(join(tmpdir(), "install-repo-"));
  homes.push(copy);
  for (const dir of ["bin", "mods", "layouts"]) cpSync(join(repo, dir), join(copy, dir), { recursive: true });
  if (layoutText === null) rmSync(join(copy, "layouts", "workspaces.json"));
  else writeFileSync(join(copy, "layouts", "workspaces.json"), layoutText);
  return join(copy, "bin", "install");
}

function assertNothingWritten(home) {
  assert.ok(!existsSync(join(home, "mods", "workspaces")));
  assert.ok(!existsSync(join(home, "layouts", "workspaces.json")));
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
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

test("a home with a my-files mod directory gets the layout with only the Files mod swapped", () => {
  const home = freshHome();
  mkdirSync(join(home, "mods", "my-files"), { recursive: true });
  const run = install(home);
  assert.equal(run.status, 0, run.stderr);
  const diff = lineDiff(repoLayout, installedLayout(home));
  assert.equal(diff.length, 1);
  assert.equal(diff[0][0].trim(), '"mod": "files"');
  assert.equal(diff[0][1].trim(), '"mod": "my-files"');
  assert.match(run.stdout, /my-files/);
});

test("the swap leaves the files block id and active entries untouched", () => {
  const home = freshHome();
  mkdirSync(join(home, "mods", "my-files"), { recursive: true });
  assert.equal(install(home).status, 0);
  const layout = installedLayout(home);
  assert.match(layout, /"id": "files"/);
  assert.match(layout, /"active": "files"/);
  assert.doesNotMatch(layout, /my-my-files|"id": "my-files"|"active": "my-files"/);
});

test("rerunning on the same home gives the same swapped layout", () => {
  const home = freshHome();
  mkdirSync(join(home, "mods", "my-files"), { recursive: true });
  assert.equal(install(home).status, 0);
  const first = installedLayout(home);
  const run = install(home);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(installedLayout(home), first);
  assert.doesNotMatch(first, /my-my-files/);
});

test("a home without my-files gets the repository layout byte for byte", () => {
  const home = freshHome();
  const run = install(home);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(installedLayout(home), repoLayout);
});

test("a my-files plain file does not count as the mod", () => {
  const home = freshHome();
  mkdirSync(join(home, "mods"), { recursive: true });
  writeFileSync(join(home, "mods", "my-files"), "not a directory");
  const run = install(home);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(installedLayout(home), repoLayout);
});

test("a home that lost its my-files mod goes back to the shipped files mod", () => {
  const home = freshHome();
  mkdirSync(join(home, "mods", "my-files"), { recursive: true });
  assert.equal(install(home).status, 0);
  rmSync(join(home, "mods", "my-files"), { recursive: true });
  const run = install(home);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(installedLayout(home), repoLayout);
});

test("the mod folder is copied without test files and carries the installed-from marker", () => {
  const home = freshHome();
  install(home);
  const mod = join(home, "mods", "workspaces");
  assert.ok(existsSync(join(mod, "main.js")));
  assert.ok(!existsSync(join(mod, "lib.test.js")));
  assert.equal(readFileSync(join(mod, ".installed-from"), "utf8"), repo);
});

test("a foreign layout file makes the script refuse and write nothing", () => {
  const home = freshHome();
  mkdirSync(join(home, "layouts"), { recursive: true });
  writeFileSync(join(home, "layouts", "workspaces.json"), "foreign");
  const run = install(home);
  assert.equal(run.status, 1);
  assert.equal(installedLayout(home), "foreign");
  assert.ok(!existsSync(join(home, "mods", "workspaces")));
});

test("a source layout naming the Files mod twice is refused before anything is written", () => {
  const home = freshHome();
  const run = install(home, repoCopy(repoLayout + '"mod": "files"\n'));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /exactly once/);
  assertNothingWritten(home);
});

test("a source layout without the Files mod is refused before anything is written", () => {
  const home = freshHome();
  const run = install(home, repoCopy(repoLayout.replace('"mod": "files"', '"mod": "other"')));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /exactly once/);
  assertNothingWritten(home);
});

test("a missing source layout is refused before anything is written", () => {
  const home = freshHome();
  const run = install(home, repoCopy(null));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /exactly once/);
  assertNothingWritten(home);
});
