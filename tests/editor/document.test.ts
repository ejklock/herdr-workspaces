import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EditorDocument, LIMIT, type Host } from "../../src/editor/document.ts";
import { languageFor } from "../../src/editor/language.ts";

const CAP = 1048576;

async function onDisk(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}

type Probe = { reads: string[]; writes: { path: string; text: string; expected: string | null }[]; execs: string[] };

function realHost(): { host: Host; probe: Probe } {
  const probe: Probe = { reads: [], writes: [], execs: [] };
  const host: Host = {
    async readTextFile(path, options) {
      probe.reads.push(path);
      if (options?.on) throw new Error("remote read unavailable in tests");
      const info = await stat(path).catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? null : Promise.reject(e)));
      if (!info) return null;
      if (info.isDirectory()) throw new Error("is a directory");
      return (await readFile(path)).subarray(0, CAP).toString("utf8");
    },
    async writeTextFile(path, text, expected) {
      probe.writes.push({ path, text, expected });
      const current = await onDisk(path);
      if (current !== expected) throw new Error("the file changed since it was read");
      const temporary = `${path}.tmp-${process.pid}`;
      await writeFile(temporary, text);
      await rename(temporary, path);
      return null;
    },
    exec(command, args = []) {
      probe.execs.push(command);
      return new Promise(resolve => execFile(command, args, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr })));
    },
  };
  return { host, probe };
}

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "editor-doc-")); });
afterEach(async () => { await chmod(dir, 0o755).catch(() => undefined); await rm(dir, { recursive: true, force: true }); });

async function opened(name: string, content: string | null, wrap: (host: Host) => Host = h => h) {
  const path = join(dir, name);
  if (content !== null) await writeFile(path, content);
  const { host, probe } = realHost();
  const doc = new EditorDocument(wrap(host), path);
  await doc.open();
  return { doc, path, probe };
}

describe("opening", () => {
  it("opens a local UTF-8 file as editable with its full text", async () => {
    const { doc } = await opened("a.txt", "héllo\nworld\n");
    assert.equal(doc.status.kind, "editable");
    assert.equal(doc.snapshot, "héllo\nworld\n");
  });

  it("reports an absent file as not found without an editor", async () => {
    const { doc, path } = await opened("missing.txt", null);
    assert.deepEqual(doc.status, { kind: "unavailable", message: "File not found" });
    await doc.save("anything");
    assert.equal(await onDisk(path), null);
  });

  it("reports a file with a NUL byte as binary", async () => {
    const { doc } = await opened("bin.dat", "ab\0cd");
    assert.deepEqual(doc.status, { kind: "unavailable", message: "Binary file · not editable" });
  });

  it("reports a directory with a folder message", async () => {
    const path = join(dir, "folder");
    await mkdir(path);
    const doc = new EditorDocument(realHost().host, path);
    await doc.open();
    assert.deepEqual(doc.status, { kind: "unavailable", message: "This path is a folder" });
  });

  it("opens a file of 1048575 bytes as editable", async () => {
    const { doc } = await opened("edge.txt", "a".repeat(LIMIT - 1));
    assert.equal(doc.status.kind, "editable");
  });

  it("opens a file of 1048576 bytes read-only as too large", async () => {
    const { doc } = await opened("edge.txt", "a".repeat(LIMIT));
    assert.deepEqual(doc.status, { kind: "readonly", message: "File too large to edit safely · read-only" });
  });

  it("opens a file of 1048577 bytes read-only", async () => {
    const { doc } = await opened("edge.txt", "a".repeat(LIMIT + 1));
    assert.equal(doc.status.kind, "readonly");
  });

  it("opens read-only when the size probe fails", async () => {
    const { doc } = await opened("a.txt", "text", host => ({ ...host, exec: async (command, args) => (command === "sh" ? { code: 1, stdout: "", stderr: "boom" } : host.exec(command, args)) }));
    assert.equal(doc.status.kind, "readonly");
  });

  it("opens read-only when the size probe prints something that is not a number", async () => {
    const { doc } = await opened("a.txt", "text", host => ({ ...host, exec: async (command, args) => (command === "sh" ? { code: 0, stdout: "?\n", stderr: "" } : host.exec(command, args)) }));
    assert.equal(doc.status.kind, "readonly");
  });

  it("opens read-only when the text holds U+FFFD", async () => {
    const { doc } = await opened("bad.txt", "a�b");
    assert.deepEqual(doc.status, { kind: "readonly", message: "Not valid UTF-8 · read-only" });
  });

  it("opens a file on another machine read-only and runs no local probe", async () => {
    const { host, probe } = realHost();
    const remote: Host = { ...host, readTextFile: async () => "remote text" };
    const doc = new EditorDocument(remote, "/remote/file.txt", "box");
    await doc.open();
    assert.deepEqual(doc.status, { kind: "readonly", message: "File on another machine · read-only" });
    assert.equal(doc.snapshot, "remote text");
    assert.deepEqual(probe.execs, []);
  });

  it("reports a cannot-open message when the read throws for another reason", async () => {
    const { host } = realHost();
    const doc = new EditorDocument({ ...host, readTextFile: async () => { throw new Error("denied"); } }, join(dir, "a.txt"));
    await writeFile(join(dir, "a.txt"), "x");
    await doc.open();
    assert.deepEqual(doc.status, { kind: "unavailable", message: "Cannot open this file (too large or unreadable)" });
  });
});

