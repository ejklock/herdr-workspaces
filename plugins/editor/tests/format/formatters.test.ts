import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveFormatter, runFormatter } from "../../src/format/index.ts";

type Host = Parameters<typeof resolveFormatter>[0];

const host: Host = {
  exec(command, args = [], options) {
    return new Promise(resolve => execFile(command, args, { cwd: options?.cwd }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr })));
  },
  async writeTextFile(path, text, expected) {
    if (expected === null) await access(path).then(() => Promise.reject(new Error("exists")), () => undefined);
    await writeFile(path, text);
    return null;
  },
  readTextFile(path) {
    return readFile(path, "utf8").catch(() => null);
  },
};

let root = "";
let scratch = "";
let home = "";
const savedPath = process.env["PATH"];
const savedTmp = process.env["TMPDIR"];
const savedHome = process.env["HOME"];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fmt-root-"));
  scratch = await mkdtemp(join(tmpdir(), "fmt-tmp-"));
  home = await mkdtemp(join(tmpdir(), "fmt-home-"));
  process.env["TMPDIR"] = scratch;
  process.env["HOME"] = home;
  process.env["PATH"] = `${join(root, "bin")}:/usr/bin:/bin`;
});
afterEach(async () => {
  process.env["PATH"] = savedPath;
  if (savedTmp === undefined) delete process.env["TMPDIR"]; else process.env["TMPDIR"] = savedTmp;
  if (savedHome === undefined) delete process.env["HOME"]; else process.env["HOME"] = savedHome;
  await rm(root, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

async function tool(path: string, body = "cat"): Promise<string> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, `#!/bin/sh\n${body}\n`);
  await chmod(full, 0o755);
  return full;
}

async function file(path: string, text = "x\n"): Promise<string> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text);
  return full;
}

/** A prettier binary under `base` whose package.json lists prettier among its devDependencies. */
async function prettier(base: string, body = "cat"): Promise<string> {
  await file(`${base}package.json`, '{ "devDependencies": { "prettier": "^3.0.0" } }\n');
  return tool(`${base}node_modules/.bin/prettier`, body);
}

async function nameFor(path: string): Promise<string | undefined> {
  return (await resolveFormatter(host, path))?.name;
}

