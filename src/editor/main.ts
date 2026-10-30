// An editable text file pane: syntax colors, line numbers, folding, Cmd+S, and no silent overwrite of a file that changed on disk.
import { View, div } from "gpui-kit";
import type { Context, AsyncContext, Element } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { props, focused, panes, shared, setShared, exec, readTextFile, writeTextFile, theme, settings, nextCommand } from "herdr";
import { EditorDocument } from "./document.ts";
import { baseName, languageFor, syntaxColors } from "./language.ts";
import { routePane, type Claims } from "./routing.ts";

type Colors = Record<string, string>;
type Hex = `#${string}`;

const hex = (t: Colors, name: string): Hex => { const v = t[name]; return v?.startsWith("#") ? (v as Hex) : "#808080"; };

export default class Editing extends View {
  private doc = new EditorDocument({ readTextFile, writeTextFile, exec }, "");
  private path = "";
  private code: EditorState | undefined;
  private pane: string | undefined;
  private generation = 0;
  private readonly token = Math.random().toString(36).slice(2);

  override init(_props: unknown, cx: AsyncContext): void {
    const given = props() as { path?: string; on?: string | null } | undefined;
    this.path = given?.path ?? "";
    this.doc = new EditorDocument({ readTextFile, writeTextFile, exec }, this.path, given?.on ?? null);
    try { cx.bind_keys([{ keystroke: "cmd-s", action: "editor-save", context: "EditorPane" }]); } catch { /* another copy bound it */ }
    this.settle();
    void this.open(cx);
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        this.settle();
        if (!this.active()) continue;
        if (command === "save") this.save(cx);
        else if (command === "overwrite") this.overwrite(cx);
        else if (command === "reload") void this.open(cx);
      }
    });
  }

  private text(): string { return this.code?.value() ?? ""; }

  private editorPanes(): string[] { return panes().filter(p => p.mod === "editor").map(p => p.pane); }

  private claims(): Claims { return (shared("editor.claims") ?? {}) as Claims; }

  /** Decides which editor pane this copy owns and records the claim; a focus proof is the pane the keyboard is in. */
  private route(proof?: string): void {
    const claims = this.claims();
    const pane = routePane({ open: this.editorPanes(), claims, token: this.token, path: this.path, current: this.pane, proof });
    this.pane = pane;
    if (pane === undefined || claims[pane]?.token === this.token) return;
    const open = new Set(this.editorPanes());
    const live = Object.fromEntries(Object.entries(claims).filter(([p]) => open.has(p)));
    setShared("editor.claims", { ...live, [pane]: { token: this.token, path: this.path } });
  }

  /** A pane the keyboard is in is this copy's pane when no other copy holds it for another file. */
  private adopt(): void {
    const pane = focused()?.pane;
    if (pane) this.route(pane);
  }

  private settle(): void { this.route(); }

  private active(): boolean {
    return this.pane !== undefined && focused()?.pane === this.pane;
  }

  private async open(cx: AsyncContext): Promise<void> {
    const generation = ++this.generation;
    this.code?.release();
    this.code = undefined;
    cx.notify();
    if (!this.path) { this.doc.status = { kind: "unavailable", message: "No file to open" }; return; }
    await this.doc.open();
    if (generation !== this.generation) return;
    if (this.doc.status.kind === "editable" || this.doc.status.kind === "readonly") {
      this.code = EditorState.new({ language: languageFor(this.path), value: this.doc.snapshot, readonly: this.doc.status.kind === "readonly",
        folding: true, line_numbers: true, font_family: String(settings()["font_family"] ?? ""), font_size: 12, syntax: syntaxColors(theme()) });
      this.code.on("change", (_e, cx) => cx.notify());
      this.code.on("focus", (_e, cx) => { this.adopt(); cx.notify(); });
    }
    cx.notify();
  }

  private save(cx: AsyncContext): void { this.run(cx, () => this.doc.save(this.text())); }

  private overwrite(cx: AsyncContext): void { this.run(cx, () => this.doc.overwrite(this.text())); }

  private run(cx: AsyncContext, work: () => Promise<void>): void {
    cx.spawn(async cx => {
      try { await work(); } finally { cx.notify(); }
    });
  }

  private button(label: string, id: string, handler: (cx: Context) => void, t: Colors): Element {
    return div().id(id).px(10).h(24).flex().items_center().rounded(6).cursor_pointer().bg(hex(t, "raised")).hover(s => s.bg(hex(t, "hover"))).on_click((_e, cx) => handler(cx)).child(label);
  }

  override render(cx: Context): Element {
    const t = theme();
    if (this.pane === undefined) this.settle();
    const status = this.doc.status;
    const notice = this.doc.failure ?? (status.kind === "readonly" || status.kind === "unavailable" ? status.message : undefined);
    const dirty = this.doc.dirty(this.text());
    return v_flex().id("editor").key_context("EditorPane").on_action("editor-save", (_e, cx) => { this.adopt(); this.save(cx); })
      .size_full().min_h(0).rounded(10).overflow_hidden().bg(hex(t, "background")).border_1().border_color(hex(t, "border")).text_color(hex(t, "foreground")).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(hex(t, "border"))
        .child(div().font_semibold().truncate().child(this.path ? baseName(this.path) : "Editor"))
        .when(dirty, el => el.child(div().text_color(hex(t, "blocked")).child("●")))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(hex(t, "dim")).child(this.path)))
      .when(Boolean(this.doc.conflict), el => el.child(h_flex().flex_none().px(14).py(8).gap(8).items_center().border_b(1).border_color(hex(t, "border")).bg(hex(t, "surface"))
        .child(div().flex_1().min_w(0).text_size(12).text_color(hex(t, "blocked")).child("This file changed on disk since you opened it."))
        .child(this.button("Reload", "editor-reload", cx => { cx.spawn(async acx => this.open(acx)); }, t))
        .child(this.button("Overwrite", "editor-overwrite", cx => this.overwrite(cx), t))))
      .when(Boolean(notice), el => el.child(div().flex_none().px(14).py(6).text_size(12).text_color(hex(t, "dim")).child(notice ?? "")))
      .child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(14).text_color(hex(t, "dim")).child(status.kind === "loading" ? "Loading file…" : ""));
  }
}
