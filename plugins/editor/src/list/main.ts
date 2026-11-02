// The changed files of the focused pane's repository, with a commit box; a click on a file shows it in the diff pane.
import { View, div } from "gpui-kit";
import type { Context, AsyncContext } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import type { FocusHandle } from "gpui";
import { spaces, panes, focused, exec, run, shared, setShared, watchFolder, theme } from "herdr";
import { diffTarget, nextTargets, paneProps, totals, untrackedAdds, TARGETS_KEY } from "./target.ts";
import { LIMIT, STATUS_ARGS, addStats, changeList, commitSteps, emptyMessage, numstatArgs, untrackedPaths, type FileChange, type Stat } from "./status.ts";

type Hex = `#${string}`;
type Colors = Record<string, Hex>;
type Location = { cwd: string | null | undefined; on: string | null };
type GitResult = { code: number; stdout: string; stderr: string };
type Loaded = { kind: "stale" } | { kind: "none" } | { kind: "ok"; root: string; files: FileChange[]; limited: boolean };

const colorsOf = (t: Record<string, string>): Colors =>
  Object.fromEntries(Object.entries(t).map(([name, v]) => [name, v.startsWith("#") ? (v as Hex) : "#808080"]));

const location = (): Location => {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : undefined;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? (f.terminal.split("/")[0] ?? null) : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
};
const key = (): string => JSON.stringify(location());

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

const statColor = (status: string, t: Colors): Hex => (status === "A" ? t["ansi2"]! : status === "D" || status === "U" ? t["ansi1"]! : t["blocked"]!);

/** The line counts of the tracked files, summed over the count commands that apply; a failing command fails the read. */
async function readStats(git: (args: string[]) => Promise<GitResult>): Promise<Record<string, Stat>> {
  const head = await git(["rev-parse", "--verify", "HEAD"]);
  const results: GitResult[] = [];
  for (const args of numstatArgs(head.code === 0)) results.push(await git(args));
  const stats: Record<string, Stat> = {};
  for (const result of results) {
    if (result.code !== 0) throw new Error(result.stderr);
    addStats(stats, result.stdout);
  }
  return stats;
}

/** Reads the repository of `cwd`: its changed files with their counts. Stale when `current` turns false once the repository is found or at the end. */
async function loadChanges(cwd: string, on: string | null, current: () => boolean): Promise<Loaded> {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
  if (!current()) return { kind: "stale" };
  if (top.code !== 0) return { kind: "none" };
  const root = top.stdout.trim(), git = (args: string[]) => exec("git", [...READ, ...args], { cwd: root, on });
  const status = await git(STATUS_ARGS);
  if (status.code !== 0) throw new Error(status.stderr);
  const stats = await readStats(git);
  const adds = await untrackedAdds(exec, root, untrackedPaths(status.stdout, LIMIT), on);
  if (!current()) return { kind: "stale" };
  return { kind: "ok", root, ...changeList(status.stdout, stats, adds, LIMIT) };
}

/** Runs the git steps in the repository root, stopping at the first that fails, with its message. */
async function runGit(root: string, on: string | null, steps: string[][]): Promise<void> {
  for (const args of steps) {
    const r = await exec("git", args, { cwd: root, on });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
  }
}

const figure = (text: string, color: Hex) => div().text_size(11).text_color(color).child(text);

const header = (files: readonly FileChange[], t: Colors) => {
  const { add, del } = totals(files);
  return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t["border"]!)
    .child(div().font_semibold().child("Changes"))
    .child(div().px(5).py(1).rounded(4).border_1().border_color(t["border"]!).text_size(10).text_color(t["muted"]!).child(`${files.length} files`))
    .child(div().flex_1()).child(figure(`+${add}`, t["ansi2"]!)).child(figure(`−${del}`, t["ansi1"]!));
};

export default class Changes extends View {
  private files: FileChange[] = [];
  private message = "";
  private handle!: FocusHandle;
  private input!: InputState;
  private typing = false;
  private context: string | undefined;
  private root: string | null = null;
  private on: string | null = null;
  private watched: string | null | undefined;
  private loading = false;
  private busy = false;
  private limited = false;
  private error: string | null = null;
  private note: string | null = null;
  private selected: string | null = null;

