import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { changeList, untrackedPaths, numstatArgs, commitSteps, emptyMessage, statusLetter, addStats, type Stat } from "../../src/list/status.ts";

const entry = (xy: string, path: string): string => `${xy} ${path}`;
const listing = (...entries: string[]): string => entries.join("\0") + "\0";

describe("the changed files of a status listing", () => {
  it("gives each entry its status letter, the numstat count of a tracked file and the line count of an untracked one", () => {
    const text = listing(entry("M ", "a"), entry(" M", "b"), entry("A ", "c"), entry("D ", "d"), entry("??", "e"), entry("MM", "f"));
    const stats = { a: { add: 1, del: 2 }, b: { add: 3, del: 0 }, c: { add: 4, del: 0 }, d: { add: 0, del: 5 }, f: { add: 6, del: 7 } };
    const { files, limited } = changeList(text, stats, { e: 9 }, 1000);
    assert.equal(limited, false);
    assert.deepEqual(files, [
      { path: "a", status: "M", add: 1, del: 2 }, { path: "b", status: "M", add: 3, del: 0 },
      { path: "c", status: "A", add: 4, del: 0 }, { path: "d", status: "D", add: 0, del: 5 },
      { path: "e", status: "A", add: 9, del: 0 }, { path: "f", status: "M", add: 6, del: 7 },
    ]);
  });

  it("counts 0 for an entry with neither a numstat nor an untracked count", () => {
    assert.deepEqual(changeList(listing(entry(" M", "x")), {}, {}, 10).files, [{ path: "x", status: "M", add: 0, del: 0 }]);
  });

  it("keeps the binary mark of a numstat count", () => {
    const stats: Record<string, Stat> = { img: { add: 0, del: 0, binary: true } };
    assert.deepEqual(changeList(listing(entry("A ", "img")), stats, {}, 10).files, [{ path: "img", status: "A", add: 0, del: 0, binary: true }]);
  });

  it("gives no files for an empty status", () => {
    assert.deepEqual(changeList("", {}, {}, 1000), { files: [], limited: false });
  });

  const many = (n: number): string => listing(...Array.from({ length: n }, (_, i) => entry(" M", `f${i}`)));
  it("gives the first 1000 entries and limited when there are more", () => {
    const { files, limited } = changeList(many(1001), {}, {}, 1000);
    assert.equal(files.length, 1000);
    assert.equal(files[999]?.path, "f999");
    assert.equal(limited, true);
  });
  it("is not limited at exactly 1000 entries", () => {
    const { files, limited } = changeList(many(1000), {}, {}, 1000);
    assert.equal(files.length, 1000);
    assert.equal(limited, false);
  });
});

describe("the untracked paths of a status listing", () => {
  it("lists only the untracked entries", () => {
    assert.deepEqual(untrackedPaths(listing(entry("M ", "a"), entry("??", "b/c"), entry("??", "d")), 1000), ["b/c", "d"]);
  });
  it("ignores untracked entries past the limit", () => {
    assert.deepEqual(untrackedPaths(listing(entry("??", "a"), entry("??", "b")), 1), ["a"]);
  });
  it("gives none for an empty status", () => assert.deepEqual(untrackedPaths("", 1000), []));
});

describe("the git commands the panel runs", () => {
  it("counts against HEAD in one diff when HEAD exists", () => {
    assert.deepEqual(numstatArgs(true), [["diff", "HEAD", "--numstat", "-z", "--no-renames"]]);
  });
  it("counts the staged and the unstaged diffs before the first commit", () => {
    assert.deepEqual(numstatArgs(false), [["diff", "--cached", "--numstat", "-z", "--no-renames"], ["diff", "--numstat", "-z", "--no-renames"]]);
  });
  it("commits by staging everything and then committing with the message", () => {
    assert.deepEqual(commitSteps("fix: x"), [["add", "-A"], ["commit", "-m", "fix: x"]]);
  });
});

describe("the status letter", () => {
  const cases: [string, boolean, string][] = [["UU", false, "U"], ["AA", false, "U"], ["DD", false, "U"], [" D", false, "D"], ["A ", false, "A"], ["??", true, "A"], ["MM", false, "M"]];
  for (const [xy, fresh, want] of cases) it(`reads "${xy}" as ${want}`, () => assert.equal(statusLetter(xy, fresh), want));
});

describe("adding numstat counts", () => {
  it("sums the same path across outputs and marks a binary file", () => {
    const stats: Record<string, Stat> = {};
    addStats(stats, "1\t2\ta\0-\t-\tb\0");
    addStats(stats, "3\t4\ta\0");
    assert.deepEqual(stats, { a: { add: 4, del: 6, binary: false }, b: { add: 0, del: 0, binary: true } });
  });
});

describe("the message of an empty list", () => {
  it("shows the error before anything else", () => assert.equal(emptyMessage({ error: "boom", loading: true, root: "/w" }), "boom"));
  it("shows loading while it loads", () => assert.equal(emptyMessage({ error: null, loading: true, root: "/w" }), "Loading changes…"));
  it("says there are no changes in a folder", () => assert.equal(emptyMessage({ error: null, loading: false, root: "/w" }), "No uncommitted changes"));
  it("says there is no folder without a root", () => assert.equal(emptyMessage({ error: null, loading: false, root: null }), "No folder"));
});
