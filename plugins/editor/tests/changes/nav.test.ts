import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stepsOf, stops, step, clampCursor, editorTarget } from "../../src/changes/nav.ts";
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

describe("where Open in editor goes", () => {
  const panes = [{ pane: "p1", mod: "editor", tab: "t1" }, { pane: "p2", mod: "editor", tab: "t2" }];
  const base = { panes, claims: { p1: { token: "a", path: "/w/f.ts" } }, focused: { tab: "t1", pane: "p0" as string | null } as { tab: string; pane: string | null } | null, path: "/w/f.ts", on: null as string | null };
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