describe("formatter resolution", () => {
  it("picks prettier for a ts file under a declared node_modules/.bin/prettier ancestor", async () => {
    await prettier("");
    assert.equal(await nameFor(await file("src/deep/a.ts")), "prettier");
  });

  it("picks prettier declared by a .prettierrc with no package.json entry", async () => {
    await tool("node_modules/.bin/prettier"); await file(".prettierrc", "{}");
    assert.equal(await nameFor(await file("a.ts")), "prettier");
  });

  it("picks prettier declared by a prettier.config file", async () => {
    await tool("node_modules/.bin/prettier"); await file("prettier.config.mjs", "export default {};");
    assert.equal(await nameFor(await file("a.ts")), "prettier");
  });

  it("picks prettier declared by a .prettierrc extension file", async () => {
    await tool("node_modules/.bin/prettier"); await file(".prettierrc.json", "{}");
    assert.equal(await nameFor(await file("a.ts")), "prettier");
  });

  it("picks prettier declared by a prettier key in package.json", async () => {
    await tool("node_modules/.bin/prettier"); await file("package.json", '{ "name": "p", "prettier": { "semi": false } }\n');
    assert.equal(await nameFor(await file("a.ts")), "prettier");
  });

  it("picks prettier declared in dependencies", async () => {
    await tool("node_modules/.bin/prettier"); await file("package.json", '{ "dependencies": { "prettier": "3" } }\n');
    assert.equal(await nameFor(await file("a.ts")), "prettier");
  });

  it("picks nothing for a prettier binary present only through hoisting", async () => {
    await tool("node_modules/.bin/prettier");
    await file("package.json", '{ "devDependencies": { "eslint": "9" }, "scripts": { "prettier": "echo" }, "peerDependencies": { "prettier": "3" } }\n');
    assert.equal(await nameFor(await file("a.ts")), undefined);
  });

  it("picks nothing for a prettier binary with no package.json at all", async () => {
    await tool("node_modules/.bin/prettier");
    assert.equal(await nameFor(await file("a.ts")), undefined);
  });

  it("picks biome when biome.json sits with a biome binary", async () => {
    await tool("node_modules/.bin/biome"); await prettier(""); await file("biome.json", "{}");
    assert.equal(await nameFor(await file("a.ts")), "biome");
  });

  it("picks biome when biome.jsonc sits with a biome binary", async () => {
    await tool("node_modules/.bin/biome"); await file("biome.jsonc", "{}");
    assert.equal(await nameFor(await file("a.ts")), "biome");
  });

  it("picks biome when the binary is in a package and biome.json is at the monorepo root", async () => {
    await tool("packages/a/node_modules/.bin/biome"); await file("biome.json", "{}");
    assert.equal(await nameFor(await file("packages/a/src/x.ts")), "biome");
  });

  it("picks nothing when a biome binary has no config anywhere up the tree", async () => {
    await tool("node_modules/.bin/biome");
    assert.equal(await nameFor(await file("a.ts")), undefined);
  });

  it("picks prettier when both binaries exist but there is no biome config", async () => {
    await tool("node_modules/.bin/biome"); await prettier("");
    assert.equal(await nameFor(await file("a.ts")), "prettier");
  });

  it("picks the nested package's prettier over the repository's", async () => {
    await prettier(""); await prettier("packages/a/");
    const formatter = await resolveFormatter(host, await file("packages/a/src/x.ts"));
    assert.equal(formatter?.name, "prettier");
    assert.match(formatter?.root ?? "", /packages\/a$/);
  });

  it("picks prettier for json, css, md and yaml files", async () => {
    await prettier("");
    for (const name of ["a.json", "a.css", "a.md", "a.yaml"]) assert.equal(await nameFor(await file(name)), "prettier", name);
  });

  it("picks pint for a php file with vendor/bin/pint", async () => {
    await tool("vendor/bin/pint"); await tool("vendor/bin/php-cs-fixer");
    assert.equal(await nameFor(await file("app/a.php")), "pint");
  });

  it("picks php-cs-fixer for a php file with only vendor/bin/php-cs-fixer", async () => {
    await tool("vendor/bin/php-cs-fixer");
    assert.equal(await nameFor(await file("a.php")), "php-cs-fixer");
  });

  it("picks rustfmt for a rs file with a Cargo.toml up the tree and rustfmt on PATH", async () => {
    await tool("bin/rustfmt"); await file("Cargo.toml", "[package]\n");
    assert.equal(await nameFor(await file("src/main.rs")), "rustfmt");
  });

  it("picks nothing for a rs file with no Cargo.toml", async () => {
    await tool("bin/rustfmt");
    assert.equal(await nameFor(await file("src/main.rs")), undefined);
  });

  it("picks nothing when prettier is only on the global PATH", async () => {
    await tool("bin/prettier");
    assert.equal(await nameFor(await file("a.ts")), undefined);
  });

  it("picks nothing for a php file in a project that only has prettier", async () => {
    await prettier("");
    assert.equal(await nameFor(await file("a.php")), undefined);
  });

  it("picks nothing for txt and py files", async () => {
    await prettier(""); await tool("vendor/bin/pint");
    assert.equal(await nameFor(await file("a.txt")), undefined);
    assert.equal(await nameFor(await file("a.py")), undefined);
  });

  it("resolves a project path with a space and non-ASCII letters like any other", async () => {
    await prettier("ação teste/");
    assert.equal(await nameFor(await file("ação teste/src/a.ts")), "prettier");
  });

  it("resolves a symlinked file from its target's directory", async () => {
    await prettier("one/"); await file("two/real.ts");
    await mkdir(join(root, "one/src"), { recursive: true });
    await symlink(join(root, "two/real.ts"), join(root, "one/src/link.ts"));
    assert.equal(await nameFor(join(root, "one/src/link.ts")), undefined);
    await prettier("two/");
    assert.equal(await nameFor(join(root, "one/src/link.ts")), "prettier");
  });
});

