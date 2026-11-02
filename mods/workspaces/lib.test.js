import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  parseStore,
  storeHome,
  storePaths,
  serializeStore,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  assignSpace,
  activeWorkspace,
  visibleSpaces,
  visibleAgents,
  loadStore,
  updateStore,
  newWorkspaceId,
  storeFromShared,
  sidebarMachines,
  newSpaceMachine,
  newSpaceArgs,
  spaceListState,
  settledStore,
  dialogCores,
  canMoveSpace,
  showsCoreRow,
  newGroupId,
  createGroup,
  renameGroup,
  deleteGroup,
  moveToGroup,
  arrangeRows,
  machineFoldKey,
  foldedAway,
  workspaceGroups,
  spaceGroup,
  sidebarSections,
  windowHome,
  windowShared,
  openPlan,
  firstListedSpace,
  beginOpen,
  endOpen,
  focusReady,
  readStoreOnce,
  ensureStoreDir,
  runOpen,
} from "./lib.js";
import { menuItems, menuIcon } from "./menu-items.js";

// An in-memory file with the app's optimistic write: a stale snapshot is refused.
function fakeFile(initial) {
  const file = {
    text: initial,
    writes: 0,
    read: async () => file.text,
    write: async (_path, text, expected) => {
      if (file.text !== expected) throw new Error("stale");
      file.text = text;
      file.writes += 1;
    },
  };
  return file;
}

const workspace = (id, name) => ({ id, name, icon: "layers", color: "accent" });
const storeOf = (workspaces, assign = {}) => ({ version: 1, workspaces, assign });
const space = (id, machine = null) => ({ id, machine });

test("store: missing file or empty text gives an empty store without an error", () => {
  for (const text of [undefined, "", "  \n"]) {
    assert.deepEqual(parseStore(text), { store: storeOf([]), error: undefined });
  }
});

test("store: a valid file round-trips byte-identical", () => {
  const text = serializeStore(storeOf([workspace("w1", "Acme"), workspace("w2", "Beta")], { s1: "w1", "m/s2": "w2" }));
  const { store, error } = parseStore(text);
  assert.equal(error, undefined);
  assert.equal(serializeStore(store), text);
});

test("store: malformed JSON gives an empty store and a reported error", () => {
  const { store, error } = parseStore("{not json");
  assert.deepEqual(store, storeOf([]));
  assert.match(error, /JSON/i);
});

test("store: a version other than 1 gives an empty store and a reported error", () => {
  const { store, error } = parseStore(JSON.stringify({ version: 2, workspaces: [workspace("w1", "Acme")], assign: {} }));
  assert.deepEqual(store, storeOf([]));
  assert.match(error, /version/);
});

test("store: a workspace missing id or name is dropped and the rest is kept", () => {
  const text = JSON.stringify(
    storeOf([{ name: "No id", icon: "layers", color: "accent" }, { id: "w2", icon: "layers", color: "accent" }, workspace("w3", "Kept")]),
  );
  assert.deepEqual(parseStore(text).store.workspaces, [workspace("w3", "Kept")]);
});

test("store: a duplicate workspace id drops the later entry", () => {
  const text = JSON.stringify(storeOf([workspace("w1", "First"), workspace("w1", "Second")]));
  assert.deepEqual(parseStore(text).store.workspaces, [workspace("w1", "First")]);
});

test("store: an assignment to an unknown workspace is dropped and the others stay", () => {
  const text = JSON.stringify(storeOf([workspace("w1", "Acme")], { s1: "w1", s2: "gone" }));
  assert.deepEqual(parseStore(text).store.assign, { s1: "w1" });
});

test("cached store: an absent value gives the empty store", () => {
  assert.deepEqual(storeFromShared(undefined), storeOf([]));
});

test("cached store: a valid store object equals the store parsed from its serialized text", () => {
  const cached = storeOf([workspace("w1", "Acme"), workspace("w2", "Beta")], { s1: "w1", "m/s2": "w2" });
  assert.deepEqual(storeFromShared(cached), parseStore(serializeStore(cached)).store);
  assert.deepEqual(storeFromShared(cached), cached);
});

test("cached store: a malformed workspace and an unknown assignment are cleaned like file text", () => {
  const cached = storeOf([{ name: "No id" }, workspace("w1", "Acme")], { s1: "w1", s2: "gone" });
  assert.deepEqual(storeFromShared(cached), storeOf([workspace("w1", "Acme")], { s1: "w1" }));
  assert.deepEqual(storeFromShared(cached), parseStore(JSON.stringify(cached)).store);
});

test("cached store: a value that is not an object gives the empty store", () => {
  const validStoreText = serializeStore(storeOf([workspace("w1", "Acme")]));
  for (const cached of ["text", validStoreText, 7, [], null, [storeOf([workspace("w1", "Acme")])]]) {
    assert.deepEqual(storeFromShared(cached), storeOf([]));
  }
});

test("store: a one-character name is accepted", () => {
  const { store, error } = createWorkspace(storeOf([]), { name: "A", icon: "layers", color: "accent" }, "w1");
  assert.equal(error, undefined);
  assert.equal(store.workspaces[0].name, "A");
});

test("store: an empty or whitespace-only name is rejected", () => {
  for (const name of ["", "   ", "\t"]) {
    const result = createWorkspace(storeOf([]), { name, icon: "layers", color: "accent" }, "w1");
    assert.equal(result.store, undefined);
    assert.match(result.error, /name/i);
  }
});

test("store: a name equal to another's ignoring case and surrounding spaces is rejected", () => {
  const start = storeOf([workspace("w1", "Acme")]);
  const result = createWorkspace(start, { name: "  aCME ", icon: "layers", color: "accent" }, "w2");
  assert.equal(result.store, undefined);
  assert.match(result.error, /already/i);
});

test("store: a created workspace keeps the trimmed name", () => {
  const { store } = createWorkspace(storeOf([]), { name: "  Acme ", icon: "server", color: "ansi2" }, "w1");
  assert.deepEqual(store.workspaces, [{ id: "w1", name: "Acme", icon: "server", color: "ansi2" }]);
});

test("store: renaming a workspace to its own name is accepted", () => {
  const start = storeOf([workspace("w1", "Acme")]);
  const { store, error } = renameWorkspace(start, "w1", { name: "ACME", icon: "server", color: "ansi2" });
  assert.equal(error, undefined);
  assert.deepEqual(store.workspaces, [{ id: "w1", name: "ACME", icon: "server", color: "ansi2" }]);
});

test("store: renaming onto another workspace's name is rejected", () => {
  const start = storeOf([workspace("w1", "Acme"), workspace("w2", "Beta")]);
  const result = renameWorkspace(start, "w1", { name: "beta", icon: "layers", color: "accent" });
  assert.equal(result.store, undefined);
  assert.match(result.error, /already/i);
});

test("store: deleting a workspace removes its assignments and leaves the others", () => {
  const start = storeOf([workspace("w1", "Acme"), workspace("w2", "Beta")], { s1: "w1", s2: "w2", s3: "w1" });
  const next = deleteWorkspace(start, "w1");
  assert.deepEqual(next, storeOf([workspace("w2", "Beta")], { s2: "w2" }));
});

test("store: assigning a space moves it and none removes it", () => {
  const start = storeOf([workspace("w1", "Acme"), workspace("w2", "Beta")], { s1: "w1" });
  assert.deepEqual(assignSpace(start, "s1", "w2").assign, { s1: "w2" });
  assert.deepEqual(assignSpace(start, "s1", undefined).assign, {});
});

test("store: assigning to an unknown workspace changes nothing", () => {
  const start = storeOf([workspace("w1", "Acme")], { s1: "w1" });
  assert.deepEqual(assignSpace(start, "s1", "gone"), start);
});

// BASE and Planet Argon each name a herdr-core machine; abby-stg is an SSH machine no workspace names.
const base = { ...workspace("base", "BASE"), machine: "base-digital" };
const argon = { ...workspace("argon", "Planet Argon"), machine: "planet-argon" };
const loose = workspace("loose", "Loose");
const core = storeOf([base, argon, loose], {
  "base-digital/1": "base",
  local1: "base",
  "planet-argon/1": "base",
  "abby-stg/1": "base",
  "abby-stg/2": "base",
  "abby-stg/3": "argon",
  "abby-stg/4": "loose",
  local2: "loose",
});
const everySpace = [
  space("local1"),
  space("local2"),
  space("local3"),
  space("base-digital/1", "base-digital"),
  space("base-digital/2", "base-digital"),
  space("planet-argon/1", "planet-argon"),
  space("abby-stg/1", "abby-stg"),
  space("abby-stg/2", "abby-stg"),
  space("abby-stg/3", "abby-stg"),
  space("abby-stg/4", "abby-stg"),
  space("abby-stg/5", "abby-stg"),
];
const idsOf = (list) => list.map((s) => s.id);

test("visible spaces: a workspace lists every space of its core plus the other-machine spaces assigned to it", () => {
  assert.deepEqual(idsOf(visibleSpaces(core, "base", everySpace)), ["base-digital/1", "base-digital/2", "abby-stg/1", "abby-stg/2"]);
});

