export type Claims = Record<string, { token: string; path: string }>;

export type Routing = {
  /** Open editor panes. */
  open: string[];
  /** Stored claims by pane; claims of panes that are no longer open are ignored. */
  claims: Claims;
  token: string;
  path: string;
  /** The pane this copy owned until now. */
  current: string | undefined;
  /** The focused pane when a focus event proves the keyboard is in this copy's editor. */
  proof?: string | undefined;
};

/**
 * The editor pane a copy of the mod owns, or undefined when it cannot be decided.
 * A pane claimed with this token stays owned; a focus proof takes an unclaimed pane, one claimed with this token,
 * or one left by an earlier build for the same path; without proof the one pane claimed with this path wins, then the one unclaimed pane.
 */
export function routePane({ open, claims, token, path, current, proof }: Routing): string | undefined {
  const live = (pane: string) => (open.includes(pane) ? claims[pane] : undefined);
  if (current !== undefined && live(current)?.token === token) return current;
  if (proof !== undefined) {
    if (!open.includes(proof)) return undefined;
    const claim = live(proof);
    return !claim || claim.token === token || claim.path === path ? proof : undefined;
  }
  const same = open.filter(pane => live(pane)?.path === path);
  if (same.length > 0) return same.length === 1 ? same[0] : undefined;
  const free = open.filter(pane => !live(pane));
  return free.length === 1 ? free[0] : undefined;
}