describe("formatter run", () => {
  const upper = "tr a-z A-Z";

  async function runRust(): Promise<string> {
    const formatter = await resolveFormatter(host, await file("crates/m/src/main.rs"));
    assert.ok(formatter);
    return runFormatter(host, formatter, "fn\n");
  }

  it("feeds the text to prettier's stdin with the file path, from the project root, and leaves no temp file", async () => {
    await prettier("", `pwd -P; echo "$@"; ${upper}`);
    const path = await file("src/a.ts", "keep\n");
    const formatter = await resolveFormatter(host, path);
    assert.ok(formatter);
    const out = await runFormatter(host, formatter, "abc\n");
    const rootReal = (await host.exec("realpath", [root])).stdout.trim();
    const pathReal = (await host.exec("realpath", [path])).stdout.trim();
    assert.equal(out, `${rootReal}\n--stdin-filepath ${pathReal}\nABC\n`);
    assert.deepEqual(await readdir(scratch), []);
    assert.deepEqual(await readdir(join(root, "src")), ["a.ts"]);
  });

  it("runs biome's format subcommand with --stdin-file-path", async () => {
    await tool("node_modules/.bin/biome", `echo "$@"; ${upper}`); await file("biome.json", "{}");
    const path = await file("a.ts");
    const formatter = await resolveFormatter(host, path);
    assert.ok(formatter);
    const pathReal = (await host.exec("realpath", [path])).stdout.trim();
    assert.equal(await runFormatter(host, formatter, "q\n"), `format --stdin-file-path=${pathReal}\nQ\n`);
  });

  it("runs rustfmt with stdout emission and the edition from Cargo.toml", async () => {
    await tool("bin/rustfmt", `echo "$@"; ${upper}`); await file("Cargo.toml", '[package]\nedition = "2018"\n');
    const formatter = await resolveFormatter(host, await file("src/main.rs"));
    assert.ok(formatter);
    assert.equal(await runFormatter(host, formatter, "fn\n"), "--emit stdout --edition 2018\nFN\n");
  });

  it("runs rustfmt with the workspace root's edition for a member that inherits it", async () => {
    await tool("bin/rustfmt", `echo "$@"; ${upper}`);
    await file("Cargo.toml", '[workspace]\nmembers = ["crates/m"]\n\n[workspace.package]\nversion = "0.1.0"\nedition = "2024"\n\n[workspace.dependencies]\nedition = "1999"\n');
    await file("crates/m/Cargo.toml", '[package]\nname = "m"\nedition.workspace = true\n');
    assert.equal(await runRust(), "--emit stdout --edition 2024\nFN\n");
  });

  it("ignores a [package] edition in the workspace root when [workspace.package] sets another", async () => {
    await tool("bin/rustfmt", `echo "$@"; ${upper}`);
    await file("Cargo.toml", '[package]\nname = "root"\nedition = "2018"\n\n[workspace]\nmembers = ["crates/m"]\n\n[workspace.package]\nedition = "2024"\n');
    await file("crates/m/Cargo.toml", '[package]\nname = "m"\nedition.workspace = true\n');
    assert.equal(await runRust(), "--emit stdout --edition 2024\nFN\n");
  });

  it("prefers a member's literal edition over the workspace's", async () => {
    await tool("bin/rustfmt", `echo "$@"; ${upper}`);
    await file("Cargo.toml", '[workspace]\nmembers = ["crates/m"]\n[workspace.package]\nedition = "2024"\n');
    await file("crates/m/Cargo.toml", '[package]\nname = "m"\nedition = "2018"\n');
    assert.equal(await runRust(), "--emit stdout --edition 2018\nFN\n");
  });

  it("formats a php file through a temp copy with the project's pint config and never touches the project file", async () => {
    await tool("vendor/bin/pint", 'for last; do :; done; echo "  FIXED 1 file"; printf "FORMATTED %s" "$*" > "$last"');
    await file("pint.json", "{}");
    const path = await file("app/a.php", "orig");
    const formatter = await resolveFormatter(host, path);
    assert.ok(formatter);
    const out = await runFormatter(host, formatter, "<?php typed");
    assert.match(out, /^FORMATTED --config=.*pint\.json .*a\.php$/);
    assert.doesNotMatch(out, /FIXED/);
    assert.deepEqual(await readdir(scratch), []);
    assert.deepEqual(await readdir(join(root, "app")), ["a.php"]);
  });

  it("passes the project's php-cs-fixer config explicitly and keeps its summary out of the text", async () => {
    await tool("vendor/bin/php-cs-fixer", 'for last; do :; done; echo "Fixed all files"; printf "%s" "$*" > "$last"');
    await file(".php-cs-fixer.dist.php", "<?php");
    const formatter = await resolveFormatter(host, await file("a.php"));
    assert.ok(formatter);
    const out = await runFormatter(host, formatter, "<?php");
    assert.match(out, /^fix --using-cache=no --no-interaction --config=.*\.php-cs-fixer\.dist\.php /);
    assert.doesNotMatch(out, /Fixed all/);
  });

  it("rejects a non-zero exit with the formatter's message and removes the temp file", async () => {
    await prettier("", "echo boom >&2; exit 2");
    const formatter = await resolveFormatter(host, await file("a.ts"));
    assert.ok(formatter);
    await assert.rejects(runFormatter(host, formatter, "x"), /boom/);
    assert.deepEqual(await readdir(scratch), []);
  });

  it("rejects an empty output for a non-empty text", async () => {
    await prettier("", "cat >/dev/null");
    const formatter = await resolveFormatter(host, await file("a.ts"));
    assert.ok(formatter);
    await assert.rejects(runFormatter(host, formatter, "x"), /nothing/);
    assert.deepEqual(await readdir(scratch), []);
  });

  it("creates its temp folder under TMPDIR and removes it after a successful run", async () => {
    let seen: string[] = [];
    await prettier("", "cat");
    const formatter = await resolveFormatter(host, await file("a.ts"));
    assert.ok(formatter);
    const spy: Host = { ...host, exec: async (command, args, options) => { if (command === "sh" && options?.cwd) seen = await readdir(scratch); return host.exec(command, args, options); } };
    assert.equal(await runFormatter(spy, formatter, "x\n"), "x\n");
    assert.equal(seen.length, 1);
    assert.deepEqual(await readdir(scratch), []);
  });
});

