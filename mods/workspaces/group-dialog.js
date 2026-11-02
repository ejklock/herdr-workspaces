// The group name dialog. Opened with props { group, name } to rename a group, or with { space } to make a
// group in the active workspace and put that space in it. Enter saves, Esc cancels.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, closeOverlay, shared, spaces, appHome, readTextFile, writeTextFile } from "herdr";
import { mkdir } from "fs/promises";
import { storePaths, updateStore, createGroup, renameGroup, moveToGroup, newGroupId, activeWorkspace } from "./lib.js";

const files = { read: readTextFile, write: writeTextFile };

export default class GroupDialog extends View {
  init(p, cx) {
    const given = props() ?? p ?? {};
    this.group = given.group;
    this.space = given.space;
    this.text = given.name ?? "";
    this.error = undefined;
    this.saving = false;
    this.input = InputState.new({ value: this.text });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = undefined; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.save(cx));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  // The store change: a rename, or a new group in the active workspace that takes the space.
  change() {
    const active = shared("workspaces.active");
    const live = spaces();
    return (store) => {
      if (this.group !== undefined) return renameGroup(store, this.group, this.text);
      const workspace = activeWorkspace(store, active)?.id;
      const id = newGroupId(store, this.text);
      const made = createGroup(store, workspace, this.text, id);
      if (made.error || this.space === undefined) return made;
      return moveToGroup(made.store, active, live, this.space, id);
    };
  }

  // Writes the store and closes only once the write settles, because Herdr cancels an overlay's unfinished tasks once it closes.
  save(cx) {
    if (this.saving) return;
    this.saving = true;
    cx.spawn(async (cx) => {
      let result;
      try {
        const { dir, file } = storePaths(appHome());
        await mkdir(dir, { recursive: true });
        result = await updateStore(files, file, this.change());
      } catch (e) {
        result = { error: `Could not save: ${e.message ?? e}` };
      }
      this.saving = false;
      if (result.error) {
        this.error = result.error;
        cx.notify();
        return;
      }
      closeOverlay(props().overlay);
    });
  }

  key(e, cx) {
    if (e.key === "escape") { this.cancel(); cx.stop_propagation(); }
  }

  // Herdr cancels an overlay's unfinished tasks once it closes, so a save in flight keeps it open.
  cancel() {
    if (!this.saving) closeOverlay(props().overlay);
  }

  render() {
    const t = theme();
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("group-dialog").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(this.group === undefined ? "New group" : "Rename group"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(14).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().id("gd-error").h(18).pt(5).text_size(11.5).text_color(t.ansi1).child(this.error ?? ""))
      .child(div().flex_1())
      .child(h_flex().pt(12).gap(8).justify_end()
        .child(button("gd-cancel", "Cancel", false, () => this.cancel()))
        .child(button("gd-save", this.group === undefined ? "Create" : "Save", true, (_e, cx) => this.save(cx))));
  }
}
