// Side-by-side diff of one file, HEAD against the working tree; the Changes list picks the file.
import { View, div, list } from "gpui-kit";
import type { Context, AsyncContext, Element } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { props, shared, setShared, focused, panes, run, exec, readTextFile, watchFolder, theme, settings } from "herdr";
import { targetToShow, differsFrom, reloadsOnTick, displayRows, loadView, type DiffTarget, type DisplayRow, type View as DiffView } from "./rows.ts";
import { stops, step, currentBlock, stepsOf, clampCursor, editorTarget, wrapsLines, type EditorClaims } from "./nav.ts";
import type { Row, Cell } from "./diff.ts";
import { rowSpans, wrapPieces, type Span } from "./words.ts";
import { diffTints, type DiffTints, type Tint } from "./tints.ts";

type Hex = `#${string}`;
type Colors = Record<string, string>;

const TARGETS_KEY = "my-diff.targets";
const WRAP_KEY = "my-diff.wrap";
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
  private loading = false;
  private scroller: VirtualListScrollHandle | undefined;
  private cursor: number | undefined;
  private deleted = false;
  private notice: string | undefined;

  override init(_props: unknown, cx: AsyncContext): void {
    this.scroller = VirtualListScrollHandle.new();
    this.follow(cx);
    cx.timer.every(10000, cx => { if (reloadsOnTick(this.target, this.loading)) this.reload(cx); });
  }

  private current(): DiffTarget | undefined { return targetToShow(shared(TARGETS_KEY), props(), focused()?.space); }

  /** Loads again when the target to show is not the one shown. */
  private follow(cx: AsyncContext | Context): void {
    const next = this.current();
    if (!next || !differsFrom(next, this.target)) return;
    this.target = next;
    this.expanded = new Set();
    this.cursor = undefined;
    this.notice = undefined;
    this.deleted = false;
    this.watch(next, cx);
    this.reload(cx);
  }

  private reload(cx: AsyncContext | Context): void {
    const target = this.target;
    if (!target) return;
    const generation = ++this.generation;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const view = await loadView({ exec, readTextFile }, target);
        if (generation === this.generation) { this.apply(view); cx.notify(); }
      } finally {
        if (generation === this.generation) this.loading = false;
      }
    });
  }

  private apply(view: DiffView): void {
    this.deleted = view.deleted === true;
    if (view.kind === "message") { this.rows = []; this.shown = []; this.message = view.text; this.cursor = undefined; return; }
    this.rows = view.rows;
    this.message = view.rows.length === 0 ? "Empty file" : undefined;
    this.fold();
    this.cursor = clampCursor(this.cursor, stops(this.shown).length);
  }

  private move(direction: "previous" | "next", cx: Context): void {
    const starts = stops(this.shown);
    const cursor = step(this.cursor, starts.length, direction);
    const stop = cursor === undefined ? undefined : starts[cursor];
    if (cursor === undefined || stop === undefined) return;
    this.cursor = cursor;
    this.scroller?.scroll_to_item(stop, "center");
    cx.notify();
  }

  private toggleWrap(cx: Context): void {
    setShared(WRAP_KEY, !wrapsLines(shared(WRAP_KEY)));
    cx.notify();
  }

  private openInEditor(cx: Context): void {
    const target = this.target;
    const f = focused();
    if (!target || !f) return;
    const path = `${target.root}/${target.path}`;
    const claims = (shared("editor.claims") ?? {}) as EditorClaims;
    const where = editorTarget({ panes: panes(), claims, focused: { tab: f.tab, pane: f.pane }, path, on: target.on });
    if (!where) return;
    const open = { path, on: target.on };
    try {
      if (where.kind === "focus") run("pane.focus", { pane: where.pane });
      else if (where.kind === "split") run("pane.split", { direction: "right", pane: where.pane, mod: "editor", props: open });
      else run("tab.new", { mod: "editor", props: open });
      this.notice = undefined;
    } catch (e) { this.notice = String(e); }
    cx.notify();
  }

  private button(id: string, label: string, enabled: boolean, t: Colors, click: (cx: Context) => void, background = "raised"): Element {
    return div().id(id).h(24).px(10).flex_none().flex().items_center().rounded(6).bg(hex(t, background))
      .text_color(enabled ? hex(t, "foreground") : hex(t, "dim"))
      .when(enabled, el => el.cursor_pointer().hover(s => s.bg(hex(t, "hover"))).on_click((_e, cx) => click(cx)))
      .child(label);
  }

  private header(t: Colors): Element {
    const starts = stops(this.shown);
    const can = stepsOf(this.cursor, starts.length);
    const position = this.cursor === undefined ? `${starts.length} ${starts.length === 1 ? "change" : "changes"}` : `${this.cursor + 1}/${starts.length}`;
    const bar = h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(hex(t, "border"))
      .child(div().flex_1().min_w(0).truncate().child(this.target?.path ?? "Diff"));
    if (this.message === undefined) {
      bar.child(div().flex_none().text_color(hex(t, "dim")).child(position))
        .child(this.button("diff-previous", "Previous", can.previous, t, cx => this.move("previous", cx)))
        .child(this.button("diff-next", "Next", can.next, t, cx => this.move("next", cx)))
        .child(this.button("diff-wrap", "Wrap", true, t, cx => this.toggleWrap(cx), wrapsLines(shared(WRAP_KEY)) ? "selected" : "raised"));
    }
    if (this.target && !this.deleted) bar.child(this.button("diff-open", "Open in editor", true, t, cx => this.openInEditor(cx)));
    return bar;
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

  private cell(cell: Cell | undefined, tint: Tint | undefined, filler: Hex, t: Colors, wrap: boolean, spans?: Span[]): Element[] {
    const wash = tint && (cell ? tint.line : filler);
    const shade = (el: Element): Element => {
      const washed = wash ? el.bg(wash) : el;
      return wrap ? washed.self_stretch() : washed;
    };
    const text = spans && tint
      ? this.words(spans, tint, wrap)
      : wrap ? div().flex_1().min_w(0).px(6).whitespace_normal().child(cell?.text ?? "") : div().flex_1().min_w(0).px(6).truncate().child(cell?.text ?? "");
    return [
      shade(div().w(48).flex_none().px(6).text_right().text_color(hex(t, "dim")).child(cell ? String(cell.line) : "")),
      shade(text),
    ];
  }

  private words(spans: Span[], tint: Tint, wrap: boolean): Element {
    if (!wrap) return h_flex().flex_1().min_w(0).px(6).overflow_hidden().children(spans.map((s) => this.span(s, tint)));
    return h_flex().flex_1().min_w(0).px(6).flex_wrap().overflow_hidden().children(wrapPieces(spans).map((s) => this.span(s, tint)));
  }

  private span(span: Span, tint: Tint): Element {
    const el = div().flex_none().whitespace_nowrap().child(span.text);
    return span.changed ? el.bg(tint.word) : el;
  }

  private line(row: DisplayRow, t: Colors, tints: DiffTints, current: number | undefined, wrap: boolean): Element {
    if (row.kind === "hidden") {
      return div().w_full().h(ROW_HEIGHT).flex_none().px(12).bg(hex(t, "raised")).text_color(hex(t, "dim")).cursor_pointer().child(row.label);
    }
    const changed = row.kind === "change";
    const words = rowSpans(row);
    const [leftNo, leftText] = this.cell(row.left, changed ? tints.removed : undefined, tints.filler, t, wrap, words?.left) as [Element, Element];
    const [rightNo, rightText] = this.cell(row.right, changed ? tints.added : undefined, tints.filler, t, wrap, words?.right) as [Element, Element];
    const bar = wrap ? div().w(3).self_stretch().flex_none() : div().w(3).h_full().flex_none();
    const marked = changed && row.block === current;
    const columns = h_flex().w_full().flex_none();
    return (wrap ? columns.min_h(ROW_HEIGHT).items_start() : columns.h(ROW_HEIGHT))
      .child(marked ? bar.bg(hex(t, "accent")) : bar).child(leftNo).child(leftText).child(rightNo).child(rightText);
  }

  private keyOf(i: number): string {
    const row = this.shown[i];
    return row?.kind === "hidden" ? `hidden:${row.id}` : `row:${i}`;
  }

  override render(cx: Context) {
    this.follow(cx);
    const t = theme();
    const tints = diffTints(t);
    const current = currentBlock(this.shown, this.cursor);
    const wrap = wrapsLines(shared(WRAP_KEY));
    const font = String(settings()["font_family"] ?? "JetBrains Mono");
    const body = this.message === undefined
      ? div().flex_1().min_h(0).relative()
        .child(wrap
          ? list("diff-rows-wrap", this.shown.length, i => this.keyOf(i), i => this.line(this.shown[i]!, t, tints, current, true))
            .on_item_click((key, cx) => this.expand(key, cx)).track_scroll(this.scroller!).size_full()
          : v_virtual_list("diff-rows", this.shown.length, ROW_HEIGHT, i => this.keyOf(i),
            range => this.shown.slice(range.start, range.end).map(row => this.line(row, t, tints, current, false)))
            .on_item_click((key, cx) => this.expand(key, cx)).track_scroll(this.scroller!).size_full())
        .child(Scrollbar.vertical(wrap ? "diff-rows-wrap" : "diff-rows").viewport_from_layout().absolute().inset_0())
      : div().p(12).text_color(hex(t, "dim")).child(this.message);
    return v_flex().id("diff").size_full().min_h(0).overflow_hidden().bg(hex(t, "background")).text_color(hex(t, "foreground")).text_size(12).font_family(font)
      .child(this.header(t))
      .when(this.notice !== undefined, el => el.child(div().px(12).py(6).flex_none().text_color(hex(t, "dim")).child(this.notice ?? "")))
      .child(body);
  }
}
