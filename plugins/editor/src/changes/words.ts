import type { DisplayRow } from "./rows.ts";

export type Span = { text: string; changed: boolean };

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

/** Each span cut after every whitespace run, so a highlighted line can break between pieces; the pieces join back to the line. */
export function wrapPieces(spans: readonly Span[]): Span[] {
  return spans.flatMap(({ text, changed }) => (text.match(/\S*\s+|\S+/gu) ?? []).map(piece => ({ text: piece, changed })));
}
