// Side-by-side diff of one file, HEAD against the working tree; the Changes list picks the file.
import { View, div, list } from "gpui-kit";
import type { Context, AsyncContext, Element } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { props, shared, setShared, focused, panes, run, exec, readTextFile, watchFolder, theme, settings } from "herdr";
import { targetToShow, differsFrom, reloadsOnTick, displayRows, loadView, type DiffTarget, type DisplayRow, type View as DiffView } from "./rows.ts";
import { stops, step, currentBlock, rulerMarks, type RulerMark, stepsOf, clampCursor, editorTarget, wrapsLines, type EditorClaims } from "./nav.ts";
import type { Row, Cell } from "./diff.ts";
import { rowSpans, wrapPieces, mergeSpans, type Segment, type Span } from "./words.ts";
import { syntaxLines, syntaxPalette, sideTexts, type SyntaxSpan } from "./syntax.ts";
import hljs from "../vendor/highlight.js";
import { diffTints, type DiffTints, type Tint } from "./tints.ts";

type Hex = `#${string}`;
type Colors = Record<string, string>;

const TARGETS_KEY = "my-diff.targets";
const WRAP_KEY = "my-diff.wrap";
const CONTEXT = 3;
const ROW_HEIGHT = 20;
const BAND_WIDTH = 18;
const BUTTON_SIZE = 26;
const RULER_WIDTH = 12;

