import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isImage, previewName } from "../../src/editor/preview.ts";

describe("isImage", () => {
  const cases: [string, boolean][] = [
    ["/r/a.png", true], ["/r/Photo.JPEG", true], ["/r/logo.svg", true], ["/r/x.webp", true],
    ["/r/x.png.txt", false], ["/r/.png", false], ["/r/png", false], ["", false], ["/r/a.md", false],
  ];
  for (const [path, expected] of cases) it(`${JSON.stringify(path)} is ${expected ? "" : "not "}an image`, () => assert.equal(isImage(path), expected));
});

describe("previewName", () => {
  const shape = /^editor-preview\/[0-9a-z]+\.[a-z]+$/;

  it("gives the same path the same name", () => assert.equal(previewName("/r/a.png"), previewName("/r/a.png")));

  it("gives different paths different names", () => assert.notEqual(previewName("/r/a.png"), previewName("/s/a.png")));

  it("lowercases the source extension", () => assert.ok(previewName("/r/A.PNG").endsWith(".png")));

  it("names the copy img when the extension holds anything but letters and digits", () => {
    assert.ok(previewName("/r/x.a b").endsWith(".img"));
    assert.ok(previewName("/r/x.p\0g").endsWith(".img"));
  });

  for (const path of ["/r/x.a b", "/r/../../etc/x.png", "/r/my pic.png", "/r/line\nbreak.gif", "/r/fotó-ção.jpg", `/${"a".repeat(4000)}.png`])
    it(`keeps the name inside the preview folder for ${JSON.stringify(path.slice(0, 30))}`, () => assert.match(previewName(path), shape));
});
