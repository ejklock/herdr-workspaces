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

/**
 * Whether an editor pane sits in a space on this computer, decided from the app's own pane and space lists; an unknown pane or tab is not local.
 * `local` names the machines that run on this computer (see `localMachines`).
 */
export function isLocalPane(
  pane: string,
  panes: readonly { pane: string; tab: string }[],
  spaces: readonly { machine: string | null; tabs: readonly { id: string }[] }[],
  local: ReadonlySet<string> = new Set(),
): boolean {
  const tab = panes.find(p => p.pane === pane)?.tab;
  if (tab === undefined) return false;
  return spaces.some(space => (space.machine === null || local.has(space.machine)) && space.tabs.some(t => t.id === tab));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The machines in an `hc machine ls --json` listing that run on this computer: another herdr-core session reached through a plain `sh -c`,
 * which shares this computer's files, paths and programs. Anything that is not such a listing names none.
 */
export function localMachines(listing: string): ReadonlySet<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(listing);
  } catch {
    return new Set();
  }
  const machines = isRecord(parsed) && Array.isArray(parsed["machines"]) ? parsed["machines"] : [];
  const names = machines.flatMap(m => (isRecord(m) && typeof m["name"] === "string" && m["target"] === "sh -c" ? [m["name"]] : []));
  return new Set(names);
}

/** The machine a file must be reached through, or null when the file is on this computer. */
export function machineToReach(on: string | null, local: ReadonlySet<string>): string | null {
  return on !== null && local.has(on) ? null : on;
}