test("visible spaces: a workspace does not list a local space or another workspace's core space assigned to it", () => {
  const ids = idsOf(visibleSpaces(core, "base", everySpace));
  assert.ok(!ids.includes("local1"));
  assert.ok(!ids.includes("planet-argon/1"));
});

test("visible spaces: a workspace does not list an unassigned other-machine space", () => {
  assert.ok(!idsOf(visibleSpaces(core, "base", everySpace)).includes("abby-stg/5"));
});

test("visible spaces: Default lists only the local core, whatever the assignment", () => {
  assert.deepEqual(idsOf(visibleSpaces(core, undefined, everySpace)), ["local1", "local2", "local3"]);
});

test("visible spaces: an active id the store no longer holds behaves as Default", () => {
  assert.deepEqual(idsOf(visibleSpaces(core, "deleted", everySpace)), ["local1", "local2", "local3"]);
  assert.equal(activeWorkspace(core, "deleted"), undefined);
});

test("visible spaces: a workspace with no machine lists only the other-machine spaces assigned to it", () => {
  assert.deepEqual(idsOf(visibleSpaces(core, "loose", everySpace)), ["abby-stg/4"]);
});

test("visible spaces: a workspace naming a machine with no spaces gives an empty list", () => {
  const quiet = storeOf([{ ...workspace("q", "Quiet"), machine: "inovatec" }]);
  assert.deepEqual(visibleSpaces(quiet, "q", everySpace), []);
});

test("visible spaces: an assignment to a space that no longer exists is ignored", () => {
  const stale = storeOf([loose], { ghost: "loose", "abby-stg/4": "loose" });
  assert.deepEqual(idsOf(visibleSpaces(stale, "loose", everySpace)), ["abby-stg/4"]);
});

test("visible spaces: no workspace and an empty store lists every local space only", () => {
  assert.deepEqual(idsOf(visibleSpaces(storeOf([]), undefined, everySpace)), ["local1", "local2", "local3"]);
});

const agent = (address, spaceId) => ({ address, space: spaceId });
const everyAgent = [
  agent("1", "local1"),
  agent("2", "base-digital/1"),
  agent("3", "planet-argon/1"),
  agent("4", "abby-stg/1"),
  agent("5", "abby-stg/5"),
  agent("6", "orphan"),
  agent("7", "abby-stg/4"),
];
const addressesOf = (list) => list.map((a) => a.address);

test("visible agents: a workspace keeps the agents of the spaces it lists, in order", () => {
  assert.deepEqual(addressesOf(visibleAgents(core, "base", everyAgent, everySpace)), ["2", "4"]);
});

test("visible agents: Default keeps only agents of local spaces", () => {
  assert.deepEqual(addressesOf(visibleAgents(core, undefined, everyAgent, everySpace)), ["1"]);
});

test("visible agents: a workspace with no machine keeps the agents of its assigned other-machine spaces", () => {
  assert.deepEqual(addressesOf(visibleAgents(core, "loose", everyAgent, everySpace)), ["7"]);
});

test("visible agents: an agent whose space is not in the given spaces is dropped", () => {
  assert.deepEqual(visibleAgents(core, "base", [agent("6", "orphan")], everySpace), []);
  assert.deepEqual(visibleAgents(core, undefined, [agent("6", "orphan")], everySpace), []);
  assert.deepEqual(visibleAgents(core, "base", everyAgent, []), []);
});

test("sidebar machine headers: a workspace shows another machine that holds a visible space of it", () => {
  const visible = visibleSpaces(core, "base", everySpace);
  assert.deepEqual(sidebarMachines(core, visible), ["abby-stg"]);
});

test("sidebar machine headers: a workspace with no other-machine space shows none", () => {
  const visible = visibleSpaces(storeOf([base]), "base", everySpace);
  assert.deepEqual(sidebarMachines(storeOf([base]), visible), []);
});

test("sidebar machine headers: Default shows none", () => {
  assert.deepEqual(sidebarMachines(core, visibleSpaces(core, undefined, everySpace)), []);
});

test("sidebar machine headers: a machine named by an inactive workspace is absent", () => {
  assert.deepEqual(sidebarMachines(core, [space("planet-argon/1", "planet-argon"), space("abby-stg/1", "abby-stg")]), ["abby-stg"]);
});

test("sidebar machine headers: the local core and the active workspace's core are never headers", () => {
  const spacesHere = [space("local1"), space("base-digital/1", "base-digital")];
  assert.deepEqual(sidebarMachines(core, spacesHere), []);
});

test("sidebar machine headers: a disconnected machine holding a visible space still has its header", () => {
  const unreachable = [{ ...space("abby-stg/1", "abby-stg"), state: "disconnected" }];
  assert.deepEqual(sidebarMachines(core, unreachable), ["abby-stg"]);
});

test("sidebar machine headers: each machine appears once, sorted", () => {
  const several = [space("z/1", "z-box"), space("a/1", "a-box"), space("a/2", "a-box")];
  assert.deepEqual(sidebarMachines(core, several), ["a-box", "z-box"]);
});

test("new space machine: the active workspace's machine", () => {
  assert.equal(newSpaceMachine(core, "base"), "base-digital");
});

test("new space machine: none under Default, for a deleted workspace id and for a workspace with no machine", () => {
  assert.equal(newSpaceMachine(core, undefined), undefined);
  assert.equal(newSpaceMachine(core, "deleted"), undefined);
  assert.equal(newSpaceMachine(core, "loose"), undefined);
});

test("new space args: carry the machine when there is one and are empty otherwise", () => {
  assert.deepEqual(newSpaceArgs(core, "base"), { machine: "base-digital" });
  assert.deepEqual(newSpaceArgs(core, undefined), {});
  assert.deepEqual(newSpaceArgs(core, "loose"), {});
});

test("store machine: a workspace's machine is kept when it is a non-empty string", () => {
  const text = JSON.stringify(storeOf([{ ...workspace("w1", "Acme"), machine: "base-digital" }]));
  assert.equal(parseStore(text).store.workspaces[0].machine, "base-digital");
});

test("store machine: an absent, empty or non-string machine leaves no field and keeps the workspace", () => {
  for (const machine of [undefined, "", 42, null, ["x"]]) {
    const text = JSON.stringify(storeOf([{ ...workspace("w1", "Acme"), machine }]));
    const kept = parseStore(text).store.workspaces;
    assert.deepEqual(kept, [workspace("w1", "Acme")]);
    assert.equal("machine" in kept[0], false);
  }
});

test("store machine: of two workspaces naming one machine, the first keeps it and the second loses only that field", () => {
  const text = JSON.stringify(storeOf([{ ...workspace("w1", "One"), machine: "m" }, { ...workspace("w2", "Two"), machine: "m" }]));
  assert.deepEqual(parseStore(text).store.workspaces, [{ ...workspace("w1", "One"), machine: "m" }, workspace("w2", "Two")]);
});

test("store machine: a store with and without machines round-trips and stays version 1", () => {
  for (const workspaces of [[workspace("w1", "Acme")], [{ ...workspace("w1", "Acme"), machine: "m" }, workspace("w2", "Beta")]]) {
    const text = serializeStore(storeOf(workspaces, { s1: "w1" }));
    const { store, error } = parseStore(text);
    assert.equal(error, undefined);
    assert.equal(store.version, 1);
    assert.equal(serializeStore(store), text);
  }
});

test("store machine: renaming a workspace keeps its machine", () => {
  const start = storeOf([{ ...workspace("w1", "Acme"), machine: "m" }]);
  const { store } = renameWorkspace(start, "w1", { name: "Acme 2", icon: "server", color: "ansi2" });
  assert.deepEqual(store.workspaces, [{ id: "w1", name: "Acme 2", icon: "server", color: "ansi2", machine: "m" }]);
});

test("store machine: a workspace created without a machine has no machine field", () => {
  const { store } = createWorkspace(storeOf([]), { name: "Acme", icon: "server", color: "ansi2" }, "w1");
  assert.equal("machine" in store.workspaces[0], false);
});


test("store file: a missing file loads as an empty store", async () => {
  const { store, error } = await loadStore(fakeFile(null).read, "/p");
  assert.deepEqual(store, storeOf([]));
  assert.equal(error, undefined);
});

test("store file: a change is written and an absent file is created", async () => {
  const file = fakeFile(null);
  const result = await updateStore(file, "/p", (s) => createWorkspace(s, { name: "Acme", icon: "layers", color: "accent" }, "w1"));
  assert.equal(result.error, undefined);
  assert.deepEqual(parseStore(file.text).store.workspaces.map((w) => w.name), ["Acme"]);
});

test("store file: a refused change writes nothing and reports the reason", async () => {
  const start = serializeStore(storeOf([workspace("w1", "Acme")]));
  const file = fakeFile(start);
  const result = await updateStore(file, "/p", (s) => createWorkspace(s, { name: "acme", icon: "layers", color: "accent" }, "w2"));
  assert.match(result.error, /already/i);
  assert.equal(file.text, start);
});

