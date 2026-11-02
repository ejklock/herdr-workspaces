import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routePane, isLocalPane, localMachines, machineToReach, type Claims } from "../../src/editor/routing.ts";

const me = { token: "me", path: "/a.txt" };
const route = (open: string[], claims: Claims, current?: string, proof?: string) =>
  routePane({ open, claims, token: me.token, path: me.path, current, proof });

describe("routing", () => {
  it("keeps the current pane while it is open and claimed with this token", () => {
    assert.equal(route(["p1", "p2"], { p1: me }, "p1"), "p1");
  });

  it("keeps the current pane although another token claims a second pane for the same path", () => {
    const claims: Claims = { p1: me, p2: { token: "other-copy", path: me.path } };
    assert.equal(route(["p1", "p2"], claims, "p1"), "p1");
  });

  it("releases the current pane when it is closed and ignores claims of closed panes", () => {
    assert.equal(route(["p2"], { p1: me, p3: { token: "x", path: "/a.txt" } }, "p1"), "p2");
    assert.equal(route(["p2", "p4"], { p1: me }, "p1"), undefined);
  });

  it("releases the current pane when another token claimed it", () => {
    assert.equal(route(["p1", "p2"], { p1: { token: "x", path: "/b.txt" }, p2: { token: "y", path: "/c.txt" } }, "p1"), undefined);
  });

  it("takes a focused pane that is unclaimed or claimed with this token", () => {
    assert.equal(route(["p1", "p2"], { p1: { token: "x", path: "/b.txt" } }, undefined, "p2"), "p2");
    assert.equal(route(["p1", "p2"], { p1: me, p2: { token: "x", path: "/b.txt" } }, undefined, "p1"), "p1");
  });

  it("does not take a focused pane another token claims for a different path", () => {
    assert.equal(route(["p1", "p2"], { p1: { token: "x", path: "/b.txt" } }, undefined, "p1"), undefined);
  });

  it("does not take a focused pane that is not an open editor pane", () => {
    assert.equal(route(["p1"], {}, undefined, "gone"), undefined);
  });

  it("takes the one open pane claimed with this path after a rebuild", () => {
    assert.equal(route(["p1", "p2"], { p1: { token: "old", path: "/a.txt" }, p2: { token: "x", path: "/b.txt" } }), "p1");
  });

  it("prefers the stale-claimed pane over an unclaimed one", () => {
    assert.equal(route(["p1", "p2"], { p1: { token: "old", path: "/a.txt" } }), "p1");
  });

  it("takes none for two panes claimed with this path until a focus proof", () => {
    const claims: Claims = { p1: { token: "old", path: "/a.txt" }, p2: { token: "older", path: "/a.txt" } };
    assert.equal(route(["p1", "p2"], claims), undefined);
    assert.equal(route(["p1", "p2"], claims, undefined, "p2"), "p2");
  });

  it("takes none for two stale claims on this path even when a third pane is unclaimed", () => {
    const claims: Claims = { p1: { token: "stale-1", path: me.path }, p2: { token: "stale-2", path: me.path } };
    assert.equal(route(["p1", "p2", "p3"], claims), undefined);
  });

  it("takes the one unclaimed pane when no claim holds this path", () => {
    assert.equal(route(["p1", "p2"], { p1: { token: "x", path: "/b.txt" } }), "p2");
  });

  it("takes none for two unclaimed panes without proof", () => {
    assert.equal(route(["p1", "p2"], {}), undefined);
  });
});

describe("editor pane on the local machine", () => {
  const space = (machine: string | null, ...tabs: string[]) => ({ machine, tabs: tabs.map(id => ({ id })) });
  const pane = (id: string, tab: string) => ({ pane: id, tab });

  it("is local when its tab belongs to a space on this machine", () => {
    assert.equal(isLocalPane("p1", [pane("p1", "t1")], [space(null, "t1")]), true);
  });

  it("is not local when its tab belongs to a space on another machine", () => {
    assert.equal(isLocalPane("p1", [pane("p1", "t1")], [space("box", "t1")]), false);
  });

  it("is not local when the pane is not in the panes list", () => {
    assert.equal(isLocalPane("p9", [pane("p1", "t1")], [space(null, "t1")]), false);
  });

  it("is not local when its tab is in no space", () => {
    assert.equal(isLocalPane("p1", [pane("p1", "t7")], [space(null, "t1")]), false);
  });

  it("is not local in a remote space while another, local space is also listed", () => {
    const spaces = [space(null, "t1"), space("box", "t2")];
    assert.equal(isLocalPane("p2", [pane("p1", "t1"), pane("p2", "t2")], spaces), false);
    assert.equal(isLocalPane("p1", [pane("p1", "t1"), pane("p2", "t2")], spaces), true);
  });

  it("is not local for a machine-prefixed pane inside a remote space", () => {
    assert.equal(isLocalPane("box/p1", [pane("box/p1", "box/t1")], [space("box", "box/t1")]), false);
  });

  it("is local in a space on a machine that runs on this computer", () => {
    const local = new Set(["acme"]);
    assert.equal(isLocalPane("acme/p1", [pane("acme/p1", "acme/t1")], [space("acme", "acme/t1")], local), true);
    assert.equal(isLocalPane("box/p1", [pane("box/p1", "box/t1")], [space("box", "box/t1")], local), false);
  });
});

describe("machines on this computer", () => {
  const listing = (...machines: unknown[]) => JSON.stringify({ machines });
  const machine = (name: string, target: string, extra: Record<string, unknown> = {}) => ({ name, target, via: true, state: "connected", ...extra });

  it("names each machine reached through a plain sh -c, connected or not, temporary or not", () => {
    const found = localMachines(listing(machine("acme", "sh -c"), machine("down", "sh -c", { state: "unreachable" }), machine("tmp", "sh -c", { temporary: true })));
    assert.deepEqual([...found].sort(), ["acme", "down", "tmp"]);
  });

  it("leaves out machines reached over ssh or any other command", () => {
    const found = localMachines(listing(
      machine("stg", "abby-stg", { via: false }),
      machine("fly", "fly ssh console -a x --pty=false -C"),
      machine("hop", "sh -c ssh box"),
      machine("pad", " sh -c"),
    ));
    assert.deepEqual([...found], []);
  });

  it("names none for output that is not a machine listing", () => {
    for (const text of ["", "not json", "[]", "null", JSON.stringify({ machines: "x" }), listing(null, 3, { target: "sh -c" }, { name: 7, target: "sh -c" })]) {
      assert.deepEqual([...localMachines(text)], [], text);
    }
  });

  it("reads a file on such a machine as a file on this computer, and any other machine through herdr-core", () => {
    const local = new Set(["acme"]);
    assert.equal(machineToReach("acme", local), null);
    assert.equal(machineToReach("box", local), "box");
    assert.equal(machineToReach(null, local), null);
  });
});
