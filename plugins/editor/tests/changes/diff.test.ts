import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, foldRows, changeStarts, type Row, type Segment } from "../../src/changes/diff.ts";

const same = (l: number, r: number, text: string): Row => ({ kind: "same", left: { line: l, text }, right: { line: r, text } });
const rows = (text: string): Row[] => {
  const parsed = parseDiff(text);
  assert.ok(parsed.ok, "diff should parse");
  return parsed.rows;
};
const doc = (...lines: string[]) => lines.join("\n") + "\n";
const HEAD = ["diff --git a/f b/f", "index 1..2 100644", "--- a/f", "+++ b/f"];

describe("parsing a unified diff into side-by-side rows", () => {
  it("yields no rows for an empty input", () => {
    assert.deepEqual(parseDiff(""), { ok: true, rows: [] });
  });

  it("yields no rows for a binary file's header", () => {
    assert.deepEqual(parseDiff(doc("diff --git a/x b/x", "index 1..2 100644", "Binary files a/x and b/x differ")), { ok: true, rows: [] });
  });

  it("puts a line added after line 2 on a right-only row and numbers both sides", () => {
    const text = doc(...HEAD, "@@ -1,4 +1,5 @@", " a", " b", "+new", " c", " d");
    assert.deepEqual(rows(text), [
      same(1, 1, "a"),
      same(2, 2, "b"),
      { kind: "change", block: 0, right: { line: 3, text: "new" } },
      same(3, 4, "c"),
      same(4, 5, "d"),
    ]);
  });

  it("pairs the first removed and added lines and leaves the second removed line alone", () => {
    assert.deepEqual(rows(doc("@@ -1,2 +1,1 @@", "-a", "-b", "+x")), [
      { kind: "change", block: 0, left: { line: 1, text: "a" }, right: { line: 1, text: "x" } },
      { kind: "change", block: 0, left: { line: 2, text: "b" } },
    ]);
  });

  it("pairs one removed with the first of three added lines", () => {
    assert.deepEqual(rows(doc("@@ -1 +1,3 @@", "-a", "+x", "+y", "+z")), [
      { kind: "change", block: 0, left: { line: 1, text: "a" }, right: { line: 1, text: "x" } },
      { kind: "change", block: 0, right: { line: 2, text: "y" } },
      { kind: "change", block: 0, right: { line: 3, text: "z" } },
    ]);
  });

  it("pairs removed/added/removed/added lines with no unchanged line between", () => {
    assert.deepEqual(rows(doc("@@ -1,2 +1,2 @@", "-r1", "+a1", "-r2", "+a2")), [
      { kind: "change", block: 0, left: { line: 1, text: "r1" }, right: { line: 1, text: "a1" } },
      { kind: "change", block: 0, left: { line: 2, text: "r2" }, right: { line: 2, text: "a2" } },
    ]);
  });

  it("reads a content line starting with dashes or pluses by its first character only", () => {
    assert.deepEqual(rows(doc("@@ -1 +1 @@", "--- x", "+++ y")), [
      { kind: "change", block: 0, left: { line: 1, text: "-- x" }, right: { line: 1, text: "++ y" } },
    ]);
  });

  it("adds no row and no number for a no-newline marker", () => {
    assert.deepEqual(rows(doc("@@ -1,2 +1,2 @@", " a", "-b", "\\ No newline at end of file", "+c", "\\ No newline at end of file")), [
      same(1, 1, "a"),
      { kind: "change", block: 0, left: { line: 2, text: "b" }, right: { line: 2, text: "c" } },
    ]);
  });

  it("restarts numbering at the second hunk header and counts the blocks apart", () => {
    assert.deepEqual(rows(doc("@@ -1 +1 @@", "-a", "+b", "@@ -10 +20 @@", "-c", "+d")), [
      { kind: "change", block: 0, left: { line: 1, text: "a" }, right: { line: 1, text: "b" } },
      { kind: "change", block: 1, left: { line: 10, text: "c" }, right: { line: 20, text: "d" } },
    ]);
  });

  it("accepts a header without counts", () => {
    assert.deepEqual(rows(doc("@@ -1 +1 @@ function f()", "-a", "+b")).length, 1);
  });

  it("shows a wholly added file as right-only rows", () => {
    assert.deepEqual(rows(doc("@@ -0,0 +1,3 @@", "+a", "+b", "+c")), [
      { kind: "change", block: 0, right: { line: 1, text: "a" } },
      { kind: "change", block: 0, right: { line: 2, text: "b" } },
      { kind: "change", block: 0, right: { line: 3, text: "c" } },
    ]);
  });

  it("shows a wholly removed file as left-only rows", () => {
    assert.deepEqual(rows(doc("@@ -1,2 +0,0 @@", "-a", "-b")), [
      { kind: "change", block: 0, left: { line: 1, text: "a" } },
      { kind: "change", block: 0, left: { line: 2, text: "b" } },
    ]);
  });

  it("fails on a hunk header that does not match the format", () => {
    assert.deepEqual(parseDiff(doc("@@ -1,2 @@", " a")), { ok: false, line: "@@ -1,2 @@", reason: "malformed hunk header" });
  });

  it("fails on a line inside a hunk with another first character", () => {
    assert.deepEqual(parseDiff(doc("@@ -1,2 +1,2 @@", " a", "?b")), { ok: false, line: "?b", reason: "unexpected line in hunk" });
  });

  it("fails on a hunk with fewer lines than its header counts", () => {
    assert.deepEqual(parseDiff(doc("@@ -1,3 +1,3 @@", " a", " b")), { ok: false, line: "@@ -1,3 +1,3 @@", reason: "hunk shorter than its header counts" });
  });

  it("fails on a hunk with more lines than its header counts", () => {
    assert.deepEqual(parseDiff(doc("@@ -1 +1 @@", " a", " b")), { ok: false, line: " b", reason: "hunk longer than its header counts" });
  });
});

