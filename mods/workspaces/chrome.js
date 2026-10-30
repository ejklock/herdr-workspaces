import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, openOverlay } from "herdr";
import { activeWorkspace, DEFAULT_ICON } from "./lib.js";
import { ACTIVE_KEY, followWorkspaceStore, iconPath, switcherHeight, workspaceColor } from "./switcher.js";

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

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class WorkspaceChrome extends View {
  init(p, cx) {
    if ((props() ?? p)?.footer) followWorkspaceStore(this, cx);
  }
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/workspaces/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      const active = activeWorkspace(this.store, shared(ACTIVE_KEY));
      const switcher = h_flex().id("workspace-switcher").h(32).px(collapsed ? 0 : 10).gap(8).items_center().when(collapsed, el => el.justify_center())
        .rounded(8).border(1).border_color(t.border).bg(t.raised).text_color(t.muted)
        .hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(() => openOverlay({ mod: "workspaces", kind: "popup", width: 260, height: switcherHeight(this.store), props: { role: "switcher" } }))
        .child(svg(iconPath(active?.icon ?? DEFAULT_ICON)).size(14).flex_none().text_color(active ? workspaceColor(t, active.color) : t.muted))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(active?.name ?? "Default")))
        .when(!collapsed, el => el.child(svg("mods/workspaces/chevron-down.svg").size(14).flex_none()));
      const divider = () => div().h(1).w_full().flex_none().bg(t.border).my(6);
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(6).pb(8).text_size(13)
        .when(!collapsed, el => el.child(h_flex().h(22).px(8).items_center().text_size(11.5).text_color(t.dim).child("Workspace")))
        .child(switcher)
        .child(divider())
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(div().size(6).rounded_full().bg(t.accent))))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).rounded(5)).child(div().font_semibold().text_color(t.foreground).child("Herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/workspaces/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/workspaces/sidebar.svg").size(15), toggleSidebar)));
  }
}
