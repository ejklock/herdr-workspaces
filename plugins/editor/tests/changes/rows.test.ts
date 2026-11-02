import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { asTarget, targetToShow, differsFrom, displayRows, hiddenLabel, loadView, untrackedRows, DIFF_FLAGS, type DiffTarget, type Loader } from "../../src/changes/rows.ts";
import type { Row } from "../../src/changes/diff.ts";

const target: DiffTarget = { root: "/w", path: "src/a.ts", on: "box", seq: 1 };

type Call = { command: string; args: string[]; options: { cwd?: string; on?: string | null } | undefined };
type Reads = { path: string; options: { on?: string | null } | undefined }[];
const head = { code: 0, stdout: "abc123\n" };
const noHead = { code: 128, stdout: "", stderr: "fatal: Needed a single revision" };
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Replies are for the git calls after the one that resolves HEAD, which answers with a commit unless told otherwise. */
function loader(replies: { code: number; stdout: string; stderr?: string }[], file: string | null = null, first = head): { deps: Loader; calls: Call[]; reads: Reads } {
  const calls: Call[] = [];
  const reads: Reads = [];
  const queue = [first, ...replies];
  const deps: Loader = {
    exec: async (command, args, options) => {
      calls.push({ command, args: args ?? [], options });
      const reply = queue.shift();
      if (!reply) throw new Error("spawn failed");
      return { stderr: "", ...reply };
    },
    readTextFile: async (path, options) => { reads.push({ path, options }); return file; },
  };
  return { deps, calls, reads };
}

const diff = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n";

describe("loading a file's diff", () => {
  it("runs a read-only git diff of HEAD in the root on the target's machine", async () => {
    const { deps, calls } = loader([{ code: 0, stdout: diff }]);
    await loadView(deps, target);
    assert.deepEqual(calls[0], {
      command: "git",
      args: [...DIFF_FLAGS, "rev-parse", "--verify", "HEAD"],
      options: { cwd: "/w", on: "box" },
    });
    assert.deepEqual(calls[1], {
      command: "git",
      args: ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "diff.suppressBlankEmpty=false",
        "diff", "HEAD", "-U1000000", "--no-ext-diff", "--no-textconv", "--no-color", "--", "src/a.ts"],
      options: { cwd: "/w", on: "box" },
    });
    assert.equal(DIFF_FLAGS.length, 7);
  });

  it("gives the parsed rows of a changed file", async () => {
    const { deps } = loader([{ code: 0, stdout: diff }]);
    const view = await loadView(deps, target);
    assert.equal(view.kind === "rows" ? view.rows.length : -1, 2);
  });

  it("reports the parse reason when the diff does not parse", async () => {
    const { deps } = loader([{ code: 0, stdout: "@@ -1 +1 @@\n-a\n+b\n+c\n" }]);
    assert.deepEqual(await loadView(deps, target), { kind: "message", text: "hunk longer than its header counts" });
  });

  it("says there are no changes when the diff is empty and the file is tracked", async () => {
    const { deps, calls } = loader([{ code: 0, stdout: "" }, { code: 0, stdout: "" }]);
    assert.deepEqual(await loadView(deps, target), { kind: "message", text: "No changes" });
    assert.deepEqual(calls[2]?.args.slice(-3), ["--untracked-files=all", "--", "src/a.ts"]);
    assert.deepEqual(calls[2]?.options, { cwd: "/w", on: "box" });
  });

  it("shows an untracked file whole as added rows", async () => {
    const { deps } = loader([{ code: 0, stdout: "" }, { code: 0, stdout: "?? src/a.ts\0" }], "a\nb\n");
    const view = await loadView(deps, target);
    assert.deepEqual(view, { kind: "rows", rows: untrackedRows("a\nb\n") });
    assert.equal(view.kind === "rows" ? view.rows.length : -1, 2);
  });

  it("reports a binary untracked file as a message", async () => {
    const { deps } = loader([{ code: 0, stdout: "" }, { code: 0, stdout: "?? src/a.ts\0" }], "a\0b");
    assert.deepEqual(await loadView(deps, target), { kind: "message", text: "Binary file" });
  });

  it("reports an unreadable untracked file as a message", async () => {
    const { deps } = loader([{ code: 0, stdout: "" }, { code: 0, stdout: "?? src/a.ts\0" }], null);
    assert.deepEqual(await loadView(deps, target), { kind: "message", text: "Cannot read this file (too large or unreadable)" });
  });

  it("reports git's complaint when git fails", async () => {
    const { deps } = loader([{ code: 128, stdout: "", stderr: "fatal: bad revision" }]);
    assert.deepEqual(await loadView(deps, target), { kind: "message", text: "fatal: bad revision" });
  });

  it("reports the error when exec rejects", async () => {
    const { deps } = loader([]);
    assert.deepEqual(await loadView(deps, target), { kind: "message", text: "Error: spawn failed" });
  });
});