test("store file: a write that lost a race is retried on the fresh content", async () => {
  const file = fakeFile(serializeStore(storeOf([workspace("w1", "Acme")])));
  const rival = serializeStore(storeOf([workspace("w1", "Acme"), workspace("w9", "Rival")]));
  const realWrite = file.write;
  file.write = async (path, text, expected) => {
    file.text = rival;
    file.write = realWrite;
    return realWrite(path, text, expected);
  };
  const result = await updateStore(file, "/p", (s) => createWorkspace(s, { name: "Beta", icon: "layers", color: "accent" }, "w2"));
  assert.equal(result.error, undefined);
  assert.deepEqual(parseStore(file.text).store.workspaces.map((w) => w.name), ["Acme", "Rival", "Beta"]);
});

test("workspace id: a name becomes a lowercase dashed slug", () => {
  assert.equal(newWorkspaceId(storeOf([]), "  Acme Corp! "), "acme-corp");
});

test("workspace id: a name with no letters or digits still gets an id", () => {
  assert.equal(newWorkspaceId(storeOf([]), "★"), "workspace");
});

test("workspace id: a taken slug gets the next free number", () => {
  const store = storeOf([workspace("acme", "Acme"), workspace("acme-2", "Acme two")]);
  assert.equal(newWorkspaceId(store, "ACME"), "acme-3");
});

test("store file: every write stale reports the failure after exactly three write attempts and leaves the file unchanged", async () => {
  const start = serializeStore(storeOf([workspace("w1", "Acme")]));
  const file = fakeFile(start);
  let attempts = 0;
  file.write = async () => {
    attempts += 1;
    throw new Error("stale");
  };
  const result = await updateStore(file, "/p", (s) => createWorkspace(s, { name: "Beta", icon: "layers", color: "accent" }, "w2"));
  assert.equal(attempts, 3);
  assert.match(result.error, /kept changing/);
  assert.equal(result.store, undefined);
  assert.equal(file.text, start);
});

test("store file: stale twice then accepted succeeds on the third write attempt", async () => {
  const file = fakeFile(serializeStore(storeOf([workspace("w1", "Acme")])));
  const realWrite = file.write;
  let attempts = 0;
  file.write = async (path, text, expected) => {
    attempts += 1;
    if (attempts < 3) throw new Error("stale");
    return realWrite(path, text, expected);
  };
  const result = await updateStore(file, "/p", (s) => createWorkspace(s, { name: "Beta", icon: "layers", color: "accent" }, "w2"));
  assert.equal(attempts, 3);
  assert.equal(result.error, undefined);
  assert.deepEqual(parseStore(file.text).store.workspaces.map((w) => w.name), ["Acme", "Beta"]);
});

test("store file: a read that rejects reports the failure and writes nothing", async () => {
  const file = fakeFile(null);
  file.read = async () => {
    throw new Error("disk gone");
  };
  const result = await updateStore(file, "/p", (s) => createWorkspace(s, { name: "Beta", icon: "layers", color: "accent" }, "w2"));
  assert.match(result.error, /disk gone/);
  assert.equal(file.writes, 0);
});

test("store file: a write that rejects reports the failure", async () => {
  const file = fakeFile(null);
  file.write = async () => {
    throw new Error("read-only volume");
  };
  const result = await updateStore(file, "/p", (s) => createWorkspace(s, { name: "Beta", icon: "layers", color: "accent" }, "w2"));
  assert.match(result.error, /read-only volume/);
  assert.equal(result.store, undefined);
});

test("store file: an invalid name reports the reason and attempts no write", async () => {
  const file = fakeFile(null);
  let attempts = 0;
  file.write = async () => {
    attempts += 1;
  };
  const result = await updateStore(file, "/p", (s) => createWorkspace(s, { name: "   ", icon: "layers", color: "accent" }, "w2"));
  assert.ok(result.error);
  assert.equal(attempts, 0);
});

test("space list state: a loading core with no rows is loading, a loaded core with no rows is empty, rows are neither", () => {
  assert.equal(spaceListState(true, 0), "loading");
  assert.equal(spaceListState(false, 0), "empty");
  assert.equal(spaceListState(true, 2), "rows");
  assert.equal(spaceListState(false, 2), "rows");
});

test("settled store: a store that already holds workspaces is used without reading the file", async () => {
  let reads = 0;
  const read = async () => {
    reads += 1;
    return undefined;
  };
  assert.equal(await settledStore(core, read, "/p"), core);
  assert.equal(reads, 0);
});

test("settled store: an empty store waits for the file read and gives what the file holds", async () => {
  const file = fakeFile(serializeStore(core));
  const store = await settledStore(storeOf([]), file.read, "/p");
  assert.deepEqual(newSpaceArgs(store, "base"), { machine: "base-digital" });
});

const menuProps = (tab) => ({ tab, target: { id: "s1", space: "s1" } });
const newSpaceItem = (store, activeId) => menuItems(menuProps(undefined), null, store, activeId, [])[0];

test("menu: New space carries the active workspace's core", () => {
  assert.deepEqual(newSpaceItem(core, "base"), ["New space", "space.new", { machine: "base-digital" }]);
});

test("menu: New space carries no core under Default, for a deleted workspace and for an unbound workspace", () => {
  for (const id of [undefined, "deleted", "loose"]) assert.deepEqual(newSpaceItem(core, id), ["New space", "space.new", {}]);
});

const remoteSpaces = [space("s1", "abby-stg")];

test("menu: the space tab lists rename, move, worktree items for a repo and close", () => {
  const items = (git) => menuItems(menuProps("space"), git, core, "base", [], remoteSpaces).map((i) => i.slice(0, 3));
  assert.deepEqual(items(null), [
    ["Rename", "space.rename", { id: "s1" }],
    ["Move to workspace…", "workspaces.move", { space: "s1" }],
    ["Move to group…", "workspaces.group-move", { space: "s1" }],
    ["Close", "space.close", { id: "s1" }],
  ]);
  assert.deepEqual(items("linked").map((i) => i[0]), ["Rename", "Move to workspace…", "Move to group…", "New worktree", "Open worktree", "Remove worktree", "Close"]);
});

test("menu: the workspace-move tab checks the space's current workspace", () => {
  const assigned = storeOf(core.workspaces, { s1: "base" });
  const items = menuItems(menuProps("workspace-move"), null, assigned, undefined, []);
  assert.deepEqual(items.map((i) => [i[0], i[3]]), [["Default", false], ...core.workspaces.map((w) => [w.name, w.id === "base"])]);
});

const machineEntry = (name, target = "sh -c", extra = {}) => ({ name, session: name, state: "connected", target, ...extra });
const ownerMachines = [machineEntry("base-digital"), machineEntry("planet-argon"), machineEntry("inovatec"), machineEntry("abby-stg", "abby-stg", { state: "unreachable" })];
const fields = (machine) => ({ name: "Acme", icon: "server", color: "ansi2", ...(machine === undefined ? {} : { machine }) });

test("create with a core: a core no workspace names is stored", () => {
  const { store, error } = createWorkspace(storeOf([base]), fields("inovatec"), "acme");
  assert.equal(error, undefined);
  assert.equal(store.workspaces[1].machine, "inovatec");
});

test("create with a core: a core another workspace names is refused by name and the store is untouched", () => {
  const start = storeOf([base]);
  const result = createWorkspace(start, fields("base-digital"), "acme");
  assert.equal(result.store, undefined);
  assert.match(result.error, /BASE/);
  assert.match(result.error, /base-digital/);
  assert.deepEqual(start, storeOf([base]));
});

test("create with a core: no machine leaves no machine key", () => {
  const { store } = createWorkspace(storeOf([]), fields(undefined), "acme");
  assert.equal("machine" in store.workspaces[0], false);
});

test("create with a core: a machine that is not a non-empty text is refused", () => {
  for (const machine of ["", null, 5, {}]) {
    const result = createWorkspace(storeOf([]), fields(machine), "acme");
    assert.equal(typeof result.error, "string", `machine ${JSON.stringify(machine)}`);
    assert.equal(result.store, undefined);
  }
});

test("create with a core: a name differing only in case is another machine", () => {
  const { store, error } = createWorkspace(storeOf([base]), fields("Base-Digital"), "acme");
  assert.equal(error, undefined);
  assert.equal(store.workspaces[1].machine, "Base-Digital");
});

test("rename with a core: keeping its own core is allowed", () => {
  const { store, error } = renameWorkspace(storeOf([base]), "base", { ...fields("base-digital"), name: "BASE 2" });
  assert.equal(error, undefined);
  assert.equal(store.workspaces[0].machine, "base-digital");
});

test("rename with a core: another workspace's core is refused by name", () => {
  const result = renameWorkspace(storeOf([base, argon]), "base", fields("planet-argon"));
  assert.match(result.error, /Planet Argon/);
  assert.equal(result.store, undefined);
});

test("rename with a core: an explicitly absent machine removes the key and keeps the assignments", () => {
  const start = storeOf([base], { "abby-stg/1": "base" });
  const { store } = renameWorkspace(start, "base", { ...fields(undefined), machine: undefined });
  assert.equal("machine" in store.workspaces[0], false);
  assert.deepEqual(store.assign, { "abby-stg/1": "base" });
});

