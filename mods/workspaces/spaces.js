// Workspace spaces: stable colored avatars, worktrees under their checkout,
// under a header per other machine (one no workspace owns), the spaces in no group first and then each group
// of the workspace under a header that folds. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder, or onto a group's header or rows to move it into the group.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, appHome, readTextFile, writeTextFile, notify, nextCommand } from "herdr";
import { storePaths, visibleSpaces, activeWorkspace, sidebarMachines, newSpaceArgs, settledStore, spaceListState, showsCoreRow, sidebarSections, arrangeRows, machineFoldKey, foldedAway, spaceGroup, moveToGroup, updateStore } from "./lib.js";
import { followWorkspaceStore, openWorkspaceDialog } from "./switcher.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.foldedGroups = new Set(JSON.parse(localStorage.getItem("groups.folded") ?? "[]"));
    followWorkspaceStore(this, cx);
    this.followCommands(cx);
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  // Makes a space on the active workspace's core; before any store is read it waits for the file instead of making it on the local core.
  async newSpace() {
    const store = await settledStore(this.store, readTextFile, storePaths(appHome()).file).catch(() => this.store);
    run("space.new", newSpaceArgs(store, shared("workspaces.active")));
  }

  // The key command "workspaces:new-space" reaches every copy of this mod; only this role acts on it.
  followCommands(cx) {
    cx.spawn(async () => {
      for (;;) {
        if ((await nextCommand()) === "new-space") await this.newSpace();
      }
    });
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        const hidden = sp.filter((s) => at[s.id] === k).every((s) => foldedAway(this.store, shared("workspaces.active"), this.folded, s));
        if (asks && !hidden && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  // `groupSpace` is the space whose group the menu's "Move to group…" changes (a nested worktree's main checkout).
  menu(w, groupSpace) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "workspaces", kind: "popup", width: 200, height: 300, props: { role: "menu", tab: "space", target: { id: w.id, groupSpace } } });
  }

  groupMenu(g) {
    openOverlay({ mod: "workspaces", kind: "popup", width: 200, height: 120, props: { role: "menu", tab: "group", target: { id: g.id } } });
  }

  // Puts a space in a group of the active workspace (none when `groupId` is undefined) unless it is already there; a refusal or failed write shows as a toast.
  async setGroup(spaceId, groupId) {
    const active = shared("workspaces.active");
    if (spaceGroup(this.store, active, spaceId) === groupId) return;
    const live = spaces();
    let result;
    try {
      result = await updateStore({ read: readTextFile, write: writeTextFile }, storePaths(appHome()).file, (store) => moveToGroup(store, active, live, spaceId, groupId));
    } catch (e) {
      result = { error: e.message ?? String(e) };
    }
    if (result.error) notify({ title: "Could not move the space", body: result.error, level: "error" });
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const all = spaces(), ps = panes();
    const sp = visibleSpaces(this.store, shared("workspaces.active"), all);
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of all) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w) => ({ w, i: all.findIndex((s) => s.id === w.id), g: this.git[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id));
    const out = arrangeRows(list);
    this.anchors = new Map(out.map((r) => [r.w.id, r.groupSpace]));
    return out;
  }

  // The space whose group entry a drag of `spaceId` changes: a nested worktree's main checkout.
  groupSpaceOf(spaceId) {
    return this.anchors?.get(spaceId) ?? spaceId;
  }

  // The rows in sections: those in no group, then each group of the workspace under a header that folds.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const active = activeWorkspace(this.store, shared("workspaces.active"));
    const state = spaceListState(!rows.length && this.loading(active?.machine ?? null), rows.length);
    if (state === "loading") return [div().id("machine-loading-local").h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…")];
    if (state === "empty" && active) return [h_flex().id("workspace-empty").h(28).flex_none().px(8).items_center().text_size(12).text_color(t.dim).child(collapsed ? "…" : `No spaces in ${active.name}`)];
    return sidebarSections(this.store, shared("workspaces.active"), rows).flatMap((s) => this.section(s, t, collapsed));
  }

  // One section: its group's header (not in the narrow rail, which has no room for it), then its rows unless the group is folded, in the narrow rail too.
  section({ group, rows }, t, collapsed) {
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t, group?.id));
    const folded = group !== undefined && this.foldedGroups.has(group.id);
    if (!group) return this.machineRows(rows, draw, t, collapsed, undefined);
    const body = folded ? [] : this.machineRows(rows, draw, t, collapsed, group.id);
    return collapsed ? body : [this.groupHeader(group, rows.length, folded, t), ...body];
  }

  // A section's rows; a header only for another machine (one no workspace owns) that holds one of them, so a machine appears under each group that holds its spaces.
  machineRows(rows, draw, t, collapsed, scope) {
    const headed = sidebarMachines(this.store, rows.map(r => r.w));
    const plain = rows.filter(r => !headed.includes(r.w.machine));
    return [...plain.map(draw), ...headed.flatMap((m) => [
      this.machineHeader(m, t, collapsed, scope),
      ...(this.folded.has(machineFoldKey(scope, m)) ? [] : rows.filter((r) => r.w.machine === m).map(draw)),
    ])];
  }

  // The fold row of a group: chevron, name and count. Click folds it; releasing a dragged space on it moves the space in; right-click opens its menu.
  groupHeader(group, count, folded, t) {
    return h_flex().id(`group-${group.id}`).h(26).flex_none().px(8).gap(7).items_center().text_size(11).text_color(t.dim)
      .cursor_pointer().hover(s => s.bg(t.hover))
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        this.pressed = null;
        if (from !== null) void this.setGroup(this.groupSpaceOf(spaces()[from].id), group.id);
        else this.toggleGroup(group.id);
        cx.notify();
      })
      .on_mouse_down("right", () => this.groupMenu(group))
      .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none())
      .child(div().flex_1().truncate().child(group.name))
      .child(div().flex_none().child(String(count)));
  }

  toggleGroup(id) {
    this.foldedGroups.has(id) ? this.foldedGroups.delete(id) : this.foldedGroups.add(id);
    localStorage.setItem("groups.folded", JSON.stringify([...this.foldedGroups]));
  }

  // True while a machine's layout is still being read or one of its spaces waits for its git.
  loading(m) {
    const layout = machines().find(k => k.name === m)?.layout;
    return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
      || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
  }

  // The fold row of another machine: its name, state, a + that makes a space there, and the fold chevron.
  machineHeader(m, t, collapsed, scope) {
    const machine = this.machines.find(k => k.name === m);
    const connected = machine?.state === "connected";
    const key = machineFoldKey(scope, m);
    const folded = this.folded.has(key);
    const at = scope ? `${m}-in-${scope}` : m;
    return h_flex().id(`machine-${at}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
      .cursor_pointer().hover(s => s.bg(t.hover))
      .on_click((_e, cx) => {
        folded ? this.folded.delete(key) : this.folded.add(key);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        cx.notify();
      })
      .child(svg("mods/workspace-chrome/server.svg").size(13).flex_none())
      .when(!collapsed, el => el.child(div().flex_1().truncate().child(m))
        .when(!connected, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
        .when(connected, el => el.child(div().id(`machine-add-${at}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m }); }).child("+")))
        .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
        .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  // Releasing a dragged space on a row moves it there and into that row's group (none for the rows in no group).
  drop(from, i, groupId) {
    const dragged = spaces()[from];
    run("space.move", { id: dragged.id, index: i + 1 });
    void this.setGroup(this.groupSpaceOf(dragged.id), groupId);
  }

  row({ w, i, g, tree, groupSpace }, t, groupId) {
    const on = w.active;
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.border_t(2).border_color(t.accent))
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        this.pressed = null;
        if (from !== null && from !== i) this.drop(from, i, groupId);
        else run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w, groupSpace))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").p(4).rounded(5).hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(() => void this.newSpace()).child("+")))
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children([...this.coreRow(t, collapsed), ...this.grouped(t, collapsed)]));
  }

  // One row ahead of the spaces while the active workspace has no core: it opens that workspace in the edit dialog.
  coreRow(t, collapsed) {
    const id = shared("workspaces.active");
    if (collapsed || !showsCoreRow(this.store, id)) return [];
    return [h_flex().id("workspace-choose-core").h(28).flex_none().px(8).items_center().rounded(6).text_size(12).text_color(t.dim)
      .cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => openWorkspaceDialog(activeWorkspace(this.store, id)))
      .child("Choose this workspace's core in Edit")];
  }
}
