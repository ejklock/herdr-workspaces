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
  adoptArrivals,
  decideArrivals,
  inDefault,
  joinSpace,
  RESTORE_MS,
} from "./lib.js";

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

const spaces = [space("a"), space("b"), space("m/c", "m"), space("m/d", "m")];
const store = storeOf([workspace("w1", "Acme"), workspace("w2", "Empty")], { a: "w1", "m/c": "w1", b: "w1", "m/d": "w1" });

test("visible spaces: no active workspace with an empty store shows every space of every machine", () => {
  assert.deepEqual(visibleSpaces(storeOf([]), undefined, spaces), spaces);
});

test("visible spaces: no active workspace hides spaces assigned to an existing workspace", () => {
  const some = storeOf([workspace("w1", "Acme")], { a: "w1", "m/c": "w1" });
  assert.deepEqual(visibleSpaces(some, undefined, spaces), [space("b"), space("m/d", "m")]);
});

test("visible spaces: no active workspace with every space assigned gives an empty list", () => {
  assert.deepEqual(visibleSpaces(store, undefined, spaces), []);
});

test("visible spaces: no active workspace keeps a space assigned to a workspace the store no longer holds", () => {
  const stale = storeOf([workspace("w1", "Acme")], { a: "gone", b: "w1" });
  assert.deepEqual(visibleSpaces(stale, undefined, spaces), [space("a"), space("m/c", "m"), space("m/d", "m")]);
});

test("visible spaces: an active workspace shows only its spaces across machines", () => {
  const mixed = storeOf([workspace("w1", "Acme")], { a: "w1", "m/c": "w1" });
  assert.deepEqual(visibleSpaces(mixed, "w1", spaces), [space("a"), space("m/c", "m")]);
});

test("visible spaces: a machine with none of its spaces in the workspace has no entry", () => {
  const local = storeOf([workspace("w1", "Acme")], { a: "w1", b: "w1" });
  assert.deepEqual(
    visibleSpaces(local, "w1", spaces).filter((s) => s.machine === "m"),
    [],
  );
});

test("visible spaces: an active id missing from the store behaves as no active workspace", () => {
  const some = storeOf([workspace("w1", "Acme")], { a: "w1" });
  assert.deepEqual(visibleSpaces(some, "deleted", spaces), [space("b"), space("m/c", "m"), space("m/d", "m")]);
  assert.deepEqual(visibleSpaces(store, "deleted", spaces), []);
  assert.equal(activeWorkspace(store, "deleted"), undefined);
});

test("visible spaces: a workspace with no spaces gives an empty list", () => {
  assert.deepEqual(visibleSpaces(store, "w2", spaces), []);
  assert.deepEqual(activeWorkspace(store, "w2"), workspace("w2", "Empty"));
});

test("visible spaces: an assignment to a space that no longer exists is ignored", () => {
  const stale = storeOf([workspace("w1", "Acme")], { a: "w1", ghost: "w1" });
  assert.deepEqual(visibleSpaces(stale, "w1", spaces), [space("a")]);
});

test("visible spaces: an unassigned space shows only under Default", () => {
  const partial = storeOf([workspace("w1", "Acme")], { a: "w1" });
  assert.deepEqual(visibleSpaces(partial, "w1", spaces), [space("a")]);
  assert.equal(visibleSpaces(partial, undefined, spaces).length, 3);
});

const agent = (address, spaceId) => ({ address, space: spaceId });
const agents = [agent("1", "a"), agent("2", "b"), agent("3", "m/c"), agent("4", "orphan"), agent("5", "a")];

test("visible agents: no active workspace keeps agents of unassigned spaces, orphans included", () => {
  const some = storeOf([workspace("w1", "Acme")], { a: "w1", "m/c": "w1" });
  assert.deepEqual(visibleAgents(some, undefined, agents), [agent("2", "b"), agent("4", "orphan")]);
  assert.deepEqual(visibleAgents(store, undefined, agents), [agent("4", "orphan")]);
});

