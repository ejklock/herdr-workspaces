import type { DisplayRow } from "./rows.ts";

/** Which editor pane shows which file, as the editor mod records it in `shared("editor.claims")`. Declared here and in the Files panel, because a mod cannot import from another mod's folder. */
export type EditorClaims = Record<string, { token: string; path: string }>;
export type EditorTarget = { kind: "focus"; pane: string } | { kind: "split"; pane: string } | { kind: "tab" };

/** Shown-row indexes where a change block begins: a change row whose previous shown row is not a change row of the same block. */
export function stops(shown: readonly DisplayRow[]): number[] {
  const starts: number[] = [];
  shown.forEach((row, i) => {
    if (row.kind !== "change") return;
    const before = shown[i - 1];
    if (before?.kind !== "change" || before.block !== row.block) starts.push(i);
  });
  return starts;
}

/** The cursor after a step over `count` stops, without wrapping; from no cursor, both directions go to the first stop. */
export function step(cursor: number | undefined, count: number, direction: "previous" | "next"): number | undefined {
  if (count === 0) return undefined;
  if (cursor === undefined) return 0;
  return Math.min(count - 1, Math.max(0, cursor + (direction === "next" ? 1 : -1)));
}

/** Which of the two buttons can still move the cursor. */
export function stepsOf(cursor: number | undefined, count: number): { previous: boolean; next: boolean } {
  if (cursor === undefined) return { previous: count > 0, next: count > 0 };
  return { previous: cursor > 0, next: cursor < count - 1 };
}

/** A cursor kept inside the stops that exist after a reload. */
export function clampCursor(cursor: number | undefined, count: number): number | undefined {
  if (cursor === undefined || count === 0) return undefined;
  return Math.min(cursor, count - 1);
}

/**
 * Where a file opens in an editor: the pane of the focused tab that already claims it, else right of the focused pane;
 * a focused layout block has no model pane to split, so it opens a new tab. A file on another machine never matches a claim, which carries no machine.
 */
export function editorTarget({ panes, claims, focused, path, on }: {
  panes: readonly { pane: string; mod?: string; tab: string }[];
  claims: EditorClaims;
  focused: { tab: string; pane: string | null } | null;
  path: string;
  on: string | null;
}): EditorTarget | undefined {
  if (!focused) return undefined;
  if (focused.pane === null) return { kind: "tab" };
  if (!on) {
    const shown = panes.find(p => p.mod === "editor" && p.tab === focused.tab && claims[p.pane]?.path === path);
    if (shown) return { kind: "focus", pane: shown.pane };
  }
  return { kind: "split", pane: focused.pane };
}