describe("saving", () => {
  it("writes nothing when there are no edits and the disk is unchanged", async () => {
    const { doc, path, probe } = await opened("a.txt", "one\n");
    const before = (await stat(path)).mtimeMs;
    await doc.save("one\n");
    assert.deepEqual(probe.writes, []);
    assert.equal((await stat(path)).mtimeMs, before);
    assert.equal(doc.conflict, undefined);
  });

  it("shows a conflict and writes nothing when there are no edits but the disk changed", async () => {
    const { doc, path, probe } = await opened("a.txt", "one\n");
    await writeFile(path, "external\n");
    await doc.save("one\n");
    assert.deepEqual(doc.conflict, { disk: "external\n" });
    assert.deepEqual(probe.writes, []);
    assert.equal(await onDisk(path), "external\n");
  });

  it("writes an edit when the disk is unchanged and clears the dirty flag", async () => {
    const { doc, path } = await opened("a.txt", "one\n");
    assert.equal(doc.dirty("one\n"), false);
    assert.equal(doc.dirty("two\n"), true);
    await doc.save("two\n");
    assert.equal(await onDisk(path), "two\n");
    assert.equal(doc.snapshot, "two\n");
    assert.equal(doc.dirty("two\n"), false);
  });

  it("rejects an edit when the disk changed and keeps the external content in a conflict", async () => {
    const { doc, path } = await opened("a.txt", "one\n");
    await writeFile(path, "external\n");
    await doc.save("two\n");
    assert.equal(await onDisk(path), "external\n");
    assert.deepEqual(doc.conflict, { disk: "external\n" });
    assert.equal(doc.snapshot, "one\n");
    assert.equal(doc.dirty("two\n"), true);
  });

  it("overwrites during a conflict using the conflict's disk text as expected", async () => {
    const { doc, path, probe } = await opened("a.txt", "one\n");
    await writeFile(path, "external\n");
    await doc.save("two\n");
    await doc.overwrite("two\n");
    assert.equal(probe.writes.at(-1)?.expected, "external\n");
    assert.equal(await onDisk(path), "two\n");
    assert.equal(doc.conflict, undefined);
    assert.equal(doc.dirty("two\n"), false);
  });

  it("refreshes the conflict and leaves the disk alone when it changed again before the overwrite", async () => {
    const { doc, path } = await opened("a.txt", "one\n");
    await writeFile(path, "external\n");
    await doc.save("two\n");
    await writeFile(path, "newer\n");
    await doc.overwrite("two\n");
    assert.equal(await onDisk(path), "newer\n");
    assert.deepEqual(doc.conflict, { disk: "newer\n" });
  });

  it("ignores an overwrite when there is no conflict", async () => {
    const { doc, path, probe } = await opened("a.txt", "one\n");
    await doc.overwrite("two\n");
    assert.deepEqual(probe.writes, []);
    assert.equal(await onDisk(path), "one\n");
  });

  it("discards edits and takes the disk text on reload during a conflict", async () => {
    const { doc, path } = await opened("a.txt", "one\n");
    await writeFile(path, "external\n");
    await doc.save("two\n");
    await doc.open();
    assert.equal(doc.snapshot, "external\n");
    assert.equal(doc.conflict, undefined);
    assert.equal(doc.dirty("external\n"), false);
  });

  it("does nothing on a read-only file", async () => {
    const { doc, path, probe } = await opened("big.txt", "a".repeat(LIMIT));
    await doc.save("changed");
    assert.deepEqual(probe.writes, []);
    assert.equal((await readFile(path)).length, LIMIT);
    assert.equal(doc.dirty("changed"), false);
  });

  it("does nothing on a binary file", async () => {
    const { doc, path, probe } = await opened("bin.dat", "a\0b");
    await doc.save("changed");
    assert.deepEqual(probe.writes, []);
    assert.equal(await onDisk(path), "a\0b");
  });

  it("ignores a second save while one is in flight", async () => {
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { doc, path, probe } = await opened("a.txt", "one\n", host => ({ ...host, writeTextFile: async (p, t, e) => { await gate; return host.writeTextFile(p, t, e); } }));
    const first = doc.save("two\n");
    const second = doc.save("three\n");
    await new Promise(resolve => setImmediate(resolve));
    release();
    await Promise.all([first, second]);
    assert.equal(probe.writes.length, 1);
    assert.equal(await onDisk(path), "two\n");
  });

  it("reports a failure and keeps the snapshot when the write fails with the disk unchanged", async () => {
    const { doc, path } = await opened("a.txt", "one\n");
    await chmod(dir, 0o555);
    await doc.save("two\n");
    await chmod(dir, 0o755);
    assert.match(doc.failure ?? "", /^Could not save: /);
    assert.equal(doc.snapshot, "one\n");
    assert.equal(doc.dirty("two\n"), true);
    assert.equal(doc.conflict, undefined);
    assert.equal(await onDisk(path), "one\n");
  });

  it("treats a rejected write as saved when the disk already equals the text", async () => {
    const { doc, path } = await opened("a.txt", "one\n", host => ({ ...host, writeTextFile: async () => { await writeFile(join(dir, "a.txt"), "two\n"); throw new Error("stale"); } }));
    await doc.save("two\n");
    assert.equal(doc.snapshot, "two\n");
    assert.equal(doc.conflict, undefined);
    assert.equal(doc.failure, undefined);
    assert.equal(await onDisk(path), "two\n");
  });
});

