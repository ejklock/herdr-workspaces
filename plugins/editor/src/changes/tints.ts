// Diff row tints. A dark theme gets the solid palette of Claude Code's terminal diff, measured from a
// screenshot of it (the removed word color is estimated by scaling the removed line like the added
// pair); the colors are opaque, so a changed word replaces the line color under it. A light theme
// derives from its own hues: a changed line at 30% (0x4D), a changed word a further 35% (0x59)
// stacked on the line. On both, the empty side of a change row is an 8% (0x14) foreground wash
// standing in for its diagonal hatch, which gpui-kit cannot draw.
export type Hex = `#${string}`;
export type Tint = { line: Hex; word: Hex };
export type DiffTints = { removed: Tint; added: Tint; filler: Hex };

const LINE_ALPHA = "4D";
const WORD_ALPHA = "59";
const FILLER_ALPHA = "14";
const DARK = {
  removed: { line: "#380701", word: "#5f0e04" },
  added: { line: "#0b2700", word: "#194302" },
} as const satisfies Record<string, Tint>;
const DARK_MAX_LUMINANCE = 0.5;
const FALLBACK = "808080";

const rgb = (value: string | undefined): string => {
  const digits = value?.startsWith("#") ? value.slice(1) : "";
  if (!/^[0-9a-fA-F]+$/.test(digits)) return FALLBACK;
  if (digits.length === 3) return [...digits].map((d) => d + d).join("");
  return digits.length === 6 || digits.length === 8 ? digits.slice(0, 6) : FALLBACK;
};

const tint = (value: string | undefined): Tint => {
  const base = rgb(value);
  return { line: `#${base}${LINE_ALPHA}`, word: `#${base}${WORD_ALPHA}` };
};

const luminance = (base: string): number => {
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = parseInt(base.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

export const diffTints = (colors: Record<string, string>): DiffTints => {
  const filler: Hex = `#${rgb(colors["foreground"])}${FILLER_ALPHA}`;
  if (luminance(rgb(colors["background"])) <= DARK_MAX_LUMINANCE) return { ...DARK, filler };
  return { removed: tint(colors["ansi1"]), added: tint(colors["ansi2"]), filler };
};
