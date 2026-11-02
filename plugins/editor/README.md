# herdr-editor

An `editor` mod for the Herdr desktop app: a pane that shows one local text file, editable, with line numbers and folding. The twelve syntax colors come from the Herdr theme and the code font size is the `font_size` setting (12 when it is missing or unusable); the pane draws no frame of its own inside the Herdr pane.

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

This plugin lives in the herdr-workspaces repository under `plugins/editor/`; run these from this folder, after `npm install` at the repository root (the root `bin/install` does the build and the copy for you).

```
npm run build        # emits mods/editor/editor/*.js and mods/editor/format/*.js (tsconfig.json), and mods/my-files/files/*.js (tsconfig.files.json); each mod's main.js re-exports its entry
npm run typecheck    # src against the app's .d.ts, tests against @types/node
npm test
npm run coverage     # same tests, writes coverage/lcov.info for src and stamps the gate's receipt
npm run install:files  # builds, then copies mods/editor and mods/my-files into ~/.config/herdr-app/mods/
```

Both mods are installed by copy, not by link: Herdr draws a mod's SVGs only from real files, so a linked my-files shows its tree with no icons. `bin/install-files <app home>` (what `npm run install:files` runs) writes only `<app home>/mods/editor` and `<app home>/mods/my-files`, marks each with `.installed-from` (the project name `herdr-workspaces`, not a path), replaces an earlier link into this plugin and a copy made from any earlier checkout path, and refuses, writing neither, a link pointing elsewhere (such as one into the old herdr-editor checkout), a folder it did not make, and a `.installed-from` that is itself a link (a link cannot prove ownership, so it is never written through). Rerun `npm run install:files` after each build to update the copies. The root `bin/install` runs the build and this script, and also installs the workspaces mod and the layout.

`tsconfig.json` and `tsconfig.files.json` read Herdr's `herdr.d.ts` and `gpui-kit.d.ts` from the git-ignored `types/` folder. `npm run build` and `npm run typecheck` first run `bin/copy-types`, which copies the two files from the app home (`HERDR_APP_HOME`, else `~/.config/herdr-app`; an empty `HERDR_APP_HOME` counts as unset) and refuses, changing nothing, when the app home or either file is missing or `types/` is a symlink. The app rewrites those files with each release, so they are copied fresh each time and never committed.

A rebuild did not reload an already open pane when observed (with the mod linked); after reinstalling, close and reopen the pane to run new code.

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

## The my-files mod

`my-files` is the shipped Files mod's lazy tree (folders on demand, git status marks A, M, D and U, a folder watch, a 10 s refresh, at most 500 entries per folder and 5,000 in all) with two changes: a click on a file opens it in the editor instead of a preview, and each file and folder is drawn with its colored Material Icon Theme icon (open-folder variants for expanded folders, light variants when the app is not dark). Source: `src/files/` (the click and location rules and the listing and git parsing are in `src/files/tree.ts`, the icon lookup in `src/files/icons.ts` over the table in `src/files/icon-table.ts`, both free of the app's modules); output: `mods/my-files/files/*.js`, behind the committed `mods/my-files/main.js`. The two chevrons and `mod.json` are copied from the shipped mod, with asset paths under `mods/my-files/`. The icons are the 1184 SVGs in `mods/my-files/icons/`, copied unchanged with the table from the herdr.dev mod amster93/herdr-file-icons (Apache-2.0, `mods/my-files/LICENSE-herdr-file-icons.txt`), which generated them from material-icon-theme 5.40.0 (MIT, `mods/my-files/icons/LICENSE-material-icon-theme.txt`). `bin/install-files` copies the `icons/` folder as real files too. Install it with `npm run install:files`, as shown under Build and install.

Click rules:

- A local file that an editor pane of the focused tab already shows: that pane gets focus.
- Otherwise a new editor pane opens to the right of the focused pane, also when the focused pane is an editor showing another file. No existing editor pane is ever closed, replaced or edited.
- Focus on a layout terminal block (no model pane to split): the file opens as a new tab.
- A file on another machine always opens a new pane with `on` set, and shows read-only in the editor.
- The tree keeps its folder and machine while an editor pane has focus; a terminal pane's folder replaces it.

Which pane shows which file is read from the editor's `shared("editor.claims")`. The layout wiring (putting `my-files` in the `workspaces` layout in place of `files`) belongs to the herdr-workspaces project and is not done here; until then open it with `herdr-app do pane.split --direction right --mod my-files`.

## Owner-run check of the my-files click

1. Run `npm run install:files`, then open a pane: `herdr-app do pane.split --direction right --mod my-files`. The tree shows the focused terminal's folder with a colored icon for each file type and folder, such as a TypeScript icon for `.ts` files and a different icon for `src` and `node_modules` folders, the open variant on an expanded folder (if the icons are missing, the mod is a link, not a copy, which is the proven cause: run `npm run install:files`, which replaces a link with a real folder).
2. Click a file: an editor pane opens to the right of the pane that had focus, showing the file.
3. Click the tree, then the same file again: the editor pane gets focus, no second pane opens.
4. Click another file: a second editor pane opens right of the focused pane; the first stays.
5. With an editor pane focused, look at the tree: it still shows the same folder.
6. With my-files placed in a layout block (not as a split pane), click a file while a layout terminal block has focus: the file opens in a new tab. A my-files split pane may take focus on the click, so this path is not reached there.
7. Edit text in an editor pane without saving, then click files in the tree: the edited pane is untouched.
