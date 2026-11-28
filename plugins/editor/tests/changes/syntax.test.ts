import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Row } from "../../src/changes/diff.ts";
import hljs from "@highlightjs/cdn-assets/es/highlight.js";
import { syntaxLines, syntaxPalette, sideTexts, type SyntaxSpan } from "../../src/changes/syntax.ts";

const joined = (line: SyntaxSpan[]): string => line.map((s) => s.text).join("");
const colorOf = (line: SyntaxSpan[], text: string) => line.find((s) => s.text === text)?.color;

function lines(text: string, path: string): SyntaxSpan[][] {
  const result = syntaxLines(hljs, text, path);
  assert.deepEqual(result.map(joined), text.split("\n"), "each line's spans join back to the line");
  return result;
}

describe("syntaxLines", () => {
  it("colors a TypeScript sample by the editor's names", () => {
    const [first, second] = lines('const n: number = 1; // x\nfunction f() { return "s"; }', "src/a.ts");
    assert.ok(first && second);
    assert.equal(colorOf(first, "const"), "keyword");
    assert.equal(colorOf(first, "1"), "number");
    assert.equal(colorOf(first, "// x"), "comment");
    assert.equal(colorOf(second, "function"), "keyword");
    assert.equal(colorOf(second, "return"), "keyword");
    assert.equal(colorOf(second, '"s"'), "string");
    assert.equal(colorOf(second, "f"), "function");
  });

  it("colors a PHP keyword and variable", () => {
    const [line] = lines("<?php $a = new Foo();", "x.php");
    assert.ok(line);
    assert.equal(colorOf(line, "new"), "keyword");
    assert.equal(colorOf(line, "$a"), "variable");
    assert.equal(colorOf(line, "Foo"), "type");
  });

  it("colors every line of a multi-line comment", () => {
    const result = lines("/* one\ntwo\nthree */", "a.js");
    assert.deepEqual(result.map((l) => l.map((s) => s.color)), [["comment"], ["comment"], ["comment"]]);
  });

  it("round-trips escaped characters and quotes", () => {
    const [line] = lines(`a < b && c > "d" + 'e'`, "a.js");
    assert.ok(line);
    assert.equal(colorOf(line, `"d"`), "string");
  });

  it("gives an empty text one line with no colored span", () => {
    const result = lines("", "a.ts");
    assert.equal(result.length, 1);
    assert.equal(joined(result[0] ?? []), "");
  });

  it("keeps a final empty line after a trailing newline", () => {
    const result = lines("let a = 1;\n", "a.ts");
    assert.equal(result.length, 2);
  });

  it("keeps a carriage return inside the line text", () => {
    const result = lines("let a = 1;\r\nlet b = 2;\r\n", "a.ts");
    assert.equal(result.length, 3);
    assert.ok(joined(result[0] ?? []).endsWith("\r"));
  });

  it("leaves an unknown or missing extension uncolored without calling highlight", () => {
    const calls: string[] = [];
    const spy = {
      getLanguage: (name: string) => hljs.getLanguage(name),
      highlight: (...args: Parameters<typeof hljs.highlight>) => {
        calls.push(String(args[1]));
        return hljs.highlight(...args);
      },
    };
    for (const path of ["x.unknownext", "Makefile", "dir.d/LICENSE", ".gitignore"]) {
      const result = syntaxLines(spy, "a b\nc", path);
      assert.deepEqual(result, [[{ text: "a b" }], [{ text: "c" }]], path);
    }
    assert.deepEqual(calls, []);
  });

  it("colors an escape inside a string with the escape name and the rest with the string name", () => {
    const [line] = lines("let c = '\\n';", "a.rs");
    assert.ok(line);
    assert.equal(colorOf(line, "\\n"), "string.escape");
    assert.deepEqual(line.filter((s) => s.color === "string").map((s) => s.text), ["'", "'"]);
  });

  it("colors an interpolation inside a template literal apart from the literal around it", () => {
    const [line] = lines("`a${x}b`", "a.ts");
    assert.deepEqual(line, [{ text: "`a", color: "string" }, { text: "${x}", color: "string.escape" }, { text: "b`", color: "string" }]);
  });

  it("leaves a class with no mapping uncolored and keeps colored children inside it", () => {
    const [line] = lines('<a href="x">t</a>', "a.html");
    assert.ok(line);
    assert.equal(colorOf(line, "a"), undefined);
    assert.equal(colorOf(line, "<"), undefined);
    assert.equal(colorOf(line, "href"), "constant");
    assert.equal(colorOf(line, '"x"'), "string");
  });

  it("gives an unmapped class inside a colored one its parent's color", () => {
    const [line] = lines("/** @param x */", "a.ts");
    assert.equal(colorOf(line ?? [], "@param"), "comment");
  });

  it("maps a built-in name to the type color", () => {
    const [line] = lines("let n: number = 1;", "a.ts");
    assert.equal(colorOf(line ?? [], "number"), "type");
  });

  it("maps a class name to the type color", () => {
    const [line] = lines("new Map();", "a.ts");
    assert.equal(colorOf(line ?? [], "Map"), "type");
  });

  it("finds the language by a case-insensitive extension", () => {
    const [line] = lines("let a = 1;", "A.TS");
    assert.equal(colorOf(line ?? [], "let"), "keyword");
  });
});

