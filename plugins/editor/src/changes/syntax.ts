import type { Row } from "./diff.ts";

export type SyntaxName =
  | "keyword" | "string" | "comment" | "function" | "type" | "number"
  | "constant" | "variable" | "operator" | "punctuation" | "boolean" | "string.escape";

export type SyntaxSpan = { text: string; color?: SyntaxName };

/** The part of highlight.js this module calls; the caller supplies the library. */
export type Highlighter = {
  getLanguage(name: string): unknown;
  highlight(code: string, options: { language: string; ignoreIllegals: boolean }): { value: string };
};

const COLORS: Record<string, SyntaxName> = {
  keyword: "keyword", built_in: "type", type: "type", title: "function", string: "string", regexp: "string",
  subst: "string.escape", comment: "comment", doc: "comment", meta: "comment", number: "number", literal: "boolean",
  variable: "variable", params: "variable", attr: "constant", attribute: "constant", symbol: "constant",
  property: "variable", operator: "operator", punctuation: "punctuation",
};

// highlight.js 11 writes a scope with a modifier as separate words ("title function_", "char escape_"),
// so the class attribute is split into words and the modifier decides first.
function colorOfClass(classes: string): SyntaxName | undefined {
  const words = classes.split(/\s+/);
  if (words.includes("function_")) return "function";
  if (words.includes("class_")) return "type";
  if (words.includes("hljs-char") && words.includes("escape_")) return "string.escape";
  const scope = words.find((w) => w.startsWith("hljs-"))?.slice("hljs-".length) ?? "";
  return COLORS[scope];
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const plain = (lines: string[]): SyntaxSpan[][] => lines.map((line) => (line === "" ? [] : [{ text: line }]));

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Splits highlight.js's HTML (nested spans around escaped text) into lines of colored spans. A span
 * open across a newline keeps its color on every line it covers; an unmapped class inherits its parent's.
 */
function spansFromHtml(html: string): SyntaxSpan[][] {
  const result: SyntaxSpan[][] = [[]];
  const stack: (SyntaxName | undefined)[] = [];
  for (const match of html.matchAll(/<span class="([^"]*)">|<\/span>|[^<]+/g)) {
    const token = match[0];
    const classes = match[1];
    if (token === "</span>") {
      stack.pop();
    } else if (classes !== undefined) {
      stack.push(colorOfClass(classes) ?? stack[stack.length - 1]);
    } else {
      const color = stack[stack.length - 1];
      unescapeHtml(token).split("\n").forEach((piece, i) => {
        if (i > 0) result.push([]);
        if (piece !== "") result[result.length - 1]?.push(color === undefined ? { text: piece } : { text: piece, color });
      });
    }
  }
  return result;
}

/** One array of colored spans per line of `text`; the spans of a line join back to that line exactly. */
export function syntaxLines(hljs: Highlighter, text: string, path: string): SyntaxSpan[][] {
  const extension = extensionOf(path);
  if (extension === "" || !hljs.getLanguage(extension)) return plain(text.split("\n"));
  return spansFromHtml(hljs.highlight(text, { language: extension, ignoreIllegals: true }).value);
}

type Hex = `#${string}`;

// The editor draws the same names in the same colors (src/editor/language.ts); a mod cannot import another
// mod's folder, so the table is repeated here and the two stay in step by hand.
const PALETTE_KEYS: Record<SyntaxName, string> = {
  keyword: "ansi5", string: "ansi2", comment: "dim", function: "ansi4", type: "ansi3", number: "ansi1", constant: "ansi6",
  variable: "foreground", operator: "ansi6", punctuation: "muted", boolean: "ansi3", "string.escape": "ansi6",
};

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** The color of each syntax name from the theme; a name whose theme value is missing or not hex is left out. */
export function syntaxPalette(theme: Record<string, string>): Partial<Record<SyntaxName, Hex>> {
  const palette: Partial<Record<SyntaxName, Hex>> = {};
  for (const [name, key] of Object.entries(PALETTE_KEYS) as [SyntaxName, string][]) {
    const value = theme[key];
    if (value !== undefined && HEX.test(value)) palette[name] = value as Hex;
  }
  return palette;
}

/** The old and the new file rebuilt from the rows' cells, each placed by its line number; a side with no cells is empty. */
export function sideTexts(rows: readonly Row[]): { old: string; new: string } {
  const old: string[] = [];
  const next: string[] = [];
  for (const row of rows) {
    if (row.left) old[row.left.line - 1] = row.left.text;
    if (row.right) next[row.right.line - 1] = row.right.text;
  }
  const join = (lines: string[]): string => Array.from(lines, line => line ?? "").join("\n");
  return { old: join(old), new: join(next) };
}
