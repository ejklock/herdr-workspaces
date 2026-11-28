import type { DisplayRow } from "./rows.ts";
import type { SyntaxName, SyntaxSpan } from "./syntax.ts";

export type Span = { text: string; changed: boolean };
/** A run of text with one syntax color and one changed flag. */
export type Segment = { text: string; color?: SyntaxName; changed: boolean };

/** The word spans of a row that pairs a removed line with an added one; every other row keeps its whole-line tint. */
export function rowSpans(row: DisplayRow): { left: Span[]; right: Span[] } | undefined {
  if (row.kind !== "change" || !row.left || !row.right) return undefined;
  return wordSpans(row.left.text, row.right.text);
}

/** Past this many tokens on a side the table costs more than the highlight is worth. */
const MAX_TOKENS = 400;

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^]/gu;
const isSpace = (token: string): boolean => /^\s/u.test(token);

/**
 * Splits a removed line and the added line paired with it into spans that mark the
 * words that differ. Returns undefined when the highlight would mislead or cost too
 * much (a side over the token cap, or two non-empty sides sharing nothing but
 * whitespace), so the caller keeps its whole-line tint.
 */
export function wordSpans(left: string, right: string): { left: Span[]; right: Span[] } | undefined {
  const a = left.match(TOKEN) ?? [];
  const b = right.match(TOKEN) ?? [];
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return undefined;

  const common = commonTokens(a, b);
  if (a.length > 0 && b.length > 0 && !common.left.some((kept, i) => kept && !isSpace(a[i] ?? ""))) return undefined;

  return { left: toSpans(a, common.left), right: toSpans(b, common.right) };
}

/** Longest common subsequence over two token lists; marks which tokens of each side belong to it. */
function commonTokens(a: string[], b: string[]): { left: boolean[]; right: boolean[] } {
  return walkTable(a, b, lengthTable(a, b));
}

/** Suffix table: cell (i, j) holds the common subsequence length of a[i..] and b[j..], in row-major order. */
function lengthTable(a: string[], b: string[]): Uint16Array {
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  return table;
}

/** Walks the table from the start, keeping equal tokens and stepping past the side with the longer remainder. */
function walkTable(a: string[], b: string[], table: Uint16Array): { left: boolean[]; right: boolean[] } {
  const width = b.length + 1;
  const left = new Array<boolean>(a.length).fill(false);
  const right = new Array<boolean>(b.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      left[i++] = true;
      right[j++] = true;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i++;
    else j++;
  }
  return { left, right };
}

/** A whitespace run between two changed tokens is changed too, then equal neighbours merge. */
function toSpans(tokens: string[], kept: boolean[]): Span[] {
  const spans: Span[] = [];
  tokens.forEach((text, i) => {
    const bridged = isSpace(text) && kept[i] === true && kept[i - 1] === false && kept[i + 1] === false;
    const changed = !kept[i] || bridged;
    const last = spans[spans.length - 1];
    if (last && last.changed === changed) last.text += text;
    else spans.push({ text, changed });
  });
  return spans;
}

/**
 * Cuts a line's syntax spans at every boundary of its word spans, so each segment keeps its syntax color
 * and says whether its words changed. Word spans that do not join to the line, or none, leave every segment unchanged.
 */
export function mergeSpans(syntax: readonly SyntaxSpan[], words: readonly Span[] | undefined): Segment[] {
  const line = syntax.map(span => span.text).join("");
  const cuts = words?.filter(word => word.text !== "");
  const usable = cuts && cuts.map(word => word.text).join("") === line ? cuts : undefined;
  const segments: Segment[] = [];
  let word = 0;
  let used = 0;
  for (const span of syntax) {
    let at = 0;
    while (at < span.text.length) {
      const current = usable?.[word];
      const take = Math.min(current ? current.text.length - used : Infinity, span.text.length - at);
      const base = { text: span.text.slice(at, at + take), changed: current?.changed === true };
      segments.push(span.color === undefined ? base : { ...base, color: span.color });
      at += take;
      used += take;
      if (current && used === current.text.length) { word++; used = 0; }
    }
  }
  return segments;
}

const MAX_PIECE = 40;

/** Each span cut after every whitespace run and into chunks of at most 40 characters, so a line can break between pieces and a long token still wraps; the pieces join back to the line. */
export function wrapPieces<T extends { text: string }>(spans: readonly T[]): T[] {
  return spans.flatMap(span => (span.text.match(/\S*\s+|\S+/gu) ?? []).flatMap(piece => chunks(piece).map(text => ({ ...span, text }))));
}

// Counted in code points, so an emoji or another character outside the basic plane is never split in half.
// A sequence of several code points, such as a flag or a joined emoji, can still fall across two chunks.
const CHUNK = new RegExp(`[^]{1,${MAX_PIECE}}`, "gu");

function chunks(piece: string): string[] {
  return piece.match(CHUNK) ?? [];
}
