/** Which editor pane shows which file, as the editor mod records it in `shared("editor.claims")`. Declared here so neither mod imports the other. */
export type TreeClaims = Record<string, { token: string; path: string }>;
export type Entry = { name: string; dir: boolean };
export type Location = { cwd: string | undefined; on: string | null };
export type OpenTarget = { kind: "focus"; pane: string } | { kind: "split"; pane: string } | { kind: "tab" };

export const PER_FOLDER = 500;
export const TOTAL = 5000;

/**
 * What a click on a file does. A local file already claimed by an editor pane of the focused tab gets that pane's focus;
 * otherwise a new pane opens right of the focused pane. Focus on a layout terminal block has no model pane to split, so the file opens in a new tab.
 * A file on another machine never matches a claim, which carries no machine.
 */
export function openTarget({ panes, claims, focused, path, on }: {
  panes: readonly { pane: string; mod?: string; tab: string }[];
  claims: TreeClaims;
  focused: { tab: string; pane: string | null };
  path: string;
  on: string | null;
}): OpenTarget {
  if (focused.pane === null) return { kind: "tab" };
  if (!on) {
    const shown = panes.find(p => p.mod === "editor" && p.tab === focused.tab && claims[p.pane]?.path === path);
    if (shown) return { kind: "focus", pane: shown.pane };
  }
  return { kind: "split", pane: focused.pane };
}

/**
 * The folder and machine the tree shows. A terminal pane gives its own folder; a layout terminal block on another machine gives that machine;
 * a mod pane (an editor) leaves the tree where it was, falling back to the active space's folder only when nothing was shown yet.
 */
export function treeLocation({ pane, focused, space, previous }: {
  pane: { pane: string; mod?: string; cwd: string | null } | undefined;
  focused: { pane: string | null; terminal: string | null; cwd: string | null } | null;
  space: { folder: string | null; machine: string | null } | undefined;
  previous: Location | undefined;
}): Location {
  if (pane?.mod !== undefined && previous) return previous;
  const on = focused?.pane === null
    ? (focused.terminal?.includes("/") ? (focused.terminal.split("/")[0] ?? null) : null)
    : space?.machine ?? null;
  return { cwd: pane?.cwd || focused?.cwd || space?.folder || undefined, on };
}

/** Marks from `git status --porcelain=v1 -z`, keyed by the repo top and the path. */
export function gitMarks(top: string, status: string): Record<string, string> {
  const marks: Record<string, string> = {};
  const root = top.trim();
  for (const entry of status.split("\0").filter(Boolean).slice(0, TOTAL)) {
    const xy = entry.slice(0, 2);
    marks[`${root}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
  }
  return marks;
}

/** Entries of the shell listing: a kind letter and a name, each NUL-terminated. */
export function parseDirectory(out: string): Entry[] {
  const fields = out.split("\0");
  const entries: Entry[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) entries.push({ name: fields[i + 1] ?? "", dir: fields[i] === "d" });
  return entries;
}

/** Keeps the folder within the per-folder and total limits (`used` entries are already loaded elsewhere), folders first, then by name. */
export function limitEntries(entries: Entry[], used: number): { entries: Entry[]; limited: boolean } {
  const kept = entries
    .slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used)))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return { entries: kept, limited: entries.length > PER_FOLDER || used + entries.length > TOTAL };
}
