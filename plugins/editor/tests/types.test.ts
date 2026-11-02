import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "..", "bin", "copy-types");
const names = ["herdr.d.ts", "gpui-kit.d.ts"];

let root: string;
let plugin: string;
let appHome: string;

const types = (name = "") => join(plugin, "types", name);
const fill = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  for (const name of names) writeFileSync(join(dir, name), `declare const ${name.replace(/\W/g, "_")}: 1;\n`);
};
const run = (env: Record<string, string | undefined>) => {
  const merged: Record<string, string | undefined> = { PATH: process.env["PATH"], HOME: join(root, "home"), ...env };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return spawnSync("sh", [join(plugin, "bin", "copy-types")], { encoding: "utf8", env: merged as NodeJS.ProcessEnv });
};
const snapshot = (): string[] =>
  existsSync(types()) ? readdirSync(types()).sort().map(n => `${n}=${readFileSync(types(n), "utf8")}`) : ["<absent>"];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "copy-types-")));
  plugin = join(root, "plugin");
  appHome = join(root, "app home");
  mkdirSync(join(plugin, "bin"), { recursive: true });
  copyFileSync(script, join(plugin, "bin", "copy-types"));
  chmodSync(join(plugin, "bin", "copy-types"), 0o755);
  mkdirSync(join(root, "home"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("copying Herdr's type files", () => {
  it("creates types/ and copies both files byte for byte from HERDR_APP_HOME", () => {
    fill(appHome);
    const result = run({ HERDR_APP_HOME: appHome });
    assert.equal(result.status, 0, result.stderr);
    for (const name of names) assert.deepEqual(readFileSync(types(name)), readFileSync(join(appHome, name)));
  });

  it("reads $HOME/.config/herdr-app when HERDR_APP_HOME is unset", () => {
    fill(join(root, "home", ".config", "herdr-app"));
    const result = run({ HERDR_APP_HOME: undefined });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(types("herdr.d.ts"), "utf8"), "declare const herdr_d_ts: 1;\n");
  });

  it("treats an empty HERDR_APP_HOME as unset", () => {
    fill(join(root, "home", ".config", "herdr-app"));
    const result = run({ HERDR_APP_HOME: "" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(types()).sort(), [...names].sort());
  });

  it("works for an app home path with spaces", () => {
    fill(appHome);
    assert.ok(appHome.includes(" "));
    assert.equal(run({ HERDR_APP_HOME: appHome }).status, 0);
    assert.ok(existsSync(types("gpui-kit.d.ts")));
  });

  it("copies the content of a type file that is a symlink to a regular file", () => {
    fill(appHome);
    writeFileSync(join(root, "real.d.ts"), "real content\n");
    rmSync(join(appHome, "herdr.d.ts"));
    symlinkSync(join(root, "real.d.ts"), join(appHome, "herdr.d.ts"));
    assert.equal(run({ HERDR_APP_HOME: appHome }).status, 0);
    assert.equal(readFileSync(types("herdr.d.ts"), "utf8"), "real content\n");
    assert.equal(lstatSync(types("herdr.d.ts")).isSymbolicLink(), false);
  });

  it("replaces a stale file from an earlier run", () => {
    mkdirSync(types());
    writeFileSync(types("herdr.d.ts"), "stale");
    fill(appHome);
    assert.equal(run({ HERDR_APP_HOME: appHome }).status, 0);
    assert.equal(readFileSync(types("herdr.d.ts"), "utf8"), "declare const herdr_d_ts: 1;\n");
  });

  it("leaves the same bytes and no leftover files on a rerun", () => {
    fill(appHome);
    run({ HERDR_APP_HOME: appHome });
    const first = snapshot();
    assert.equal(run({ HERDR_APP_HOME: appHome }).status, 0);
    assert.deepEqual(snapshot(), first);
  });
});

describe("refusing to copy", () => {
  const stale = () => {
    mkdirSync(types(), { recursive: true });
    for (const name of names) writeFileSync(types(name), `stale ${name}`);
  };
  const refused = (env: Record<string, string | undefined>, looked: string) => {
    const before = snapshot();
    const result = run(env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^refusing:/m);
    assert.ok(result.stderr.includes(looked), result.stderr);
    assert.ok(result.stderr.includes("HERDR_APP_HOME"), result.stderr);
    assert.deepEqual(snapshot(), before);
  };

  it("an app home that does not exist", () => {
    stale();
    refused({ HERDR_APP_HOME: appHome }, appHome);
  });

  it("an app home that is a file", () => {
    stale();
    writeFileSync(appHome, "x");
    refused({ HERDR_APP_HOME: appHome }, appHome);
  });

  it("a missing herdr.d.ts, keeping the stale pair", () => {
    stale();
    fill(appHome);
    rmSync(join(appHome, "herdr.d.ts"));
    refused({ HERDR_APP_HOME: appHome }, join(appHome, "herdr.d.ts"));
  });

  it("a missing gpui-kit.d.ts, never leaving one fresh file beside one stale file", () => {
    stale();
    fill(appHome);
    rmSync(join(appHome, "gpui-kit.d.ts"));
    refused({ HERDR_APP_HOME: appHome }, join(appHome, "gpui-kit.d.ts"));
  });

  it("a type file that is a directory", () => {
    stale();
    fill(appHome);
    rmSync(join(appHome, "gpui-kit.d.ts"));
    mkdirSync(join(appHome, "gpui-kit.d.ts"));
    refused({ HERDR_APP_HOME: appHome }, join(appHome, "gpui-kit.d.ts"));
  });

  it("an unset app home whose default folder is missing, naming the default path", () => {
    refused({ HERDR_APP_HOME: undefined }, join(root, "home", ".config", "herdr-app"));
  });

  const unreadable = (name: string) => {
    const file = join(appHome, name);
    chmodSync(file, 0o000);
    return () => chmodSync(file, 0o644);
  };
  const asRoot = process.getuid?.() === 0 ? "chmod 000 does not block reading as root" : false;

  for (const name of names) {
    it(`an unreadable ${name}, naming it and keeping the stale pair`, { skip: asRoot }, () => {
      stale();
      fill(appHome);
      const restore = unreadable(name);
      try {
        refused({ HERDR_APP_HOME: appHome }, join(appHome, name));
      } finally {
        restore();
      }
    });

    it(`an unreadable ${name}, creating no types/ folder`, { skip: asRoot }, () => {
      fill(appHome);
      const restore = unreadable(name);
      try {
        refused({ HERDR_APP_HOME: appHome }, join(appHome, name));
        assert.equal(existsSync(types()), false);
      } finally {
        restore();
      }
    });
  }

  it("a missing app home, with the app-home message rather than a per-file one", () => {
    stale();
    const result = run({ HERDR_APP_HOME: appHome });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`refusing: the app home ${appHome} is not a folder`), result.stderr);
    assert.ok(!result.stderr.includes("is not a file"), result.stderr);
  });

  it("a types/gpui-kit.d.ts that is a folder, nesting nothing under it and leaving types/ as it was", () => {
    stale();
    rmSync(types("gpui-kit.d.ts"));
    mkdirSync(types("gpui-kit.d.ts"));
    fill(appHome);
    const before = readdirSync(types()).sort();
    const result = run({ HERDR_APP_HOME: appHome });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^refusing:/m);
    assert.ok(result.stderr.includes(types("gpui-kit.d.ts")), result.stderr);
    assert.deepEqual(readdirSync(types()).sort(), before);
    assert.deepEqual(readdirSync(types("gpui-kit.d.ts")), []);
  });

  it("a types folder that is a symlink pointing outside the plugin, writing nothing through it", () => {
    fill(appHome);
    const outside = join(root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, types());
    const result = run({ HERDR_APP_HOME: appHome });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^refusing:/m);
    assert.ok(result.stderr.includes(types()), result.stderr);
    assert.ok(result.stderr.includes("HERDR_APP_HOME"), result.stderr);
    assert.deepEqual(readdirSync(outside), []);
  });
});

describe("a failure during the copy", () => {
  const stubCpFailingOnSecondFile = () => {
    const bin = join(root, "stub-bin");
    mkdirSync(bin);
    const count = join(root, "cp-count");
    writeFileSync(join(bin, "cp"), `#!/bin/sh\necho x >> "${count}"\nif [ "$(wc -l < "${count}")" -ge 2 ]; then echo "cp: injected failure" >&2; exit 1; fi\nexec /bin/cp "$@"\n`);
    chmodSync(join(bin, "cp"), 0o755);
    return bin;
  };

  it("leaves types/ exactly the stale pair and no staging folder", () => {
    mkdirSync(types());
    for (const name of names) writeFileSync(types(name), `stale ${name}`);
    fill(appHome);
    const before = snapshot();
    const result = run({ HERDR_APP_HOME: appHome, PATH: `${stubCpFailingOnSecondFile()}:${process.env["PATH"]}` });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes("injected failure"), result.stderr);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(readdirSync(types()).sort(), [...names].sort());
  });
});