describe("symlink", () => {
  it("saves through one link to its target and keeps the link", async () => {
    const target = join(dir, "target.txt");
    await writeFile(target, "one\n");
    const link = join(dir, "link.txt");
    await symlink(target, link);
    const { host } = realHost();
    const doc = new EditorDocument(host, link);
    await doc.open();
    assert.equal(doc.snapshot, "one\n");
    await doc.save("two\n");
    assert.equal(await readFile(target, "utf8"), "two\n");
    assert.equal((await lstat(link)).isSymbolicLink(), true);
  });

  it("saves through a chain of links to the final target and keeps every link", async () => {
    const c = join(dir, "c.txt"), b = join(dir, "b.txt"), a = join(dir, "a.txt");
    await writeFile(c, "one\n");
    await symlink(c, b);
    await symlink(b, a);
    const doc = new EditorDocument(realHost().host, a);
    await doc.open();
    await doc.save("two\n");
    assert.equal(await readFile(c, "utf8"), "two\n");
    assert.equal((await lstat(a)).isSymbolicLink(), true);
    assert.equal((await lstat(b)).isSymbolicLink(), true);
    assert.equal(await readlink(a), b);
    assert.equal((await lstat(c)).isSymbolicLink(), false);
  });

  it("reports a dangling link as not found", async () => {
    const link = join(dir, "dangling.txt");
    await symlink(join(dir, "nowhere.txt"), link);
    const doc = new EditorDocument(realHost().host, link);
    await doc.open();
    assert.deepEqual(doc.status, { kind: "unavailable", message: "File not found" });
  });

  it("opens and saves a name with a space and non-ASCII letters", async () => {
    const { doc, path } = await opened("ação teste.md", "# oi\n");
    assert.equal(doc.status.kind, "editable");
    await doc.save("# olá\n");
    assert.equal(await onDisk(path), "# olá\n");
  });

  it("saves a link whose name holds a space and non-ASCII letters", async () => {
    const target = join(dir, "alvo final.md");
    await writeFile(target, "x\n");
    const link = join(dir, "ação teste.md");
    await symlink(target, link);
    const doc = new EditorDocument(realHost().host, link);
    await doc.open();
    await doc.save("y\n");
    assert.equal(await readFile(target, "utf8"), "y\n");
    assert.equal((await lstat(link)).isSymbolicLink(), true);
  });
});

