import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffTarget, nextSeq, nextTargets, paneProps, countLines, untrackedAdds, totals } from "../../src/list/target.ts";

describe("counting an untracked file's lines", () => {
  const cases: [string, string | null, number][] = [
    ["lines ending in a newline", "a\nb\n", 2],
    ["lines with no final newline", "a\nb", 2],
    ["an empty text", "", 0],
    ["a single newline", "\n", 1],
    ["a null read", null, 0],
  ];
  for (const [title, text, want] of cases) {
    it(`counts ${title} as ${want}`, () => assert.equal(countLines(text), want));
  }
});

describe("the added counts of untracked files", () => {
  it("reads each file by its full path on the panel's machine", async () => {
    const reads: { path: string; options: { on?: string | null } | undefined }[] = [];
    const counts = await untrackedAdds(async (path, options) => { reads.push({ path, options }); return "a\n"; }, "/w", ["x/a.ts", "b.ts"], "box");
    assert.deepEqual(reads, [{ path: "/w/x/a.ts", options: { on: "box" } }, { path: "/w/b.ts", options: { on: "box" } }]);
    assert.deepEqual(counts, { "x/a.ts": 1, "b.ts": 1 });
  });

  it("counts a null read and a rejected read as 0 and still counts the others", async () => {
    const texts: Record<string, string | null> = { "/w/a": "1\n2\n3", "/w/b": null, "/w/d": "\n" };
    const counts = await untrackedAdds(async path => {
      if (path === "/w/c") throw new Error("denied");
      return texts[path] ?? null;
    }, "/w", ["a", "b", "c", "d"], null);
    assert.deepEqual(counts, { a: 3, b: 0, c: 0, d: 1 });
  });

  it("feeds the header total with tracked counts and untracked counts together", async () => {
    const adds = await untrackedAdds(async () => "a\nb\nc\n", "/w", ["new.ts"], null);
    const files = [{ path: "t.ts", add: 4, del: 1 }, { path: "new.ts", add: adds["new.ts"] ?? 0, del: 0 }];
    assert.deepEqual(totals(files), { add: 7, del: 1 });
  });

  it("passes a local panel's machine as null", async () => {
    let seen: unknown;
    await untrackedAdds(async (_path, options) => { seen = options; return ""; }, "/w", ["a"], null);
    assert.deepEqual(seen, { on: null });
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
