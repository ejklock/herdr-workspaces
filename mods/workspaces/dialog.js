// The workspace dialog: a name, an icon, a color and the core it is bound to. Opened with props { id, name, icon, color, machine }
// to edit (with Delete, then Confirm delete) or with none to create. Enter saves, Esc cancels.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, closeOverlay, setShared, shared, appHome, readTextFile, writeTextFile, hc } from "herdr";
import { mkdir } from "fs/promises";
import { storePaths, loadStore, dialogCores, updateStore, createWorkspace, renameWorkspace, deleteWorkspace, newWorkspaceId, WORKSPACE_ICONS, WORKSPACE_COLORS } from "./lib.js";
import { ACTIVE_KEY, iconPath, workspaceColor } from "./switcher.js";

const files = { read: readTextFile, write: writeTextFile };

const dialogButton = (t, id, text, primary, action, danger) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
  .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
  .text_color(primary ? t.solid_foreground : danger ? t.ansi1 : t.foreground).text_size(12.5).font_medium().cursor_pointer()
  .hover((s) => s.opacity(0.88)).on_click(action).child(text);

export default class WorkspaceDialog extends View {
  init(p, cx) {
    const given = props() ?? p ?? {};
    this.id = given.id;
    this.text = given.name ?? "";
    this.icon = given.icon ?? WORKSPACE_ICONS[0];
    this.color = given.color ?? Object.keys(WORKSPACE_COLORS)[0];
    this.machine = given.machine;
    this.cores = undefined;
    this.coresError = undefined;
    this.error = undefined;
    this.confirming = false;
    this.saving = false;
    this.input = InputState.new({ value: this.text });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = undefined; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.save(cx));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    this.loadCores(cx);
  }

  // Lists the cores to pick from; it only reads, never starts a core. The store is read fresh so another workspace's core is never offered.
  loadCores(cx) {
    cx.spawn(async (cx) => {
      try {
        const listed = await hc(["machine", "ls", "--json"]);
        if (listed.code !== 0) throw new Error(listed.stderr?.trim() || `hc exited with ${listed.code}`);
        const { store } = await loadStore(readTextFile, storePaths(appHome()).file);
        this.cores = dialogCores(store, JSON.parse(listed.stdout).machines, this.id);
      } catch (e) {
        this.coresError = `Could not list the cores: ${e.message ?? e}`;
      }
      cx.notify();
    });
  }

  // Runs `change` on the store file; closes on success, else shows why it was refused.
  commit(change, cx, done) {
    if (this.saving) return;
    this.saving = true;
    cx.spawn(async (cx) => {
      let result;
      try {
        const { dir, file } = storePaths(appHome());
        await mkdir(dir, { recursive: true });
        result = await updateStore(files, file, change);
      } catch (e) {
        result = { error: `Could not save: ${e.message ?? e}` };
      }
      this.saving = false;
      if (result.error) {
        this.error = result.error;
        cx.notify();
        return;
      }
      done?.();
      closeOverlay(props().overlay);
    });
  }

  save(cx) {
    const fields = { name: this.text, icon: this.icon, color: this.color, machine: this.machine };
    let created;
    this.commit((store) => {
      if (this.id === undefined) {
        created = newWorkspaceId(store, this.text);
        return createWorkspace(store, fields, created);
      }
      if (!store.workspaces.some((w) => w.id === this.id)) return { error: "This workspace no longer exists." };
      return renameWorkspace(store, this.id, fields);
    }, cx, () => { if (created) setShared(ACTIVE_KEY, created); });
  }

  remove(cx) {
    this.commit((store) => ({ store: deleteWorkspace(store, this.id) }), cx, () => {
      if (shared(ACTIVE_KEY) === this.id) setShared(ACTIVE_KEY, null);
    });
  }

  key(e, cx) {
    if (e.key === "escape") { this.cancel(); cx.stop_propagation(); }
  }

  // Herdr cancels an overlay's unfinished tasks once it closes, so a save in flight keeps it open.
  cancel() {
    if (!this.saving) closeOverlay(props().overlay);
  }

  // The Core row: "None" and one chip per core, or why there are none yet.
  corePicker(t) {
    if (this.coresError) return div().id("wd-cores-error").text_size(11.5).text_color(t.ansi1).child(this.coresError);
    if (!this.cores) return div().id("wd-cores-loading").text_size(11.5).text_color(t.dim).child("Loading…");
    const chip = (id, text, value) => div().id(`wd-core-${id}`).h(28).px(10).flex().items_center().rounded(7).text_size(12)
      .border_1().border_color(this.machine === value ? t.accent : t.border).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.machine = value; this.error = undefined; cx.notify(); })
      .child(text);
    const cores = this.cores.map((c) => chip(c.name, c.state === "connected" ? c.name : `${c.name} (${c.state.replace(/_/g, " ")})`, c.name));
    return h_flex().flex_wrap().gap(6).children([chip("none", "None", undefined), ...cores]);
  }

  render() {
    const t = theme();
    const label = (text) => div().pt(14).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const button = (id, text, primary, action, danger) => dialogButton(t, id, text, primary, action, danger);
    const icon = (name) => div().id(`wd-icon-${name}`).size(32).flex_none().flex().items_center().justify_center().rounded(7)
      .border_1().border_color(this.icon === name ? t.accent : t.border).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.icon = name; cx.notify(); })
      .child(svg(iconPath(name)).size(15).text_color(workspaceColor(t, this.color)));
    const swatch = (name) => div().id(`wd-color-${name}`).size(26).flex_none().flex().items_center().justify_center().rounded_full()
      .bg(workspaceColor(t, name)).border_2().border_color(this.color === name ? t.foreground : t.popover).cursor_pointer()
      .on_click((_e, cx) => { this.color = name; cx.notify(); });
    const editing = this.id !== undefined;
    return v_flex().id("workspace-dialog").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(editing ? "Edit workspace" : "New workspace"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().id("wd-error").h(18).pt(5).text_size(11.5).text_color(t.ansi1).child(this.error ?? ""))
      .child(label("Icon"))
      .child(h_flex().flex_wrap().gap(6).children(WORKSPACE_ICONS.map(icon)))
      .child(label("Color"))
      .child(h_flex().gap(8).children(Object.keys(WORKSPACE_COLORS).map(swatch)))
      .child(label("Core"))
      .child(this.corePicker(t))
      .child(div().flex_1())
      .child(h_flex().pt(16).gap(8).justify_end()
        .children(editing ? this.deleteControls(button) : [])
        .child(button("wd-cancel", "Cancel", false, () => this.cancel()))
        .child(button("wd-save", editing ? "Save" : "Create", true, (_e, cx) => this.save(cx))));
  }

  // The Delete button (then Confirm delete) with the spacer that keeps it at the left edge, for an existing workspace.
  deleteControls(button) {
    return [
      this.confirming
        ? button("wd-confirm", "Confirm delete", false, (_e, cx) => this.remove(cx), true)
        : button("wd-delete", "Delete", false, (_e, cx) => { this.confirming = true; cx.notify(); }, true),
      div().flex_1(),
    ];
  }
}
