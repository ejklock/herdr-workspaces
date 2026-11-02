import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffTarget, nextSeq, nextTargets, paneProps, untrackedAdds, totals } from "../../src/list/target.ts";

type Call = { command: string; args: string[] | undefined; options: { cwd?: string; on?: string | null } | undefined };
type Result = { code: number; stdout: string; stderr: string };
const ok = (stdout: string, code = 0): Result => ({ code, stdout, stderr: "" });
const stub = (result: Result | Error) => {
  const calls: Call[] = [];
  const exec = async (command: string, args?: string[], options?: { cwd?: string; on?: string | null }) => {
    calls.push({ command, args, options });
    if (result instanceof Error) throw result;
    return result;
  };
  return { calls, exec };
};

describe("the added counts of untracked files", () => {
  it("runs one binary-safe grep count over all the paths, after the options end", async () => {
    const { calls, exec } = stub(ok("x/a.ts:1\n-b.ts:2\n"));
    const counts = await untrackedAdds(exec, "/w", ["x/a.ts", "-b.ts"], "box");
    assert.deepEqual(calls, [{ command: "env", args: ["LC_ALL=C", "grep", "-c", "-I", "-H", "-e", "", "--", "x/a.ts", "-b.ts"], options: { cwd: "/w", on: "box" } }]);
    assert.deepEqual(counts, { "x/a.ts": 1, "-b.ts": 2 });
  });

  it("passes a local panel's machine as null", async () => {
    const { calls, exec } = stub(ok("a:0\n"));
    await untrackedAdds(exec, "/w", ["a"], null);
    assert.deepEqual(calls[0]?.options, { cwd: "/w", on: null });
  });

  it("runs nothing and counts nothing for no paths", async () => {
    const { calls, exec } = stub(ok(""));
    assert.deepEqual(await untrackedAdds(exec, "/w", [], null), {});
    assert.equal(calls.length, 0);
  });

  it("gives a path with a colon, a space or a newline its own count", async () => {
    const { exec } = stub(ok("col:on.txt:1\na.txt:3\nmy file:3\nnl\nname.txt:5\n"));
    const counts = await untrackedAdds(exec, "/w", ["col:on.txt", "a.txt", "my file", "nl\nname.txt"], null);
    assert.deepEqual(counts, { "col:on.txt": 1, "a.txt": 3, "my file": 3, "nl\nname.txt": 5 });
  });

  it("counts a path with no record as 0 in the middle without shifting the paths after it", async () => {
    const { exec } = stub(ok("a:4\nc:2\nd:1\n", 2));
    assert.deepEqual(await untrackedAdds(exec, "/w", ["a", "b", "c", "d"], null), { a: 4, b: 0, c: 2, d: 1 });
  });

  it("counts a path with no record as 0 at the end", async () => {
    const { exec } = stub(ok("a:4\nb:3\n"));
    assert.deepEqual(await untrackedAdds(exec, "/w", ["a", "b", "c"], null), { a: 4, b: 3, c: 0 });
  });

  it("parses a binary file's 0 record and keeps the counts after it", async () => {
    const { exec } = stub(ok("a:4\nbin.dat:0\nc:2\n"));
    assert.deepEqual(await untrackedAdds(exec, "/w", ["a", "bin.dat", "c"], null), { a: 4, "bin.dat": 0, c: 2 });
  });

  it("counts every path 0 when the exec rejects", async () => {
    const { exec } = stub(new Error("unreachable"));
    assert.deepEqual(await untrackedAdds(exec, "/w", ["a", "b"], null), { a: 0, b: 0 });
  });

  it("parses the counts of an exit 1 where no line matched", async () => {
    const { exec } = stub(ok("a:0\nb:0\n", 1));
    assert.deepEqual(await untrackedAdds(exec, "/w", ["a", "b"], null), { a: 0, b: 0 });
  });

  it("keeps the counts of the other files when one file is unreadable", async () => {
    const { exec } = stub({ code: 2, stdout: "a:6\nc:1\n", stderr: "grep: b: Permission denied" });
    assert.deepEqual(await untrackedAdds(exec, "/w", ["a", "b", "c"], null), { a: 6, b: 0, c: 1 });
  });

  it("counts 0 for the paths that garbage output cannot place", async () => {
    const { exec } = stub(ok("garbage with no separator\n"));
    assert.deepEqual(await untrackedAdds(exec, "/w", ["a", "b"], null), { a: 0, b: 0 });
  });

  it("counts 0 for a count that is not digits and keeps the one before it", async () => {
    const { exec } = stub(ok("a:2\nb:many\n"));
    assert.deepEqual(await untrackedAdds(exec, "/w", ["a", "b"], null), { a: 2, b: 0 });
  });

  it("stops at a record it cannot place at the cursor and does not take a valid record further on", async () => {
    const { exec } = stub(ok("junk:1\nb:2\n"));
    assert.deepEqual(await untrackedAdds(exec, "/w", ["a", "b"], null), { a: 0, b: 0 });
  });

  it("feeds the header total with tracked counts and untracked counts together", async () => {
    const { exec } = stub(ok("new.ts:3\n"));
    const adds = await untrackedAdds(exec, "/w", ["new.ts"], null);
    const files = [{ path: "t.ts", add: 4, del: 1 }, { path: "new.ts", add: adds["new.ts"] ?? 0, del: 0 }];
    assert.deepEqual(totals(files), { add: 7, del: 1 });
  });
});

