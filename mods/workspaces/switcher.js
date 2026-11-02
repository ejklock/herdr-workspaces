// The workspace switcher popup: Default, every workspace (a check on the active one, an edit control),
// and "New workspace…". Choosing one sets it active for this window; Default clears it.
// Also holds what the footer row and the popup share: the active-workspace key and the live store (drawn from the last store read until the file is read).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, closeOverlay, openOverlay, props, appHome, readTextFile, watchFolder } from "herdr";
import { mkdir } from "fs/promises";
import { loadStore, storePaths, storeFromShared, serializeStore, activeWorkspace, DEFAULT_ICON, WORKSPACE_COLORS, WORKSPACE_ICONS } from "./lib.js";

export const ACTIVE_KEY = "workspaces.active";
export const ROW_HEIGHT = 32;
const STORE_CACHE_KEY = "workspaces.store";

/** The color a workspace's icon is drawn in: the strong hue shared with the space avatars. */
export const workspaceColor = (t, name) => WORKSPACE_COLORS[name] ?? t[name] ?? t.muted;

export const iconPath = (icon) => `mods/workspaces/${WORKSPACE_ICONS.includes(icon) || icon === DEFAULT_ICON ? icon : DEFAULT_ICON}.svg`;

/**
 * Keeps `view.store` current while the view lives: other windows and mods write the file.
 * The first frame draws the last store read (held in shared state); every file read then replaces it,
 * and refreshes the shared copy only when it differs, so followers do not re-render each other.
 */
export function followWorkspaceStore(view, cx) {
  view.store = storeFromShared(shared(STORE_CACHE_KEY));
  const { dir, file } = storePaths(appHome());
  cx.spawn(async (cx) => {
    await mkdir(dir, { recursive: true });
    for (;;) {
      view.store = (await loadStore(readTextFile, file)).store;
      if (serializeStore(view.store) !== serializeStore(storeFromShared(shared(STORE_CACHE_KEY)))) setShared(STORE_CACHE_KEY, view.store);
      cx.notify();
      await watchFolder(dir);
    }
  });
}

export function openWorkspaceDialog(workspace) {
  openOverlay({ mod: "workspaces", kind: "dialog", width: 420, height: 500, props: { role: "dialog", ...workspace } });
}

/** Popup height for the switcher: 5 px padding twice, every row and the 9 px separator, within what a window can show. */
export const switcherHeight = (store) => Math.min(480, 10 + 9 + (store.workspaces.length + 2) * ROW_HEIGHT);

export default class Switcher extends View {
  init(_props, cx) {
    followWorkspaceStore(this, cx);
  }

  choose(id) {
    setShared(ACTIVE_KEY, id ?? null);
    closeOverlay(props().overlay);
  }

  edit(w) {
    closeOverlay(props().overlay);
    openWorkspaceDialog(w);
  }

  render() {
    const t = theme();
    const active = activeWorkspace(this.store, shared(ACTIVE_KEY));
    const row = (id, icon, color, name, on, pick, extra) => h_flex().id(id).h(ROW_HEIGHT).px(8).gap(9).items_center().rounded(7).text_color(t.foreground)
      .hover((s) => s.bg(t.hover)).cursor_pointer().on_click(pick)
      .child(svg(iconPath(icon)).size(14).flex_none().text_color(color))
      .child(div().flex_1().truncate().child(name))
      .child(svg("mods/workspaces/check.svg").size(13).flex_none().text_color(t.muted).opacity(on ? 1 : 0))
      .children(extra ?? []);
    return v_flex().id("switcher").w_full().min_h(0).overflow_y_scroll().p(5).bg(t.popover).text_size(12.8)
      .child(row("ws-all", DEFAULT_ICON, t.muted, "Default", !active, () => this.choose(undefined)))
      .children(this.store.workspaces.map((w) => row(`ws-${w.id}`, w.icon, workspaceColor(t, w.color), w.name, active?.id === w.id, () => this.choose(w.id), [
        div().id(`ws-edit-${w.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
          .hover((s) => s.bg(t.selected).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.edit(w); })
          .child(svg("mods/workspaces/square-pen.svg").size(13)),
      ])))
      .child(div().mx(7).my(4).h(1).bg(t.border))
      .child(h_flex().id("ws-new").h(ROW_HEIGHT).px(8).gap(9).items_center().rounded(7).text_color(t.foreground)
        .hover((s) => s.bg(t.hover)).cursor_pointer().on_click(() => this.edit({}))
        .child(svg("mods/workspaces/plus.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child("New workspace…")));
  }
}
