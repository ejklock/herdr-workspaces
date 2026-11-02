import { foldRows, parseDiff, type Cell, type Row } from "./diff.ts";

/** The file the list picked; declared here and in the list mod, because a mod cannot import from another mod's folder. */
export type DiffTarget = { root: string; path: string; on: string | null; seq: number };

/** The target in a shared slot or in props, or undefined when the value is not one. */
export function asTarget(value: unknown): DiffTarget | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { root, path, on, seq } = value as Record<string, unknown>;
  if (typeof root !== "string" || typeof path !== "string" || typeof seq !== "number") return undefined;
  return { root, path, on: typeof on === "string" ? on : null, seq };
}

/** Whether a pane has to load again: the target it should show is not the one it shows. */
export function differsFrom(next: DiffTarget, shown: DiffTarget | undefined): boolean {
  return !shown || next.root !== shown.root || next.path !== shown.path || next.on !== shown.on || next.seq !== shown.seq;
}

/** The target a pane shows: the entry of the space named in its props, else of the focused space when the props name none; failing both, the target in its props. */
export function targetToShow(shared: unknown, props: unknown, focusedSpace?: unknown): DiffTarget | undefined {
  const named = typeof props === "object" && props !== null ? (props as Record<string, unknown>)["space"] : undefined;
  const space = typeof named === "string" ? named : typeof focusedSpace === "string" ? focusedSpace : undefined;
  if (typeof space === "string" && typeof shared === "object" && shared !== null && !Array.isArray(shared)) {
    const entry = asTarget(Object.entries(shared).find(([id]) => id === space)?.[1]);
    if (entry) return entry;
  }
  return asTarget(props);
}

/** What the pane draws: rows, or one message in their place. */
export type View = { kind: "rows"; rows: Row[] } | { kind: "message"; text: string };

export type DisplayRow =
  | { kind: "same"; left: Cell; right: Cell }
  | { kind: "change"; left?: Cell; right?: Cell }
  | { kind: "hidden"; id: number; label: string };

/** The Herdr calls the loader needs, so a test can stand in for them. */
export type Loader = {
  exec: (command: string, args?: string[], options?: { cwd?: string; on?: string | null }) => Promise<{ code: number; stdout: string; stderr: string }>;
  readTextFile: (path: string, options?: { on?: string | null }) => Promise<string | null>;
};

/** Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie): the folder watch would see it, and every refresh would start the next one. */
export const DIFF_FLAGS = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "diff.suppressBlankEmpty=false"];

const message = (text: string): View => ({ kind: "message", text });

export const hiddenLabel = (count: number): string => `${count} hidden ${count === 1 ? "line" : "lines"}`;

/** Every line of a file git does not track as an added row, numbered from 1. */
export function untrackedRows(text: string): Row[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line, i): Row => ({ kind: "change", block: 0, right: { line: i + 1, text: line } }));
}

/** Rows to draw: unchanged runs far from a change folded into one hidden row, unless their id is expanded. */
export function displayRows(rows: readonly Row[], context: number, expanded: ReadonlySet<number>): DisplayRow[] {
  return foldRows(rows, context, expanded).flatMap((segment): DisplayRow[] => {
    if (segment.kind === "hidden") return [{ kind: "hidden", id: segment.id, label: hiddenLabel(segment.count) }];
    return segment.rows.map((row): DisplayRow => row.kind === "same"
      ? row
      : { kind: "change", ...(row.left && { left: row.left }), ...(row.right && { right: row.right }) });
  });
}

async function untrackedView(deps: Loader, { root, path, on }: DiffTarget): Promise<View> {
  const status = await deps.exec("git", [...DIFF_FLAGS, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", path], { cwd: root, on });
  if (status.code !== 0 || !status.stdout.startsWith("??")) return message("No changes");
  const text = await deps.readTextFile(`${root}/${path}`, { on });
  if (text === null) return message("Cannot read this file (too large or unreadable)");
  if (text.includes("\0")) return message("Binary file");
  return { kind: "rows", rows: untrackedRows(text) };
}

/** Git's empty tree: what a repository with no commits has in place of HEAD. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

/** Git prints blob ids abbreviated to a length that varies with the repository, so an id is the empty blob when it is a prefix of the full id. */
function isEmptyBlob(id: string): boolean {
  return id.length >= 4 && EMPTY_BLOB.startsWith(id);
}

/** What to show for a non-empty diff that holds no rows, from the header lines git wrote. */
function noRowsView(output: string): View {
  if (/^Binary files .* differ$|^GIT binary patch$/m.test(output)) return message("Binary file changed");
  if (/^old mode \d+$/m.test(output) && /^new mode \d+$/m.test(output)) return message("Mode changed");
  const ids = /^index (?<from>[0-9a-f]+)\.\.(?<to>[0-9a-f]+)/m.exec(output)?.groups;
  if (ids?.from !== undefined && ids.to !== undefined) {
    if (/^0+$/.test(ids.to) && isEmptyBlob(ids.from)) return message("Empty file deleted");
    if (isEmptyBlob(ids.to)) return { kind: "rows", rows: [] };
  }
  return message("The diff has no lines");
}

/** The view of one file: HEAD (or the empty tree before the first commit) against the working tree, or an untracked file whole. Every failure becomes a message. */
export async function loadView(deps: Loader, target: DiffTarget): Promise<View> {
  const { root, path, on } = target;
  try {
    const head = await deps.exec("git", [...DIFF_FLAGS, "rev-parse", "--verify", "HEAD"], { cwd: root, on });
    const base = head.code === 0 ? "HEAD" : EMPTY_TREE;
    const diff = await deps.exec("git", [...DIFF_FLAGS, "diff", base, "-U1000000", "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
    if (diff.code !== 0) return message(diff.stderr.trim() || "git diff failed");
    if (diff.stdout.trim() === "") return await untrackedView(deps, target);
    const parsed = parseDiff(diff.stdout);
    if (!parsed.ok) return message(parsed.reason);
    return parsed.rows.length === 0 ? noRowsView(diff.stdout) :{ kind: "rows", rows: parsed.rows };
  } catch (e) {
    return message(String(e));
  }
}
