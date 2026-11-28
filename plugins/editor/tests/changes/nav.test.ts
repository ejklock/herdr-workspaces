import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { currentBlock, stepsOf, stops, step, clampCursor, editorTarget, wrapsLines, rulerMarks } from "../../src/changes/nav.ts";
import type { DisplayRow } from "../../src/changes/rows.ts";

const cell = { line: 1, text: "x" };
const same: DisplayRow = { kind: "same", left: cell, right: cell };
const hidden = (id: number): DisplayRow => ({ kind: "hidden", id, label: "5 hidden lines" });
const change = (block: number): DisplayRow => ({ kind: "change", block, right: cell });

describe("change stops", () => {
  it("finds the start of each block across a folded run, and after it expands", () => {
    assert.deepEqual(stops([change(0), change(0), hidden(0), change(1)]), [0, 3]);
    assert.deepEqual(stops([change(0), change(0), same, same, change(1)]), [0, 4]);
  });
  it("splits two blocks with no unchanged row between them", () => {
    assert.deepEqual(stops([change(0), change(0), change(1), change(1)]), [0, 2]);
  });
  it("has no stop without change rows", () => {
    assert.deepEqual(stops([same, hidden(0)]), []);
    assert.deepEqual(stepsOf(undefined, 0), { previous: false, next: false });
  });
  it("has one stop for one block", () => {
    assert.deepEqual(stops([same, change(3), change(3)]), [1]);
    assert.deepEqual(stepsOf(0, 1), { previous: false, next: false });
  });
});

describe("cursor steps", () => {
  it("goes to the first stop from no cursor, either way", () => {
    assert.equal(step(undefined, 3, "next"), 0);
    assert.equal(step(undefined, 3, "previous"), 0);
  });
  it("stays at the first stop going previous and at the last going next", () => {
    assert.equal(step(0, 3, "previous"), 0);
    assert.equal(step(2, 3, "next"), 2);
  });
  it("moves one stop in between", () => {
    assert.equal(step(1, 3, "next"), 2);
    assert.equal(step(1, 3, "previous"), 0);
  });
  it("gives nothing without stops", () => {
    assert.equal(step(undefined, 0, "next"), undefined);
  });
  it("says which buttons can move", () => {
    assert.deepEqual(stepsOf(undefined, 3), { previous: true, next: true });
    assert.deepEqual(stepsOf(0, 3), { previous: false, next: true });
    assert.deepEqual(stepsOf(2, 3), { previous: true, next: false });
  });
  it("clamps a cursor to fewer stops", () => {
    assert.equal(clampCursor(4, 2), 1);
    assert.equal(clampCursor(1, 5), 1);
    assert.equal(clampCursor(3, 0), undefined);
    assert.equal(clampCursor(undefined, 4), undefined);
  });
});

describe("current block", () => {
  const shown = [same, change(0), change(0), same, change(1)];
  it("is the block the cursor's stop starts", () => {
    assert.equal(currentBlock(shown, 0), 0);
    assert.equal(currentBlock(shown, 1), 1);
  });
  it("is absent before the first step and for a cursor outside the stops", () => {
    assert.equal(currentBlock(shown, undefined), undefined);
    assert.equal(currentBlock(shown, 2), undefined);
    assert.equal(currentBlock(shown, -1), undefined);
  });
  it("is absent without change rows", () => {
    assert.equal(currentBlock([same, hidden(0)], 0), undefined);
  });
  it("tells adjacent blocks apart", () => {
    assert.equal(currentBlock([change(0), change(1)], 1), 1);
  });
  it("skips a hidden row between blocks", () => {
    assert.equal(currentBlock([change(0), hidden(0), change(1)], 1), 1);
  });
});

