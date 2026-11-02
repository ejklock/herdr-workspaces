---
type: Issue
title: Changes panel and side-by-side diff pane
description: "Builds what issue 0006 scoped and did not deliver: a my-changes panel whose click opens one reused pane with a side-by-side diff, in three slices."
status: open
timestamp: 2026-11-02T19:51:45Z
---

## 0011. Changes panel and side-by-side diff pane

## What / Why

[Issue 0006](/issues/0006-changes-panel-opens-a-side-by-side-diff-in-a-pane.md) closed after its first slice. It delivered `plugins/editor/src/changes/diff.ts`, which parses a whole-file git diff into side-by-side rows and folds unchanged runs, but none of the panel or the pane. The workspaces layout still shows Herdr's native `changes` mod, whose diff opens as one unified column under the list. On 2026-11-02 the owner asked why Changes still looks the old way, and chose to build the rest ("sim.. vamos fazer").

0006's Scope, Decision and Acceptance still stand. A read-only survey of Herdr 0.1.9 found these points that the build has to provide itself:
- No mod reuses a pane today: a Files click opens a new editor pane each time, and the editor reads its file once from `props()`. The reused diff pane needs its own channel.
- gpui-kit has no text-run API, so a line in several colors is a row of segments.
- `src/changes/` is outside every tsconfig, so nothing builds it into a mod yet.

### Scope

Slices, each usable on its own, in this order:

1. **Panel and pane.**
   - `my-changes` is a copy of the native `changes` mod (list, counts, commit box, refresh), whose click opens the diff pane instead of the inline diff.
   - `my-diff` is the pane: HEAD against the working tree, side by side, with line numbers on each side, removed and added rows in the theme's `ansi1` and `ansi2`, and unchanged runs folded into "N hidden lines" that a click expands.
   - A second click on another file shows that file in the same pane.
   - The build compiles both mods.
   - `bin/install` installs them with the editor plugin, and the layout shows `my-changes` in place of `changes`; `--without editor` keeps the native one.
2. **Reading aids.**
   - Changed words inside paired lines get a stronger background.
   - The header has next change, previous change, and opening the file in the editor.
   - The diff refreshes when the file changes on disk.
   - Files on another machine open read-only.
3. **Syntax colors.** A light tokenizer of the plugin's own, for the languages the editor already formats, colors keywords, strings, comments and numbers on both sides.

### Decision

- The pane is found again by its mod: a click looks for a `my-diff` pane in the focused tab. If there is one, it hands over the new target through `setShared` and focuses it. Otherwise it splits right with `pane.split` and the target in `props`. Session judgment: the editor's claims pattern (`editor.claims`) shows `shared` is how this plugin's mods talk to each other.
- The shared target is kept per space, as `shared("my-diff.targets")` keyed by space id. The list puts the space in the props of a pane it opens, and a pane follows only its own space's entry. Herdr keeps shared values in `<app home>/shared.json` across restarts. With one global target, every diff pane in every space showed the last file clicked anywhere; the session reproduced this in a scratch window. Two tabs of one space still share a target. Session judgment, after the owner chose to fix it before the PR: a pane cannot learn its own id from props, so keying by pane would need the editor's whole claims routing.
- Changed words are drawn as one row of `div` segments per line, since no rich-text primitive exists.
- The pane runs `git diff HEAD -U1000000 --no-ext-diff --no-textconv --no-color -c diff.suppressBlankEmpty=false` with the same read-only flags as the native mod (`--no-optional-locks`, `core.fsmonitor=false`, `diff.autoRefreshIndex=false`). Like the native mod, it reads an untracked file whole as added lines.
- The native `changes` mod in the app home stays untouched; the clone lives in `plugins/editor/` (ADR 0003, 0006's Decision).

### Acceptance

- In a scratch app home installed by `bin/install`, a click on a changed file opens one pane beside the panel with the side-by-side diff, and a click on a second file shows it in the same pane.
- Unchanged runs fold and expand; removed and added lines read clearly in the owner's theme.
- `--without editor` leaves the layout's `changes` block on the native mod.
- `npm test` is green and `herdr-app check` passes on each new mod.
- Slices 2 and 3 meet 0006's acceptance for word highlights, navigation, live refresh and syntax colors.
