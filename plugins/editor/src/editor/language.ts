const LANG: Record<string, string> = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };

export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

export function languageFor(path: string): string {
  const name = baseName(path);
  const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "txt";
  return LANG[ext] ?? ext;
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

/** A file is Markdown by its extension; a dotfile such as `.md` has none. */
export function isMarkdown(path: string): boolean {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 && MARKDOWN_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export type FileView = "preview" | "source";

/** The view a file opens in: Markdown rendered, anything else as text. */
export function initialView(path: string): FileView {
  return isMarkdown(path) ? "preview" : "source";
}

export function syntaxColors(t: Record<string, string>): Record<string, string> {
  const colors = {
    keyword: t["ansi5"], string: t["ansi2"], comment: t["dim"], function: t["ansi4"], type: t["ansi3"], number: t["ansi1"], constant: t["ansi6"],
    variable: t["foreground"], operator: t["ansi6"], punctuation: t["muted"], boolean: t["ansi3"], "string.escape": t["ansi6"],
  };
  return Object.fromEntries(Object.entries(colors).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

const DEFAULT_FONT_SIZE = 12;

/** The owner's code font size in pixels; a missing or unusable setting falls back to the default. */
export function editorFontSize(settings: Record<string, unknown>): number {
  const size = settings["font_size"];
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : DEFAULT_FONT_SIZE;
}
