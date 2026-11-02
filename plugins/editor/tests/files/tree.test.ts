import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openTarget, treeLocation, gitMarks, parseDirectory, limitEntries, type TreeClaims } from "../../src/files/tree.ts";

const claim = (path: string) => ({ token: "t", path });
const click = (over: Partial<Parameters<typeof openTarget>[0]>) =>
  openTarget({
    panes: [{ pane: "p1", tab: "tab1" }],
    claims: {},
    focused: { tab: "tab1", pane: "p1" },
    path: "/w/a.ts",
    on: null,
    ...over,
  });

describe("opening a file from the tree", () => {
  it("focuses the editor pane of the focused tab that shows the path", () => {
    const panes = [{ pane: "p1", tab: "tab1" }, { pane: "e1", mod: "editor", tab: "tab1" }];
    assert.deepEqual(click({ panes, claims: { e1: claim("/w/a.ts") } }), { kind: "focus", pane: "e1" });
  });

  it("splits right of the focused pane when the path is shown only in another tab", () => {
    const panes = [{ pane: "p1", tab: "tab1" }, { pane: "e2", mod: "editor", tab: "tab2" }];
    assert.deepEqual(click({ panes, claims: { e2: claim("/w/a.ts") } }), { kind: "split", pane: "p1" });
  });

  it("focuses the one of two editor panes in the tab that shows the path", () => {
    const panes = [{ pane: "p1", tab: "tab1" }, { pane: "e1", mod: "editor", tab: "tab1" }, { pane: "e2", mod: "editor", tab: "tab1" }];
    const claims: TreeClaims = { e1: claim("/w/other.ts"), e2: claim("/w/a.ts") };
    assert.deepEqual(click({ panes, claims }), { kind: "focus", pane: "e2" });
  });

  it("splits right of the focused pane when no editor pane is open", () => {
    assert.deepEqual(click({}), { kind: "split", pane: "p1" });
  });

  it("splits right of a focused editor pane that shows another file instead of reusing it", () => {
    const panes = [{ pane: "e1", mod: "editor", tab: "tab1" }];
    assert.deepEqual(click({ panes, claims: { e1: claim("/w/other.ts") }, focused: { tab: "tab1", pane: "e1" } }), { kind: "split", pane: "e1" });
  });

  it("ignores a claim of a pane that is no longer open", () => {
    assert.deepEqual(click({ claims: { gone: claim("/w/a.ts") } }), { kind: "split", pane: "p1" });
  });

  it("splits for a file on another machine even when an editor pane claims the same local path", () => {
    const panes = [{ pane: "p1", tab: "tab1" }, { pane: "e1", mod: "editor", tab: "tab1" }];
    assert.deepEqual(click({ panes, claims: { e1: claim("/w/a.ts") }, on: "box" }), { kind: "split", pane: "p1" });
  });

  it("does not match a claim holding the decomposed form of the same path", () => {
    const path = "/w/ação.ts";
    const panes = [{ pane: "p1", tab: "tab1" }, { pane: "e1", mod: "editor", tab: "tab1" }];
    const claims: TreeClaims = { e1: claim(path.normalize("NFD")) };
    assert.deepEqual(click({ panes, claims, path }), { kind: "split", pane: "p1" });
  });

  it("opens a new tab when focus is on a layout terminal block", () => {
    assert.deepEqual(click({ focused: { tab: "tab1", pane: null } }), { kind: "tab" });
  });

  it("matches a path with spaces and non-ASCII letters exactly", () => {
    const path = "/w/ação teste/a b.ts";
    const panes = [{ pane: "p1", tab: "tab1" }, { pane: "e1", mod: "editor", tab: "tab1" }, { pane: "e2", mod: "editor", tab: "tab1" }];
    const claims: TreeClaims = { e1: claim("/w/acao teste/a b.ts"), e2: claim(path) };
    assert.deepEqual(click({ panes, claims, path }), { kind: "focus", pane: "e2" });
  });
});

const space = { folder: "/w", machine: null as string | null };

