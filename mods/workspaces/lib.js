// Workspace store logic shared by the mods. Pure: no import from "herdr", so it runs under Node.
// A store is { version: 1, workspaces: [{ id, name, icon, color }], assign: { [spaceId]: workspaceId } }.

/** Icon names are the shipped mods/workspace-chrome/<name>.svg files; "layers" stands for Default. */
export const WORKSPACE_ICONS = ["folder", "server", "monitor", "terminal", "git-branch", "archive", "clock", "file-text", "files", "circle-check"];
export const DEFAULT_ICON = "layers";

/** Color names are theme names; each shows as the same strong hue as the spaces mod's avatars. */
export const WORKSPACE_COLORS = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

const FALLBACK_WORKSPACE_ICON = WORKSPACE_ICONS[0];
const DEFAULT_COLOR = "ansi6";

/** Where the store lives under an app home, and the folder to watch. */
export function storePaths(appHome) {
  const dir = `${appHome}/workspaces`;
  return { dir, file: `${dir}/workspaces.json` };
}

const emptyStore = () => ({ version: 1, workspaces: [], assign: {} });
const isText = (value) => typeof value === "string" && value.length > 0;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

function parseWorkspaces(list) {
  const seen = new Set();
  const kept = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (!isRecord(entry) || !isText(entry.id) || !isText(entry.name) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    kept.push({
      id: entry.id,
      name: entry.name,
      icon: isText(entry.icon) ? entry.icon : FALLBACK_WORKSPACE_ICON,
      color: isText(entry.color) ? entry.color : DEFAULT_COLOR,
    });
  }
  return kept;
}

function parseAssign(assign, workspaces) {
  const known = new Set(workspaces.map((w) => w.id));
  const kept = {};
  for (const [spaceId, workspaceId] of Object.entries(isRecord(assign) ? assign : {})) {
    if (known.has(workspaceId)) kept[spaceId] = workspaceId;
  }
  return kept;
}

/** Reads the file's text. Bad input never throws: it gives an empty store and the reason. */
export function parseStore(text) {
  if (typeof text !== "string" || text.trim() === "") return { store: emptyStore(), error: undefined };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { store: emptyStore(), error: `Invalid JSON: ${e.message}` };
  }
  if (!isRecord(data) || data.version !== 1) {
    return { store: emptyStore(), error: `Unsupported store version: ${isRecord(data) ? data.version : "none"}` };
  }
  const workspaces = parseWorkspaces(data.workspaces);
  return { store: { version: 1, workspaces, assign: parseAssign(data.assign, workspaces) }, error: undefined };
}

/** A store from a value held in the app's shared state: cleaned like file text, empty for anything but an object. */
export function storeFromShared(value) {
  return parseStore(isRecord(value) ? JSON.stringify(value) : undefined).store;
}

const WRITE_ATTEMPTS = 3;

/** Reads and parses the store file through the given `read(path)` (null or undefined when absent). */
export async function loadStore(read, path) {
  return parseStore((await read(path)) ?? undefined);
}

/**
 * Applies `change(store)` (gives { store } or { error }) to the file and writes it back only if
 * nobody changed it meanwhile; a lost race is retried on the fresh content. Gives { store } or { error }.
 * `io` carries the app's `read(path)` and `write(path, text, expected)`.
 */
export async function updateStore(io, path, change) {
  let failure = "The workspaces file kept changing; try again.";
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    let text;
    try {
      text = (await io.read(path)) ?? null;
    } catch (e) {
      return { error: `The workspaces file could not be read: ${e.message ?? e}` };
    }
    const changed = change(parseStore(text ?? undefined).store);
    if (changed.error) return { error: changed.error };
    try {
      await io.write(path, serializeStore(changed.store), text);
      return { store: changed.store };
    } catch (e) {
      failure = `${failure} (${e.message ?? e})`;
    }
  }
  return { error: failure };
}

export function serializeStore(store) {
  return `${JSON.stringify(store, null, 2)}\n`;
}

/** The trimmed name, or the reason it is refused. `ownId` lets a workspace keep its own name. */
function checkName(store, name, ownId) {
  const trimmed = name.trim();
  if (trimmed === "") return { error: "Enter a name." };
  if (store.workspaces.some((w) => w.id !== ownId && sameName(w.name, trimmed))) {
    return { error: `A workspace named "${trimmed}" already exists.` };
  }
  return { name: trimmed };
}

/** An id for a new workspace: the name as a dashed slug, numbered when the store already holds it. */
export function newWorkspaceId(store, name) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const taken = new Set(store.workspaces.map((w) => w.id));
  let id = slug;
  for (let n = 2; taken.has(id); n += 1) id = `${slug}-${n}`;
  return id;
}