describe("language", () => {
  it("maps extensions the editor does not know to a known grammar and falls back to the extension", () => {
    assert.equal(languageFor("/x/main.ts"), "js");
    assert.equal(languageFor("/x/Cargo.toml"), "yaml");
    assert.equal(languageFor("/x/notes.md"), "md");
    assert.equal(languageFor("/x/Makefile"), "txt");
  });
});

describe("resolving", () => {
  async function linked(wrap: (host: Host) => Host) {
    const target = join(dir, "target.txt");
    await writeFile(target, "one\n");
    const link = join(dir, "link.txt");
    await symlink(target, link);
    const { host, probe } = realHost();
    const doc = new EditorDocument(wrap(host), link);
    await doc.open();
    return { doc, target, link, probe };
  }
  const notResolved = (host: Host, answer: () => Promise<{ code: number; stdout: string; stderr: string }>): Host =>
    ({ ...host, exec: (command, args) => (command === "realpath" ? answer() : host.exec(command, args)) });

  async function assertNeverWritten(doc: EditorDocument, target: string, link: string, probe: Probe) {
    assert.equal(doc.status.kind, "readonly");
    assert.match((doc.status as { message: string }).message, /./);
    await doc.save("two\n");
    assert.deepEqual(probe.writes, []);
    assert.equal(await readFile(target, "utf8"), "one\n");
    assert.equal((await lstat(link)).isSymbolicLink(), true);
  }

  it("opens read-only and never writes when realpath exits 1 on a live link", async () => {
    const { doc, target, link, probe } = await linked(host => notResolved(host, async () => ({ code: 1, stdout: "", stderr: "" })));
    await assertNeverWritten(doc, target, link, probe);
  });

  it("opens read-only and never writes when realpath throws", async () => {
    const { doc, target, link, probe } = await linked(host => notResolved(host, async () => { throw new Error("no realpath"); }));
    await assertNeverWritten(doc, target, link, probe);
  });

  it("opens read-only and never writes when realpath prints nothing", async () => {
    const { doc, target, link, probe } = await linked(host => notResolved(host, async () => ({ code: 0, stdout: "\n", stderr: "" })));
    await assertNeverWritten(doc, target, link, probe);
  });

  it("opens editable and saves to the target when realpath succeeds", async () => {
    const { doc, target, link } = await linked(host => host);
    assert.equal(doc.status.kind, "editable");
    await doc.save("two\n");
    assert.equal(await readFile(target, "utf8"), "two\n");
    assert.equal((await lstat(link)).isSymbolicLink(), true);
  });
});