const pane = (id: string, tab: string, mod?: string) => ({ pane: id, tab, ...(mod ? { mod } : {}) });

describe("the click counter", () => {
  it("starts at 1 when no target was shared", () => {
    assert.equal(nextSeq(undefined), 1);
  });

  it("grows by one over the shared target", () => {
    assert.equal(nextSeq({ root: "/w", path: "a", on: null, seq: 7 }), 8);
  });

  it("starts over when the shared value is not a target", () => {
    assert.equal(nextSeq({ seq: "7" }), 1);
    assert.equal(nextSeq("x"), 1);
    assert.equal(nextSeq(null), 1);
  });
});

describe("opening a changed file in the diff pane", () => {
  it("opens a new tab when a layout block has focus", () => {
    assert.deepEqual(diffTarget({ panes: [pane("p1", "t1")], focused: { tab: "t1", pane: null } }), { kind: "tab" });
  });

  it("focuses the diff pane of the focused tab", () => {
    const panes = [pane("p1", "t1"), pane("d1", "t1", "my-diff")];
    assert.deepEqual(diffTarget({ panes, focused: { tab: "t1", pane: "p1" } }), { kind: "focus", pane: "d1" });
  });

  it("focuses the first diff pane when the tab has two", () => {
    const panes = [pane("p1", "t1"), pane("d2", "t1", "my-diff"), pane("d3", "t1", "my-diff")];
    assert.deepEqual(diffTarget({ panes, focused: { tab: "t1", pane: "p1" } }), { kind: "focus", pane: "d2" });
  });

  it("splits right of the focused pane when the diff pane is in another tab", () => {
    const panes = [pane("p1", "t1"), pane("d1", "t2", "my-diff")];
    assert.deepEqual(diffTarget({ panes, focused: { tab: "t1", pane: "p1" } }), { kind: "split", pane: "p1" });
  });

  it("splits right of the focused pane when no diff pane exists", () => {
    assert.deepEqual(diffTarget({ panes: [pane("p1", "t1")], focused: { tab: "t1", pane: "p1" } }), { kind: "split", pane: "p1" });
  });

  it("does not reuse a pane of another mod", () => {
    const panes = [pane("p1", "t1"), pane("e1", "t1", "editor")];
    assert.deepEqual(diffTarget({ panes, focused: { tab: "t1", pane: "p1" } }), { kind: "split", pane: "p1" });
  });

  it("does nothing when nothing has focus", () => {
    assert.equal(diffTarget({ panes: [pane("p1", "t1")], focused: null }), undefined);
  });
});

describe("the shared targets of each space", () => {
  const file = { root: "/w", path: "a.ts", on: null };
  const entry = (path: string, seq: number) => ({ root: "/w", path, on: null, seq });

  it("gives the first click of a space seq 1 when nothing was shared", () => {
    assert.deepEqual(nextTargets(undefined, "A", file, ["A"]), { A: entry("a.ts", 1) });
    assert.deepEqual(nextTargets({}, "A", file, ["A"]), { A: entry("a.ts", 1) });
  });

  it("grows only the clicked space's seq and leaves another space's entry unchanged", () => {
    const previous = { A: entry("old.ts", 3), B: entry("b.ts", 9) };
    assert.deepEqual(nextTargets(previous, "A", file, ["A", "B"]), { A: entry("a.ts", 4), B: entry("b.ts", 9) });
  });

  it("drops the entry of a space that is no longer open", () => {
    const previous = { A: entry("old.ts", 3), Z: entry("z.ts", 1) };
    assert.deepEqual(nextTargets(previous, "A", file, ["A"]), { A: entry("a.ts", 4) });
  });

  it("keeps the clicked space's entry when the open list does not name it", () => {
    assert.deepEqual(nextTargets({ B: entry("b.ts", 2) }, "A", file, ["B"]), { A: entry("a.ts", 1), B: entry("b.ts", 2) });
  });

  const malformed: [string, unknown][] = [
    ["a string", "x"],
    ["an array", [entry("a.ts", 1)]],
    ["null", null],
    ["the old flat shape", { root: "/w", path: "a", on: null, seq: 7 }],
  ];
  for (const [title, previous] of malformed) {
    it(`treats ${title} as empty`, () => {
      assert.deepEqual(nextTargets(previous, "A", file, ["A"]), { A: entry("a.ts", 1) });
    });
  }

  it("drops an entry that is not a target and keeps the valid ones", () => {
    const previous = { A: { seq: 5 }, B: entry("b.ts", 2), C: "x" };
    assert.deepEqual(nextTargets(previous, "A", file, ["A", "B", "C"]), { A: entry("a.ts", 1), B: entry("b.ts", 2) });
  });

  it("opens a pane with the space and the target fields", () => {
    assert.deepEqual(paneProps("A", entry("a.ts", 4)), { space: "A", root: "/w", path: "a.ts", on: null, seq: 4 });
  });
});