describe("an untracked file's read", () => {
  const untracked = [{ code: 0, stdout: "" }, { code: 0, stdout: "?? src/a.ts\0" }];

  it("reads the file's full path on the target's machine", async () => {
    const { deps, reads } = loader(untracked, "a\n");
    await loadView(deps, target);
    assert.deepEqual(reads, [{ path: "/w/src/a.ts", options: { on: "box" } }]);
  });

  it("reads the file on this machine for a local target", async () => {
    const { deps, reads } = loader(untracked, "a\n");
    await loadView(deps, { ...target, on: null });
    assert.deepEqual(reads, [{ path: "/w/src/a.ts", options: { on: null } }]);
  });
});

describe("a diff with no rows", () => {
  const binary = "diff --git a/bin b/bin\nindex 1234567..89abcde 100644\nBinary files a/bin and b/bin differ\n";
  const mode = "diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n";
  const cases: [string, string, string][] = [
    ["a changed binary file", binary, "Binary file changed"],
    ["a mode-only change", mode, "Mode changed"],
    ["any other output", "diff --git a/f b/f\nsimilarity index 100%\n", "The diff has no lines"],
  ];
  for (const [title, stdout, text] of cases) {
    it(`says so for ${title}`, async () => {
      const { deps } = loader([{ code: 0, stdout }]);
      assert.deepEqual(await loadView(deps, target), { kind: "message", text });
    });
  }

  const emptyNew = "diff --git a/.gitkeep b/.gitkeep\nnew file mode 100644\nindex 0000000..e69de29\n";
  const emptyGone = "diff --git a/gone b/gone\ndeleted file mode 100644\nindex e69de29..0000000\n";
  const emptied = "diff --git a/f b/f\nindex 3b18e51..e69de29 100644\n--- a/f\n+++ b/f\n@@ -1,2 +0,0 @@\n-a\n-b\n";
  const lookalike = "diff --git a/f b/f\nnew file mode 100644\nindex 0000000..e69de2a\n";

  it("shows a staged empty new file as an empty file", async () => {
    const { deps } = loader([{ code: 0, stdout: emptyNew }]);
    assert.deepEqual(await loadView(deps, target), { kind: "rows", rows: [] });
  });

  it("says a deleted empty file was deleted", async () => {
    const { deps } = loader([{ code: 0, stdout: emptyGone }]);
    assert.deepEqual(await loadView(deps, target), { kind: "message", text: "Empty file deleted" });
  });

  it("recognizes the empty blob under a longer abbreviation", async () => {
    const { deps } = loader([{ code: 0, stdout: emptyGone.replace("e69de29..0000000", "e69de29bb2d1..000000000000") }]);
    assert.deepEqual(await loadView(deps, target), { kind: "message", text: "Empty file deleted" });
  });

  it("keeps the removed rows of a file emptied by a change", async () => {
    const { deps } = loader([{ code: 0, stdout: emptied }]);
    const view = await loadView(deps, target);
    assert.equal(view.kind === "rows" && view.rows.length, 2);
  });

  it("does not take an id that only begins like the empty blob for it", async () => {
    const { deps } = loader([{ code: 0, stdout: lookalike }]);
    assert.deepEqual(await loadView(deps, target), { kind: "message", text: "The diff has no lines" });
  });

  it("still gives no rows for an untracked empty file", async () => {
    const { deps } = loader([{ code: 0, stdout: "" }, { code: 0, stdout: "?? src/a.ts\0" }], "");
    assert.deepEqual(await loadView(deps, target), { kind: "rows", rows: [] });
  });
});

