// A lazy file browser for the focused pane's folder; a click on a file opens it in an editor pane.
import { View, div, svg } from "gpui-kit";
import type { Context, AsyncContext, Element } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, run, shared, watchFolder, theme, window } from "herdr";
import { openTarget, treeLocation, gitMarks, parseDirectory, limitEntries, TOTAL, type Entry, type Location, type TreeClaims } from "./tree.ts";

type Hex = `#${string}`;
type Colors = Record<string, Hex>;

const colorsOf = (t: Record<string, string>): Colors =>
  Object.fromEntries(Object.entries(t).map(([name, v]) => [name, v.startsWith("#") ? (v as Hex) : "#808080"]));

export default class Files extends View {
  private entries = new Map<string, Entry[]>();
  private folders = new Set<string>();
  private pending = new Set<string>();
  private marks: Record<string, string> = {};
  private context: string | undefined;
  private root: string | undefined;
  private on: string | null = null;
  private watched: string | null | undefined;
  private loading = false;
  private limited = false;
  private error: string | null = null;

  override init(_props: unknown, cx: AsyncContext): void {
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  /** The folder and machine the focused pane works in; the tree keeps its own while an editor pane has focus. */
  private location(): Location {
    const f = focused();
    const pane = f?.pane ? panes().find(p => p.pane === f.pane) : undefined;
    const previous = this.root !== undefined ? { cwd: this.root, on: this.on } : undefined;
    return treeLocation({ pane, focused: f, space: spaces().find(s => s.active), previous });
  }

  private key(): string { return JSON.stringify(this.location()); }

  private async directory(path: string, on: string | null): Promise<Entry[]> {
    if (!on && window()?.platform === "windows") {
      const r = await exec("powershell", ["-NoProfile", "-Command", "& { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)) } }) | ConvertTo-Json -Compress }", path]);
      if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
      const result: Entry | Entry[] = JSON.parse(r.stdout || "[]");
      return Array.isArray(result) ? result : [result];
    }
    const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ] && [ ! -L "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
    const r = await exec("sh", ["-c", script, "files", path], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    return parseDirectory(r.stdout);
  }

  private watch(root: string, cx: AsyncContext): void {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async cx => {
      try { while (this.watched === root) { await watchFolder(root); if (this.watched === root) this.refresh(cx); } }
      catch { if (this.watched === root) this.watched = null; }
    });
  }

  private async loadFolder(path: string, context: string): Promise<void> {
    const on = this.on, root = this.root;
    if (root === undefined) return;
    const listed = await this.directory(path ? `${root}/${path}` : root, on);
    if (this.key() !== context || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    const { entries, limited } = limitEntries(listed, used);
    this.entries.set(path, entries);
    if (limited) this.limited = true;
  }

  private refresh(cx: AsyncContext): void {
    if (this.loading) return;
    const { cwd, on } = this.location(), context = this.key();
    if (context !== this.context) {
      this.context = context; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set();
      this.pending = new Set(); this.marks = {}; this.watched = null; this.error = null; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) await this.loadFolder(path, context);
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        let marks: Record<string, string> = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal"], { cwd, on }).catch(() => null);
          if (status?.code === 0) marks = gitMarks(top.stdout, status.stdout);
        }
        if (this.key() !== context) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  private toggle(path: string, cx: Context): void {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context ?? "";
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.key() === context) this.error = String(e); }
          finally { this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  /** Opens the file in the editor pane that already shows it in the focused tab, else in a new editor pane right of the focused pane. */
  private open(path: string, cx: Context): void {
    const f = focused();
    if (!f || this.root === undefined) return;
    const full = `${this.root}/${path}`;
    const claims = (shared("editor.claims") ?? {}) as TreeClaims;
    const target = openTarget({ panes: panes(), claims, focused: { tab: f.tab, pane: f.pane }, path: full, on: this.on });
    const props = { path: full, on: this.on };
    try {
      if (target.kind === "focus") run("pane.focus", { pane: target.pane });
      else if (target.kind === "split") run("pane.split", { direction: "right", pane: target.pane, mod: "editor", props });
      else run("tab.new", { mod: "editor", props });
    } catch (e) { this.error = String(e); cx.notify(); }
  }

  private rows(prefix: string, depth: number, out: Element[], t: Colors): Element[] {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t["hover"]!))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.open(path, cx))
        .child(entry.dir ? svg(`mods/my-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t["dim"]!) : div().w(12).flex_none())
        .child(svg(`mods/my-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t["muted"]!))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t["ansi2"]! : mark === "D" || mark === "U" ? t["ansi1"]! : t["blocked"]!).child(mark ?? ""))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  override render(cx: Context): Element {
    if (this.key() !== this.context) this.refresh(cx);
    const t = colorsOf(theme());
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t["background"]!).border_1().border_color(t["border"]!).text_color(t["foreground"]!).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t["border"]!)
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t["dim"]!).child(this.root?.split(/[\\/]/).pop() ?? "")))
      .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t["dim"]!).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t["dim"]!).child("File list limited to 500 entries per folder and 5,000 total"))));
  }
}
