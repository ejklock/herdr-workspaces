# herdr-editor

An `editor` mod for the Herdr desktop app: a pane that shows one local text file, editable, with the theme's syntax colors, line numbers and folding.

## Safety

- A save writes with `writeTextFile(target, text, expected)`, where `expected` is the text last read or saved. A file changed on disk is never overwritten silently: the pane shows a conflict bar with Reload and Overwrite.
- A symlink is read and written through its resolved target, so the link stays a link.
- Read-only, never written: a local path whose real location cannot be resolved, files of 1 MiB or more, files whose size is unknown, binary files, text that is not valid UTF-8, and files on another machine.

## Format on save

Saving runs the project's own formatter, writes what it prints and shows that text in the pane. The nearest project up from the file's real directory decides; a file whose project has none is saved exactly as typed.

| Files | Formatter | Found as |
|---|---|---|
| js, jsx, mjs, cjs, ts, tsx, mts, cts, json, jsonc, css | biome | `node_modules/.bin/biome`, with a `biome.json` or `biome.jsonc` in its folder or any folder above (a binary with no config anywhere is not used) |
| the same, plus scss, less, md, markdown, yaml, yml, html, vue | prettier | `node_modules/.bin/prettier`, only when the project declares prettier: a `.prettierrc`, `.prettierrc.*`, `prettier.config.*` or a top-level `prettier` key in a package.json, found from the file's folder up to the repository root (the nearest folder holding a `.git` entry, a folder or a file; with no repository, up to the folder holding the binary), or `prettier` in the `dependencies` or `devDependencies` of the package.json beside that `node_modules`. A config above the repository root does not count, so a config in the home folder counts only when the home folder is the repository root (it holds a `.git` entry and the project has none of its own) or, with no repository at all, when the binary itself sits in the home folder; and a binary that is only there through hoisting is not used. Each package.json is read with `JSON.parse` after dropping one leading byte order mark, and checked; invalid JSON declares nothing |
| php | pint, else php-cs-fixer | `vendor/bin/pint`, `vendor/bin/php-cs-fixer` (the project's `pint.json` or `.php-cs-fixer[.dist].php` is passed explicitly) |
| rs | rustfmt | `rustfmt` on PATH, only with a `Cargo.toml` up the tree; edition from the crate's Cargo.toml, else the workspace root's `[workspace.package]` edition (for `edition.workspace = true`), else 2021 |

No global formatter is used for JS, TS, CSS, JSON, Markdown, YAML or PHP: it could reformat a repository that does not want it. The formatter never touches the project file: the text goes to a temp copy outside the project, the formatter prints it (pint and php-cs-fixer fix the temp copy, which is then read back), and the editor's guarded write stays the only writer. A formatter that fails, times out or prints nothing never blocks the save: the text as typed is written and a notice says why.

The pane's text is replaced only by text a save just wrote, and only when it differs from what was sent and the pane was not edited meanwhile. A save that wrote nothing (a failed write, a conflict, a save already running, no edits, an overwrite with no conflict) leaves the typed text alone.

## Build and install

```
npm install
npm run build        # emits mods/editor/editor/*.js and mods/editor/format/*.js from src; mods/editor/main.js re-exports the entry
npm run typecheck    # src against the app's .d.ts, tests against @types/node
npm test
npm run coverage     # same tests, writes coverage/lcov.info for src and stamps the gate's receipt
ln -s "$PWD/mods/editor" ~/.config/herdr-app/mods/editor
```

`tsconfig.json` reads the app's `herdr.d.ts` and `gpui-kit.d.ts` in place from `~/.config/herdr-app` (an absolute path; adjust it for another home). The app rewrites those files, so they are never copied.

A rebuild through the link did not reload an already open pane when observed; close and reopen the pane to run new code.

## Use

Open a pane: `herdr-app do pane.split --direction right --mod editor --props '{"path":"/abs/file.ts"}'`. `props` is `{ path, on? }`.

Commands reach the focused editor pane only: `herdr-app do editor.save`, `editor.overwrite` (during a conflict), `editor.reload` (discards edits), `editor.fresh` (saves, then opens the file in Fresh; see below). With several editor panes open, a copy owns the pane its keyboard focus proves, its own earlier pane, the one pane left by an earlier build for the same file, or the one unclaimed pane; with two candidates and no focus proof it owns none until a focus event.

## Open in Fresh

The header's "Open in Fresh" button (and `herdr-app do editor.fresh`, which takes the same path) hands the file to the Fresh editor: a terminal running `fresh <file>` opens to the right of the pane and the editor pane closes. It saves first, with the normal save rules (the guarded write, format on save), and opens Fresh only when the disk then holds exactly the pane's text. On a conflict, a failed save, a save already running, or text edited while the save ran, the pane stays with its bar or notice and no terminal opens. A local read-only file has nothing to save, so it opens at once. The button is absent, and `editor.fresh` does nothing, for a missing file, a folder, a binary file, a file on another machine, and an editor pane whose space is on another machine (the terminal would start on that machine, where the file is not). The button adopts its pane first, as Cmd+S does; with two editor panes open and neither focused yet, it shows once you click into the text. Fresh must be on the PATH of the terminal.

## Owner-run check of Open in Fresh

1. Open a file: `herdr-app do pane.split --direction right --mod editor --props '{"path":"/tmp/try.txt"}'` (create the file first).
2. Click in the editor and type a character, then click "Open in Fresh" in the header.
3. `cat /tmp/try.txt` holds your edit, the editor pane is gone and a terminal running Fresh with the file takes its place.
4. Open the file again in a pane, change it from a terminal (`echo external > /tmp/try.txt`), then click "Open in Fresh": the conflict bar shows, no terminal opens and the file keeps `external`.
5. Symlink: `ln -s /tmp/try.txt /tmp/try-link.txt`, open `/tmp/try-link.txt` in the editor, click "Open in Fresh", edit and save in Fresh, then run `test -L /tmp/try-link.txt && cat /tmp/try.txt`: the link is still a link and the target holds the edit.

`npm test -- --test-name-pattern=<text>` runs only the matching tests.

## Owner-run check of Cmd+S and the dirty marker

1. Open a file: `herdr-app do pane.split --direction right --mod editor --props '{"path":"/tmp/try.txt"}'` (create the file first).
2. Click in the editor and type a character: a dot appears in the header beside the file name.
3. Press Cmd+S.
4. Run `cat /tmp/try.txt`: it holds your edit, and the dot is gone.
5. Change the file from a terminal, then press Cmd+S in the pane: the conflict bar shows and the file keeps the terminal's content until you press Overwrite.
6. Put the pane in conflict again, click Reload: the disk text shows at once and the conflict bar goes away.

## Owner-run check of format on save

1. Open a file in a project with a formatter: `herdr-app do pane.split --direction right --mod editor --props '{"path":"/abs/project/src/file.ts"}'`.
2. Click in the editor and type badly formatted code (extra spaces, missing semicolons).
3. Press Cmd+S.
4. The pane shows the formatted text and the dot in the header goes away.
5. Run `cat /abs/project/src/file.ts`: it holds the formatted text.