test("rename with a core: a machine that is not a non-empty text is refused", () => {
  for (const machine of ["", null, 7]) assert.equal(typeof renameWorkspace(storeOf([base]), "base", fields(machine)).error, "string");
});

test("store machine: a hand-edited file with two workspaces on one core parses with the first winning", () => {
  const text = JSON.stringify(storeOf([{ ...workspace("a", "A"), machine: "m" }, { ...workspace("b", "B"), machine: "m" }]));
  const { store } = parseStore(text);
  assert.equal(store.workspaces[0].machine, "m");
  assert.equal("machine" in store.workspaces[1], false);
});

test("dialog cores: creating offers every free sh -c machine by name, never an SSH one", () => {
  assert.deepEqual(dialogCores(storeOf([]), ownerMachines, undefined).map((m) => m.name), ["base-digital", "inovatec", "planet-argon"]);
});

test("dialog cores: a core another workspace names is not offered", () => {
  assert.deepEqual(dialogCores(storeOf([base]), ownerMachines, undefined).map((m) => m.name), ["inovatec", "planet-argon"]);
});

test("dialog cores: editing a workspace lists its own core with the free ones, sorted by name", () => {
  assert.deepEqual(dialogCores(storeOf([base]), ownerMachines, "base").map((m) => m.name), ["base-digital", "inovatec", "planet-argon"]);
  assert.deepEqual(dialogCores(storeOf([base, argon]), ownerMachines, "argon").map((m) => m.name), ["inovatec", "planet-argon"]);
});

test("dialog cores: a temporary machine is excluded and an unreachable sh -c one is listed with its state", () => {
  const list = [machineEntry("tmp", "sh -c", { temporary: true }), machineEntry("down", "sh -c", { state: "unreachable" })];
  assert.deepEqual(dialogCores(storeOf([]), list, undefined), [{ name: "down", state: "unreachable" }]);
});

test("dialog cores: editing keeps the workspace's own core first as not attached when the machine list lacks it", () => {
  const list = [machineEntry("inovatec", "sh -c", { state: "connected" })];
  assert.deepEqual(dialogCores(storeOf([base]), list, "base"), [
    { name: "base-digital", state: "not attached" },
    { name: "inovatec", state: "connected" },
  ]);
});

test("dialog cores: the own core listed with another target or as temporary still shows once as not attached", () => {
  for (const own of [machineEntry("base-digital", "ssh"), machineEntry("base-digital", "sh -c", { temporary: true })]) {
    const shown = dialogCores(storeOf([base]), [own, machineEntry("inovatec")], "base");
    assert.deepEqual(shown, [{ name: "base-digital", state: "not attached" }, { name: "inovatec", state: "connected" }]);
  }
});

test("dialog cores: creating or editing another workspace never adds a core missing from the list", () => {
  const list = [machineEntry("inovatec")];
  assert.deepEqual(dialogCores(storeOf([base]), list, undefined).map((c) => c.name), ["inovatec"]);
  assert.deepEqual(dialogCores(storeOf([base, argon]), list, "argon").map((c) => c.name), ["planet-argon", "inovatec"]);
});

test("dialog cores: a listed own core appears once with its listed state", () => {
  const list = [machineEntry("base-digital", "sh -c", { state: "connected" }), machineEntry("inovatec", "sh -c", {})];
  const shown = dialogCores(storeOf([base]), list, "base");
  assert.equal(shown.filter((c) => c.name === "base-digital").length, 1);
  assert.equal(shown.find((c) => c.name === "base-digital").state, "connected");
});

test("dialog cores: every entry has a non-empty text state, defaulting to unknown", () => {
  const entry = (state) => ({ name: "x", target: "sh -c", state });
  for (const bad of [undefined, 7, "", null, {}]) {
    const raw = bad === undefined ? { name: "x", target: "sh -c" } : entry(bad);
    assert.deepEqual(dialogCores(storeOf([]), [raw], undefined), [{ name: "x", state: "unknown" }]);
  }
  assert.deepEqual(dialogCores(storeOf([]), [entry("connected")], undefined), [{ name: "x", state: "connected" }]);
});

test("dialog cores: malformed input gives an empty list", () => {
  for (const bad of [undefined, null, "x", 3, [null, 5, {}, { target: "sh -c" }, { name: "", target: "sh -c" }]]) {
    assert.deepEqual(dialogCores(storeOf([]), bad, undefined), []);
  }
});

test("move to workspace: offered only for a space on a machine no workspace names", () => {
  assert.equal(canMoveSpace(core, space("a", null)), false);
  assert.equal(canMoveSpace(core, space("a", "base-digital")), false);
  assert.equal(canMoveSpace(core, space("a", "abby-stg")), true);
  assert.equal(canMoveSpace(storeOf([]), space("a", "base-digital")), true);
  assert.equal(canMoveSpace(core, undefined), false);
});

test("menu: Move to workspace is offered for a space on another machine only", () => {
  const labels = (spaces) => menuItems(menuProps("space"), null, core, "base", [], spaces).map((i) => i[0]);
  assert.ok(labels(remoteSpaces).includes("Move to workspace…"));
  assert.ok(!labels([space("s1")]).includes("Move to workspace…"));
  assert.ok(!labels([space("s1", "base-digital")]).includes("Move to workspace…"));
  assert.ok(!labels([]).includes("Move to workspace…"));
});

test("core row: shown for an active workspace with no machine only", () => {
  assert.equal(showsCoreRow(core, "loose"), true);
  assert.equal(showsCoreRow(core, "base"), false);
  assert.equal(showsCoreRow(core, undefined), false);
  assert.equal(showsCoreRow(core, "deleted"), false);
});

test("core row: the listed spaces stay the moved-in ones of other machines", () => {
  assert.equal(showsCoreRow(core, "loose"), true);
  assert.deepEqual(idsOf(visibleSpaces(core, "loose", everySpace)), ["abby-stg/4"]);
});

const groupedStore = (groups, grouped = {}, workspaces = core.workspaces) => ({ ...storeOf(workspaces, core.assign), groups, grouped });
const grp = (id, name, workspaceId) => ({ id, name, ...(workspaceId ? { workspace: workspaceId } : {}) });
const parseGroups = (data) => parseStore(JSON.stringify({ version: 1, workspaces: core.workspaces, assign: {}, ...data })).store;

test("groups parsing: a file with no groups or grouped keys has none and adds no keys", () => {
  const store = parseStore(serializeStore(storeOf([workspace("w1", "Acme")]))).store;
  assert.deepEqual(workspaceGroups(store, undefined), []);
  assert.equal("groups" in store, false);
  assert.equal("grouped" in store, false);
});

test("groups parsing: a group of a workspace the store lacks is dropped with its members", () => {
  const store = parseGroups({ groups: [grp("g1", "Keep", "base"), grp("g2", "Lost", "gone"), grp("g3", "Default one")], grouped: { a: "g1", b: "g2", c: "g3" } });
  assert.deepEqual(store.groups, [grp("g1", "Keep", "base"), grp("g3", "Default one")]);
  assert.deepEqual(store.grouped, { a: "g1", c: "g3" });
});

test("groups parsing: a group whose workspace is not a text is dropped", () => {
  assert.equal(parseGroups({ groups: [{ id: "g1", name: "X", workspace: 5 }, { id: "g2", name: "Y", workspace: "" }] }).groups, undefined);
});

test("groups parsing: a duplicate group id keeps the first", () => {
  const store = parseGroups({ groups: [grp("g1", "First", "base"), grp("g1", "Second", "argon")], grouped: { a: "g1" } });
  assert.deepEqual(store.groups, [grp("g1", "First", "base")]);
  assert.deepEqual(store.grouped, { a: "g1" });
});

test("groups parsing: a member whose group is gone is dropped and the others stay", () => {
  const store = parseGroups({ groups: [grp("g1", "One", "base")], grouped: { a: "g1", b: "gone", c: 7 } });
  assert.deepEqual(store.grouped, { a: "g1" });
});

test("groups parsing: a group with a missing or non-text name or id is dropped", () => {
  const store = parseGroups({ groups: [{ id: "g1", name: 4 }, { id: "g2" }, { name: "No id" }, grp("g3", "Fine", "base")] });
  assert.deepEqual(store.groups, [grp("g3", "Fine", "base")]);
});

test("groups parsing: an array where an object is expected, and the reverse, is ignored", () => {
  assert.equal(parseGroups({ groups: { g1: "x" }, grouped: ["g1"] }).groups, undefined);
  const store = parseGroups({ groups: [grp("g1", "One", "base")], grouped: ["g1"] });
  assert.equal(store.grouped, undefined);
  assert.deepEqual(store.groups, [grp("g1", "One", "base")]);
  assert.equal(parseGroups({ groups: [["g1"], "g2", null] }).groups, undefined);
});

test("groups parsing: a store with groups, their order and members round-trips and stays version 1", () => {
  const text = serializeStore(groupedStore([grp("g2", "Second", "base"), grp("g1", "First"), grp("g3", "Third", "base")], { a: "g1", b: "g2", c: "g2" }));
  const { store, error } = parseStore(text);
  assert.equal(error, undefined);
  assert.equal(store.version, 1);
  assert.deepEqual(store.groups.map((g) => g.id), ["g2", "g1", "g3"]);
  assert.equal(serializeStore(store), text);
});

