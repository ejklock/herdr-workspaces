// Side-by-side diff of one file, HEAD against the working tree; the Changes list picks the file.
import { View, div } from "gpui-kit";
import type { Context, AsyncContext, Element } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { props, shared, focused, exec, readTextFile, watchFolder, theme, settings } from "herdr";
import { targetToShow, differsFrom, displayRows, loadView, type DiffTarget, type DisplayRow, type View as DiffView } from "./rows.ts";
import type { Row, Cell } from "./diff.ts";

type Hex = `#${string}`;
type Colors = Record<string, string>;

const TARGETS_KEY = "my-diff.targets";
const CONTEXT = 3;
const ROW_HEIGHT = 20;

const hex = (t: Colors, name: string): Hex => { const v = t[name]; return v?.startsWith("#") ? (v as Hex) : "#808080"; };

export default class Diff extends View {
  private target: DiffTarget | undefined;
  private rows: Row[] = [];
  private shown: DisplayRow[] = [];
  private expanded = new Set<number>();
  private message: string | undefined = "No file selected";
  private watched: string | undefined;
  private generation = 0;

  override init(_props: unknown, cx: AsyncContext): void {
    this.follow(cx);
  }

  private current(): DiffTarget | undefined { return targetToShow(shared(TARGETS_KEY), props(), focused()?.space); }

  /** Loads again when the target to show is not the one shown. */
  private follow(cx: AsyncContext | Context): void {
    const next = this.current();
    if (!next || !differsFrom(next, this.target)) return;
    this.target = next;
    this.expanded = new Set();
    this.watch(next, cx);
    this.reload(cx);
  }

  private reload(cx: AsyncContext | Context): void {
    const target = this.target;
    if (!target) return;
    const generation = ++this.generation;
    cx.spawn(async cx => {
      const view = await loadView({ exec, readTextFile }, target);
      if (generation === this.generation) { this.apply(view); cx.notify(); }
    });
  }

  private apply(view: DiffView): void {
    if (view.kind === "message") { this.rows = []; this.shown = []; this.message = view.text; return; }
    this.rows = view.rows;
    this.message = view.rows.length === 0 ? "Empty file" : undefined;
    this.fold();
  }

  private fold(): void { this.shown = displayRows(this.rows, CONTEXT, this.expanded); }

  private watch(target: DiffTarget, cx: AsyncContext | Context): void {
    if (target.on) { this.watched = undefined; return; }
    if (this.watched === target.root) return;
    const root = this.watched = target.root;
    cx.spawn(async cx => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.reload(cx);
        }
      } catch { if (this.watched === root) this.watched = undefined; }
    });
  }

  private expand(key: string, cx: Context): void {
    const id = key.startsWith("hidden:") ? Number(key.slice(7)) : Number.NaN;
    if (Number.isNaN(id)) return;
    this.expanded.add(id);
    this.fold();
    cx.notify();
  }

  private cell(cell: Cell | undefined, tint: Hex | undefined, t: Colors): Element[] {
    const shade = (el: Element): Element => (cell && tint ? el.bg(`${tint}18` as Hex) : el);
    return [
      shade(div().w(48).flex_none().px(6).text_right().text_color(hex(t, "dim")).child(cell ? String(cell.line) : "")),
      shade(div().flex_1().min_w(0).px(6).truncate().child(cell?.text ?? "")),
    ];
  }

  private line(row: DisplayRow, t: Colors): Element {
    if (row.kind === "hidden") {
      return div().w_full().h(ROW_HEIGHT).flex_none().px(12).bg(hex(t, "raised")).text_color(hex(t, "dim")).cursor_pointer().child(row.label);
    }
    const changed = row.kind === "change";
    const [leftNo, leftText] = this.cell(row.left, changed ? hex(t, "ansi1") : undefined, t) as [Element, Element];
    const [rightNo, rightText] = this.cell(row.right, changed ? hex(t, "ansi2") : undefined, t) as [Element, Element];
    return h_flex().w_full().h(ROW_HEIGHT).flex_none().child(leftNo).child(leftText).child(rightNo).child(rightText);
  }

  private keyOf(i: number): string {
    const row = this.shown[i];
    return row?.kind === "hidden" ? `hidden:${row.id}` : `row:${i}`;
  }

  override render(cx: Context) {
    this.follow(cx);
    const t = theme();
    const font = String(settings()["font_family"] ?? "JetBrains Mono");
    const body = this.message === undefined
      ? div().flex_1().min_h(0).relative()
        .child(v_virtual_list("diff-rows", this.shown.length, ROW_HEIGHT, i => this.keyOf(i),
          range => this.shown.slice(range.start, range.end).map(row => this.line(row, t)))
          .on_item_click((key, cx) => this.expand(key, cx)).size_full())
        .child(Scrollbar.vertical("diff-rows").viewport_from_layout().absolute().inset_0())
      : div().p(12).text_color(hex(t, "dim")).child(this.message);
    return v_flex().id("diff").size_full().min_h(0).overflow_hidden().bg(hex(t, "background")).text_color(hex(t, "foreground")).text_size(12).font_family(font)
      .child(h_flex().h(36).flex_none().px(12).items_center().border_b(1).border_color(hex(t, "border")).child(div().min_w(0).truncate().child(this.target?.path ?? "Diff")))
      .child(body);
  }
}
