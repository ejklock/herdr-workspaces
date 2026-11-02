import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "..", "..", "bin", "install-files");
const svgs = ["chevron-down.svg", "chevron-right.svg", "file.svg", "folder.svg"];
const icons = ["icons/nodejs.svg", "icons/folder-src-open.svg"];

let root: string;
let repo: string;
let home: string;

const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
const source = (name: string) => join(repo, "mods", "my-files", name);
const target = (name = "") => join(home, "mods", "my-files", name);
const editorSource = (name: string) => join(repo, "mods", "editor", name);
const editorTarget = (name = "") => join(home, "mods", "editor", name);
const install = (...args: string[]) => spawnSync("sh", [join(repo, "bin", "install-files"), ...args], { encoding: "utf8" });
const tree = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? tree(join(dir, e.name)).map(f => `${e.name}/${f}`) : [e.name])).sort();

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "install-files-")));
  repo = join(root, "repo");
  home = join(root, "app home");
  mkdirSync(join(repo, "bin"), { recursive: true });
  copyFileSync(script, join(repo, "bin", "install-files"));
  chmodSync(join(repo, "bin", "install-files"), 0o755);
  for (const name of ["main.js", "mod.json", ...svgs]) write(source(name), `src ${name}`);
  for (const name of icons) write(source(name), `icon ${name}`);
  for (const name of ["main.js", "tree.js"]) write(source(`files/${name}`), `built ${name}`);
  write(editorSource("main.js"), "export { default } from \"./editor/main.js\";");
  write(editorSource("mod.json"), "{}");
  for (const name of ["editor/main.js", "editor/pane.js", "format/run.js"]) write(editorSource(name), `built ${name}`);
  for (const name of ["editor/pane.d.ts", "jsconfig.json", "editor/pane.test.js"]) write(editorSource(name), "not shipped");
  for (const name of ["gpui-kit.d.ts", "jsconfig.json", "files/gpui-kit.d.ts", "files/tree.d.ts", "files/tree.test.js"]) write(source(name), "not shipped");
  mkdirSync(home, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("installing my-files", () => {
  it("copies the built mod into a new real folder and marks it with the repo path", () => {
    const run = install(home);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(lstatSync(target()).isSymbolicLink(), false);
    assert.deepEqual(tree(target()), [".installed-from", ...svgs, ...icons, "files/main.js", "files/tree.js", "main.js", "mod.json"].sort());
    assert.equal(readFileSync(target(".installed-from"), "utf8"), repo);
    assert.equal(readFileSync(target("files/main.js"), "utf8"), "built main.js");
  });

  it("works for an app home path with spaces", () => {
    assert.equal(install(home).status, 0);
    assert.ok(existsSync(target("mod.json")));
  });

  it("replaces a link into the repo with a real folder and leaves the repo files untouched", () => {
    mkdirSync(join(home, "mods"));
    symlinkSync(join(repo, "mods", "my-files"), target());
    const run = install(home);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(lstatSync(target()).isSymbolicLink(), false);
    assert.equal(readFileSync(source("main.js"), "utf8"), "src main.js");
    assert.equal(existsSync(source(".installed-from")), false);
    assert.ok(existsSync(source("gpui-kit.d.ts")));
    assert.ok(existsSync(source("files/tree.test.js")));
  });

  it("refuses a link pointing elsewhere and leaves it untouched", () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(join(home, "mods"));
    symlinkSync(elsewhere, target());
    const run = install(home);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /refusing/);
    assert.equal(lstatSync(target()).isSymbolicLink(), true);
    assert.deepEqual(readdirSync(elsewhere), []);
  });

  it("refuses a real folder without the marker and leaves it untouched", () => {
    write(target("mine.txt"), "keep");
    const run = install(home);
    assert.notEqual(run.status, 0);
    assert.deepEqual(tree(target()), ["mine.txt"]);
  });

  it("refuses a real folder marked by another repo and leaves it untouched", () => {
    write(target(".installed-from"), "/some/other/repo");
    write(target("mine.txt"), "keep");
    const run = install(home);
    assert.notEqual(run.status, 0);
    assert.deepEqual(tree(target()), [".installed-from", "mine.txt"]);
    assert.equal(readFileSync(target(".installed-from"), "utf8"), "/some/other/repo");
  });

  it("removes from the copy a file that is gone from the source on a rerun", () => {
    assert.equal(install(home).status, 0);
    rmSync(source("folder.svg"));
    rmSync(source("files/tree.js"));
    assert.equal(install(home).status, 0);
    assert.equal(existsSync(target("folder.svg")), false);
    assert.equal(existsSync(target("files/tree.js")), false);
    assert.ok(existsSync(target("file.svg")));
  });

  it("updates a changed source file in place on a rerun", () => {
    assert.equal(install(home).status, 0);
    write(source("files/main.js"), "rebuilt");
    assert.equal(install(home).status, 0);
    assert.equal(readFileSync(target("files/main.js"), "utf8"), "rebuilt");
  });

  it("removes a link planted for a file inside the copy instead of writing through it", () => {
    assert.equal(install(home).status, 0);
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "untouched");
    rmSync(target("main.js"));
    symlinkSync(outside, target("main.js"));
    rmSync(target("files/tree.js"));
    symlinkSync(outside, target("files/tree.js"));
    const run = install(home);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(outside, "utf8"), "untouched");
    assert.equal(lstatSync(target("main.js")).isSymbolicLink(), false);
    assert.equal(readFileSync(target("main.js"), "utf8"), "src main.js");
    assert.equal(readFileSync(target("files/tree.js"), "utf8"), "built tree.js");
  });

  it("removes a link planted for the files folder inside the copy instead of writing through it", () => {
    assert.equal(install(home).status, 0);
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "untouched");
    rmSync(target("files"), { recursive: true });
    symlinkSync(outside, target("files"));
    const run = install(home);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(readdirSync(outside), ["keep.txt"]);
    assert.equal(lstatSync(target("files")).isDirectory(), true);
    assert.equal(readFileSync(target("files/main.js"), "utf8"), "built main.js");
  });

  it("copies the icons as real files and removes one gone from the source", () => {
    assert.equal(install(home).status, 0);
    assert.equal(readFileSync(target("icons/nodejs.svg"), "utf8"), "icon icons/nodejs.svg");
    assert.equal(lstatSync(target("icons/nodejs.svg")).isFile(), true);
    rmSync(source("icons/nodejs.svg"));
    assert.equal(install(home).status, 0);
    assert.equal(existsSync(target("icons/nodejs.svg")), false);
    assert.ok(existsSync(target("icons/folder-src-open.svg")));
  });

  it("removes a link planted for an icon instead of writing through it", () => {
    assert.equal(install(home).status, 0);
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "untouched");
    rmSync(target("icons/nodejs.svg"));
    symlinkSync(outside, target("icons/nodejs.svg"));
    const run = install(home);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(outside, "utf8"), "untouched");
    assert.equal(lstatSync(target("icons/nodejs.svg")).isSymbolicLink(), false);
    assert.equal(readFileSync(target("icons/nodejs.svg"), "utf8"), "icon icons/nodejs.svg");
  });

  it("replaces an icons folder that is a link to elsewhere with a real folder instead of writing through it", () => {
    assert.equal(install(home).status, 0);
    const outside = join(root, "outside-icons");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.svg"), "untouched");
    rmSync(target("icons"), { recursive: true });
    symlinkSync(outside, target("icons"));
    const run = install(home);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(readdirSync(outside), ["keep.svg"]);
    assert.equal(lstatSync(target("icons")).isDirectory(), true);
    assert.equal(readFileSync(target("icons/nodejs.svg"), "utf8"), "icon icons/nodejs.svg");
  });

  it("leaves the icons identical on a second run", () => {
    assert.equal(install(home).status, 0);
    const first = tree(target("icons"));
    assert.equal(install(home).status, 0);
    assert.deepEqual(tree(target("icons")), first);
    assert.equal(readFileSync(target("icons/folder-src-open.svg"), "utf8"), "icon icons/folder-src-open.svg");
  });

  it("removes a link planted for the marker instead of writing through it", () => {
    assert.equal(install(home).status, 0);
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "untouched");
    rmSync(target(".installed-from"));
    symlinkSync(outside, target(".installed-from"));
    const run = install(home);
    assert.notEqual(run.status, 0, "a marker that is a link does not prove ownership");
    assert.equal(readFileSync(outside, "utf8"), "untouched");
  });

  it("refuses a marker that is a link and leaves its target unchanged even when the target holds the repo path", () => {
    assert.equal(install(home).status, 0);
    const outside = join(root, "outside.txt");
    writeFileSync(outside, `${repo}\n`);
    rmSync(target(".installed-from"));
    symlinkSync(outside, target(".installed-from"));
    const run = install(home);
    assert.notEqual(run.status, 0, "a marker that is a link does not prove ownership");
    assert.equal(readFileSync(outside, "utf8"), `${repo}\n`);
    assert.equal(lstatSync(target(".installed-from")).isSymbolicLink(), true);
  });

  it("refuses a folder whose marker holds the repo path followed by more text", () => {
    mkdirSync(target(), { recursive: true });
    writeFileSync(target(".installed-from"), `${repo}-old`);
    writeFileSync(target("keep.txt"), "kept");
    const run = install(home);
    assert.notEqual(run.status, 0);
    assert.equal(readFileSync(target("keep.txt"), "utf8"), "kept");
    assert.equal(readFileSync(target(".installed-from"), "utf8"), `${repo}-old`);
  });

  it("refuses a link into a sibling folder whose name begins with the repo's name and leaves it untouched", () => {
    const sibling = join(root, "repo-old");
    mkdirSync(join(sibling, "mods", "my-files"), { recursive: true });
    writeFileSync(join(sibling, "mods", "my-files", "keep.txt"), "kept");
    mkdirSync(join(home, "mods"));
    symlinkSync(join(sibling, "mods", "my-files"), target());
    const run = install(home);
    assert.notEqual(run.status, 0);
    assert.equal(lstatSync(target()).isSymbolicLink(), true);
    assert.deepEqual(readdirSync(join(sibling, "mods", "my-files")), ["keep.txt"]);
  });

  it("recognises its own copy on the next run after a copy that failed partway", () => {
    chmodSync(source("main.js"), 0o000);
    const failed = install(home);
    chmodSync(source("main.js"), 0o644);
    assert.notEqual(failed.status, 0, "the copy of an unreadable file fails");
    assert.equal(readFileSync(target(".installed-from"), "utf8"), repo);
    const run = install(home);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(target("main.js"), "utf8"), "src main.js");
  });

  it("never copies declaration files, the jsconfig or test files", () => {
    assert.equal(install(home).status, 0);
    const copied = tree(target());
    assert.deepEqual(copied.filter(f => /\.d\.ts$|jsconfig\.json$|\.test\.js$/.test(f)), []);
  });

  it("removes a declaration file found in the copy", () => {
    assert.equal(install(home).status, 0);
    write(target("gpui-kit.d.ts"), "stale");
    assert.equal(install(home).status, 0);
    assert.equal(existsSync(target("gpui-kit.d.ts")), false);
  });

  it("refuses when the build output is missing, names npm run build and writes nothing", () => {
    rmSync(source("files/main.js"));
    const run = install(home);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /npm run build/);
    assert.equal(existsSync(join(home, "mods")), false);
  });

  it("copies the built editor mod into a new real folder with its own marker and no declaration or test files", () => {
    const run = install(home);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(lstatSync(editorTarget()).isSymbolicLink(), false);
    assert.deepEqual(tree(editorTarget()), [".installed-from", "editor/main.js", "editor/pane.js", "format/run.js", "main.js", "mod.json"].sort());
    assert.equal(readFileSync(editorTarget(".installed-from"), "utf8"), repo);
    assert.equal(readFileSync(editorTarget("editor/pane.js"), "utf8"), "built editor/pane.js");
  });

  it("updates the editor copy on a rerun and removes a built file gone from the source", () => {
    assert.equal(install(home).status, 0);
    write(editorSource("editor/main.js"), "rebuilt");
    rmSync(editorSource("format/run.js"));
    assert.equal(install(home).status, 0);
    assert.equal(readFileSync(editorTarget("editor/main.js"), "utf8"), "rebuilt");
    assert.equal(existsSync(editorTarget("format/run.js")), false);
  });

  it("replaces an editor link into the repo with a real folder", () => {
    mkdirSync(join(home, "mods"));
    symlinkSync(join(repo, "mods", "editor"), editorTarget());
    const run = install(home);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(lstatSync(editorTarget()).isSymbolicLink(), false);
    assert.equal(existsSync(editorSource(".installed-from")), false);
  });

  it("refuses an editor link pointing elsewhere and writes neither mod", () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(join(home, "mods"));
    symlinkSync(elsewhere, editorTarget());
    const run = install(home);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /refusing/);
    assert.equal(lstatSync(editorTarget()).isSymbolicLink(), true);
    assert.deepEqual(readdirSync(elsewhere), []);
    assert.equal(existsSync(target()), false);
  });

  it("refuses an editor folder marked by another repo and writes neither mod", () => {
    write(editorTarget(".installed-from"), "/some/other/repo");
    const run = install(home);
    assert.notEqual(run.status, 0);
    assert.deepEqual(tree(editorTarget()), [".installed-from"]);
    assert.equal(existsSync(target()), false);
  });

  it("refuses an editor folder whose marker is a link and does not write through it", () => {
    const outside = join(root, "outside.txt");
    writeFileSync(outside, repo);
    mkdirSync(editorTarget(), { recursive: true });
    symlinkSync(outside, editorTarget(".installed-from"));
    const run = install(home);
    assert.notEqual(run.status, 0);
    assert.equal(readFileSync(outside, "utf8"), repo);
    assert.equal(existsSync(target()), false);
  });

  it("refuses when the editor build output is missing, names npm run build and writes nothing", () => {
    rmSync(editorSource("editor/main.js"));
    const run = install(home);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /npm run build/);
    assert.equal(existsSync(join(home, "mods")), false);
  });

  it("prints usage and exits 2 without an argument", () => {
    const run = install();
    assert.equal(run.status, 2);
    assert.match(run.stderr, /usage/);
  });

  it("prints usage and exits 2 for a missing app home and writes nothing", () => {
    const missing = join(root, "nope");
    const run = install(missing);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /usage/);
    assert.equal(existsSync(missing), false);
  });
});