test("group create: adds to the end of the active workspace's groups, or to Default with no workspace", () => {
  const first = createGroup(groupedStore([grp("g1", "One", "base")]), "base", "  Two ", "g2");
  assert.deepEqual(first.store.groups, [grp("g1", "One", "base"), grp("g2", "Two", "base")]);
  const def = createGroup(storeOf([]), undefined, "Loose", "g1");
  assert.deepEqual(def.store.groups, [grp("g1", "Loose")]);
});

test("group create: an empty name or one equal ignoring case in the same workspace is refused", () => {
  const store = groupedStore([grp("g1", "Alpha", "base"), grp("g2", "Beta")]);
  for (const name of ["", "   "]) assert.match(createGroup(store, "base", name, "g9").error, /name/i);
  assert.match(createGroup(store, "base", " ALPHA ", "g9").error, /already/);
  assert.match(createGroup(store, undefined, "beta", "g9").error, /already/);
});

test("group create: the same name in another workspace or in Default is allowed", () => {
  const store = groupedStore([grp("g1", "Alpha", "base")]);
  assert.equal(createGroup(store, "argon", "Alpha", "g2").error, undefined);
  assert.equal(createGroup(store, undefined, "Alpha", "g2").error, undefined);
});

test("group create: a workspace the store lacks is refused", () => {
  assert.match(createGroup(groupedStore([]), "gone", "Alpha", "g1").error, /workspace/i);
});

test("group id: a name becomes a dashed slug, numbered when taken", () => {
  const store = groupedStore([grp("api", "API", "base"), grp("api-2", "API 2", "base")]);
  assert.equal(newGroupId(store, " Web App "), "web-app");
  assert.equal(newGroupId(store, "API"), "api-3");
  assert.equal(newGroupId(store, "!!!"), "group");
});

test("group rename: trims, follows the same refusals and lets a group keep its own name", () => {
  const store = groupedStore([grp("g1", "Alpha", "base"), grp("g2", "Beta", "base"), grp("g3", "Alpha", "argon")], { a: "g1" });
  assert.deepEqual(renameGroup(store, "g1", " New ").store.groups[0], grp("g1", "New", "base"));
  assert.deepEqual(renameGroup(store, "g1", "ALPHA").store.groups[0], grp("g1", "ALPHA", "base"));
  assert.match(renameGroup(store, "g1", "beta").error, /already/);
  assert.match(renameGroup(store, "g1", " ").error, /name/i);
  assert.equal(renameGroup(store, "g3", "Beta").error, undefined);
  assert.deepEqual(renameGroup(store, "g1", "New").store.grouped, { a: "g1" });
  assert.match(renameGroup(store, "gone", "New").error, /no longer/);
});

test("group delete: removes the group and its members, and the spaces list in no group", () => {
  const store = groupedStore([grp("g1", "Alpha", "base"), grp("g2", "Beta", "base")], { "base-digital/1": "g1", "base-digital/2": "g2", "abby-stg/1": "g1" });
  const { store: after } = deleteGroup(store, "g1");
  assert.deepEqual(after.groups, [grp("g2", "Beta", "base")]);
  assert.deepEqual(after.grouped, { "base-digital/2": "g2" });
  const rows = visibleSpaces(after, "base", everySpace).map((s) => ({ w: s, tree: null }));
  assert.equal(sidebarSections(after, "base", rows)[0].rows.length, 3);
  assert.equal(spaceGroup(after, "base", "base-digital/1"), undefined);
});

test("group delete: the last group leaves no groups or grouped keys", () => {
  const { store } = deleteGroup(groupedStore([grp("g1", "Alpha", "base")], { a: "g1" }), "g1");
  assert.equal("groups" in store, false);
  assert.equal("grouped" in store, false);
});

test("workspace delete: removes its groups and their members and keeps the others'", () => {
  const store = groupedStore([grp("g1", "Alpha", "base"), grp("g2", "Beta", "argon"), grp("g3", "Loose")], { a: "g1", b: "g2", c: "g3" });
  const after = deleteWorkspace(store, "base");
  assert.deepEqual(after.groups, [grp("g2", "Beta", "argon"), grp("g3", "Loose")]);
  assert.deepEqual(after.grouped, { b: "g2", c: "g3" });
});

const baseGroups = groupedStore([grp("g1", "Alpha", "base"), grp("g2", "Beta", "argon"), grp("g3", "Loose")]);

test("move to group: sets the member entry and No group removes it", () => {
  const moved = moveToGroup(baseGroups, "base", everySpace, "abby-stg/1", "g1");
  assert.deepEqual(moved.store.grouped, { "abby-stg/1": "g1" });
  const again = moveToGroup(moved.store, "base", everySpace, "abby-stg/1", undefined);
  assert.equal("grouped" in again.store, false);
  assert.deepEqual(again.store.groups, baseGroups.groups);
});

test("move to group: Default's group takes a local space", () => {
  assert.deepEqual(moveToGroup(baseGroups, undefined, everySpace, "local1", "g3").store.grouped, { local1: "g3" });
});

test("move to group: a group of another workspace than the one listing the space is refused and nothing changes", () => {
  for (const [active, spaceId, groupId] of [["base", "abby-stg/1", "g2"], ["base", "abby-stg/1", "g3"], [undefined, "local1", "g1"], ["base", "local1", "g1"], ["base", "abby-stg/1", "gone"]]) {
    const result = moveToGroup(baseGroups, active, everySpace, spaceId, groupId);
    assert.ok(result.error, `${active} ${spaceId} ${groupId}`);
    assert.equal(result.store, undefined);
  }
});

test("space group: an entry whose group belongs to another workspace is ignored and kept", () => {
  const store = groupedStore([grp("g1", "Alpha", "base"), grp("g2", "Beta", "argon")], { "abby-stg/1": "g2", "base-digital/1": "g1" });
  assert.equal(spaceGroup(store, "base", "abby-stg/1"), undefined);
  assert.equal(spaceGroup(store, "base", "base-digital/1"), "g1");
  assert.equal(spaceGroup(store, undefined, "base-digital/1"), undefined);
  assert.deepEqual(store.grouped, { "abby-stg/1": "g2", "base-digital/1": "g1" });
});

test("space group: a rebound space shows in no group, and the entry returns when it comes back", () => {
  const store = groupedStore([grp("g1", "Alpha", "base")], { "abby-stg/3": "g1" });
  const rows = [{ w: space("abby-stg/3", "abby-stg"), tree: null }];
  assert.equal(sidebarSections(store, "argon", rows)[0].rows.length, 1);
  assert.equal(sidebarSections(store, "base", rows)[1].rows.length, 1);
});

const rowsOf = (ids) => ids.map((id) => ({ w: space(id), tree: null }));
const sectionIds = (sections) => sections.map((s) => [s.group?.id, s.rows.map((r) => r.w.id)]);

test("sidebar sections: no groups gives one section holding every row in order", () => {
  assert.deepEqual(sectionIds(sidebarSections(storeOf([]), undefined, rowsOf(["a", "b", "c"]))), [[undefined, ["a", "b", "c"]]]);
});

test("sidebar sections: rows in no group come first, then each group in order with its rows in Herdr's order", () => {
  const store = groupedStore([grp("g2", "Two"), grp("g1", "One")], { a: "g1", b: "g2", c: "g1", e: "g2" });
  assert.deepEqual(sectionIds(sidebarSections(store, undefined, rowsOf(["a", "b", "c", "d", "e"]))), [
    [undefined, ["d"]],
    ["g2", ["b", "e"]],
    ["g1", ["a", "c"]],
  ]);
});

test("sidebar sections: an empty group still has its section", () => {
  const store = groupedStore([grp("g1", "One")]);
  assert.deepEqual(sectionIds(sidebarSections(store, undefined, rowsOf(["a"]))), [[undefined, ["a"]], ["g1", []]]);
});

test("sidebar sections: a group of one workspace never appears in another or in Default", () => {
  const store = groupedStore([grp("g1", "Alpha", "base")], { a: "g1" });
  for (const active of ["argon", undefined, "deleted"]) assert.deepEqual(sectionIds(sidebarSections(store, active, rowsOf(["a"]))), [[undefined, ["a"]]]);
  assert.deepEqual(sectionIds(sidebarSections(store, "base", rowsOf(["a"]))), [[undefined, []], ["g1", ["a"]]]);
});

test("sidebar sections: a worktree row stays in the section of the main checkout above it", () => {
  const store = groupedStore([grp("g1", "One")], { main: "g1" });
  const rows = [
    { w: space("a"), tree: null },
    { w: space("main"), tree: null },
    { w: space("wt"), tree: "├─" },
    { w: space("wt2"), tree: "└─" },
    { w: space("b"), tree: null },
  ];
  assert.deepEqual(sectionIds(sidebarSections(store, undefined, rows)), [[undefined, ["a", "b"]], ["g1", ["main", "wt", "wt2"]]]);
  const own = groupedStore([grp("g1", "One")], { wt2: "g1" });
  assert.deepEqual(sectionIds(sidebarSections(own, undefined, rows)), [[undefined, ["a", "main", "wt", "wt2", "b"]], ["g1", []]]);
});

