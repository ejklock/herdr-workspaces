import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { iconId } from "../../src/files/icons.ts";
import table from "../../src/files/icon-table.ts";

const file = (path: string, dark = true) => iconId(table, path, { dir: false, open: false, dark });
const folder = (path: string, open = false, dark = true) => iconId(table, path, { dir: true, open, dark });

describe("file icon ids", () => {
  const cases: [string, string][] = [
    ["package.json", "nodejs"],
    [".gitignore", "git"],
    ["vite.config.ts", "vite"],
    [".github/funding.yml", "github-sponsors"],
    ["Dockerfile", "docker"],
    ["DOCKERFILE", "docker"],
    ["a.ts", "typescript"],
    ["a.spec.ts", "test-ts"],
    ["a.php", "php"],
    ["a.blade.php", "laravel"],
    ["a.vue", "vue"],
    ["a.zzzz", "file"],
    ["README_NO_RULE", "file"],
    ["trailing.", "file"],
  ];
  for (const [path, id] of cases) it(`${path} is ${id}`, () => assert.equal(file(path), id));

  it("a light theme prefers the light variant, a dark one the dark id", () => {
    assert.equal(file("a.toml", true), "toml");
    assert.equal(file("a.toml", false), "toml_light");
  });
});

describe("folder icon ids", () => {
  const cases: [string, string, string][] = [
    ["src", "folder-src", "folder-src-open"],
    ["tests", "folder-test", "folder-test-open"],
    [".github", "folder-github", "folder-github-open"],
    ["node_modules", "folder-node", "folder-node-open"],
    ["plain-no-rule", "folder", "folder-open"],
  ];
  for (const [path, closed, open] of cases) {
    it(`${path} is ${closed} closed and ${open} open`, () => {
      assert.equal(folder(path), closed);
      assert.equal(folder(path, true), open);
    });
  }

  it("a folder with a light variant uses it only in a light theme, with the open form", () => {
    for (const name of ["jinja", "jinja2", "j2", "idea", "cursor"]) {
      const light = table.light.folderNames[name] ?? "";
      assert.ok(light.endsWith("_light"), name);
      assert.equal(folder(name, false, false), light);
      assert.equal(folder(name, true, false), `${light.slice(0, -6)}-open_light`);
      assert.equal(folder(name, false, true), table.folderNames[name]);
    }
  });

  it("a path rule matches on any suffix of the path, for folders and files", () => {
    assert.equal(folder("repo/.github/workflows"), "folder-gh-workflows");
    assert.equal(file("repo/.github/funding.yml"), "github-sponsors");
  });

  it("a folder path rule beats the folder's own name", () => {
    assert.equal(folder("prisma/schema"), "folder-prisma");
    assert.equal(folder("schema"), "folder-class");
  });

  it("the leading underscore is dropped from folder names only, not file names", () => {
    assert.equal(file("_justfile"), "file");
  });

  it("a folder named __x__ matches the rule for x", () => {
    assert.equal(folder("__tests__"), "folder-test");
  });

  it("a folder name is never matched against file extensions", () => {
    assert.equal(folder("a.ts"), "folder");
    assert.equal(folder("x.vue"), "folder");
  });
});

describe("every icon id has its SVG", () => {
  const dir = join(import.meta.dirname, "..", "..", "mods", "my-files", "icons");
  const light = table.light;
  const ids = new Set<string>([table.file, table.folder]);
  for (const map of [table.fileNames, table.fileExtensions, table.folderNames, light.fileNames, light.fileExtensions, light.folderNames]) {
    for (const id of Object.values(map)) ids.add(id);
  }
  const folderIds = new Set<string>([table.folder, ...Object.values(table.folderNames), ...Object.values(light.folderNames)]);
  for (const id of folderIds) ids.add(id.endsWith("_light") ? `${id.slice(0, -6)}-open_light` : `${id}-open`);

  it("finds an SVG for each id the lookup can return", () => {
    const missing = [...ids].filter(id => !existsSync(join(dir, `${id}.svg`)));
    assert.deepEqual(missing, []);
  });
});