describe("a repository with no commits", () => {
  const added = "diff --git a/src/a.ts b/src/a.ts\nnew file mode 100644\nindex 0000000..e69de29\n--- /dev/null\n+++ b/src/a.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n";

  it("diffs against the empty tree with the other arguments unchanged, on the target's machine", async () => {
    const { deps, calls } = loader([{ code: 0, stdout: added }], null, noHead);
    await loadView(deps, target);
    assert.deepEqual(calls[1], {
      command: "git",
      args: [...DIFF_FLAGS, "diff", EMPTY_TREE, "-U1000000", "--no-ext-diff", "--no-textconv", "--no-color", "--", "src/a.ts"],
      options: { cwd: "/w", on: "box" },
    });
  });

  it("shows a staged new file as added rows", async () => {
    const { deps } = loader([{ code: 0, stdout: added }], null, noHead);
    const view = await loadView(deps, { ...target, on: null });
    assert.deepEqual(view.kind === "rows" ? view.rows.map(r => r.kind === "change" && r.right?.text) : view, ["a", "b"]);
  });

  it("sends a file the diff does not cover through the untracked path", async () => {
    const { deps, reads } = loader([{ code: 0, stdout: "" }, { code: 0, stdout: "?? src/a.ts\0" }], "x\ny\n", noHead);
    const view = await loadView(deps, target);
    assert.deepEqual(view, { kind: "rows", rows: untrackedRows("x\ny\n") });
    assert.equal(reads.length, 1);
  });

  it("reports a rejected check for HEAD as a message", async () => {
    const { deps } = loader([]);
    deps.exec = async () => { throw new Error("spawn failed"); };
    assert.deepEqual(await loadView(deps, target), { kind: "message", text: "Error: spawn failed" });
  });
});

describe("reading a target", () => {
  it("accepts a complete target and keeps its machine", () => {
    assert.deepEqual(asTarget({ root: "/w", path: "a", on: "box", seq: 2 }), { root: "/w", path: "a", on: "box", seq: 2 });
  });

  it("reads a missing machine as this one", () => {
    assert.deepEqual(asTarget({ root: "/w", path: "a", seq: 2 }), { root: "/w", path: "a", on: null, seq: 2 });
  });

  it("rejects values that are not targets", () => {
    assert.equal(asTarget(undefined), undefined);
    assert.equal(asTarget({ root: "/w", path: "a" }), undefined);
    assert.equal(asTarget({ root: 1, path: "a", seq: 1 }), undefined);
  });
});

describe("rows of an untracked file", () => {
  const cases: [string, string, string[]][] = [
    ["an empty file", "", []],
    ["a file ending in a newline", "a\nb\n", ["a", "b"]],
    ["a file with no final newline", "a\nb", ["a", "b"]],
    ["a single newline", "\n", [""]],
  ];
  for (const [title, text, lines] of cases) {
    it(`numbers ${title} from 1`, () => {
      const want: Row[] = lines.map((line, i) => ({ kind: "change", block: 0, right: { line: i + 1, text: line } }));
      assert.deepEqual(untrackedRows(text), want);
    });
  }
});

describe("display rows", () => {
  const same = (n: number): Row => ({ kind: "same", left: { line: n, text: `l${n}` }, right: { line: n, text: `l${n}` } });
  const file = (...changed: number[]): Row[] =>
    Array.from({ length: 20 }, (_, i): Row => (changed.includes(i + 1)
      ? { kind: "change", block: 0, left: { line: i + 1, text: "old" }, right: { line: i + 1, text: "new" } }
      : same(i + 1)));

  it("folds the runs far from a change", () => {
    const rows = displayRows(file(10), 3, new Set());
    assert.deepEqual(rows.map(r => r.kind), ["hidden", "same", "same", "same", "change", "same", "same", "same", "hidden"]);
    assert.deepEqual(rows[0], { kind: "hidden", id: 0, label: "6 hidden lines" });
    assert.deepEqual(rows.at(-1), { kind: "hidden", id: 13, label: "7 hidden lines" });
  });

  it("shows an expanded run in place", () => {
    const rows = displayRows(file(10), 3, new Set([0]));
    assert.equal(rows.length, 14);
    assert.equal(rows[0]?.kind, "same");
    assert.equal(rows.filter(r => r.kind === "hidden").length, 1);
  });

  it("labels one hidden line in the singular", () => {
    assert.equal(hiddenLabel(1), "1 hidden line");
    assert.equal(hiddenLabel(3), "3 hidden lines");
  });

  it("keeps a run of three unchanged lines between two changes visible", () => {
    const rows = displayRows(file(5, 9), 3, new Set());
    assert.equal(rows.filter(r => r.kind === "same" && r.left.line >= 6 && r.left.line <= 8).length, 3);
    assert.equal(rows.filter(r => r.kind === "hidden").length, 1);
  });

  it("has no hidden row for a wholly added file", () => {
    const rows = displayRows(untrackedRows("a\nb\nc\nd\ne\nf\n"), 3, new Set());
    assert.equal(rows.some(r => r.kind === "hidden"), false);
    assert.equal(rows.length, 6);
  });

  it("leaves the missing side of a change row empty", () => {
    assert.deepEqual(displayRows(untrackedRows("a\n"), 3, new Set()), [{ kind: "change", right: { line: 1, text: "a" } }]);
  });
});

