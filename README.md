# herdr-editor

An `editor` mod for the Herdr desktop app: a pane that shows one local text file, editable, with the theme's syntax colors, line numbers and folding.

## Safety

- A save writes with `writeTextFile(target, text, expected)`, where `expected` is the text last read or saved. A file changed on disk is never overwritten silently: the pane shows a conflict bar with Reload and Overwrite.
- A symlink is read and written through its resolved target, so the link stays a link.
- Read-only, never written: a local path whose real location cannot be resolved, files of 1 MiB or more, files whose size is unknown, binary files, text that is not valid UTF-8, and files on another machine.

## Build and install

```
npm install
npm run build        # emits mods/editor/*.js from src/editor
npm run typecheck    # src against the app's .d.ts, tests against @types/node
npm test
ln -s "$PWD/mods/editor" ~/.config/herdr-app/mods/editor
```

`tsconfig.json` reads the app's `herdr.d.ts` and `gpui-kit.d.ts` in place from `~/.config/herdr-app` (an absolute path; adjust it for another home). The app rewrites those files, so they are never copied.

A rebuild through the link did not reload an already open pane when observed; close and reopen the pane to run new code.

## Use

Open a pane: `herdr-app do pane.split --direction right --mod editor --props '{"path":"/abs/file.ts"}'`. `props` is `{ path, on? }`.

Commands reach the focused editor pane only: `herdr-app do editor.save`, `editor.overwrite` (during a conflict), `editor.reload` (discards edits). With several editor panes open, a copy owns the pane its keyboard focus proves, its own earlier pane, the one pane left by an earlier build for the same file, or the one unclaimed pane; with two candidates and no focus proof it owns none until a focus event.

`npm test -- --test-name-pattern=<text>` runs only the matching tests.

## Owner-run check of Cmd+S and the dirty marker

1. Open a file: `herdr-app do pane.split --direction right --mod editor --props '{"path":"/tmp/try.txt"}'` (create the file first).
2. Click in the editor and type a character: a dot appears in the header beside the file name.
3. Press Cmd+S.
4. Run `cat /tmp/try.txt`: it holds your edit, and the dot is gone.
5. Change the file from a terminal, then press Cmd+S in the pane: the conflict bar shows and the file keeps the terminal's content until you press Overwrite.
6. Put the pane in conflict again, click Reload: the disk text shows at once and the conflict bar goes away.
