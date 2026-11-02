import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStore,
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
} from "./lib.js";
import { menuItems } from "./menu-items.js";

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

test("menu: the space tab lists rename, move, worktree items for a repo and close", () => {
  const items = (git) => menuItems(menuProps("space"), git, core, "base", []).map((i) => i.slice(0, 3));
  assert.deepEqual(items(null), [
    ["Rename", "space.rename", { id: "s1" }],
    ["Move to workspace…", "workspaces.move", { space: "s1" }],
    ["Close", "space.close", { id: "s1" }],
  ]);
  assert.deepEqual(items("linked").map((i) => i[0]), ["Rename", "Move to workspace…", "New worktree", "Open worktree", "Remove worktree", "Close"]);
});

test("menu: the workspace-move tab checks the space's current workspace", () => {
  const assigned = storeOf(core.workspaces, { s1: "base" });
  const items = menuItems(menuProps("workspace-move"), null, assigned, undefined, []);
  assert.deepEqual(items.map((i) => [i[0], i[3]]), [["Default", false], ...core.workspaces.map((w) => [w.name, w.id === "base"])]);
});