describe("where Open in editor goes", () => {
  const panes = [{ pane: "p1", mod: "editor", tab: "t1" }, { pane: "p2", mod: "editor", tab: "t2" }];
  const base = { panes, claims: { p1: { token: "[MASKED by secret-mask: original value hidden for security]", path: "/w/f.ts" } }, focused: { tab: "t1", pane: "p0" as string | null } as { tab: string; pane: string | null } | null, path: "/w/f.ts", on: null as string | null };
  it("focuses the pane of the focused tab that claims the file", () => {
    assert.deepEqual(editorTarget(base), { kind: "focus", pane: "p1" });
  });
  it("splits when the claim is in another tab", () => {
    assert.deepEqual(editorTarget({ ...base, focused: { tab: "t2", pane: "p9" } }), { kind: "split", pane: "p9" });
  });
  it("splits when the claim is for another path", () => {
    assert.deepEqual(editorTarget({ ...base, path: "/w/g.ts" }), { kind: "split", pane: "p0" });
  });
  it("splits for a file on another machine even with a matching claim", () => {
    assert.deepEqual(editorTarget({ ...base, on: "box" }), { kind: "split", pane: "p0" });
  });
  it("opens a tab when a layout block is focused", () => {
    assert.deepEqual(editorTarget({ ...base, focused: { tab: "t1", pane: null } }), { kind: "tab" });
  });
  it("does nothing when nothing is focused", () => {
    assert.equal(editorTarget({ ...base, focused: null }), undefined);
  });
});

describe("wraps lines", () => {
  it("wraps lines unless the stored value is false", () => {
    assert.equal(wrapsLines(false), false);
    for (const stored of [true, undefined, null, "false", 0, {}]) assert.equal(wrapsLines(stored), true);
  });
});

describe("overview ruler marks", () => {
  const both = (block: number): DisplayRow => ({ kind: "change", block, left: cell, right: cell });
  const removedOnly = (block: number): DisplayRow => ({ kind: "change", block, left: cell });
  const rows = (length: number, at: number, ...block: DisplayRow[]): DisplayRow[] =>
    Array.from({ length }, (_, i) => block[i - at] ?? same);

  it("places a block by where it starts and sizes it by its rows", () => {
    assert.deepEqual(rulerMarks(rows(100, 50, both(0), both(0)), 500), [{ top: 250, size: 10, kind: "changed", stop: 0 }]);
  });
  it("colors a block by the sides its rows have", () => {
    assert.equal(rulerMarks(rows(10, 2, change(0)), 100)[0]?.kind, "added");
    assert.equal(rulerMarks(rows(10, 2, removedOnly(0)), 100)[0]?.kind, "removed");
  });
  it("keeps a minimum mark size", () => {
    assert.equal(rulerMarks(rows(1000, 10, change(0)), 300)[0]?.size, 3);
  });
  it("gives one mark per block in order, with the stop index", () => {
    const marks = rulerMarks([change(0), same, change(1)], 30);
    assert.deepEqual(marks.map(m => m.stop), [0, 1]);
    assert.deepEqual(marks.map(m => m.top), [0, 20]);
  });
  it("separates blocks that a hidden row splits", () => {
    assert.equal(rulerMarks([change(0), hidden(0), change(1)], 30).length, 2);
  });
  it("rounds the top down and the size to the nearest pixel", () => {
    assert.deepEqual(rulerMarks([same, same, change(0)], 100), [{ top: 66, size: 33, kind: "added", stop: 0 }]);
  });
  it("keeps two touching blocks apart, each with its own kind", () => {
    const marks = rulerMarks([removedOnly(0), removedOnly(0), change(1), same, same, same, same, same, same, same], 100);
    assert.deepEqual(marks, [{ top: 0, size: 20, kind: "removed", stop: 0 }, { top: 20, size: 10, kind: "added", stop: 1 }]);
  });
  it("keeps a mark at the end inside the ruler", () => {
    const marks = rulerMarks(rows(1000, 999, change(0)), 300);
    assert.deepEqual(marks.map(m => [m.top, m.size]), [[297, 3]]);
  });
  it("gives no marks without change rows, height or shown rows", () => {
    assert.deepEqual(rulerMarks([same, hidden(0)], 100), []);
    assert.deepEqual(rulerMarks([change(0)], 0), []);
    assert.deepEqual(rulerMarks([], 100), []);
  });
});