  override init(_props: unknown, cx: AsyncContext): void {
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  private watch(root: string, cx: AsyncContext): void {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async cx => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  private resetContext(context: string): void {
    this.context = context; this.root = null; this.files = []; this.selected = null;
    this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.limited = false;
  }

  /** Takes a finished read into the panel: nothing for a stale read, the error for a folder outside a repository, else the files. */
  private apply(loaded: Loaded, on: string | null, cx: AsyncContext): void {
    if (loaded.kind === "stale") return;
    if (loaded.kind === "none") { this.root = null; this.files = []; this.selected = null; this.error = "Not a git repository"; return; }
    this.root = loaded.root; this.on = on; this.files = loaded.files; this.limited = loaded.limited; this.error = null;
    this.watch(loaded.root, cx);
    if (this.selected && !loaded.files.some(f => f.path === this.selected)) this.selected = null;
  }

  private refresh(cx: AsyncContext): void {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) this.resetContext(context);
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async cx => {
      try { this.apply(await loadChanges(cwd, on, () => key() === context), on, cx); }
      catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  /** Hands the file to the diff pane through the focused space's entry in the shared targets, then opens or focuses that pane. */
  private show(path: string, cx: Context): void {
    const f = focused();
    if (!f || this.root === null) return;
    this.selected = path; this.note = null;
    const targets = nextTargets(shared(TARGETS_KEY), f.space, { root: this.root, path, on: this.on }, spaces().map(s => s.id));
    const target = targets[f.space]!;
    const action = diffTarget({ panes: panes(), focused: { tab: f.tab, pane: f.pane } });
    try {
      setShared(TARGETS_KEY, targets);
      if (action?.kind === "focus") run("pane.focus", { pane: action.pane });
      else if (action?.kind === "split") run("pane.split", { direction: "right", pane: action.pane, mod: "my-diff", props: paneProps(f.space, target) });
      else if (action?.kind === "tab") run("tab.new", { mod: "my-diff", props: paneProps(f.space, target) });
    } catch (e) { this.note = `Cannot open the diff: ${String(e)}`; }
    cx.notify();
  }

  /** Whether a commit can start: a message, a repository, and no read or commit running. */
  private ready(): boolean {
    return Boolean(this.message.trim() && this.root !== null && !this.busy && !this.loading);
  }

  private commit(cx: Context): void {
    if (!this.ready() || this.context !== key()) return;
    const root = this.root!, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async cx => {
      try {
        await runGit(root, on, commitSteps(message));
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${String(e)}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  private row(f: FileChange, t: Colors) {
    const parts = f.path.split("/"), name = parts.pop();
    return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(this.selected === f.path, el => el.bg(t["selected"]!)).hover(s => s.bg(t["hover"]!)).on_click((_e, cx) => this.show(f.path, cx))
      .child(div().w(14).text_size(11).text_color(statColor(f.status, t)).child(f.status))
      .child(h_flex().flex_1().min_w(0).child(div().text_color(t["dim"]!).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name ?? "")))
      .when(f.add > 0, el => el.child(figure(`+${f.add}`, t["ansi2"]!))).when(f.del > 0, el => el.child(figure(`−${f.del}`, t["ansi1"]!)));
  }

  private list(t: Colors) {
    return v_flex().id("changes-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.files.map(f => this.row(f, t)))
      .when(!this.files.length, el => el.child(div().p(8).text_color(t["dim"]!).child(emptyMessage({ error: this.error, loading: this.loading, root: this.root }))));
  }

  private commitBox(t: Colors) {
    const enabled = this.ready();
    return h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t["border"]!)
      .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t["accent"]! : t["border"]!).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t["foreground"]!)))
      .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t["solid"]! : t["raised"]!).text_color(enabled ? t["solid_foreground"]! : t["dim"]!).text_size(12).when(enabled, el => el.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit"));
  }

  override render(cx: Context) {
    if (key() !== this.context) this.refresh(cx);
    const t = colorsOf(theme());
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t["background"]!).border_1().border_color(t["border"]!).text_color(t["foreground"]!).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(header(this.files, t))
      .child(this.list(t))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t["dim"]!).child("Showing the first 1,000 changed files")))
      .when(Boolean(this.note), el => el.child(div().px(10).pb(8).text_size(11).text_color(t["ansi1"]!).child(this.note ?? "")))
      .child(this.commitBox(t));
  }
}