type Palette = ReturnType<typeof syntaxPalette>;
type Tokens = { old: SyntaxSpan[][]; new: SyntaxSpan[][] };

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
  private bodyHeight = 0;
  private deleted = false;
  private notice: string | undefined;
  private tokens: Tokens = { old: [], new: [] };

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
    if (view.kind === "message") { this.rows = []; this.shown = []; this.tokens = { old: [], new: [] }; this.message = view.text; this.cursor = undefined; return; }
    this.rows = view.rows;
    const text = sideTexts(view.rows);
    const path = this.target?.path ?? "";
    this.tokens = { old: syntaxLines(hljs, text.old, path), new: syntaxLines(hljs, text.new, path) };
    this.message = view.rows.length === 0 ? "Empty file" : undefined;
    this.fold();
    this.cursor = clampCursor(this.cursor, stops(this.shown).length);
  }

  private move(direction: "previous" | "next", cx: Context): void {
    const cursor = step(this.cursor, stops(this.shown).length, direction);
    if (cursor !== undefined) this.goTo(cursor, cx);
  }

  private goTo(cursor: number, cx: Context): void {
    const stop = stops(this.shown)[cursor];
    if (stop === undefined) return;
    this.cursor = cursor;
    this.scroller?.scroll_to_item(stop, "center");
    cx.notify();
  }

  private resized(height: number, cx: Context): void {
    if (height === this.bodyHeight) return;
    this.bodyHeight = height;
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

  private button(id: string, glyph: string, enabled: boolean, t: Colors, click: (cx: Context) => void, background = "raised"): Element {
    return div().id(id).w(BUTTON_SIZE).h(BUTTON_SIZE).flex_none().flex().items_center().justify_center().rounded(6).bg(hex(t, background))
      .text_color(enabled ? hex(t, "foreground") : hex(t, "dim"))
      .when(enabled, el => el.cursor_pointer().hover(s => s.bg(hex(t, "hover"))).on_click((_e, cx) => click(cx)))
      .child(glyph);
  }

  private title(t: Colors): Element {
    const path = this.target?.path ?? "Diff";
    const slash = path.lastIndexOf("/");
    const title = h_flex().flex_1().min_w(0).overflow_hidden();
    if (slash >= 0) title.child(div().min_w(0).truncate().text_color(hex(t, "dim")).child(path.slice(0, slash + 1)));
    return title.child(div().flex_none().whitespace_nowrap().font_bold().child(path.slice(slash + 1)));
  }

  private counts(t: Colors): Element[] {
    const added = this.rows.filter(row => row.kind === "change" && row.right).length;
    const removed = this.rows.filter(row => row.kind === "change" && row.left).length;
    return [
      div().flex_none().text_color(hex(t, "ansi2")).child(`+${added}`),
      div().flex_none().text_color(hex(t, "ansi1")).child(`\u2212${removed}`),
    ];
  }

  private header(t: Colors): Element {
    const starts = stops(this.shown);
    const can = stepsOf(this.cursor, starts.length);
    const position = this.cursor === undefined ? `${starts.length} ${starts.length === 1 ? "change" : "changes"}` : `${this.cursor + 1}/${starts.length}`;
    const bar = h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(hex(t, "border")).child(this.title(t));
    if (this.message === undefined) {
      bar.children(this.counts(t))
        .child(div().flex_none().text_color(hex(t, "dim")).child(position))
        .child(this.button("diff-previous", "\u2191", can.previous, t, cx => this.move("previous", cx)))
        .child(this.button("diff-next", "\u2193", can.next, t, cx => this.move("next", cx)))
        .child(this.button("diff-wrap", "\u23CE", true, t, cx => this.toggleWrap(cx), wrapsLines(shared(WRAP_KEY)) ? "selected" : "raised"));
    }
    if (this.target && !this.deleted) bar.child(this.button("diff-open", "\u2197", true, t, cx => this.openInEditor(cx)));
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

  private spansOf(cell: Cell | undefined, side: SyntaxSpan[][]): SyntaxSpan[] {
    if (!cell) return [];
    const spans = side[cell.line - 1];
    return spans && spans.map(span => span.text).join("") === cell.text ? spans : cell.text === "" ? [] : [{ text: cell.text }];
  }

  private cell(cell: Cell | undefined, side: SyntaxSpan[][], marker: string, tint: Tint | undefined, words: Span[] | undefined, t: Colors, palette: Palette, wrap: boolean): Element[] {
    const shade = (el: Element): Element => {
      const washed = tint && cell ? el.bg(tint.line) : el;
      return wrap ? washed.self_stretch() : washed;
    };
    const number = h_flex().w(58).flex_none().px(6).gap(4).text_color(hex(t, "dim"))
      .child(div().flex_1().text_right().child(cell ? String(cell.line) : ""))
      .child(div().w(8).flex_none().child(cell ? marker : ""));
    return [shade(number), shade(this.segments(mergeSpans(this.spansOf(cell, side), tint ? words : undefined), tint, t, palette, wrap))];
  }

  private segments(segments: Segment[], tint: Tint | undefined, t: Colors, palette: Palette, wrap: boolean): Element {
    const shown = wrap ? wrapPieces(segments) : segments;
    const row = h_flex().flex_1().min_w(0).px(6).overflow_hidden().children(shown.map(segment => this.segment(segment, tint, t, palette)));
    return wrap ? row.flex_wrap() : row;
  }

  private segment(segment: Segment, tint: Tint | undefined, t: Colors, palette: Palette): Element {
    const color = (segment.color && palette[segment.color]) ?? hex(t, "foreground");
    const el = div().flex_none().whitespace_nowrap().text_color(color).child(segment.text);
    return segment.changed && tint ? el.bg(tint.word) : el;
  }

  private hidden(row: Extract<DisplayRow, { kind: "hidden" }>, t: Colors): Element {
    return div().w_full().h(ROW_HEIGHT).flex_none().px(12).bg(hex(t, "raised")).text_color(hex(t, "dim")).cursor_pointer().child(`\u2195 ${row.label}`);
  }

  private band(row: DisplayRow, tints: DiffTints, wrap: boolean): Element {
    const band = wrap ? div().w(BAND_WIDTH).self_stretch().flex_none() : div().w(BAND_WIDTH).h_full().flex_none();
    if (row.kind !== "change") return band;
    return band.bg((row.right ? tints.added : tints.removed).line);
  }

  private line(row: DisplayRow, t: Colors, tints: DiffTints, palette: Palette, current: number | undefined, wrap: boolean): Element {
    if (row.kind === "hidden") return this.hidden(row, t);
    const changed = row.kind === "change";
    const words = rowSpans(row);
    const [leftNo, leftText] = this.cell(row.left, this.tokens.old, changed ? "\u2212" : "", changed ? tints.removed : undefined, words?.left, t, palette, wrap) as [Element, Element];
    const [rightNo, rightText] = this.cell(row.right, this.tokens.new, changed ? "+" : "", changed ? tints.added : undefined, words?.right, t, palette, wrap) as [Element, Element];
    const bar = wrap ? div().w(3).self_stretch().flex_none() : div().w(3).h_full().flex_none();
    const marked = changed && row.block === current;
    const columns = h_flex().w_full().flex_none();
    return (wrap ? columns.min_h(ROW_HEIGHT).items_start() : columns.h(ROW_HEIGHT))
      .child(marked ? bar.bg(hex(t, "accent")) : bar).child(leftNo).child(leftText).child(this.band(row, tints, wrap)).child(rightNo).child(rightText);
  }

  private ruler(marks: readonly RulerMark[], current: number | undefined, t: Colors): Element {
    const color = { added: "ansi2", removed: "ansi1", changed: "blocked" } as const;
    return div().w(RULER_WIDTH).h_full().flex_none().relative().bg(hex(t, "surface")).border_l(1).border_color(hex(t, "border"))
      .children(marks.map(mark => div().id(`diff-mark-${mark.stop}`).absolute().top(mark.top).left(1).w(RULER_WIDTH - 2).h(mark.size)
        .bg(hex(t, color[mark.kind])).cursor_pointer()
        .when(mark.stop === current, el => el.border_1().border_color(hex(t, "foreground")))
        .on_click((_e, cx) => this.goTo(mark.stop, cx))));
  }

  private keyOf(i: number): string {
    const row = this.shown[i];
    return row?.kind === "hidden" ? `hidden:${row.id}` : `row:${i}`;
  }

  override render(cx: Context) {
    this.follow(cx);
    const t = theme();
    const tints = diffTints(t);
    const palette = syntaxPalette(t);
    const current = currentBlock(this.shown, this.cursor);
    const wrap = wrapsLines(shared(WRAP_KEY));
    const font = String(settings()["font_family"] ?? "JetBrains Mono");
    const marks = this.message === undefined ? rulerMarks(this.shown, this.bodyHeight) : [];
    const body = this.message === undefined
      ? h_flex().id("diff-body").flex_1().min_h(0).on_size_change((size, cx) => this.resized(size.height, cx))
        .child(div().flex_1().min_w(0).h_full().relative()
        .child(wrap
          ? list("diff-rows-wrap", this.shown.length, i => this.keyOf(i), i => this.line(this.shown[i]!, t, tints, palette, current, true))
            .on_item_click((key, cx) => this.expand(key, cx)).track_scroll(this.scroller!).size_full()
          : v_virtual_list("diff-rows", this.shown.length, ROW_HEIGHT, i => this.keyOf(i),
            range => this.shown.slice(range.start, range.end).map(row => this.line(row, t, tints, palette, current, false)))
            .on_item_click((key, cx) => this.expand(key, cx)).track_scroll(this.scroller!).size_full())
        .child(Scrollbar.vertical(wrap ? "diff-rows-wrap" : "diff-rows").viewport_from_layout().absolute().inset_0()))
        .child(this.ruler(marks, this.cursor, t))
      : div().p(12).text_color(hex(t, "dim")).child(this.message);
    return v_flex().id("diff").size_full().min_h(0).overflow_hidden().bg(hex(t, "background")).text_color(hex(t, "foreground")).text_size(12).font_family(font)
      .child(this.header(t))
      .when(this.notice !== undefined, el => el.child(div().px(12).py(6).flex_none().text_color(hex(t, "dim")).child(this.notice ?? "")))
      .child(body);
  }
}