const unchanged = (n: number, from = 1): Row[] => Array.from({ length: n }, (_, i) => same(from + i, from + i, `u${from + i}`));
const change = (block: number): Row => ({ kind: "change", block, right: { line: 1, text: "x" } });
const shape = (segments: Segment[]) =>
  segments.map(s => (s.kind === "hidden" ? `hidden:${s.count}` : `${s.kind}:${s.rows.length}`));

describe("folding rows into visible segments and hidden blocks", () => {
  it("hides the middle of a long unchanged run between two changes", () => {
    const segs = foldRows([change(0), ...unchanged(10), change(1)], 3, new Set());
    assert.deepEqual(shape(segs), ["visible:4", "hidden:4", "visible:4"]);
    assert.deepEqual(segs[1], { kind: "hidden", id: 4, count: 4 });
  });

  it("keeps a run visible when hiding it would save fewer than 3 rows", () => {
    assert.deepEqual(shape(foldRows([change(0), ...unchanged(8), change(1)], 3, new Set())), ["visible:10"]);
  });

  it("hides the start of a file before its first change", () => {
    assert.deepEqual(shape(foldRows([...unchanged(10), change(0)], 3, new Set())), ["hidden:7", "visible:4"]);
  });

  it("hides the end of a file after its last change", () => {
    assert.deepEqual(shape(foldRows([change(0), ...unchanged(10)], 3, new Set())), ["visible:4", "hidden:7"]);
  });

  it("hides a whole file with no change as one block", () => {
    assert.deepEqual(foldRows(unchanged(20), 3, new Set()), [{ kind: "hidden", id: 0, count: 20 }]);
  });

  it("shows the rows of an expanded block", () => {
    const all = unchanged(20);
    assert.deepEqual(foldRows(all, 3, new Set([0])), [{ kind: "expanded", id: 0, rows: all }]);
  });

  it("keeps block ids stable across calls for the same rows", () => {
    const input = [change(0), ...unchanged(10), change(1)];
    assert.deepEqual(foldRows(input, 3, new Set()), foldRows(input, 3, new Set([99])));
  });

  it("hides every unchanged run of 3 or more at context 0", () => {
    assert.deepEqual(shape(foldRows([change(0), ...unchanged(3), change(1), ...unchanged(2), change(2)], 0, new Set())),
      ["visible:1", "hidden:3", "visible:4"]);
  });

  it("yields no segments for no rows", () => {
    assert.deepEqual(foldRows([], 3, new Set()), []);
  });

  it("keeps a 1-row unchanged run and a 200000-row change run in one visible segment", () => {
    const input = [...unchanged(4), ...Array.from({ length: 200000 }, () => change(0))];
    const segs = foldRows(input, 3, new Set());
    assert.deepEqual(shape(segs), ["visible:200004"]);
    const seg = segs[0];
    assert.ok(seg?.kind === "visible");
    assert.equal(seg.start, 0);
    assert.ok(seg.rows.every((r, i) => r === input[i]));
  });

  it("hides 5 rows then shows a 200000-row change run after 8 unchanged rows", () => {
    const input = [...unchanged(8), ...Array.from({ length: 200000 }, () => change(0))];
    const segs = foldRows(input, 3, new Set());
    assert.deepEqual(shape(segs), ["hidden:5", "visible:200003"]);
    const [hidden, visible] = segs;
    assert.ok(hidden?.kind === "hidden" && visible?.kind === "visible");
    assert.equal(hidden.id, 0);
    assert.equal(visible.start, 5);
  });

  it("does not share a visible segment's rows array with the input after a long run joins it", () => {
    const input = [...unchanged(4), ...Array.from({ length: 200000 }, () => change(0))];
    const seg = foldRows(input, 3, new Set())[0];
    assert.ok(seg?.kind === "visible");
    seg.rows.length = 0;
    assert.equal(input.length, 200004);
  });
});

describe("change starts for next and previous navigation", () => {
  it("is empty without a change", () => {
    assert.deepEqual(changeStarts(unchanged(4)), []);
  });

  it("gives the first index of a block of 3 rows at index 5", () => {
    const input = [...unchanged(5), change(0), change(0), change(0), ...unchanged(2)];
    assert.deepEqual(changeStarts(input), [5]);
  });

  it("gives both starts of two blocks separated by unchanged rows", () => {
    assert.deepEqual(changeStarts([change(0), ...unchanged(2), change(1), change(1)]), [0, 3]);
  });

  it("counts two blocks with no unchanged row between as two", () => {
    assert.deepEqual(changeStarts([change(0), change(0), change(1)]), [0, 2]);
  });
});