describe("syntaxPalette", () => {
  const theme = { ansi1: "#010101", ansi2: "#020202", ansi3: "#030303", ansi4: "#040404", ansi5: "#050505", ansi6: "#060606", dim: "#0d0d0d", muted: "#0e0e0e", foreground: "#0f0f0f" };

  it("palette maps each name to the same theme key as the editor", () => {
    assert.deepEqual(syntaxPalette(theme), {
      keyword: "#050505", string: "#020202", comment: "#0d0d0d", function: "#040404", type: "#030303", number: "#010101", constant: "#060606",
      variable: "#0f0f0f", operator: "#060606", punctuation: "#0e0e0e", boolean: "#030303", "string.escape": "#060606",
    });
  });

  it("palette leaves out a name whose theme key is missing", () => {
    const { ansi5: _gone, ...rest } = theme;
    const palette = syntaxPalette(rest);
    assert.equal("keyword" in palette, false);
    assert.equal(palette.string, "#020202");
  });

  it("palette leaves out a name whose theme value is not hex", () => {
    const palette = syntaxPalette({ ...theme, ansi5: "magenta", ansi2: "#12" });
    assert.equal("keyword" in palette, false);
    assert.equal("string" in palette, false);
    assert.equal(palette.number, "#010101");
  });

  it("palette accepts short hex values", () => {
    const palette = syntaxPalette({ ansi5: "#abc", ansi2: "#abcd", ansi1: "#abcde" });
    assert.equal(palette.keyword, "#abc");
    assert.equal(palette.string, "#abcd");
    assert.equal("number" in palette, false);
  });
});

describe("sideTexts", () => {
  const cell = (line: number, text: string) => ({ line, text });
  const rows: Row[] = [
    { kind: "same", left: cell(1, "a"), right: cell(1, "a") },
    { kind: "change", block: 0, left: cell(2, "old"), right: cell(2, "new") },
    { kind: "change", block: 0, right: cell(3, "extra") },
    { kind: "same", left: cell(3, "z"), right: cell(4, "z") },
  ];

  it("side text rebuilds the old and the new file from same and change rows", () => {
    assert.deepEqual(sideTexts(rows), { old: "a\nold\nz", new: "a\nnew\nextra\nz" });
  });

  it("side text leaves the old side empty for an added file", () => {
    const added: Row[] = [{ kind: "change", block: 0, right: cell(1, "x") }, { kind: "change", block: 0, right: cell(2, "y") }];
    assert.deepEqual(sideTexts(added), { old: "", new: "x\ny" });
  });

  it("side text leaves the new side empty for a deleted file", () => {
    const deleted: Row[] = [{ kind: "change", block: 0, left: cell(1, "x") }, { kind: "change", block: 0, left: cell(2, "y") }];
    assert.deepEqual(sideTexts(deleted), { old: "x\ny", new: "" });
  });

  it("side text leaves a blank line where the cells skip a line number", () => {
    const gap: Row[] = [{ kind: "same", left: cell(1, "a"), right: cell(1, "a") }, { kind: "same", left: cell(3, "b"), right: cell(3, "b") }];
    assert.deepEqual(sideTexts(gap), { old: "a\n\nb", new: "a\n\nb" });
  });

  it("side text keeps blank lines between cells in place", () => {
    const blank: Row[] = [{ kind: "same", left: cell(1, "a"), right: cell(1, "a") }, { kind: "same", left: cell(2, ""), right: cell(2, "") }, { kind: "same", left: cell(3, "b"), right: cell(3, "b") }];
    assert.deepEqual(sideTexts(blank), { old: "a\n\nb", new: "a\n\nb" });
  });
});
