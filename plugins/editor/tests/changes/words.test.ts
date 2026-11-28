import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { wordSpans, rowSpans, wrapPieces, mergeSpans, type Span } from "../../src/changes/words.ts";
import type { DisplayRow } from "../../src/changes/rows.ts";
import type { SyntaxSpan } from "../../src/changes/syntax.ts";

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

describe("wrap pieces", () => {
  it("wrap pieces never split a character outside the basic plane across two chunks", () => {
    const text = "a" + "\u{1F600}".repeat(30);
    const pieces = wrapPieces([{ text, changed: false }]);
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    assert.equal(pieces.map(p => p.text).join(""), text);
    for (const piece of pieces) {
      assert.ok(!lone.test(piece.text), JSON.stringify(piece.text));
      assert.ok(Array.from(piece.text).length <= 40);
    }
    assert.deepEqual(pieces.map(p => Array.from(p.text).length), [31]);
  });

  const pieces = (spans: Span[]): [string, boolean][] => wrapPieces(spans).map((s) => [s.text, s.changed]);

  it("wrap pieces break an unchanged span after each whitespace run", () => {
    assert.deepEqual(pieces([{ text: "foo bar baz", changed: false }]), [["foo ", false], ["bar ", false], ["baz", false]]);
  });
  it("wrap pieces keep the changed flag of the span they come from", () => {
    assert.deepEqual(pieces([{ text: "a ", changed: false }, { text: "bb cc", changed: true }]), [["a ", false], ["bb ", true], ["cc", true]]);
  });
  it("wrap pieces split leading indentation from the first word", () => {
    assert.deepEqual(pieces([{ text: "    const x", changed: false }]), [["    ", false], ["const ", false], ["x", false]]);
  });
  it("wrap pieces cut a 100-character token into chunks of 40, 40 and 20", () => {
    assert.deepEqual(pieces([{ text: "x".repeat(100), changed: false }]).map(([t]) => t.length), [40, 40, 20]);
  });
  it("wrap pieces carry color and changed flag to every chunk and join back to the line", () => {
    const spans = [{ text: `ab ${"y".repeat(90)}`, changed: true, color: "string" as const }];
    const result = wrapPieces(spans);
    assert.deepEqual(result.map((s) => s.text.length), [3, 40, 40, 10]);
    assert.ok(result.every((s) => s.changed && s.color === "string"));
    assert.equal(result.map((s) => s.text).join(""), spans[0]?.text);
  });
  it("wrap pieces keep a 40-character piece whole and still break after whitespace", () => {
    assert.deepEqual(pieces([{ text: "z".repeat(40), changed: false }]).map(([t]) => t.length), [40]);
    assert.deepEqual(pieces([{ text: "ab cd", changed: false }]).map(([t]) => t), ["ab ", "cd"]);
  });
  it("wrap pieces leave a span with no whitespace whole", () => {
    assert.deepEqual(pieces([{ text: "word", changed: true }]), [["word", true]]);
  });
  it("wrap pieces of no spans are none, and an empty span draws nothing", () => {
    assert.deepEqual(pieces([]), []);
    assert.deepEqual(pieces([{ text: "", changed: true }]), []);
  });
  it("wrap pieces keep tabs and double spaces inside the piece they end", () => {
    assert.deepEqual(pieces([{ text: "a\t\tb", changed: false }]), [["a\t\t", false], ["b", false]]);
    assert.deepEqual(pieces([{ text: "a  b", changed: false }]), [["a  ", false], ["b", false]]);
  });
  it("wrap pieces join back to the original line", () => {
    const spans = [{ text: "  x = ", changed: false }, { text: "foo(a,  b)\t", changed: true }, { text: "end", changed: false }];
    assert.equal(joined(wrapPieces(spans)), joined(spans));
  });
});

describe("mergeSpans", () => {
  const syntax: SyntaxSpan[] = [
    { text: "const ", color: "keyword" }, { text: "x", color: "variable" }, { text: " = ", color: "operator" }, { text: "1", color: "number" },
  ];

  it("merges syntax and word spans into segments cut at every boundary of either", () => {
    const words: Span[] = [{ text: "const x = ", changed: false }, { text: "1", changed: true }];
    assert.deepEqual(mergeSpans(syntax, words), [
      { text: "const ", color: "keyword", changed: false },
      { text: "x", color: "variable", changed: false },
      { text: " = ", color: "operator", changed: false },
      { text: "1", color: "number", changed: true },
    ]);
  });

  it("merges a word boundary inside a syntax span into two segments that keep the color", () => {
    const words: Span[] = [{ text: "con", changed: false }, { text: "st x = 1", changed: true }];
    const segments = mergeSpans(syntax, words);
    assert.deepEqual(segments.slice(0, 2), [
      { text: "con", color: "keyword", changed: false },
      { text: "st ", color: "keyword", changed: true },
    ]);
    assert.equal(segments.map((s) => s.text).join(""), "const x = 1");
  });

  it("merges with no word spans into unchanged segments", () => {
    const segments = mergeSpans(syntax, undefined);
    assert.deepEqual(segments.map((s) => s.text), ["const ", "x", " = ", "1"]);
    assert.ok(segments.every((s) => !s.changed));
  });

  it("merges an empty line into no changed segment and no text", () => {
    assert.equal(mergeSpans([], []).map((s) => s.text).join(""), "");
    assert.ok(mergeSpans([], undefined).every((s) => !s.changed));
  });

  it("merges to segments whose texts join to the line", () => {
    const words: Span[] = [{ text: "c", changed: true }, { text: "onst x", changed: false }, { text: " = 1", changed: true }];
    assert.equal(mergeSpans(syntax, words).map((s) => s.text).join(""), "const x = 1");
  });

  it("merges word spans that do not join to the line by falling back to the syntax spans", () => {
    const segments = mergeSpans(syntax, [{ text: "other", changed: true }]);
    assert.deepEqual(segments.map((s) => s.text), ["const ", "x", " = ", "1"]);
    assert.ok(segments.every((s) => !s.changed));
  });

  it("merges a colorless span without a color key", () => {
    assert.deepEqual(mergeSpans([{ text: "ab" }], [{ text: "ab", changed: true }]), [{ text: "ab", changed: true }]);
  });
});