describe("tree location", () => {
  it("uses the cwd of a focused terminal pane and the machine of the active space", () => {
    const got = treeLocation({
      pane: { pane: "p1", cwd: "/w/sub" },
      focused: { pane: "p1", terminal: "t1", cwd: "/w/other" },
      space: { folder: "/w", machine: "box" },
      previous: undefined,
    });
    assert.deepEqual(got, { cwd: "/w/sub", on: "box" });
  });

  it("uses the cwd and machine of a focused terminal pane even when a previous location exists", () => {
    const got = treeLocation({
      pane: { pane: "p1", cwd: "/w/sub" },
      focused: { pane: "p1", terminal: "t1", cwd: "/w/sub" },
      space: { folder: "/w", machine: "box" },
      previous: { cwd: "/old", on: "other" },
    });
    assert.deepEqual(got, { cwd: "/w/sub", on: "box" });
  });

  it("keeps the previous location while an editor pane has focus", () => {
    const got = treeLocation({
      pane: { pane: "e1", mod: "editor", cwd: null },
      focused: { pane: "e1", terminal: null, cwd: null },
      space,
      previous: { cwd: "/w/sub", on: "box" },
    });
    assert.deepEqual(got, { cwd: "/w/sub", on: "box" });
  });

  it("falls back to the space folder when an editor pane has focus and nothing was shown before", () => {
    const got = treeLocation({
      pane: { pane: "e1", mod: "editor", cwd: null },
      focused: { pane: "e1", terminal: null, cwd: null },
      space: { folder: "/w", machine: "box" },
      previous: undefined,
    });
    assert.deepEqual(got, { cwd: "/w", on: "box" });
  });

  it("takes the machine from a layout terminal block on another machine", () => {
    const got = treeLocation({
      pane: undefined,
      focused: { pane: null, terminal: "box/t3", cwd: "/srv" },
      space,
      previous: undefined,
    });
    assert.deepEqual(got, { cwd: "/srv", on: "box" });
  });

  it("marks added, untracked, unmerged, deleted and other changes by repo top and path", () => {
    const status = ["?? new.txt", " M mod.txt", "A  added.txt", "UU both.txt", " D gone.txt", "AM mixed.txt", "R  r.txt"].join("\0") + "\0";
    assert.deepEqual(gitMarks("/repo\n", status), {
      "/repo/new.txt": "A",
      "/repo/mod.txt": "M",
      "/repo/added.txt": "A",
      "/repo/both.txt": "U",
      "/repo/gone.txt": "D",
      "/repo/mixed.txt": "A",
      "/repo/r.txt": "M",
    });
  });

  it("marks an added-and-unmerged status as added whichever letter comes first", () => {
    const status = ["AU au.txt", "UA ua.txt"].join("\0") + "\0";
    assert.deepEqual(gitMarks("/repo", status), { "/repo/au.txt": "A", "/repo/ua.txt": "A" });
  });

  it("parses directory output with spaces, a newline and non-ASCII letters exactly", () => {
    const out = "d\0ação dir\0f\0a b.ts\0f\0line\nbreak\0";
    assert.deepEqual(parseDirectory(out), [
      { name: "ação dir", dir: true },
      { name: "a b.ts", dir: false },
      { name: "line\nbreak", dir: false },
    ]);
  });

  it("sorts folders first then by name and keeps every entry when within the limits", () => {
    const got = limitEntries([{ name: "b", dir: false }, { name: "a", dir: false }, { name: "z", dir: true }], 0);
    assert.deepEqual(got, { entries: [{ name: "z", dir: true }, { name: "a", dir: false }, { name: "b", dir: false }], limited: false });
  });

  it("marks a folder of more than 500 entries as limited and keeps 500", () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ name: `f${i}`, dir: false }));
    const got = limitEntries(many, 0);
    assert.equal(got.entries.length, 500);
    assert.equal(got.limited, true);
  });

  it("keeps the first 500 entries listed, then sorts them", () => {
    const listed = Array.from({ length: 501 }, (_, i) => ({ name: `f${String(500 - i).padStart(3, "0")}`, dir: false }));
    const order = listed.map(e => e.name);
    const expected = order.slice(0, 500).sort();
    assert.equal(expected[0], "f001");
    const got = limitEntries(listed, 0);
    assert.deepEqual(got.entries.map(e => e.name), expected);
    assert.deepEqual(listed.map(e => e.name), order, "the caller's array keeps its order");
  });

  it("does not mark exactly 500 entries as limited", () => {
    const exact = Array.from({ length: 500 }, (_, i) => ({ name: `f${i}`, dir: false }));
    assert.equal(limitEntries(exact, 0).limited, false);
  });

  it("limits a folder by the entries already loaded elsewhere against the 5,000 total", () => {
    const some = Array.from({ length: 100 }, (_, i) => ({ name: `f${i}`, dir: false }));
    const got = limitEntries(some, 4950);
    assert.equal(got.entries.length, 50);
    assert.equal(got.limited, true);
  });
});