describe("the target a diff pane shows", () => {
  const own = { space: "A", root: "/own", path: "own.ts", on: null, seq: 1 };
  const ownTarget = { root: "/own", path: "own.ts", on: null, seq: 1 };
  const entry = (path: string, seq: number) => ({ root: "/w", path, on: null, seq });

  it("follows the entry of its own space", () => {
    assert.deepEqual(targetToShow({ A: entry("a.ts", 5), B: entry("b.ts", 9) }, own), entry("a.ts", 5));
  });

  it("shows its props when the map holds only another space", () => {
    assert.deepEqual(targetToShow({ B: entry("b.ts", 9) }, own), ownTarget);
  });

  it("shows its props when they name no space and the focused space has no entry", () => {
    const { space: _space, ...bare } = own;
    assert.deepEqual(targetToShow({ B: entry("b.ts", 9) }, bare, "A"), ownTarget);
  });

  it("lets the space named in the props win over the focused space", () => {
    assert.deepEqual(targetToShow({ A: entry("a.ts", 5), B: entry("b.ts", 9) }, own, "B"), entry("a.ts", 5));
  });

  it("shows its props when its own space has no entry and the focused space has one", () => {
    assert.deepEqual(targetToShow({ B: entry("b.ts", 9) }, own, "B"), ownTarget);
  });

  it("treats a space that is not a string as naming no space", () => {
    const numbered = { ...own, space: 5 };
    assert.deepEqual(targetToShow({ A: entry("a.ts", 5) }, numbered, "A"), entry("a.ts", 5));
  });

  it("follows the focused space when the props name no space", () => {
    const { space: _space, ...bare } = own;
    assert.deepEqual(targetToShow({ A: entry("a.ts", 5), B: entry("b.ts", 9) }, bare, "A"), entry("a.ts", 5));
  });

  it("shows its props when no space is focused", () => {
    const { space: _space, ...bare } = own;
    for (const focused of [undefined, null, 3]) assert.deepEqual(targetToShow({ A: entry("a.ts", 5) }, bare, focused), ownTarget);
  });

  it("follows the focused space for a pane opened with no props", () => {
    assert.deepEqual(targetToShow({ A: entry("a.ts", 5) }, undefined, "A"), entry("a.ts", 5));
    assert.equal(targetToShow({ B: entry("b.ts", 5) }, {}, "A"), undefined);
  });

  it("shows its props when the map is malformed or absent", () => {
    for (const shared of [undefined, null, "x", [entry("a.ts", 5)], { A: "x" }, { A: { seq: 2 } }]) {
      assert.deepEqual(targetToShow(shared, own), ownTarget);
    }
  });

  it("shows nothing when the props are no target and the space has no entry", () => {
    assert.equal(targetToShow({ B: entry("b.ts", 1) }, { space: "A" }), undefined);
    assert.equal(targetToShow(undefined, undefined), undefined);
  });
});

describe("whether a diff pane reloads", () => {
  const shown: DiffTarget = { root: "/w", path: "a.ts", on: null, seq: 3 };

  it("keeps what it shows when nothing differs", () => {
    assert.equal(differsFrom({ ...shown }, shown), false);
  });

  it("reloads when the path, root, host or seq differs", () => {
    for (const change of [{ path: "b.ts" }, { root: "/x" }, { on: "box" }, { seq: 4 }]) {
      assert.equal(differsFrom({ ...shown, ...change }, shown), true);
    }
  });

  it("reloads when nothing is shown yet", () => {
    assert.equal(differsFrom(shown, undefined), true);
  });
});
