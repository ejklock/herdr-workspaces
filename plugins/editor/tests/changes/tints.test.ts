import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffTints } from "../../src/changes/tints.ts";

const theme = { ansi1: "#e06c75", ansi2: "#98c379", foreground: "#abb2bf", background: "#ffffff" };
const darkPalette = {
  removed: { line: "#380701", word: "#5f0e04" },
  added: { line: "#0b2700", word: "#194302" },
  filler: "#abb2bf14",
};

describe("diffTints", () => {
  it("derives line, word and filler tints from the theme hues", () => {
    assert.deepEqual(diffTints(theme), {
      removed: { line: "#e06c754D", word: "#e06c7559" },
      added: { line: "#98c3794D", word: "#98c37959" },
      filler: "#abb2bf14",
    });
  });

  it("keeps the digits of an uppercase value", () => {
    assert.equal(diffTints({ ...theme, ansi1: "#E06C75" }).removed.line, "#E06C754D");
  });

  it("expands a short hex", () => {
    assert.equal(diffTints({ ...theme, ansi1: "#abc" }).removed.word, "#aabbcc59");
  });

  it("replaces an alpha already present", () => {
    assert.equal(diffTints({ ...theme, ansi1: "#e06c7580" }).removed.line, "#e06c754D");
  });

  for (const bad of [undefined, "", "rgb(1,2,3)", "red", "#12", "#1234567"]) {
    it(`falls back to grey for ${JSON.stringify(bad)}`, () => {
      const colors: Record<string, string> = { ansi2: "#98c379", foreground: "#abb2bf", background: "#ffffff" };
      if (bad !== undefined) colors["ansi1"] = bad;
      assert.equal(diffTints(colors).removed.line, "#8080804D");
    });
  }

  it("falls back to grey for a missing foreground", () => {
    assert.equal(diffTints({ background: "#ffffff" }).filler, "#80808014");
  });

  for (const background of ["#21252b", "#121720", "#bbbbbb", undefined, "not-a-color"]) {
    it(`paints the solid dark palette on background ${JSON.stringify(background)}`, () => {
      const colors: Record<string, string> = { ansi1: "#e06c75", ansi2: "#98c379", foreground: "#abb2bf" };
      if (background !== undefined) colors["background"] = background;
      assert.deepEqual(diffTints(colors), darkPalette);
    });
  }

  for (const background of ["#ffffff", "#fafafa", "#bcbcbc", "#fff"]) {
    it(`derives the tints from the theme on background ${background}`, () => {
      assert.deepEqual(diffTints({ ...theme, background }), {
        removed: { line: "#e06c754D", word: "#e06c7559" },
        added: { line: "#98c3794D", word: "#98c37959" },
        filler: "#abb2bf14",
      });
    });
  }
});
