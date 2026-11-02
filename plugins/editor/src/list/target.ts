/** What the changes list hands the diff pane: the file to show and a counter that grows with each click, so a click on the same file still reloads it. Declared here and in the diff mod, because a mod cannot import from another mod's folder. */
export type DiffTarget = { root: string; path: string; on: string | null; seq: number };

/** The shared key both mods read and write: a map from space id to that space's target. */
export const TARGETS_KEY = "my-diff.targets";

/** The seq for the next click: one above the last target in the shared slot, so it grows even across a reloaded list. */
export function nextSeq(previous: unknown): number {
  const seq = typeof previous === "object" && previous !== null && "seq" in previous ? previous.seq : undefined;
  return typeof seq === "number" && Number.isFinite(seq) ? seq + 1 : 1;
}

function asEntry(value: unknown): DiffTarget | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { root, path, on, seq } = value as Record<string, unknown>;
  if (typeof root !== "string" || typeof path !== "string" || typeof seq !== "number" || !Number.isFinite(seq)) return undefined;
  return { root, path, on: typeof on === "string" ? on : null, seq };
}

/**
 * The shared map after a click in one space: that space's entry holds the file with a seq one above its previous entry, other open spaces keep theirs, and entries of spaces no longer open are dropped.
 * A previous value that is not a map of targets counts as empty, entry by entry.
 */
export function nextTargets(
  previous: unknown,
  space: string,
  file: { root: string; path: string; on: string | null },
  open: readonly string[],
): Record<string, DiffTarget> {
  const old = typeof previous === "object" && previous !== null && !Array.isArray(previous) ? Object.entries(previous) : [];
  const next: Record<string, DiffTarget> = {};
  for (const [id, value] of old) {
    const entry = asEntry(value);
    if (entry && id !== space && open.includes(id)) next[id] = entry;
  }
  const own = old.find(([id]) => id === space)?.[1];
  next[space] = { ...file, seq: nextSeq(asEntry(own)) };
  return next;
}

/** The props of a diff pane the list opens: its space, so the pane follows that space's entry, and the target it starts on. */
export function paneProps(space: string, target: DiffTarget): Record<string, unknown> {
  return { space, ...target };
}

export type DiffAction = { kind: "focus"; pane: string } | { kind: "split"; pane: string } | { kind: "tab" };

/**
 * What a click on a changed file does. A diff pane in the focused tab gets focus (the first, in panes() order); otherwise a new diff pane opens right of the focused pane.
 * Focus on a layout block has no model pane to split, so the diff opens in a new tab. With nothing focused nothing happens.
 */
export function diffTarget({ panes, focused }: {
  panes: readonly { pane: string; mod?: string; tab: string }[];
  focused: { tab: string; pane: string | null } | null;
}): DiffAction | undefined {
  if (!focused) return undefined;
  if (focused.pane === null) return { kind: "tab" };
  const shown = panes.find(p => p.mod === "my-diff" && p.tab === focused.tab);
  return shown ? { kind: "focus", pane: shown.pane } : { kind: "split", pane: focused.pane };
}

type Exec = (command: string, args?: string[], options?: { cwd?: string; on?: string | null }) => Promise<{ code: number; stdout: string; stderr: string }>;

/**
 * The added count of each untracked file, by path, from one grep run in the repository root on the panel's machine: the lines of each file, a binary file counting 0 and no file's text reaching the panel.
 * Grep prints one `<path>:<count>\n` record per file in the order given, none for a binary or unreadable file (some greps print `<path>:0` for a binary). So the paths are walked in order with a cursor into the output: a path takes the count only when the output continues with exactly its record, else it counts 0 and the cursor stays. A failed run (no grep, an unreachable machine) counts every path 0.
 */
export async function untrackedAdds(
  run: Exec,
  root: string,
  paths: readonly string[],
  on: string | null,
): Promise<Record<string, number>> {
  if (paths.length === 0) return {};
  const stdout = await run("env", ["LC_ALL=C", "grep", "-c", "-I", "-H", "-e", "", "--", ...paths], { cwd: root, on })
    .then(result => result.stdout, () => "");
  const counts: Record<string, number> = {};
  let cursor = 0;
  for (const path of paths) {
    counts[path] = 0;
    const head = `${path}:`;
    if (!stdout.startsWith(head, cursor)) continue;
    const end = stdout.indexOf("\n", cursor + head.length);
    const digits = end < 0 ? "" : stdout.slice(cursor + head.length, end);
    if (!/^\d+$/.test(digits)) continue;
    counts[path] = Number(digits);
    cursor = end + 1;
  }
  return counts;
}

/** The header's added and removed totals over every listed file. */
export function totals(files: readonly { add: number; del: number }[]): { add: number; del: number } {
  return { add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0) };
}
