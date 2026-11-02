export type Formatter = {
  name: "prettier" | "biome" | "pint" | "php-cs-fixer" | "rustfmt";
  /** The directory holding the project's binary (or Cargo.toml), where the formatter runs so its config is found. */
  root: string;
  /** The file's real path: configs and overrides are matched against it. */
  file: string;
  /** The project's config file for a formatter that takes it as an argument; empty when none exists. */
  config: string;
};

export type FormatHost = {
  exec(command: string, args?: string[], options?: { cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }>;
  writeTextFile(path: string, text: string, expected: string | null): Promise<null>;
  /** The file's text, or null when it does not exist. */
  readTextFile(path: string): Promise<string | null>;
};

const NAMES: readonly Formatter["name"][] = ["prettier", "biome", "pint", "php-cs-fixer", "rustfmt"];

// Walks up from the file's real directory; the nearest directory that holds a project-local formatter wins.
// Only node_modules/.bin, vendor/bin and (for Rust) a Cargo.toml count; nothing is taken from the global PATH except rustfmt.
// A biome binary counts when a biome config exists in its folder or above. A prettier binary is reported as a candidate
// with the facts its declaration is decided from (a config file, the package.json beside the binary, the package.json
// files on the way up), and the walk goes on past it. Those facts are gathered from the file's folder up to the
// repository root (the nearest folder holding a .git entry, file or folder), or, with no repository, up to the folder
// holding the binary.
// Output: records of name, binary folder, real file, config, count of extra lines, then the extra lines.
const PROBE = `
f=$(realpath "$1") || exit 1
d=$(dirname "$f")
start=$d
biome_config_up() {
  s=$1
  while :; do
    [ -f "$s/biome.json" ] || [ -f "$s/biome.jsonc" ] && return 0
    [ "$s" = / ] && return 1
    s=$(dirname "$s")
  done
}
repo_root() {
  s=$1
  while :; do
    [ -e "$s/.git" ] && { printf '%s' "$s"; return 0; }
    [ "$s" = / ] && return 1
    s=$(dirname "$s")
  done
}
repo=$(repo_root "$start")
prettier_candidate() {
  boundary=\${repo:-$d}
  config=
  packages=
  s=$start
  while :; do
    for n in "$s"/.prettierrc "$s"/.prettierrc.* "$s"/prettier.config.*; do [ -f "$n" ] && config=1; done
    [ -f "$s/package.json" ] && packages="$packages$s/package.json
"
    { [ "$s" = "$boundary" ] || [ "$s" = / ]; } && break
    s=$(dirname "$s")
  done
  own=
  [ -f "$d/package.json" ] && own="$d/package.json"
  count=$(printf '%s' "$packages" | grep -c '')
  printf 'prettier\\n%s\\n%s\\n%s\\n%s\\n%s\\n' "$d" "$f" "$config" "$((count + 1))" "$own"
  printf '%s' "$packages"
}
base=\${f##*/}
case $base in *.*) ext=\${base##*.} ;; *) ext= ;; esac
case $ext in
  js|jsx|mjs|cjs|ts|tsx|mts|cts|json|jsonc|css) group=web ;;
  scss|less|md|markdown|yaml|yml|html|vue) group=prettier ;;
  php) group=php ;;
  rs) group=rust ;;
  *) exit 0 ;;
esac
found() { printf '%s\\n%s\\n%s\\n%s\\n0\\n' "$1" "$d" "$f" "$2"; exit 0; }
while :; do
  case $group in
    web)
      if [ -x "$d/node_modules/.bin/biome" ] && biome_config_up "$d"; then found biome ""; fi
      if [ -x "$d/node_modules/.bin/prettier" ]; then prettier_candidate; fi ;;
    prettier)
      if [ -x "$d/node_modules/.bin/prettier" ]; then prettier_candidate; fi ;;
    php)
      if [ -x "$d/vendor/bin/pint" ]; then
        if [ -f "$d/pint.json" ]; then found pint "$d/pint.json"; fi
        found pint ""
      fi
      if [ -x "$d/vendor/bin/php-cs-fixer" ]; then
        if [ -f "$d/.php-cs-fixer.php" ]; then found php-cs-fixer "$d/.php-cs-fixer.php"; fi
        if [ -f "$d/.php-cs-fixer.dist.php" ]; then found php-cs-fixer "$d/.php-cs-fixer.dist.php"; fi
        found php-cs-fixer ""
      fi ;;
    rust)
      if [ -f "$d/Cargo.toml" ]; then
        if command -v rustfmt >/dev/null 2>&1; then found rustfmt ""; fi
        exit 0
      fi ;;
  esac
  [ "$d" = / ] && exit 0
  d=$(dirname "$d")
done
`;

/** Pipes the temp file into the command's stdin. */
const STDIN = 'f=$1; shift; "$@" < "$f"';
/** For a formatter with no stdin mode: runs on the temp copy, then prints it. */
const IN_PLACE = 'f=$1; shift; "$@" "$f" >&2 && cat "$f"';
// The edition is the crate's literal one, else the nearest enclosing workspace's [workspace.package] edition (what
// \`edition.workspace = true\` inherits), else 2021.
const RUSTFMT = `f=$1
literal='s/^[[:space:]]*edition[[:space:]]*=[[:space:]]*"\\([0-9]*\\)".*/\\1/p'
edition=$(sed -n "$literal" Cargo.toml | head -n 1)
if [ -z "$edition" ] && grep -q '^[[:space:]]*edition.*workspace' Cargo.toml; then
  d=$(dirname "$PWD")
  while :; do
    [ -f "$d/Cargo.toml" ] && edition=$(sed -n "/^\\[workspace\\.package\\]/,/^\\[/{$literal;}" "$d/Cargo.toml" | head -n 1)
    [ -n "$edition" ] || [ "$d" = / ] && break
    d=$(dirname "$d")
  done
fi
rustfmt --emit stdout --edition "\${edition:-2021}" < "$f"`;

type Candidate = { name: string; root: string; file: string; config: string; extra: string[] };

function candidates(stdout: string): Candidate[] {
  const lines = stdout.split("\n");
  const found: Candidate[] = [];
  for (let i = 0; i + 4 < lines.length;) {
    const count = Number(lines[i + 4]);
    if (!Number.isInteger(count) || count < 0) break;
    found.push({ name: lines[i] ?? "", root: lines[i + 1] ?? "", file: lines[i + 2] ?? "", config: lines[i + 3] ?? "", extra: lines.slice(i + 5, i + 5 + count) });
    i += 5 + count;
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a package.json says about prettier: its config under a top-level key, and its listing among the dependencies. One leading byte order mark is dropped, as Node does. */
function packageFacts(text: string | null): { config: boolean; listed: boolean } {
  const none = { config: false, listed: false };
  if (text === null) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return none;
  }
  if (!isRecord(parsed)) return none;
  const key = parsed["prettier"];
  const listsPrettier = (section: unknown): boolean => isRecord(section) && typeof section["prettier"] === "string";
  return {
    config: isRecord(key) || typeof key === "string",
    listed: listsPrettier(parsed["dependencies"]) || listsPrettier(parsed["devDependencies"]),
  };
}

/** Whether the project declares prettier: a config file or package.json key within the repository, or a listing beside the binary. */
async function declaresPrettier(host: FormatHost, candidate: Candidate): Promise<boolean> {
  if (candidate.config) return true;
  const [own, ...walked] = candidate.extra;
  const read = (path: string): Promise<string | null> => host.readTextFile(path).catch(() => null);
  if (own && packageFacts(await read(own)).listed) return true;
  for (const path of walked) if (path && packageFacts(await read(path)).config) return true;
  return false;
}

/** The project's own formatter for a local file, or undefined when its project has none. */
export async function resolveFormatter(host: FormatHost, path: string): Promise<Formatter | undefined> {
  const result = await host.exec("sh", ["-c", PROBE, "format", path]);
  if (result.code !== 0) return undefined;
  for (const candidate of candidates(result.stdout)) {
    const name = NAMES.find(n => n === candidate.name);
    if (!name || !candidate.root || !candidate.file) continue;
    if (name === "prettier" && !(await declaresPrettier(host, candidate))) continue;
    return { name, root: candidate.root, file: candidate.file, config: name === "prettier" ? "" : candidate.config };
  }
  return undefined;
}

function command(formatter: Formatter, temp: string): string[] {
  const bin = (dir: string, tool: string): string => `${formatter.root}/${dir}/${tool}`;
  switch (formatter.name) {
    case "prettier": return ["-c", STDIN, "format", temp, bin("node_modules/.bin", "prettier"), "--stdin-filepath", formatter.file];
    case "biome": return ["-c", STDIN, "format", temp, bin("node_modules/.bin", "biome"), "format", `--stdin-file-path=${formatter.file}`];
    case "pint": return ["-c", IN_PLACE, "format", temp, bin("vendor/bin", "pint"), ...(formatter.config ? [`--config=${formatter.config}`] : [])];
    case "php-cs-fixer": return ["-c", IN_PLACE, "format", temp, bin("vendor/bin", "php-cs-fixer"), "fix", "--using-cache=no", "--no-interaction", ...(formatter.config ? [`--config=${formatter.config}`] : [])];
    case "rustfmt": return ["-c", RUSTFMT, "format", temp];
  }
}

async function inTempDir<T>(host: FormatHost, work: (dir: string) => Promise<T>): Promise<T> {
  // An explicit template: some mktemp builds ignore TMPDIR when given none.
  const made = await host.exec("sh", ["-c", 'mktemp -d "${TMPDIR:-/tmp}/herdr-fmt.XXXXXX"']);
  const dir = made.stdout.trim();
  if (made.code !== 0 || !dir) throw new Error("could not create a temp folder");
  try {
    return await work(dir);
  } finally {
    await host.exec("rm", ["-rf", dir]).catch(() => undefined);
  }
}

/** The text formatted by the project's formatter, run on a temp copy outside the project; throws when it fails or prints nothing. */
export async function runFormatter(host: FormatHost, formatter: Formatter, text: string): Promise<string> {
  if (text === "") return text;
  return inTempDir(host, async dir => {
    const temp = `${dir}/${formatter.file.slice(formatter.file.lastIndexOf("/") + 1)}`;
    await host.writeTextFile(temp, text, null);
    const result = await host.exec("sh", command(formatter, temp), { cwd: formatter.root });
    if (result.code !== 0) throw new Error(`exited with ${result.code}${result.stderr.trim() ? `: ${result.stderr.trim()}` : ""}`);
    if (result.stdout === "") throw new Error("printed nothing");
    return result.stdout;
  });
}