test("sidebar sections: another machine's rows sit in a section like any other row", () => {
  const store = groupedStore([grp("g1", "One", "base")], { "abby-stg/1": "g1", "base-digital/1": "g1" });
  const rows = visibleSpaces(store, "base", everySpace).map((s) => ({ w: s, tree: null }));
  assert.deepEqual(sectionIds(sidebarSections(store, "base", rows)), [[undefined, ["base-digital/2", "abby-stg/2"]], ["g1", ["base-digital/1", "abby-stg/1"]]]);
});

test("workspace groups: only the active workspace's, or Default's, in order", () => {
  const store = groupedStore([grp("g1", "A", "base"), grp("g2", "B"), grp("g3", "C", "base")]);
  assert.deepEqual(workspaceGroups(store, "base").map((g) => g.id), ["g1", "g3"]);
  assert.deepEqual(workspaceGroups(store, undefined).map((g) => g.id), ["g2"]);
  assert.deepEqual(workspaceGroups(store, "deleted").map((g) => g.id), ["g2"]);
});

test("menu: a space's menu offers Move to group… after rename", () => {
  const items = menuItems(menuProps("space"), null, core, "base", [], []).map((i) => i.slice(0, 3));
  assert.deepEqual(items, [["Rename", "space.rename", { id: "s1" }], ["Move to group…", "workspaces.group-move", { space: "s1" }], ["Close", "space.close", { id: "s1" }]]);
});

test("menu: the group-move tab lists the listing workspace's groups, checks the current, then No group and New group…", () => {
  const store = groupedStore([grp("g1", "Alpha", "base"), grp("g2", "Beta", "base"), grp("g3", "Loose")], { s1: "g2" });
  const items = menuItems(menuProps("group-move"), null, store, "base", []);
  assert.deepEqual(items.map((i) => [...i.slice(0, 4)]), [
    ["Alpha", "workspaces.group", { space: "s1", group: "g1" }, false],
    ["Beta", "workspaces.group", { space: "s1", group: "g2" }, true],
    ["No group", "workspaces.group", { space: "s1" }, false],
    ["New group…", "workspaces.group-new", { space: "s1" }, false],
  ]);
  const none = menuItems(menuProps("group-move"), null, store, undefined, []);
  assert.deepEqual(none.map((i) => [i[0], i[3]]), [["Loose", false], ["No group", true], ["New group…", false]]);
});

test("menu: the group-move tab ignores a member entry of another workspace's group", () => {
  const store = groupedStore([grp("g1", "Alpha", "base"), grp("g2", "Beta", "argon")], { s1: "g2" });
  assert.deepEqual(menuItems(menuProps("group-move"), null, store, "base", []).map((i) => [i[0], i[3]]), [["Alpha", false], ["No group", true], ["New group…", false]]);
});

test("menu: a group header's menu has Rename and Delete naming the group", () => {
  const p = { tab: "group", target: { id: "g1" } };
  assert.deepEqual(menuItems(p, null, core, "base", []).map((i) => i.slice(0, 3)), [["Rename", "workspaces.group-rename", { group: "g1" }], ["Delete", "workspaces.group-delete", { group: "g1" }]]);
});

test("menu icon: every group command shows its own icon, never the close one", () => {
  const dir = "mods/workspace-chrome/";
  for (const [command, icon] of [["workspaces.group", "layers"], ["workspaces.group-move", "layers"], ["workspaces.group-new", "plus"], ["workspaces.group-rename", "square-pen"], ["workspaces.group-delete", "x"]]) {
    assert.equal(menuIcon(command), `${dir}${icon}.svg`, command);
  }
});

test("menu icon: close is x, space.rename is square-pen and an unknown command is terminal", () => {
  assert.equal(menuIcon("space.close"), "mods/workspace-chrome/x.svg");
  assert.equal(menuIcon("tab.close"), "mods/workspace-chrome/x.svg");
  assert.equal(menuIcon("space.rename"), "mods/workspace-chrome/square-pen.svg");
  assert.equal(menuIcon("something.else"), "mods/workspace-chrome/terminal.svg");
});

const gitOf = (repo, linked) => ({ repo, linked });
const entry = (id, g) => ({ w: space(id), i: 0, g });
const listed = [entry("a", null), entry("main", gitOf("r", false)), entry("wt", gitOf("r", true)), entry("wt2", gitOf("r", true)), entry("b", null)];

test("worktree rows: nested under the main checkout, they act on its entry", () => {
  const rows = arrangeRows(listed);
  assert.deepEqual(rows.map((r) => [r.w.id, r.tree, r.groupSpace]), [["a", null, "a"], ["main", null, "main"], ["wt", "├─", "main"], ["wt2", "└─", "main"], ["b", null, "b"]]);
});

test("worktree rows: a worktree whose main checkout is not listed is its own row and acts on its own entry", () => {
  const rows = arrangeRows([entry("wt", gitOf("r", true)), entry("c", null)]);
  assert.deepEqual(rows.map((r) => [r.w.id, r.tree, r.groupSpace]), [["wt", null, "wt"], ["c", null, "c"]]);
});

test("worktree rows: Move to group… on a worktree checks the group it is drawn in", () => {
  const store = groupedStore([grp("g1", "Alpha", "base"), grp("g2", "Beta", "base")], { main: "g1" });
  const wt = arrangeRows(listed).find((r) => r.w.id === "wt");
  const p = { tab: "space", target: { id: wt.w.id, groupSpace: wt.groupSpace } };
  const move = menuItems(p, null, store, "base", [], []).find((i) => i[0] === "Move to group…");
  assert.deepEqual(move.slice(0, 3), ["Move to group…", "workspaces.group-move", { space: "main" }]);
  const sub = menuItems({ tab: "group-move", target: { id: move[2].space } }, null, store, "base", []);
  assert.deepEqual(sub.map((i) => [i[0], i[3]]), [["Alpha", true], ["Beta", false], ["No group", false], ["New group…", false]]);
});

test("worktree rows: moving the worktree to a group moves the main checkout and the worktree shows there", () => {
  const live = [space("a"), space("main"), space("wt"), space("wt2"), space("b")];
  const store = groupedStore([grp("g1", "Alpha"), grp("g2", "Beta")], { main: "g1" });
  const moved = moveToGroup(store, undefined, live, "main", "g2").store;
  assert.equal(moved.grouped.main, "g2");
  assert.equal("wt" in moved.grouped, false);
  const sections = sidebarSections(moved, undefined, arrangeRows(listed));
  assert.deepEqual(sectionIds(sections), [[undefined, ["a", "b"]], ["g1", []], ["g2", ["main", "wt", "wt2"]]]);
});

test("worktree rows: No group on the worktree clears the main checkout's entry", () => {
  const live = [space("main"), space("wt")];
  const store = groupedStore([grp("g1", "Alpha", "base")], { main: "g1" });
  const cleared = moveToGroup(store, "base", live, "main", undefined).store;
  assert.equal("grouped" in cleared, false);
});

test("no group: an entry naming another workspace's group stays and the store is unchanged", () => {
  const store = groupedStore([grp("g1", "Alpha", "base"), grp("g2", "Beta", "argon")], { "abby-stg/1": "g2" });
  const result = moveToGroup(store, "base", everySpace, "abby-stg/1", undefined);
  assert.equal(result.store, store);
  assert.deepEqual(result.store.grouped, { "abby-stg/1": "g2" });
});

test("no group: an entry naming a group of the listing workspace is removed", () => {
  const store = groupedStore([grp("g1", "Alpha", "base")], { "abby-stg/1": "g1" });
  assert.equal("grouped" in moveToGroup(store, "base", everySpace, "abby-stg/1", undefined).store, false);
});

test("machine fold key: the same machine under two sections folds apart", () => {
  assert.notEqual(machineFoldKey("g1", "abby-stg"), machineFoldKey("g2", "abby-stg"));
  assert.notEqual(machineFoldKey(undefined, "abby-stg"), machineFoldKey("g1", "abby-stg"));
  assert.equal(machineFoldKey("g1", "abby-stg"), machineFoldKey("g1", "abby-stg"));
});

test("folded away: a space is hidden only by its own section's fold of its machine", () => {
  const store = groupedStore([grp("g1", "Alpha", "base"), grp("g2", "Beta", "base")], { "abby-stg/1": "g1", "abby-stg/2": "g2" });
  const folded = new Set([machineFoldKey("g1", "abby-stg")]);
  assert.equal(foldedAway(store, "base", folded, space("abby-stg/1", "abby-stg")), true);
  assert.equal(foldedAway(store, "base", folded, space("abby-stg/2", "abby-stg")), false);
  assert.equal(foldedAway(store, "base", folded, space("abby-stg/3", "abby-stg")), false);
});

test("no group: an entry naming a group of Default stays when another workspace lists the space", () => {
  const store = groupedStore([grp("g3", "Loose")], { "abby-stg/1": "g3" });
  assert.equal(moveToGroup(store, "base", everySpace, "abby-stg/1", undefined).store, store);
});

