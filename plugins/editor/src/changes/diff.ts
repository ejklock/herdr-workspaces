/** One side of a row: the line number on that side and the line's text. */
export type Cell = { line: number; text: string };
/** A change row has no cell on the side that has no line; `block` numbers the change blocks in order. */
export type Row =
  | { kind: "same"; left: Cell; right: Cell }
  | { kind: "change"; block: number; left?: Cell; right?: Cell };
export type ParseResult = { ok: true; rows: Row[] } | { ok: false; line: string; reason: string };
export type Segment =
  | { kind: "visible"; start: number; rows: Row[] }
  | { kind: "hidden"; id: number; count: number }
  | { kind: "expanded"; id: number; rows: Row[] };

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MIN_HIDDEN = 3;

type Hunk = { header: string; oldLeft: number; newLeft: number; oldNo: number; newNo: number };
type ParseState = { rows: Row[]; hunk: Hunk | undefined; removed: Cell[]; added: Cell[]; block: number };

const fail = (line: string, reason: string): ParseResult => ({ ok: false, line, reason });

/** Emits the pending removed and added lines as change rows, pairing the i-th of each. */
function flushChange(state: ParseState): void {
  const { removed, added } = state;
  const height = Math.max(removed.length, added.length);
  for (let i = 0; i < height; i++) {
    const left = removed[i];
    const right = added[i];
    state.rows.push({ kind: "change", block: state.block, ...(left && { left }), ...(right && { right }) });
  }
  if (height > 0) state.block++;
  state.removed = [];
  state.added = [];
}

/** A header line opens a hunk only before the first hunk or once the previous one has consumed all its counted lines. */
function opensHunk(line: string, hunk: Hunk | undefined): boolean {
  if (!line.startsWith("@@")) return false;
  return !hunk || (hunk.oldLeft === 0 && hunk.newLeft === 0);
}

function parseHunkHeader(line: string): Hunk | undefined {
  const m = HUNK_HEADER.exec(line);
  if (!m) return undefined;
  return { header: line, oldLeft: Number(m[2] ?? 1), newLeft: Number(m[4] ?? 1), oldNo: Number(m[1]), newNo: Number(m[3]) };
}

function addSameRow(state: ParseState, hunk: Hunk, text: string): void {
  flushChange(state);
  state.rows.push({ kind: "same", left: { line: hunk.oldNo++, text }, right: { line: hunk.newNo++, text } });
  hunk.oldLeft--;
  hunk.newLeft--;
}

/** Moves one counted hunk body line into the state; false when the line's kind has no count left. */
function acceptHunkLine(state: ParseState, hunk: Hunk, first: string | undefined, text: string): boolean {
  if (first === " " && hunk.oldLeft > 0 && hunk.newLeft > 0) {
    addSameRow(state, hunk, text);
  } else if (first === "-" && hunk.oldLeft > 0) {
    state.removed.push({ line: hunk.oldNo++, text });
    hunk.oldLeft--;
  } else if (first === "+" && hunk.newLeft > 0) {
    state.added.push({ line: hunk.newNo++, text });
    hunk.newLeft--;
  } else {
    return false;
  }
  return true;
}

/** Applies one hunk body line to the state; returns a failure when the line does not fit the hunk. */
function applyHunkLine(state: ParseState, hunk: Hunk, line: string): ParseResult | undefined {
  const first = line[0];
  if (first === "\\" || acceptHunkLine(state, hunk, first, line.slice(1))) return undefined;
  return fail(line, " -+".includes(first ?? "x") ? "hunk longer than its header counts" : "unexpected line in hunk");
}

/** Handles one diff line: a header opens a hunk, a body line joins the open hunk, anything before the first hunk is skipped. */
function applyLine(state: ParseState, line: string): ParseResult | undefined {
  if (opensHunk(line, state.hunk)) {
    flushChange(state);
    state.hunk = parseHunkHeader(line);
    return state.hunk ? undefined : fail(line, "malformed hunk header");
  }
  return state.hunk ? applyHunkLine(state, state.hunk, line) : undefined;
}

/**
 * Side-by-side rows of a unified diff. Lines before the first hunk header are ignored; inside a hunk only a line's first character decides its kind.
 * Within a change block the i-th removed line shares a row with the i-th added line.
 */
export function parseDiff(text: string): ParseResult {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const state: ParseState = { rows: [], hunk: undefined, removed: [], added: [], block: 0 };

  for (const line of lines) {
    const failure = applyLine(state, line);
    if (failure) return failure;
  }
  flushChange(state);
  const { hunk } = state;
  if (hunk && (hunk.oldLeft !== 0 || hunk.newLeft !== 0)) return fail(hunk.header, "hunk shorter than its header counts");
  return { ok: true, rows: state.rows };
}

/** Marks every change row and the rows within `context` of one. */
function keepMask(rows: readonly Row[], context: number): boolean[] {
  const keep = rows.map(r => r.kind === "change");
  rows.forEach((r, i) => {
    if (r.kind !== "change") return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = true;
  });
  return keep;
}

function pushRun(segments: Segment[], run: Row[], start: number, shown: boolean, expanded: ReadonlySet<number>): void {
  if (shown || run.length < MIN_HIDDEN) {
    const last = segments.at(-1);
    if (last?.kind === "visible") for (const row of run) last.rows.push(row);
    else segments.push({ kind: "visible", start, rows: run });
  } else if (expanded.has(start)) {
    segments.push({ kind: "expanded", id: start, rows: run });
  } else {
    segments.push({ kind: "hidden", id: start, count: run.length });
  }
}

/**
 * Visible segments and hidden blocks. An unchanged row stays visible within `context` rows of a change; a run that would hide fewer than three rows stays visible.
 * A hidden block's id is the index of its first row; an id in `expanded` shows its rows instead.
 */
export function foldRows(rows: readonly Row[], context: number, expanded: ReadonlySet<number>): Segment[] {
  const keep = keepMask(rows, context);
  const segments: Segment[] = [];
  let i = 0;
  while (i < rows.length) {
    let end = i;
    while (end < rows.length && keep[end] === keep[i]) end++;
    pushRun(segments, rows.slice(i, end), i, keep[i] === true, expanded);
    i = end;
  }
  return segments;
}

/** Row indexes where each change block begins, in order. */
export function changeStarts(rows: readonly Row[]): number[] {
  const starts: number[] = [];
  let previous: number | undefined;
  rows.forEach((row, i) => {
    const block = row.kind === "change" ? row.block : undefined;
    if (block !== undefined && block !== previous) starts.push(i);
    previous = block;
  });
  return starts;
}
