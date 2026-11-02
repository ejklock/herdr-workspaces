import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { editorFontSize, syntaxColors } from "../../src/editor/language.ts";

const graphite: Record<string, string> = {
  ansi1: "#e06c75", ansi2: "#98c379", ansi3: "#e5c07b", ansi4: "#61afef", ansi5: "#c678dd", ansi6: "#56b6c2",
  dim: "#5c6370", muted: "#7f848e", foreground: "#abb2bf", border: "#ffffff18",
};

const expected: Record<string, string> = {
  keyword: "#c678dd", string: "#98c379", comment: "#5c6370", function: "#61afef", type: "#e5c07b", number: "#e06c75",
  constant: "#56b6c2", variable: "#abb2bf", operator: "#56b6c2", punctuation: "#7f848e", boolean: "#e5c07b", "string.escape": "#56b6c2",
};

describe("syntaxColors", () => {
  it("maps all twelve semantic keys from the theme", () => {
    assert.deepEqual(syntaxColors(graphite), expected);
  });

  it("leaves out the keys whose theme color is missing when ansi6 is absent", () => {
    const { ansi6: _omitted, ...theme } = graphite;
    const colors = syntaxColors(theme);
    for (const key of ["constant", "operator", "string.escape"]) assert.equal(key in colors, false, key);
    assert.equal(Object.keys(colors).length, 9);
  });

  it("leaves out punctuation and variable when muted and foreground are absent", () => {
    const { muted: _m, foreground: _f, ...theme } = graphite;
    const colors = syntaxColors(theme);
    assert.equal("punctuation" in colors, false);
    assert.equal("variable" in colors, false);
    assert.equal(Object.keys(colors).length, 10);
  });

  it("returns an empty object for an empty theme", () => {
    assert.deepEqual(syntaxColors({}), {});
  });
});

describe("editorFontSize", () => {
  it("returns the setting when it is a finite number above zero", () => {
    assert.equal(editorFontSize({ font_size: 14 }), 14);
    assert.equal(editorFontSize({ font_size: 15.5 }), 15.5);
    assert.equal(editorFontSize({ font_size: 1 }), 1);
  });

  it("falls back to 12 for a missing or unusable setting", () => {
    const bad: unknown[] = [0, -3, NaN, Infinity, "14", null];
    assert.equal(editorFontSize({}), 12);
    for (const value of bad) assert.equal(editorFontSize({ font_size: value }), 12, String(value));
  });
});