test("visible agents: an active id missing from the store behaves as no active workspace", () => {
  const some = storeOf([workspace("w1", "Acme")], { a: "w1" });
  assert.deepEqual(visibleAgents(some, "deleted", agents), [agent("2", "b"), agent("3", "m/c"), agent("4", "orphan")]);
});

test("visible agents: an agent of a space assigned to a deleted workspace is kept under no active workspace", () => {
  const stale = storeOf([workspace("w1", "Acme")], { a: "gone" });
  assert.deepEqual(visibleAgents(stale, undefined, agents), agents);
});

test("visible agents: an active workspace keeps only agents of its spaces, in order", () => {
  const partial = storeOf([workspace("w1", "Acme")], { a: "w1", "m/c": "w1" });
  assert.deepEqual(visibleAgents(partial, "w1", agents), [agent("1", "a"), agent("3", "m/c"), agent("5", "a")]);
});

test("visible agents: an agent in another workspace's space or an unassigned space is hidden", () => {
  const split = storeOf([workspace("w1", "Acme"), workspace("w2", "Beta")], { a: "w1", b: "w2" });
  assert.deepEqual(visibleAgents(split, "w2", agents), [agent("2", "b")]);
  assert.deepEqual(visibleAgents(split, "w1", agents).map((x) => x.address), ["1", "5"]);
});