const ownHome = "/Users/x/.config/herdr-app-windows/id";

test("store home: an absolute workspaces.home wins over this window's app home", () => {
  assert.equal(storeHome("/Users/x/.config/herdr-app", ownHome), "/Users/x/.config/herdr-app");
});

test("store home: a trailing slash is dropped so the store paths have no double slash", () => {
  const home = storeHome("/Users/x/.config/herdr-app/", ownHome);
  assert.equal(home, "/Users/x/.config/herdr-app");
  assert.equal(storePaths(home).file, "/Users/x/.config/herdr-app/workspaces/workspaces.json");
});

test("store home: an unusable workspaces.home falls back to this window's app home", () => {
  for (const value of [undefined, null, "", "/", "herdr-app", "./x", 7, {}, ["/abs"], true]) {
    assert.equal(storeHome(value, ownHome), ownHome, JSON.stringify(value));
  }
});

test("store home: a workspaces.home equal to the app home gives the app home", () => {
  assert.equal(storeHome(ownHome, ownHome), ownHome);
});

test("window home: a workspace's folder is named by its id under the windows folder", () => {
  assert.equal(windowHome("/Users/x", "acme"), "/Users/x/.config/herdr-app-windows/acme");
});

test("window home: Default has a folder no workspace id can name", () => {
  const home = windowHome("/Users/x", undefined);
  assert.equal(home, "/Users/x/.config/herdr-app-windows/_default");
  assert.equal(windowHome("/Users/x", null), home);
  assert.equal(windowHome("/Users/x", "_default"), undefined);
});

test("window home: an id that is not a lowercase slug gets no path", () => {
  for (const id of ["a/b", "..", "../x", "a b", "Acme", "", "a.b", 7, {}]) {
    assert.equal(windowHome("/Users/x", id), undefined, JSON.stringify(id));
  }
});

test("window home: a trailing slash on the user's home builds no double slash", () => {
  assert.equal(windowHome("/Users/x/", "acme"), "/Users/x/.config/herdr-app-windows/acme");
});

test("window shared: Herdr's own keys stay and the four window keys are set", () => {
  const text = JSON.stringify({ "sidebar.width": 268, "space.colors": { a: "ansi1" }, layout: "main" });
  assert.deepEqual(windowShared(text, "acme", "/Users/x/.config/herdr-app"), {
    "sidebar.width": 268,
    "space.colors": { a: "ansi1" },
    layout: "Workspaces",
    "workspaces.active": "acme",
    "workspaces.home": "/Users/x/.config/herdr-app",
    "workspaces.focus-first": true,
  });
});

test("window shared: an absent, malformed or non-object file gives just the window keys", () => {
  const only = { layout: "Workspaces", "workspaces.active": null, "workspaces.home": "/h", "workspaces.focus-first": true };
  for (const text of [null, undefined, "", "{not json", "[1,2]", "7", "null", '"x"']) {
    assert.deepEqual(windowShared(text, undefined, "/h"), only, String(text));
  }
});

test("window shared: another workspace's active id is replaced, and Default is null", () => {
  const text = JSON.stringify({ "workspaces.active": "other", "workspaces.home": "/old" });
  assert.equal(windowShared(text, "acme", "/h")["workspaces.active"], "acme");
  assert.equal(windowShared(text, "acme", "/h")["workspaces.home"], "/h");
  assert.equal(windowShared(text, undefined, "/h")["workspaces.active"], null);
});

const planInput = { userHome: "/Users/x", mainHome: "/Users/x/.config/herdr-app", id: "acme", appHome: "/Users/x/.config/herdr-app", present: ["mods/editor", "mods/my-files", "mods/my-changes", "mods/my-diff", "themes", "keys.json", "settings.json"] };
const WIN = "/Users/x/.config/herdr-app-windows/acme";
const targetsOf = (step) => [step.paths, step.to, step.path].flat().filter((p) => typeof p === "string");

test("open plan: checks the window is not running, makes folders, mirrors, writes shared state, then launches", () => {
  const plan = openPlan(planInput);
  assert.deepEqual(plan.map((s) => s.kind), ["running", "folders", "remove", ...Array(9).fill("mirror"), "shared", "launch"]);
  assert.equal(plan[0].socket, `${WIN}/herdr-app.sock`);
  assert.deepEqual(plan.filter((s) => s.kind === "mirror").map((s) => [s.from, s.to, s.dir]), [
    ["/Users/x/.config/herdr-app/mods/workspaces", `${WIN}/mods/workspaces`, true],
    ["/Users/x/.config/herdr-app/mods/editor", `${WIN}/mods/editor`, true],
    ["/Users/x/.config/herdr-app/mods/my-files", `${WIN}/mods/my-files`, true],
    ["/Users/x/.config/herdr-app/mods/my-changes", `${WIN}/mods/my-changes`, true],
    ["/Users/x/.config/herdr-app/mods/my-diff", `${WIN}/mods/my-diff`, true],
    ["/Users/x/.config/herdr-app/layouts/Workspaces.json", `${WIN}/layouts/Workspaces.json`, false],
    ["/Users/x/.config/herdr-app/keys.json", `${WIN}/keys.json`, false],
    ["/Users/x/.config/herdr-app/settings.json", `${WIN}/settings.json`, false],
    ["/Users/x/.config/herdr-app/themes", `${WIN}/themes`, true],
  ]);
  assert.deepEqual(plan.at(-2), { kind: "shared", path: `${WIN}/shared.json`, id: "acme", mainHome: "/Users/x/.config/herdr-app" });
});

test("open plan: writes only inside the window home and never inside the main home", () => {
  for (const step of openPlan(planInput)) {
    for (const target of targetsOf(step)) {
      assert.ok(target === WIN || target.startsWith(`${WIN}/`), target);
      assert.ok(!target.startsWith("/Users/x/.config/herdr-app/"), target);
    }
  }
});

test("open plan: a source that is absent gets no step", () => {
  const plan = openPlan({ ...planInput, present: [] });
  assert.deepEqual(plan.filter((s) => s.kind === "mirror").map((s) => s.to), [`${WIN}/mods/workspaces`, `${WIN}/layouts/Workspaces.json`]);
});

test("open plan: the earlier lower-case layout file is removed before the mirror copies the new one", () => {
  for (const present of [planInput.present, []]) {
    const plan = openPlan({ ...planInput, present });
    const removal = plan.findIndex((s) => s.kind === "remove");
    assert.deepEqual(plan[removal], { kind: "remove", path: `${WIN}/layouts/workspaces.json` });
    assert.ok(removal > plan.findIndex((s) => s.kind === "folders"));
    assert.ok(removal < plan.findIndex((s) => s.kind === "mirror" && s.to === `${WIN}/layouts/Workspaces.json`));
  }
});

test("open plan: an id with no window home gives no plan", () => {
  assert.equal(openPlan({ ...planInput, id: "Acme" }), undefined);
});

test("open plan: a window home equal to this window's app home gives no plan", () => {
  assert.equal(openPlan({ ...planInput, appHome: WIN }), undefined);
});

test("open plan: launches a new Herdr process with the window home as its app home", () => {
  assert.deepEqual(openPlan(planInput).at(-1), { kind: "launch", command: "/usr/bin/open", args: ["-n", "-b", "dev.herdr.app", "--env", `HERDR_APP_HOME=${WIN}`] });
});

test("open plan: Default opens its own folder and sets no active workspace", () => {
  const plan = openPlan({ ...planInput, id: undefined });
  const dflt = "/Users/x/.config/herdr-app-windows/_default";
  assert.equal(plan.at(-1).args.at(-1), `HERDR_APP_HOME=${dflt}`);
  assert.equal(plan.at(-2).id, undefined);
});

test("open plan: from a workspace window it copies from the main home the window's shared state names", () => {
  const inside = { ...planInput, appHome: "/Users/x/.config/herdr-app-windows/beta" };
  const plan = openPlan({ ...inside, mainHome: storeHome("/Users/x/.config/herdr-app", inside.appHome) });
  assert.equal(plan.find((s) => s.kind === "mirror").from, "/Users/x/.config/herdr-app/mods/workspaces");
  assert.equal(plan.at(-2).mainHome, "/Users/x/.config/herdr-app");
});

const listedRow = (id, extra = {}) => ({ w: { id, name: id }, i: 0, g: null, ...extra });
const wsStore = (groups, grouped) => ({ version: 1, workspaces: [{ id: "base", name: "Base", icon: "folder", color: "ansi6" }], assign: {}, groups, grouped });

test("first listed space: a space in no group comes before every group", () => {
  const store = wsStore([{ id: "g1", name: "G", workspace: "base" }], { b: "g1" });
  assert.equal(firstListedSpace(store, "base", arrangeRows([listedRow("b"), listedRow("a")])), "a");
});

test("first listed space: with spaces only in groups it is the first group's first space", () => {
  const store = wsStore([{ id: "g1", name: "One", workspace: "base" }, { id: "g2", name: "Two", workspace: "base" }], { c: "g2", b: "g1", a: "g1" });
  assert.equal(firstListedSpace(store, "base", arrangeRows([listedRow("c"), listedRow("b"), listedRow("a")])), "b");
});

