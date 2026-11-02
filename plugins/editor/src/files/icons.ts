// The lookup rules are ported from amster93/herdr-file-icons (Apache-2.0), which applies Material Icon Theme's rules as VS Code does.
type Names = Record<string, string>;

export type IconTable = {
  file: string;
  folder: string;
  fileNames: Names;
  fileExtensions: Names;
  folderNames: Names;
  light: { fileNames: Names; fileExtensions: Names; folderNames: Names };
};

type Kind = "fileNames" | "fileExtensions" | "folderNames";

/** A folder's own name without the decoration the theme's keys omit: `__tests__` and `.github` match `tests` and `github`. */
const bare = (name: string): string => name.replace(/^__(.+)__$/, "$1").replace(/^[._-]/, "");

const openVariant = (id: string): string => (id.endsWith("_light") ? `${id.slice(0, -6)}-open_light` : `${id}-open`);

const lookup = (table: IconTable, kind: Kind, key: string, dark: boolean): string | undefined =>
  (dark ? undefined : table.light[kind][key]) ?? table[kind][key];

/**
 * The icon id for a path, matching names case-insensitively. A path rule (".github/workflows") beats a name, a name beats an extension,
 * the longest extension wins ("spec.ts" over "ts"), and without `dark` the theme's light table is checked first.
 * A folder never matches an extension; an open folder uses the open variant of its id.
 */
export function iconId(table: IconTable, path: string, { dir, open, dark }: { dir: boolean; open: boolean; dark: boolean }): string {
  const parts = path.toLowerCase().split("/");
  const name = parts[parts.length - 1] ?? "";
  const kind: Kind = dir ? "folderNames" : "fileNames";
  const find = (key: string): string | undefined => lookup(table, kind, key, dark) ?? (dir ? lookup(table, kind, bare(key), dark) : undefined);

  let id: string | undefined;
  for (let i = 0; id === undefined && i < parts.length - 1; i++) id = find(parts.slice(i).join("/"));
  if (dir) {
    const folder = id ?? find(name) ?? table.folder;
    return open ? openVariant(folder) : folder;
  }
  id ??= lookup(table, kind, name, dark);
  for (let dot = name.indexOf("."); id === undefined && dot !== -1; dot = name.indexOf(".", dot + 1)) {
    id = lookup(table, "fileExtensions", name.slice(dot + 1), dark);
  }
  return id ?? table.file;
}