test("visible agents: a workspace with no spaces and an empty agent list give empty lists", () => {
  assert.deepEqual(visibleAgents(store, "w2", agents), []);
  assert.deepEqual(visibleAgents(store, "w1", []), []);
  assert.deepEqual(visibleAgents(store, undefined, []), []);
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

// A window's view of a space as the app lists it.
const live = (id, active = false, machine = null) => ({ id, machine, active });
const joinStore = storeOf([workspace("w1", "Acme")], { old: "w1" });

test("adoptArrivals assigns a new active unassigned space to the active workspace", () => {
  const out = adoptArrivals(joinStore, "w1", [live("old"), live("new", true)], new Set(["old"]));
  assert.deepEqual(out.adopt, ["new"]);
});

test("adoptArrivals takes nothing while Default is active", () => {
  assert.deepEqual(adoptArrivals(joinStore, undefined, [live("new", true)], new Set()).adopt, []);
});

test("adoptArrivals takes nothing for a stale active workspace id", () => {
  assert.deepEqual(adoptArrivals(joinStore, "gone", [live("new", true)], new Set()).adopt, []);
});

test("adoptArrivals leaves new spaces that are not the window's active one", () => {
  const out = adoptArrivals(joinStore, "w1", [live("m/a", false, "m"), live("m/b", false, "m")], new Set());
  assert.deepEqual(out.adopt, []);
});

test("adoptArrivals leaves a new space another window already assigned", () => {
  const store = storeOf([workspace("w1", "Acme"), workspace("w2", "Other")], { fresh: "w2" });
  assert.deepEqual(adoptArrivals(store, "w1", [live("fresh", true)], new Set()).adopt, []);
});

test("adoptArrivals takes a new space whose assignment points at a deleted workspace", () => {
  const store = storeOf([workspace("w1", "Acme")], { fresh: "gone" });
  assert.deepEqual(adoptArrivals(store, "w1", [live("fresh", true)], new Set()).adopt, ["fresh"]);
});

test("adoptArrivals never takes a space present at the start", () => {
  const out = adoptArrivals(joinStore, "w1", [live("start", true)], new Set(["start"]));
  assert.deepEqual(out.adopt, []);
});

test("adoptArrivals takes a remote new active space under its machine-prefixed id", () => {
  const out = adoptArrivals(joinStore, "w1", [live("m/7", true, "m")], new Set());
  assert.deepEqual(out.adopt, ["m/7"]);
});

test("adoptArrivals decides an arrival once: selecting it later does not take it", () => {
  const first = adoptArrivals(joinStore, "w1", [live("m/a", false, "m")], new Set());
  const later = adoptArrivals(joinStore, "w1", [live("m/a", true, "m")], first.seen);
  assert.deepEqual(later.adopt, []);
});

test("adoptArrivals does not change the seen set it was given", () => {
  const seen = new Set();
  adoptArrivals(joinStore, "w1", [live("new", true)], seen);
  assert.equal(seen.size, 0);
});

// Arrivals as the view sees them: `at` ms after it started.
const START = 1_000_000;
const decide = (spaces, { at, seen = new Set(), loaded = true, store = joinStore, activeId = "w1" }) =>
  decideArrivals({ store, activeId, spaces, seen, loaded, startedAt: START, now: START + at });

test("decideArrivals never takes spaces restored in the first tick, the active one included", () => {
  const out = decide([live("a", true), live("b")], { at: 250 });
  assert.deepEqual(out.adopt, []);
  assert.deepEqual([...out.seen].sort(), ["a", "b"]);
});

test("decideArrivals never takes a space restored in a later tick of the window", () => {
  const first = decide([live("a")], { at: 100 });
  const later = decide([live("a"), live("m/b", true, "m")], { at: RESTORE_MS - 1, seen: first.seen });
  assert.deepEqual(later.adopt, []);
  assert.ok(later.seen.has("m/b"));
});

test("decideArrivals takes the active unassigned space that arrives after the window", () => {
  assert.deepEqual(decide([live("old"), live("new", true)], { at: RESTORE_MS + 1, seen: new Set(["old"]) }).adopt, ["new"]);
});

test("decideArrivals takes the first space of a window that started with none", () => {
  assert.deepEqual(decide([live("first", true)], { at: RESTORE_MS + 5000 }).adopt, ["first"]);
});

test("decideArrivals treats an arrival exactly at the limit as restored", () => {
  assert.deepEqual(decide([live("x", true)], { at: RESTORE_MS }).adopt, []);
});

test("decideArrivals treats an arrival just past the limit as created", () => {
  assert.deepEqual(decide([live("x", true)], { at: RESTORE_MS + 1 }).adopt, ["x"]);
});

test("decideArrivals waits for the store: past the window, not loaded, nothing taken or marked decided", () => {
  const waiting = decide([live("x", true)], { at: RESTORE_MS + 1, loaded: false });
  assert.deepEqual(waiting.adopt, []);
  assert.equal(waiting.seen.size, 0);
  assert.deepEqual(decide([live("x", true)], { at: RESTORE_MS + 2, seen: waiting.seen }).adopt, ["x"]);
});

test("decideArrivals does not change the seen set it was given", () => {
  const seen = new Set();
  decide([live("x", true)], { at: 10, seen });
  assert.equal(seen.size, 0);
});

test("inDefault: a space assigned to a deleted workspace is in Default, one in a live workspace is not", () => {
  const store = storeOf([workspace("w1", "Acme")], { gone: "ghost", kept: "w1" });
  assert.equal(inDefault(store, "gone"), true);
  assert.equal(inDefault(store, "kept"), false);
  assert.equal(inDefault(store, "never"), true);
});

test("joinSpace on the fresh store assigns a space whose workspace was deleted, as adoptArrivals does", () => {
  const store = storeOf([workspace("w1", "Acme")], { fresh: "gone" });
  assert.equal(joinSpace(store, "fresh", "w1").assign.fresh, "w1");
  assert.deepEqual(adoptArrivals(store, "w1", [live("fresh", true)], new Set()).adopt, ["fresh"]);
});

test("joinSpace leaves a space another window put in a live workspace", () => {
  const store = storeOf([workspace("w1", "Acme"), workspace("w2", "Other")], { fresh: "w2" });
  assert.equal(joinSpace(store, "fresh", "w1"), store);
});
