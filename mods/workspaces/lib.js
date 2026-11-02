// Workspace store logic shared by the mods. Pure: no import from "herdr", so it runs under Node.
// A store is { version: 1, workspaces: [{ id, name, icon, color, machine? }], assign: { [spaceId]: workspaceId } }.
// `machine` names the herdr-core machine a workspace owns; no two workspaces name the same one.
// Groups add `groups: [{ id, name, workspace? }]` in display order (no `workspace` means Default) and
// `grouped: { [spaceId]: groupId }`; both keys are absent while empty.

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

/** The workspace with `machine` set when it is a text no earlier workspace (in `cores`) already owns. */
function claimMachine(workspace, machine, cores) {
  if (!isText(machine) || cores.has(machine)) return workspace;
  cores.add(machine);
  return { ...workspace, machine };
}

function parseWorkspaces(list) {
  const seen = new Set();
  const cores = new Set();
  const kept = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (!isRecord(entry) || !isText(entry.id) || !isText(entry.name) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const workspace = {
      id: entry.id,
      name: entry.name,
      icon: isText(entry.icon) ? entry.icon : FALLBACK_WORKSPACE_ICON,
      color: isText(entry.color) ? entry.color : DEFAULT_COLOR,
    };
    kept.push(claimMachine(workspace, entry.machine, cores));
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

const groupsOf = (store) => store.groups ?? [];
const membersOf = (store) => store.grouped ?? {};

/** The store with these groups and members; the keys are left out when empty, so a store with no groups is as it was before groups. */
const withGroups = ({ groups: _groups, grouped: _grouped, ...rest }, groups, grouped) => ({
  ...rest,
  ...(groups.length > 0 ? { groups } : {}),
  ...(Object.keys(grouped).length > 0 ? { grouped } : {}),
});

/** The store without the groups in `gone` and their members. */
function dropGroups(store, gone) {
  const members = Object.entries(membersOf(store)).filter(([, groupId]) => !gone.has(groupId));
  return withGroups(store, groupsOf(store).filter((g) => !gone.has(g.id)), Object.fromEntries(members));
}

/** Groups with a text id and name that no earlier group uses; one naming a workspace must name one the store holds. */
function parseGroups(list, workspaces) {
  const known = new Set(workspaces.map((w) => w.id));
  const seen = new Set();
  const kept = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (!isRecord(entry) || !isText(entry.id) || !isText(entry.name) || seen.has(entry.id)) continue;
    if (entry.workspace !== undefined && !known.has(entry.workspace)) continue;
    seen.add(entry.id);
    kept.push({ id: entry.id, name: entry.name, ...(entry.workspace === undefined ? {} : { workspace: entry.workspace }) });
  }
  return kept;
}

function parseGrouped(grouped, groups) {
  const known = new Set(groups.map((g) => g.id));
  return Object.fromEntries(Object.entries(isRecord(grouped) ? grouped : {}).filter(([, groupId]) => known.has(groupId)));
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
  const groups = parseGroups(data.groups, workspaces);
  const store = withGroups({ version: 1, workspaces, assign: parseAssign(data.assign, workspaces) }, groups, parseGrouped(data.grouped, groups));
  return { store, error: undefined };
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

/** `{}` for no core, `{ machine }` for a free core, else the reason it is refused. Machine names are case-sensitive, like hc's. */
function checkMachine(store, machine, ownId) {
  if (machine === undefined) return {};
  if (!isText(machine)) return { error: "A core must be a machine name." };
  const owner = store.workspaces.find((w) => w.id !== ownId && w.machine === machine);
  if (owner) return { error: `The core "${machine}" already belongs to ${owner.name}.` };
  return { machine };
}

const withoutMachine = ({ machine: _machine, ...rest }) => rest;

/** Adds a workspace under the given id; `machine` binds its core. Gives { store } or { error }. */
export function createWorkspace(store, { name, icon, color, machine }, id) {
  const checked = checkName(store, name, undefined);
  if (checked.error) return { error: checked.error };
  const core = checkMachine(store, machine, undefined);
  if (core.error) return { error: core.error };
  return { store: { ...store, workspaces: [...store.workspaces, { id, name: checked.name, icon, color, ...core }] } };
}

/**
 * Changes a workspace's name, icon and color. A `machine` key binds its core; the key present with
 * no value unbinds it (assignments stay); the key absent leaves the core as it is. Gives { store } or { error }.
 */
export function renameWorkspace(store, id, fields) {
  const checked = checkName(store, fields.name, id);
  if (checked.error) return { error: checked.error };
  const core = "machine" in fields ? checkMachine(store, fields.machine, id) : undefined;
  if (core?.error) return { error: core.error };
  const edit = (w) => ({ ...(core ? withoutMachine(w) : w), name: checked.name, icon: fields.icon, color: fields.color, ...core });
  return { store: { ...store, workspaces: store.workspaces.map((w) => (w.id === id ? edit(w) : w)) } };
}

/** Removes a workspace with its assignments, its groups and their members. */
export function deleteWorkspace(store, id) {
  const assign = Object.fromEntries(Object.entries(store.assign).filter(([, workspaceId]) => workspaceId !== id));
  const gone = new Set(groupsOf(store).filter((g) => g.workspace === id).map((g) => g.id));
  return dropGroups({ ...store, workspaces: store.workspaces.filter((w) => w.id !== id), assign }, gone);
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

const isLocal = (space) => (space.machine ?? null) === null;
const coreNames = (store) => new Set(store.workspaces.map((w) => w.machine).filter(Boolean));

/**
 * The spaces the sidebar lists. A workspace lists every space of its core, plus the spaces of other
 * machines (ones no workspace names) assigned to it; Default lists only the local core's spaces.
 */
export function visibleSpaces(store, activeId, spaces) {
  const active = activeWorkspace(store, activeId);
  if (!active) return spaces.filter(isLocal);
  const cores = coreNames(store);
  return spaces.filter((s) => {
    if (active.machine && s.machine === active.machine) return true;
    return !isLocal(s) && !cores.has(s.machine) && store.assign[s.id] === active.id;
  });
}

/** The agents of the spaces `visibleSpaces` lists; an agent whose space is not among `spaces` is dropped. */
export function visibleAgents(store, activeId, agents, spaces) {
  const shown = new Set(visibleSpaces(store, activeId, spaces).map((s) => s.id));
  return agents.filter((a) => shown.has(a.space));
}

/** The machine headers the sidebar draws: other machines that hold a listed space, sorted; never a core. */
export function sidebarMachines(store, visible) {
  const cores = coreNames(store);
  const names = visible.map((s) => s.machine ?? null).filter((m) => m !== null && !cores.has(m));
  return [...new Set(names)].sort();
}

/** The machine a new space is made on: the active workspace's core; undefined (the local core) otherwise. */
export function newSpaceMachine(store, activeId) {
  return activeWorkspace(store, activeId)?.machine;
}

/** The `space.new` arguments for a new space: `{ machine }` when the active workspace names a core, else `{}`. */
export function newSpaceArgs(store, activeId) {
  const machine = newSpaceMachine(store, activeId);
  return machine ? { machine } : {};
}

/** What the sidebar's list shows: "loading" while the core is still being read and nothing is listed, "empty" once it is read and nothing is listed, else "rows". */
export function spaceListState(coreLoading, rowCount) {
  if (rowCount > 0) return "rows";
  return coreLoading ? "loading" : "empty";
}

/**
 * The store to make a new space from: the one already followed when it holds workspaces, else what
 * the file holds, so a space made before the first read still lands on the active workspace's core.
 */
export async function settledStore(store, read, path) {
  if (store.workspaces.length > 0) return store;
  return (await loadStore(read, path)).store;
}

const isSh = (m) => isRecord(m) && isText(m.name) && m.target === "sh -c" && !m.temporary;

/**
 * The cores the dialog offers, from the `machines` of `hc machine ls --json`: attached `sh -c`
 * machines no other workspace names (the edited one, `ownId`, keeps its own), sorted by name,
 * each with its connection state ("unknown" when the list gives no text one). The edited workspace's
 * own core comes first as "not attached" when the list does not offer it, so the binding stays visible.
 * Anything malformed gives an empty list.
 */
export function dialogCores(store, machines, ownId) {
  const taken = new Set(store.workspaces.filter((w) => w.id !== ownId).map((w) => w.machine));
  const cores = (Array.isArray(machines) ? machines : [])
    .filter((m) => isSh(m) && !taken.has(m.name))
    .map((m) => ({ name: m.name, state: isText(m.state) ? m.state : "unknown" }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const own = store.workspaces.find((w) => w.id === ownId)?.machine;
  if (!own || cores.some((c) => c.name === own)) return cores;
  return [{ name: own, state: "not attached" }, ...cores];
}

/** True for a space on another machine: not this computer and named by no workspace. */
export function canMoveSpace(store, space) {
  return space !== undefined && !isLocal(space) && !coreNames(store).has(space.machine);
}

/** True when the sidebar should ask the active workspace to choose its core: it exists and names none. */
export function showsCoreRow(store, activeId) {
  const active = activeWorkspace(store, activeId);
  return active !== undefined && !active.machine;
}

/** The groups of the active workspace, or of Default, in creation order; an id the store no longer holds counts as Default. */
export function workspaceGroups(store, activeId) {
  const key = activeWorkspace(store, activeId)?.id;
  return groupsOf(store).filter((g) => g.workspace === key);
}

/** The group a space is listed in, or undefined: an entry whose group belongs to another workspace is ignored, never removed. */
export function spaceGroup(store, activeId, spaceId) {
  const id = membersOf(store)[spaceId];
  return workspaceGroups(store, activeId).some((g) => g.id === id) ? id : undefined;
}

/**
 * The sidebar's sections for the listed `rows` ({ w: space, tree }, in Herdr's order): first the rows in no group,
 * then one section per group of the active workspace in group order, an empty group included.
 * A worktree row (`tree` set) goes with the main checkout above it.
 */
export function sidebarSections(store, activeId, rows) {
  const groups = workspaceGroups(store, activeId);
  const loose = { group: undefined, rows: [] };
  const sections = [loose, ...groups.map((group) => ({ group, rows: [] }))];
  const byGroup = new Map(sections.map((s) => [s.group?.id, s]));
  let current = loose;
  for (const row of rows) {
    if (!row.tree) current = byGroup.get(spaceGroup(store, activeId, row.w.id)) ?? loose;
    current.rows.push(row);
  }
  return sections;
}

/**
 * Orders the listed spaces `list` ({ w: space, i, g: git or null }) for the sidebar: each linked worktree goes under the
 * main checkout of its repo (under the first main one when a repo has several), marked with its tree glyph. Every row
 * gets `groupSpace`, the id of the space whose group entry it acts on: its main checkout for a nested worktree, itself otherwise.
 */
export function arrangeRows(list) {
  const mains = new Map();
  for (const r of list) if (r.g && !r.g.linked && !mains.has(r.g.repo)) mains.set(r.g.repo, r.w.id);
  const nested = (r) => r.g?.linked && mains.has(r.g.repo);
  const out = [];
  for (const r of list) {
    if (nested(r)) continue;
    out.push({ ...r, tree: null, groupSpace: r.w.id });
    if (!r.g || r.g.linked || mains.get(r.g.repo) !== r.w.id) continue;
    const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
    kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─", groupSpace: r.w.id }));
  }
  return out;
}

/** The fold key of a machine header in a section: `groupId` is undefined for the rows in no group. */
export const machineFoldKey = (groupId, machine) => `${groupId ?? ""}/${machine}`;

/** True when the section a space is listed in holds its machine's header folded, so its row is hidden (`folded` is the set of fold keys). */
export function foldedAway(store, activeId, folded, space) {
  return folded.has(machineFoldKey(spaceGroup(store, activeId, space.id), space.machine));
}

/** An id for a new group: the name as a dashed slug, numbered when the store already holds it. */
export function newGroupId(store, name) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "group";
  const taken = new Set(groupsOf(store).map((g) => g.id));
  let id = slug;
  for (let n = 2; taken.has(id); n += 1) id = `${slug}-${n}`;
  return id;
}

/** The trimmed name, or the reason it is refused; names are unique among the groups of one workspace (`workspaceId` undefined is Default). */
function checkGroupName(store, workspaceId, name, ownId) {
  const trimmed = name.trim();
  if (trimmed === "") return { error: "Enter a name." };
  if (groupsOf(store).some((g) => g.id !== ownId && g.workspace === workspaceId && sameName(g.name, trimmed))) {
    return { error: `A group named "${trimmed}" already exists.` };
  }
  return { name: trimmed };
}

/** Adds a group under `id` at the end of a workspace's groups (`workspaceId` undefined is Default). Gives { store } or { error }. */
export function createGroup(store, workspaceId, name, id) {
  if (workspaceId !== undefined && !store.workspaces.some((w) => w.id === workspaceId)) return { error: "This workspace no longer exists." };
  const checked = checkGroupName(store, workspaceId, name, undefined);
  if (checked.error) return { error: checked.error };
  const group = { id, name: checked.name, ...(workspaceId === undefined ? {} : { workspace: workspaceId }) };
  return { store: withGroups(store, [...groupsOf(store), group], membersOf(store)) };
}

/** Renames a group; it may keep its own name in another case. Gives { store } or { error }. */
export function renameGroup(store, id, name) {
  const group = groupsOf(store).find((g) => g.id === id);
  if (!group) return { error: "This group no longer exists." };
  const checked = checkGroupName(store, group.workspace, name, id);
  if (checked.error) return { error: checked.error };
  return { store: withGroups(store, groupsOf(store).map((g) => (g.id === id ? { ...g, name: checked.name } : g)), membersOf(store)) };
}

/** Removes a group and its members' entries: its spaces are listed in no group. */
export function deleteGroup(store, id) {
  return { store: dropGroups(store, new Set([id])) };
}

/**
 * Puts a space in a group of the active workspace, or in none when `groupId` is undefined. The space must be one
 * `spaces` lists in that workspace and the group must belong to it, else { error } and nothing changes. Gives { store } or { error }.
 */
export function moveToGroup(store, activeId, spaces, spaceId, groupId) {
  const { [spaceId]: _removed, ...rest } = membersOf(store);
  if (groupId === undefined) {
    const held = groupsOf(store).find((g) => g.id === membersOf(store)[spaceId]);
    if (held && held.workspace !== activeWorkspace(store, activeId)?.id) return { store };
    return { store: withGroups(store, groupsOf(store), rest) };
  }
  const group = groupsOf(store).find((g) => g.id === groupId);
  if (!group) return { error: "This group no longer exists." };
  if (group.workspace !== activeWorkspace(store, activeId)?.id) return { error: "That group belongs to another workspace." };
  if (!visibleSpaces(store, activeId, spaces).some((s) => s.id === spaceId)) return { error: "That space is not listed in this workspace." };
  return { store: withGroups(store, groupsOf(store), { ...rest, [spaceId]: groupId }) };
}
