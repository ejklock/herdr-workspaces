/** A file's added and removed line counts; a binary file has no line counts. */
export type Stat = { add: number; del: number; binary?: boolean };
export type FileChange = { path: string; status: string } & Stat;

/** The most changed files the panel lists. */
export const LIMIT = 1000;

/** The status listing: porcelain v1, NUL separated, one entry per path, untracked files listed one by one. */
export const STATUS_ARGS = ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"];

/** The count commands: with a HEAD one diff against it; before the first commit the staged and the unstaged diffs, which add up. */
export function numstatArgs(hasHead: boolean): string[][] {
  return hasHead
    ? [["diff", "HEAD", "--numstat", "-z", "--no-renames"]]
    : [["diff", "--cached", "--numstat", "-z", "--no-renames"], ["diff", "--numstat", "-z", "--no-renames"]];
}

/** The commands a commit runs, in order: stage everything, then commit with the message. */
export function commitSteps(message: string): string[][] {
  return [["add", "-A"], ["commit", "-m", message]];
}

/** The one-letter status of a porcelain XY pair: U for a conflict, D for a deletion, A for an addition (or an untracked file), else M. */
export function statusLetter(xy: string, fresh: boolean): string {
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "U";
  return xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
}

/** Adds the counts of a `--numstat -z` output into the stats by path; a "-" count marks a binary file. */
export function addStats(stats: Record<string, Stat>, numstat: string): void {
  for (const entry of numstat.split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (!parts.length) continue;
    const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
    stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
  }
}

const entriesOf = (statusText: string): string[] => statusText.split("\0").filter(Boolean);

/** The paths of the untracked entries among the first `limit` entries of a status listing. */
export function untrackedPaths(statusText: string, limit: number): string[] {
  return entriesOf(statusText).slice(0, limit).filter(entry => entry.startsWith("??")).map(entry => entry.slice(3));
}

/**
 * The listed files of a status listing: the first `limit` entries, each with its status letter and its counts.
 * A tracked file takes its numstat count, an untracked file the line count of its content; `limited` says entries were cut.
 */
export function changeList(
  statusText: string,
  stats: Readonly<Record<string, Stat>>,
  adds: Readonly<Record<string, number>>,
  limit: number,
): { files: FileChange[]; limited: boolean } {
  const all = entriesOf(statusText);
  const files = all.slice(0, limit).map((entry): FileChange => {
    const xy = entry.slice(0, 2), path = entry.slice(3);
    return { path, status: statusLetter(xy, xy === "??"), ...(stats[path] ?? { add: adds[path] ?? 0, del: 0 }) };
  });
  return { files, limited: all.length > limit };
}

/** What the empty list says: the error first, then loading, then no changes in a folder, else no folder. */
export function emptyMessage({ error, loading, root }: { error: string | null; loading: boolean; root: string | null }): string {
  return error || (loading ? "Loading changes…" : root !== null ? "No uncommitted changes" : "No folder");
}