describe("racing", () => {
  function gate() {
    let open = () => {};
    const promise = new Promise<void>(resolve => { open = resolve; });
    return { promise, open };
  }
  const tick = () => new Promise(resolve => setImmediate(resolve));

  it("takes the reload's text and reports a conflict on the next save when a save is in flight during a reload", async () => {
    const held = gate();
    const { doc, path, probe } = await opened("a.txt", "one\n", host => ({ ...host, writeTextFile: async (p, t, e) => { await held.promise; return host.writeTextFile(p, t, e); } }));
    const save = doc.save("two\n");
    await tick();
    await doc.open();
    held.open();
    await save;
    assert.equal(doc.snapshot, "one\n");
    assert.equal(doc["saving"], false);
    assert.equal(await onDisk(path), "two\n");
    await doc.save("one\n");
    assert.deepEqual(doc.conflict, { disk: "two\n" });
    assert.equal(probe.writes.length, 1);
    assert.equal(await onDisk(path), "two\n");
  });

  it("takes the reload's text and reports a conflict on the next save when an overwrite is in flight during a reload", async () => {
    const held = gate();
    let armed = false;
    const { doc, path, probe } = await opened("a.txt", "one\n", host => ({ ...host, writeTextFile: async (p, t, e) => { if (armed) await held.promise; return host.writeTextFile(p, t, e); } }));
    await writeFile(path, "external\n");
    await doc.save("two\n");
    assert.deepEqual(doc.conflict, { disk: "external\n" });
    armed = true;
    const overwrite = doc.overwrite("two\n");
    await tick();
    await doc.open();
    held.open();
    await overwrite;
    assert.equal(doc.snapshot, "external\n");
    assert.equal(doc.conflict, undefined);
    assert.equal(doc["saving"], false);
    assert.equal(await onDisk(path), "two\n");
    await doc.save("external\n");
    assert.deepEqual(doc.conflict, { disk: "two\n" });
    assert.equal(probe.writes.length, 2);
  });

  it("shows the latest reload's text when two reloads finish in reverse order", async () => {
    const held = gate();
    const reached = gate();
    let armed = false;
    const { doc, path } = await opened("a.txt", "one\n", host => ({
      ...host,
      readTextFile: async (p, o) => {
        const text = await host.readTextFile(p, o);
        if (armed) { armed = false; reached.open(); await held.promise; }
        return text;
      },
    }));
    armed = true;
    const first = doc.open();
    await reached.promise;
    await writeFile(path, "two\n");
    await doc.open();
    held.open();
    await first;
    assert.equal(doc.snapshot, "two\n");
    assert.equal(doc.status.kind, "editable");
  });

  it("shows no conflict from a save with no edits whose disk read finished after a reload", async () => {
    const held = gate();
    const reached = gate();
    let armed = false;
    const { doc, path } = await opened("a.txt", "one\n", host => ({
      ...host,
      readTextFile: async (p, o) => {
        const text = await host.readTextFile(p, o);
        if (armed) { armed = false; reached.open(); await held.promise; }
        return text;
      },
    }));
    armed = true;
    const save = doc.save("one\n");
    await reached.promise;
    await writeFile(path, "external\n");
    await doc.open();
    held.open();
    await save;
    assert.equal(doc.snapshot, "external\n");
    assert.equal(doc.conflict, undefined);
  });

  it("keeps ignoring a save while a newer save runs after an older save finished across a reload", async () => {
    const first = gate();
    const second = gate();
    const writes: Promise<void>[] = [first.promise, second.promise];
    const { doc, probe } = await opened("a.txt", "one\n", host => ({ ...host, writeTextFile: async (p, t, e) => { await writes.shift(); return host.writeTextFile(p, t, e); } }));
    const older = doc.save("two\n");
    await new Promise(resolve => setImmediate(resolve));
    await doc.open();
    const newer = doc.save("three\n");
    await new Promise(resolve => setImmediate(resolve));
    first.open();
    await older;
    await doc.save("four\n");
    second.open();
    await newer;
    assert.equal(probe.writes.length, 2);
  });

  it("shows no conflict from a write that failed after a reload took the disk text", async () => {
    const held = gate();
    const { doc, path } = await opened("a.txt", "one\n", host => ({ ...host, writeTextFile: async (p, t, e) => { await held.promise; return host.writeTextFile(p, t, e); } }));
    const save = doc.save("two\n");
    await new Promise(resolve => setImmediate(resolve));
    await writeFile(path, "external\n");
    await doc.open();
    held.open();
    await save;
    assert.equal(doc.snapshot, "external\n");
    assert.equal(doc.conflict, undefined);
    assert.equal(doc.failure, undefined);
  });
});
