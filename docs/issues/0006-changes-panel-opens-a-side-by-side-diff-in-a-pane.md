---
type: Issue
title: Changes panel opens a side-by-side diff in a pane
description: A copy of the Changes panel whose file click opens one reused pane beside it with a VS Code-style side-by-side diff of HEAD against the working tree.
status: open
timestamp: 2026-11-02T15:01:34Z
---

## 0006. Changes panel opens a side-by-side diff in a pane

Herdr's native Changes panel (`~/.config/herdr-app/mods/changes`) opens a file's diff as one unified column under the list. The owner asked on 2026-11-02 for a VS Code-style diff with clear contrast, opened in a pane beside the panel ("changes como o do vscode bem claro, ao invés de abrir embaixo abrir em um pane"). The app's Editor has no diff mode and no line backgrounds (`gpui-kit.d.ts`, EditorState options), and no TypeScript grammar, so the pane draws its own rows.

### Scope

- `my-changes`: a copy of the native `changes` mod that keeps the list and the commit box; a click on a changed file opens the diff pane beside it, one pane reused for every file.
- The diff pane: HEAD against the working tree, side by side, with line numbers on each side; unchanged runs fold into "N hidden lines" that a click expands; word-level highlight inside changed lines; red and green from the Herdr theme (`ansi1`/`ansi2`, a stronger alpha for changed words); syntax colors from a light per-language tokenizer of its own.
- Header actions: open the file in the editor, next and previous change; the diff refreshes live; files on other machines open read-only.
- Lives in the editor plugin, `plugins/editor/` ([ADR 0003](/adr/0003-optional-plugins-live-self-contained-in-the-repository.md)); the workspaces layout shows `my-changes` in place of `changes`.

### Decision

- Click opens a pane beside the panel, not under it; one reused pane. Owner, 2026-11-02.
- The line diff comes from `git diff -U1000000`; the plugin only parses and lays it out, with no diff library (a mod loads only files under its own folder and the plugin has no bundler). Session judgment, 2026-11-02.
- my-changes goes in `plugins/editor/` rather than a plugin of its own. Owner, 2026-11-02.

### Acceptance

- A click on a changed file in my-changes opens one pane beside it with the side-by-side diff; a second click on another file reuses that pane.
- Unchanged runs fold and expand; next and previous move between changes; an edit to the file on disk refreshes the diff.
- Removed and added lines, and the changed words inside them, read clearly in the owner's theme.
- `bin/install` installs `my-changes` with the editor plugin and the workspaces layout shows it; `--without editor` keeps the native `changes`.