/** Adds a workspace under the given id. Gives { store } or { error }. */
export function createWorkspace(store, { name, icon, color }, id) {
  const checked = checkName(store, name, undefined);
  if (checked.error) return { error: checked.error };
  return { store: { ...store, workspaces: [...store.workspaces, { id, name: checked.name, icon, color }] } };
}

/** Changes a workspace's name, icon and color. Gives { store } or { error }. */
export function renameWorkspace(store, id, { name, icon, color }) {
  const checked = checkName(store, name, id);
  if (checked.error) return { error: checked.error };
  const workspaces = store.workspaces.map((w) => (w.id === id ? { id, name: checked.name, icon, color } : w));
  return { store: { ...store, workspaces } };
}

export function deleteWorkspace(store, id) {
  const assign = Object.fromEntries(Object.entries(store.assign).filter(([, workspaceId]) => workspaceId !== id));
  return { ...store, workspaces: store.workspaces.filter((w) => w.id !== id), assign };
}

/** Puts a space in a workspace; an absent workspace id takes it out. An unknown workspace changes nothing. */
export function assignSpace(store, spaceId, workspaceId) {
  const { [spaceId]: _removed, ...rest } = store.assign;
  if (workspaceId === undefined) return { ...store, assign: rest };
  if (!store.workspaces.some((w) => w.id === workspaceId)) return store;
  return { ...store, assign: { ...rest, [spaceId]: workspaceId } };
}

/** The active workspace, or undefined for Default, including an id the store no longer holds. */
export function activeWorkspace(store, activeId) {
  return store.workspaces.find((w) => w.id === activeId);
}

/** True when the space belongs to no workspace the store holds; an assignment to a deleted workspace counts as none. */
export const inDefault = (store, spaceId) => !store.workspaces.some((w) => w.id === store.assign[spaceId]);

/** Puts a space in the workspace unless it already sits in a live one; the same Default rule `adoptArrivals` applies. */
export function joinSpace(store, spaceId, workspaceId) {
  return inDefault(store, spaceId) ? assignSpace(store, spaceId, workspaceId) : store;
}

// How long after the view starts the app is still restoring the window's spaces. Measured in a scratch
// relaunch with five spaces, two on an attached machine: 7 relaunches, every space listed within
// 0.62-0.66 s, the attached machine a local core, not ssh. 5 s leaves a wide margin over that, but how a
// slower machine (ssh) behaves was not measured; the margin is an inference.
// Two costs: a space made in the first 5 s is not taken; and a machine that takes longer than 5 s to
// restore has its restored space taken and moved out of Default for good, when that space is this window's
// active one, is in no workspace, and a workspace is active.
export const RESTORE_MS = 5000;

/**
 * Herdr gives a mod no signal that a restore finished, so spaces arriving within RESTORE_MS of the view's
 * start are the window's starting set (never taken, whichever is active); later ones are decided by
 * `adoptArrivals`, but only once the store has loaded, since before that every space would look
 * unassigned. Until then they stay undecided.
 */
export function decideArrivals({ store, activeId, spaces, seen, loaded, startedAt, now }) {
  if (now - startedAt <= RESTORE_MS) return { adopt: [], seen: new Set([...seen, ...spaces.map((s) => s.id)]) };
  if (!loaded) return { adopt: [], seen: new Set(seen) };
  return adoptArrivals(store, activeId, spaces, seen);
}

/** The spaces the sidebar lists: only those in no workspace for Default, else only the active workspace's. */
export function visibleSpaces(store, activeId, spaces) {
  const active = activeWorkspace(store, activeId);
  if (!active) return spaces.filter((s) => inDefault(store, s.id));
  return spaces.filter((s) => store.assign[s.id] === active.id);
}

/**
 * Decides the spaces not in `seen` once, at first sight. A space joins the active workspace only if it is
 * this window's active space (what creating one here does; a reconnecting machine's spaces and another
 * window's are not), sits in no workspace, and a workspace is active. Gives { adopt: ids, seen: the
 * enlarged set }; a space that is not taken is never taken later.
 */
export function adoptArrivals(store, activeId, spaces, seen) {
  const arrived = spaces.filter((s) => !seen.has(s.id));
  const target = activeWorkspace(store, activeId);
  const adopt = target ? arrived.filter((s) => s.active && inDefault(store, s.id)).map((s) => s.id) : [];
  return { adopt, seen: new Set([...seen, ...arrived.map((s) => s.id)]) };
}

/** The agents the sidebar lists: those whose space visibleSpaces would keep. */
export function visibleAgents(store, activeId, agents) {
  const active = activeWorkspace(store, activeId);
  if (!active) return agents.filter((a) => inDefault(store, a.space));
  return agents.filter((a) => store.assign[a.space] === active.id);
}
