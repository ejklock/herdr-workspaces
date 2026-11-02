import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { wordSpans, rowSpans, type Span } from "../../src/changes/words.ts";
import type { DisplayRow } from "../../src/changes/rows.ts";

const joined = (spans: Span[]): string => spans.map((s) => s.text).join("");
const changed = (spans: Span[]): string[] => spans.filter((s) => s.changed).map((s) => s.text);

function spansOf(left: string, right: string): { left: Span[]; right: Span[] } {
  const result = wordSpans(left, right);
  assert.ok(result, "expected spans");
  assert.equal(joined(result.left), left);
  assert.equal(joined(result.right), right);
  for (const side of [result.left, result.right]) {
    side.forEach((span, i) => {
      if (i > 0) assert.notEqual(span.changed, side[i - 1]?.changed, "adjacent spans share a flag");
    });
  }
  return result;
}

describe("wordSpans changed words", () => {
  it("marks only the renamed identifier on each side", () => {
    const r = spansOf("const a = 1;", "const b = 1;");
    assert.deepEqual(changed(r.left), ["a"]);
    assert.deepEqual(changed(r.right), ["b"]);
  });

  it("marks an added argument on the right and nothing on the left", () => {
    const r = spansOf("foo(x)", "foo(x, y)");
    assert.deepEqual(changed(r.left), []);
    assert.deepEqual(changed(r.right), [", y"]);
  });

  it("marks a word appended at the end", () => {
    const r = spansOf("let total", "let total now");
    assert.deepEqual(changed(r.left), []);
    assert.deepEqual(changed(r.right), [" now"]);
  });

  it("marks a word removed from the middle as one span", () => {
    const r = spansOf("one two three", "one three");
    assert.deepEqual(changed(r.left), ["two "]);
    assert.deepEqual(changed(r.right), []);
  });

  it("keeps non-ASCII letters inside one word", () => {
    const r = spansOf("naïve café", "naïve cafés");
    assert.deepEqual(changed(r.left), ["café"]);
    assert.deepEqual(changed(r.right), ["cafés"]);
  });

  it("marks nothing for identical text", () => {
    const r = spansOf("same text", "same text");
    assert.deepEqual(changed(r.left), []);
    assert.deepEqual(changed(r.right), []);
  });

  it("marks the whole right when the left is empty", () => {
    const r = spansOf("", "added line");
    assert.deepEqual(r.left, []);
    assert.deepEqual(r.right, [{ text: "added line", changed: true }]);
  });

  it("marks a whitespace-only change", () => {
    const r = spansOf("a  b", "a b");
    assert.deepEqual(changed(r.left), ["  "]);
    assert.deepEqual(changed(r.right), [" "]);
  });
});

describe("wordSpans skipped highlights", () => {
  /** n tokens of "a" and single spaces: one word is 1 token, each further word adds 2. */
  const tokens = (n: number): string => `${"a ".repeat(Math.floor(n / 2))}${n % 2 === 1 ? "a" : ""}`;

  it("gives spans at exactly 400 tokens on a side", () => {
    assert.ok(wordSpans(tokens(400), "a b"));
    assert.ok(wordSpans("a b", tokens(400)));
  });

  it("gives undefined at 401 tokens on a side", () => {
    assert.equal(wordSpans(tokens(401), "a b"), undefined);
    assert.equal(wordSpans("a b", tokens(401)), undefined);
  });

  it("gives undefined when only whitespace is shared", () => {
    assert.equal(wordSpans("abc", "xyz"), undefined);
  });

  it("gives spans when a word is shared", () => {
    const r = spansOf("a b", "x b");
    assert.deepEqual(changed(r.left), ["a"]);
    assert.deepEqual(changed(r.right), ["x"]);
  });

  it("gives empty span lists for two empty strings", () => {
    assert.deepEqual(wordSpans("", ""), { left: [], right: [] });
  });

  it("highlights a pair of 400 distinct-word tokens per side", () => {
    const words = (pick: (i: number) => string): string => `${Array.from({ length: 200 }, (_, i) => pick(i)).join(" ")} `;
    const r = spansOf(words((i) => `w${i}`), words((i) => (i % 7 === 0 ? `x${i}` : `w${i}`)));
    assert.equal(changed(r.left).length, 29);
    assert.equal(changed(r.right).length, 29);
  });

  it("gives undefined when two sides share only whitespace", () => {
    assert.equal(wordSpans("a b", "x y"), undefined);
  });

  it("marks two changed words and the whitespace between them as one span", () => {
    const r = spansOf("a x b", "a y z b");
    assert.deepEqual(changed(r.left), ["x"]);
    assert.deepEqual(r.right.map((s) => s.text), ["a ", "y z ", "b"]);
    assert.deepEqual(changed(r.right), ["y z "]);
  });
});

describe("rowSpans", () => {
  const cell = (text: string) => ({ line: 1, text });
  const change = (left?: string, right?: string): DisplayRow => ({
    kind: "change",
    block: 0,
    ...(left === undefined ? {} : { left: cell(left) }),
    ...(right === undefined ? {} : { right: cell(right) }),
  });

  it("gives the word spans of a change row with both sides", () => {
    const r = rowSpans(change("const a = 1;", "const b = 1;"));
    assert.ok(r, "expected spans");
    assert.deepEqual(changed(r.left), ["a"]);
    assert.deepEqual(changed(r.right), ["b"]);
  });

  it("gives undefined for a change row with only a removed side", () => {
    assert.equal(rowSpans(change("a")), undefined);
  });

  it("gives undefined for a change row with only an added side", () => {
    assert.equal(rowSpans(change(undefined, "a")), undefined);
  });

  it("gives undefined for an unchanged row", () => {
    assert.equal(rowSpans({ kind: "same", left: cell("x a"), right: cell("x b") }), undefined);
  });

  it("gives undefined for a hidden row", () => {
    assert.equal(rowSpans({ kind: "hidden", id: 1, label: "3 lines" }), undefined);
  });

  it("gives undefined when the two sides share only whitespace", () => {
    assert.equal(rowSpans(change("a b", "x y")), undefined);
  });

  it("gives undefined past the token cap on one side", () => {
    assert.equal(rowSpans(change(`a${" b".repeat(200)}`, "a")), undefined);
  });
});