async function put(path: string, text = "{}\n"): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  return path;
}

async function exe(path: string): Promise<string> {
  await put(path, "#!/bin/sh\ncat\n");
  await chmod(path, 0o755);
  return path;
}

describe("prettier declaration boundary", () => {
  const ownDependencies = '{ "devDependencies": { "eslint": "9" } }\n';

  it("ignores a .prettierrc in the home folder above a repository", async () => {
    await put(join(home, ".prettierrc"));
    await mkdir(join(home, "repo/.git"), { recursive: true });
    await put(join(home, "repo/package.json"), ownDependencies);
    await exe(join(home, "repo/node_modules/.bin/prettier"));
    assert.equal(await nameFor(await put(join(home, "repo/a.ts"))), undefined);
  });

  it("accepts a .prettierrc at the repository root for a file in a nested package", async () => {
    await mkdir(join(home, "repo/.git"), { recursive: true });
    await put(join(home, "repo/.prettierrc"));
    await put(join(home, "repo/packages/a/package.json"), ownDependencies);
    await exe(join(home, "repo/packages/a/node_modules/.bin/prettier"));
    assert.equal(await nameFor(await put(join(home, "repo/packages/a/src/a.ts"))), "prettier");
  });

  it("ignores a package.json prettier key one folder above the repository root", async () => {
    await put(join(home, "package.json"), '{ "prettier": {} }\n');
    await mkdir(join(home, "repo/.git"), { recursive: true });
    await put(join(home, "repo/package.json"), ownDependencies);
    await exe(join(home, "repo/node_modules/.bin/prettier"));
    assert.equal(await nameFor(await put(join(home, "repo/a.ts"))), undefined);
  });

  it("accepts a package.json prettier key in the folder holding the repository's .git", async () => {
    await mkdir(join(home, "repo/.git"), { recursive: true });
    await put(join(home, "repo/package.json"), '{ "prettier": {} }\n');
    await exe(join(home, "repo/packages/a/node_modules/.bin/prettier"));
    assert.equal(await nameFor(await put(join(home, "repo/packages/a/a.ts"))), "prettier");
  });

  it("treats a .git file, as in a worktree, as the repository root", async () => {
    await put(join(home, ".prettierrc"));
    await put(join(home, "tree/.git"), "gitdir: /elsewhere\n");
    await put(join(home, "tree/package.json"), ownDependencies);
    await exe(join(home, "tree/node_modules/.bin/prettier"));
    assert.equal(await nameFor(await put(join(home, "tree/a.ts"))), undefined);
  });

  it("accepts a .prettierrc at a worktree's root, marked by a .git file, for a file in a nested package", async () => {
    await put(join(home, "tree/.git"), "gitdir: /elsewhere\n");
    await put(join(home, "tree/.prettierrc"));
    await put(join(home, "tree/packages/a/package.json"), ownDependencies);
    await exe(join(home, "tree/packages/a/node_modules/.bin/prettier"));
    assert.equal(await nameFor(await put(join(home, "tree/packages/a/a.ts"))), "prettier");
  });

  it("accepts a .prettierrc beside the binary's node_modules when there is no repository", async () => {
    await put(join(home, "proj/.prettierrc"));
    await exe(join(home, "proj/node_modules/.bin/prettier"));
    assert.equal(await nameFor(await put(join(home, "proj/src/a.ts"))), "prettier");
  });

  it("ignores a .prettierrc one folder above the binary's folder when there is no repository", async () => {
    await put(join(home, "outer/.prettierrc"));
    await put(join(home, "outer/proj/package.json"), ownDependencies);
    await exe(join(home, "outer/proj/node_modules/.bin/prettier"));
    assert.equal(await nameFor(await put(join(home, "outer/proj/a.ts"))), undefined);
  });

  it("finds a .prettierrc in the file's own folder when the binary sits in a folder above it and there is no repository", async () => {
    await put(join(home, "proj/package.json"), ownDependencies);
    await exe(join(home, "proj/node_modules/.bin/prettier"));
    await put(join(home, "proj/src/.prettierrc"));
    assert.equal(await nameFor(await put(join(home, "proj/src/a.ts"))), "prettier");
  });

  it("does not count a prettier listing in a nested package when the binary is hoisted to the repository root", async () => {
    await mkdir(join(home, "repo/.git"), { recursive: true });
    await put(join(home, "repo/package.json"), ownDependencies);
    await exe(join(home, "repo/node_modules/.bin/prettier"));
    await put(join(home, "repo/packages/x/package.json"), '{ "devDependencies": { "prettier": "3" } }\n');
    assert.equal(await nameFor(await put(join(home, "repo/packages/x/a.ts"))), undefined);
  });

  it("falls through to biome when a nested prettier binary is undeclared and a biome with its config sits further up", async () => {
    await mkdir(join(home, "repo/.git"), { recursive: true });
    await exe(join(home, "repo/node_modules/.bin/biome"));
    await put(join(home, "repo/biome.json"));
    await put(join(home, "repo/packages/x/package.json"), ownDependencies);
    await exe(join(home, "repo/packages/x/node_modules/.bin/prettier"));
    assert.equal(await nameFor(await put(join(home, "repo/packages/x/a.ts"))), "biome");
  });

  it("still counts prettier listed in devDependencies beside the binary when the home folder has a .prettierrc", async () => {
    await put(join(home, ".prettierrc"));
    await put(join(home, "repo/.git/HEAD"));
    await put(join(home, "repo/package.json"), '{ "devDependencies": { "prettier": "3" } }\n');
    await exe(join(home, "repo/node_modules/.bin/prettier"));
    assert.equal(await nameFor(await put(join(home, "repo/a.ts"))), "prettier");
  });
});