test("first listed space: an empty workspace gives none", () => {
  assert.equal(firstListedSpace(wsStore([], {}), "base", []), undefined);
  assert.equal(firstListedSpace(wsStore([{ id: "g1", name: "One", workspace: "base" }], {}), "base", []), undefined);
});

test("first listed space: a worktree is never chosen ahead of its main checkout", () => {
  const repo = JSON.stringify([null, "/r/.git"]);
  const rows = arrangeRows([listedRow("wt", { g: { repo, linked: true } }), listedRow("main", { g: { repo, linked: false } })]);
  assert.equal(firstListedSpace(wsStore([], {}), "base", rows), "main");
});

test("first listed space: a local space comes before the spaces under another machine's header", () => {
  const rows = arrangeRows([{ w: { id: "far", name: "far", machine: "m1" }, i: 0, g: null }, listedRow("near")]);
  assert.equal(firstListedSpace(wsStore([], {}), "base", rows), "near");
});

test("an open of a window home already being opened is refused, and the home is free once that open ends", () => {
  const opening = new Set();
  assert.equal(beginOpen(opening, "/h/a"), true);
  assert.equal(beginOpen(opening, "/h/a"), false);
  assert.equal(beginOpen(opening, "/h/b"), true);
  endOpen(opening, "/h/a");
  assert.equal(beginOpen(opening, "/h/a"), true);
  assert.equal(beginOpen(opening, "/h/b"), false);
});

test("a home is free again after an open that failed", () => {
  const opening = new Set();
  beginOpen(opening, "/h/a");
  try {
    throw new Error("boom");
  } catch {
    // the failed open still releases its home
  } finally {
    endOpen(opening, "/h/a");
  }
  assert.equal(beginOpen(opening, "/h/a"), true);
});

test("the first space is selected only with the focus flag, a store read from disk, and the workspace in it", () => {
  const present = { id: "base" };
  assert.equal(focusReady({ flag: false, storeRead: true, id: undefined, active: undefined }), false);
  assert.equal(focusReady({ flag: false, storeRead: true, id: "base", active: present }), false);
  assert.equal(focusReady({ flag: true, storeRead: false, id: undefined, active: undefined }), false);
  assert.equal(focusReady({ flag: true, storeRead: true, id: undefined, active: undefined }), true);
  assert.equal(focusReady({ flag: true, storeRead: false, id: "base", active: present }), false);
  assert.equal(focusReady({ flag: true, storeRead: true, id: "base", active: undefined }), false);
  assert.equal(focusReady({ flag: true, storeRead: true, id: "base", active: present }), true);
});

const VALID_TEXT = serializeStore({ version: 1, workspaces: [{ id: "w1", name: "Acme", icon: "layers", color: "accent" }], assign: {} });
const KEPT = storeFromShared({ version: 1, workspaces: [{ id: "k", name: "Kept", icon: "layers", color: "accent" }], assign: {} });

test("a store read that finds a valid file gives that store, counted as read", async () => {
  const result = await readStoreOnce(async () => VALID_TEXT, "/f", KEPT);
  assert.deepEqual(result.store.workspaces.map((w) => w.id), ["w1"]);
  assert.equal(result.read, true);
});

test("a store read that finds no file gives the empty store, counted as read", async () => {
  const result = await readStoreOnce(async () => null, "/f", KEPT);
  assert.deepEqual(result.store, parseStore(undefined).store);
  assert.equal(result.read, true);
});

test("a store read that rejects keeps the previous store and is not counted as read", async () => {
  const result = await readStoreOnce(async () => { throw new Error("denied"); }, "/f", KEPT);
  assert.equal(result.store, KEPT);
  assert.equal(result.read, false);
});

test("a store read that finds malformed JSON gives what the parser gives, counted as read", async () => {
  const result = await readStoreOnce(async () => "{not json", "/f", KEPT);
  assert.deepEqual(result.store, parseStore("{not json").store);
  assert.equal(result.read, true);
});

test("a store read that finds the file after a rejected one gives that store, counted as read", async () => {
  let calls = 0;
  const read = async () => { calls += 1; if (calls === 1) throw new Error("denied"); return VALID_TEXT; };
  const first = await readStoreOnce(read, "/f", KEPT);
  const second = await readStoreOnce(read, "/f", first.store);
  assert.equal(first.read, false);
  assert.deepEqual(second.store.workspaces.map((w) => w.id), ["w1"]);
  assert.equal(second.read, true);
});

test("the store folder is made with mkdir -p through the given exec", async () => {
  const calls = [];
  const result = await ensureStoreDir(async (...args) => { calls.push(args); return { code: 0, stderr: "" }; }, "/h/workspaces");
  assert.deepEqual(calls, [["/bin/mkdir", ["-p", "/h/workspaces"]]]);
  assert.equal(result.error, undefined);
});

test("a store folder that cannot be made names mkdir and its stderr, or its exit code when stderr is empty", async () => {
  const withStderr = await ensureStoreDir(async () => ({ code: 1, stderr: "denied\n" }), "/d");
  assert.match(withStderr.error, /mkdir/);
  assert.match(withStderr.error, /denied/);
  const silent = await ensureStoreDir(async () => ({ code: 7, stderr: "" }), "/d");
  assert.match(silent.error, /mkdir/);
  assert.match(silent.error, /7/);
});

function openFlow({ start, answersAt = Infinity, opening = new Set() }) {
  const log = { probes: 0, sleeps: 0, starts: 0, clock: 0 };
  const io = {
    opening,
    key: "/h/a",
    start: async () => { log.starts += 1; return start(); },
    probe: async () => { log.probes += 1; return log.probes >= answersAt; },
    sleep: async (ms) => { log.sleeps += 1; log.clock += ms; },
    now: () => log.clock,
  };
  return { io, log, opening };
}

test("an open whose step before the launch fails frees its home at once and waits for nothing", async () => {
  const { io, log, opening } = openFlow({ start: async () => ({ error: "Copying: boom" }) });
  const result = await runOpen(io);
  assert.deepEqual(result, { error: "Copying: boom" });
  assert.equal(log.probes, 0);
  assert.equal(opening.has("/h/a"), false);
});

test("an open whose launch fails frees its home at once and waits for nothing", async () => {
  const { io, log, opening } = openFlow({ start: async () => ({ error: "Starting Herdr: no" }) });
  const result = await runOpen(io);
  assert.deepEqual(result, { error: "Starting Herdr: no" });
  assert.equal(log.probes, 0);
  assert.equal(opening.has("/h/a"), false);
});

test("an open that launches holds its home through the probes and frees it once the socket answers", async () => {
  const opening = new Set();
  const held = [];
  const { io, log } = openFlow({ start: async () => ({ launched: true }), answersAt: 3, opening });
  const probe = io.probe;
  io.probe = async () => { held.push(opening.has("/h/a")); return probe(); };
  const result = await runOpen(io);
  assert.deepEqual(result, {});
  assert.equal(log.probes, 3);
  assert.deepEqual(held, [true, true, true]);
  assert.equal(opening.has("/h/a"), false);
});

test("an open whose socket never answers frees its home once 15 seconds have passed", async () => {
  const { io, log, opening } = openFlow({ start: async () => ({ launched: true }) });
  const heldAt = [];
  const probe = io.probe;
  io.probe = async () => { heldAt.push([log.clock, opening.has("/h/a")]); return probe(); };
  const result = await runOpen(io);
  assert.deepEqual(result, {});
  assert.ok(log.clock >= 15000, `waited only ${log.clock} ms`);
  assert.ok(log.clock < 17000, `waited ${log.clock} ms`);
  assert.ok(heldAt.every(([at, held]) => (at < 15000 ? held : true)));
  assert.equal(opening.has("/h/a"), false);
});

test("a second open of a home being held is refused and runs nothing, while another home is allowed and the same home is allowed after the release", async () => {
  const opening = new Set();
  const first = openFlow({ start: async () => ({ launched: true }), answersAt: 2, opening });
  const second = openFlow({ start: async () => ({ launched: true }), answersAt: 1, opening });
  const other = openFlow({ start: async () => ({ launched: true }), answersAt: 1, opening });
  other.io.key = "/h/b";
  let refused;
  let allowed;
  const probe = first.io.probe;
  first.io.probe = async () => {
    refused ??= await runOpen(second.io);
    allowed ??= await runOpen(other.io);
    return probe();
  };
  await runOpen(first.io);
  assert.deepEqual(refused, { refused: true });
  assert.equal(second.log.starts, 0);
  assert.equal(second.log.probes, 0);
  assert.deepEqual(allowed, {});
  assert.equal(other.log.starts, 1);
  const again = await runOpen(second.io);
  assert.deepEqual(again, {});
  assert.equal(second.log.starts, 1);
});

test("the mod's sources hold no masked placeholder in place of their own text", () => {
  const dir = new URL(".", import.meta.url);
  const placeholder = "MASKED by " + "secret-mask";
  const tainted = readdirSync(dir).filter((name) => name.endsWith(".js") && readFileSync(new URL(name, dir), "utf8").includes(placeholder));
  assert.deepEqual(tainted, []);
});
