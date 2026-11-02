// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "workspace-move" | "group-move" | "group" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, shared, terminals, spaces, panes, exec, notify, appHome, readTextFile, writeTextFile } from "herdr";
import { assignSpace, deleteGroup, moveToGroup, newSpaceArgs, settledStore, storePaths, updateStore } from "./lib.js";
import { menuItems, menuIcon } from "./menu-items.js";
import { followWorkspaceStore, iconPath, workspaceColor } from "./switcher.js";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

// The store changes a menu item makes, each awaited before the overlay closes: [builds the change from the item's args, the toast title when it fails].
const WRITES = {
  "workspaces.assign": [({ space, workspace }) => (store) => ({ store: assignSpace(store, space, workspace) }), "Could not move the space"],
  "workspaces.group": [
    ({ space, group }) => {
      const active = shared("workspaces.active");
      const live = spaces();
      return (store) => moveToGroup(store, active, live, space, group);
    },
    "Could not move the space",
  ],
  "workspaces.group-delete": [({ group }) => (store) => deleteGroup(store, group), "Could not delete the group"],
};

const popup = (tab, space) => ({ mod: "workspaces", kind: "popup", width: 220, height: 300, props: { role: "menu", tab, target: { id: space } } });
const groupDialog = (given) => ({ mod: "workspaces", kind: "dialog", width: 380, height: 190, props: { role: "group-dialog", ...given } });

// The overlay a menu item opens instead of running a command, or undefined.
function overlayFor([, command, args], store) {
  switch (command) {
    case "workspaces.move":
      return popup("workspace-move", args.space);
    case "workspaces.group-move":
      return popup("group-move", args.space);
    case "workspaces.group-new":
      return groupDialog({ space: args.space });
    case "workspaces.group-rename":
      return groupDialog({ group: args.group, name: store.groups?.find((g) => g.id === args.group)?.name });
    case "worktree":
      return { mod: "worktree", kind: "dialog", ...(args.action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: args };
    default:
      return undefined;
  }
}

// A separator goes above the item where the group of items changes.
const separated = (list, i) => {
  const [, command, args] = list[i];
  return i > 0 && (command.endsWith(".close") || (command === "workspaces.assign" && !args.workspace) || (command === "workspaces.group" && !args.group) || command === "app.help" || (command === "app.theme" && list[i - 1][1] !== "app.theme"));
};

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    followWorkspaceStore(this, cx);
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  // Applies a change to the store file; a failed write is shown as a toast. The menu stays open until this settles, because Herdr cancels an overlay's unfinished tasks once it closes.
  async write(change, title) {
    let result;
    try {
      result = await updateStore({ read: readTextFile, write: writeTextFile }, storePaths(appHome()).file, change);
    } catch (e) {
      result = { error: e.message ?? String(e) };
    }
    if (result.error) notify({ title, body: result.error, level: "error" });
  }

  // Makes a space on the active workspace's core. With no store read yet it waits for the file first, and the overlay closes only after that, because Herdr cancels an overlay's unfinished tasks once it closes.
  async newSpace(overlay) {
    const store = await settledStore(this.store, readTextFile, storePaths(appHome()).file).catch(() => this.store);
    closeOverlay(overlay);
    run("space.new", newSpaceArgs(store, shared("workspaces.active")));
  }

  items() {
    const p = props();
    return menuItems(p, this.git, this.store, shared("workspaces.active"), p?.tab === "pane" ? terminals() : [], spaces());
  }

  choose(i, cx) {
    const it = this.items()[i];
    if (!it) return;
    const overlay = props()?.overlay;
    if (it[1] === "space.new") {
      void this.newSpace(overlay);
      return;
    }
    const write = WRITES[it[1]];
    if (write) {
      void this.write(write[0](it[2]), write[1]).finally(() => closeOverlay(overlay));
      return;
    }
    closeOverlay(overlay);
    const next = overlayFor(it, this.store);
    if (next) openOverlay(next);
    else run(it[1], it[2]);
  }

  onKey(e, cx, count) {
    switch (e.key) {
      case "down":
        this.at = (this.at + 1) % count;
        break;
      case "up":
        this.at = (this.at + count - 1) % count;
        break;
      case "enter":
        this.choose(this.at, cx);
        break;
      case "escape":
        closeOverlay(props().overlay);
        break;
      default:
        return;
    }
    cx.notify();
  }

  render(cx) {
    const t = theme();
    const list = this.items();
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .when(props()?.tab === "workspace-move" || props()?.tab === "group-move", (el) => el.overflow_y_scroll())
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => this.onKey(e, cx, list.length))
      .children(list.map((it, i) => this.entry(t, list, it, i)));
  }

  // One item: a separator above where the group changes, then the icon, label and shortcut or check.
  entry(t, list, it, i) {
    return v_flex()
            .when(separated(list, i), el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(it[1] === "workspaces.assign"
              ? svg(iconPath(it[4]?.icon ?? "layers")).size(14).flex_none().text_color(it[4] ? workspaceColor(t, it[4].color) : t.muted)
              : svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it[0]))
            .child(it[3] ? svg("mods/workspaces/check.svg").size(13).flex_none().text_color(t.muted) : div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2]))));
  }
}