describe("package.json declaration", () => {
  const declaring = '{ "devDependencies": { "prettier": "3" } }\n';

  /** Resolves a ts file beside a prettier binary whose package.json holds `text`; no config file exists. */
  async function declared(text: string, read?: Host["readTextFile"]): Promise<boolean> {
    await put(join(home, "p/package.json"), text);
    await exe(join(home, "p/node_modules/.bin/prettier"));
    const path = await put(join(home, "p/a.ts"));
    const spy: Host = { ...host, readTextFile: read ?? host.readTextFile };
    return (await resolveFormatter(spy, path))?.name === "prettier";
  }

  const cases: [string, string, boolean][] = [
    ["devDependencies", '{ "devDependencies": { "prettier": "3" } }', true],
    ["dependencies", '{ "dependencies": { "prettier": "3" } }', true],
    ["a top-level object key", '{ "prettier": { "semi": false } }', true],
    ["a top-level string key", '{ "prettier": "@org/prettier-config" }', true],
    ["scripts", '{ "scripts": { "prettier": "echo" } }', false],
    ["peerDependencies", '{ "peerDependencies": { "prettier": "3" } }', false],
    ["optionalDependencies", '{ "optionalDependencies": { "prettier": "3" } }', false],
    ["overrides", '{ "overrides": { "prettier": "3" } }', false],
    ["nested under another dependency", '{ "dependencies": { "other": { "prettier": "3" } } }', false],
    ["a devDependencies key written with a unicode escape", '{ "devDependencies": { "\\u0070rettier": "3" } }', true],
    ["invalid JSON with a comment", '{ // note\n "devDependencies": { "prettier": "3" } }', false],
    ["a truncated file", '{ "devDependencies": { "prettier": "3" ', false],
    ["dependencies that is an array", '{ "dependencies": ["prettier"] }', false],
    ["dependencies that is a string", '{ "dependencies": "prettier" }', false],
    ["dependencies that is null", '{ "dependencies": null }', false],
    ["a top-level array", '["prettier"]', false],
    ["a top-level number", "42", false],
  ];
  for (const [title, text, expected] of cases) {
    it(`${expected ? "declares" : "does not declare"} prettier for ${title}`, async () => {
      assert.equal(await declared(text), expected);
    });
  }

  const bom = "\uFEFF";
  const bomCases: [string, string, boolean][] = [
    ["a byte order mark before devDependencies", `${bom}{"devDependencies":{"prettier":"3"}}`, true],
    ["a byte order mark before a top-level key", `${bom}{"prettier":{"semi":false}}`, true],
    ["a byte order mark before unrelated dependencies", `${bom}{"devDependencies":{"eslint":"9"}}`, false],
    ["two leading byte order marks", `${bom}${bom}{"devDependencies":{"prettier":"3"}}`, false],
    ["a byte order mark inside a string value", `{"name":"a${bom}b","devDependencies":{"prettier":"3"}}`, true],
  ];
  for (const [title, text, expected] of bomCases) {
    it(`${expected ? "declares" : "does not declare"} prettier for ${title}`, async () => {
      assert.equal(await declared(text), expected);
    });
  }

  it("does not declare prettier when the host cannot find the package.json", async () => {
    assert.equal(await declared(declaring, async () => null), false);
  });

  it("does not declare prettier, and does not throw, when reading the package.json is rejected", async () => {
    assert.equal(await declared(declaring, async () => { throw new Error("denied"); }), false);
  });
});
