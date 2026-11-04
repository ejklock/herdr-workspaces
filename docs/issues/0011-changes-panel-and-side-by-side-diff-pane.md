---
type: Issue
title: Changes panel and side-by-side diff pane
description: "Builds what issue 0006 scoped and did not deliver: a my-changes panel whose click opens one reused pane with a side-by-side diff, in three slices."
status: closed
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
3. **Syntax colors: dropped.** On 2026-11-02 the owner asked why the diff was being written from scratch rather than reusing what exists, and chose no syntax colors in the diff pane. Open in editor already shows the file in the editor's native highlighting. A tokenizer of the plugin's own was built and discarded uncommitted.

### Decision

- The pane is found again by its mod: a click looks for a `my-diff` pane in the focused tab. If there is one, it hands over the new target through `setShared` and focuses it. Otherwise it splits right with `pane.split` and the target in `props`. Session judgment: the editor's claims pattern (`editor.claims`) shows `shared` is how this plugin's mods talk to each other.
- The shared target is kept per space, as `shared("my-diff.targets")` keyed by space id. The list puts the space in the props of a pane it opens, and a pane follows only its own space's entry. Herdr keeps shared values in `<app home>/shared.json` across restarts. With one global target, every diff pane in every space showed the last file clicked anywhere; the session reproduced this in a scratch window. Two tabs of one space still share a target. Session judgment, after the owner chose to fix it before the PR: a pane cannot learn its own id from props, so keying by pane would need the editor's whole claims routing.
- Changed words are drawn as one row of `div` segments per line, since no rich-text primitive exists.
- The pane runs `git diff HEAD -U1000000 --no-ext-diff --no-textconv --no-color -c diff.suppressBlankEmpty=false` with the same read-only flags as the native mod (`--no-optional-locks`, `core.fsmonitor=false`, `diff.autoRefreshIndex=false`). Like the native mod, it reads an untracked file whole as added lines.
- The native `changes` mod in the app home stays untouched; the clone lives in `plugins/editor/` (ADR 0003, 0006's Decision).
- The list counts the lines of untracked files with one `env LC_ALL=C grep -c -I -H -e '' -- <paths>` on the panel's machine. It parses the `name:count` records in argument order and never searches ahead, because a later name can appear inside an earlier record. A binary or unreadable file counts 0. The session measured the 122 repositories under /Volumes/Developer/www: reading each file through `readTextFile` stayed at or under 34 ms in 27 of the 28 repositories with untracked files, but one with about 136 MB of untracked `.bin` dumps took 782 ms on every 10 s refresh, against 12 ms for the grep. The owner chose the grep over caching the reads.
- A diff of a file on another machine reloads every 10 s, skipping a tick while a load still runs, because `watchFolder` watches only local folders.
- Previous and Next step over change blocks, in order of where each block starts, and stop at the ends without wrapping. The header shows `k/n` after a step and `n changes` before one; the position survives an expand and is clamped on reload. The rows of the block a step lands on carry a 3px bar in the theme's `accent` color at the left edge (a fixed column on every non-hidden row); no bar before the first step. The owner asked for it on 2026-11-03: the steps gave no hint of which change is selected.
- Open in editor follows the Files panel's rule: focus an editor pane of the focused tab that already holds the file, otherwise split right; from a layout block, open a new tab. `src/changes/nav.ts` repeats that rule from `src/files/tree.ts`, because a mod can only import its own installed subfolders. The button is hidden for a file deleted in the working tree.
- Changed rows: on 2026-11-03 the owner asked for the colors and contrast of Claude Code's terminal diff, after the first tints were too faint and the stronger VS Code-style tints were still not right. Dark themes (background luminance at or below 0.5) use its palette, measured from the owner's screenshot: added line #0b2700, added word #194302, removed line #380701, removed word #5f0e04 (estimated; the screenshot shows none). Light themes keep the tints derived from the theme's `ansi1`/`ansi2`: the line at 30%, a changed word a further 35% stacked on the line. The empty side of a change row is an 8% foreground wash on both (no hatch primitive exists). `diffTints` in `src/changes/tints.ts` decides.
- Wrap: on 2026-11-03 the owner asked for optional automatic line wrap like GitHub's, or at least a pane-size-responsive one. The header's Wrap button is on by default (the owner asked for that on 2026-11-03 after testing it); a click turns it off and that choice is stored in `shared("my-diff.wrap")` as false (so it holds across panes and restarts). Off keeps the fixed-height `v_virtual_list` rows; on draws gpui-kit `list` rows that size to their wrapped text and reflow with the cell width. A highlighted line breaks between whitespace-bounded pieces (a single piece wider than the cell is clipped), since no text-run primitive exists. Previous and Next in wrap mode scroll through the same `VirtualListScrollHandle` set with `track_scroll` on the `list`, which gpui-kit documents only for virtual lists; the owner confirmed it in the app on 2026-11-03.
- Changed words come from a longest common subsequence over word, whitespace and punctuation tokens, capped at 400 tokens per side. A pair that shares only whitespace, or that passes the cap, keeps the whole-line tint.

### Acceptance

- In a scratch app home installed by `bin/install`, a click on a changed file opens one pane beside the panel with the side-by-side diff, and a click on a second file shows it in the same pane.
- Unchanged runs fold and expand; removed and added lines read clearly in the owner's theme.
- `--without editor` leaves the layout's `changes` block on the native mod.
- `npm test` is green and `herdr-app check` passes on each new mod.
- Slice 2 meets 0006's acceptance for word highlights, navigation and live refresh. Syntax colors are out (slice 3 dropped).

### Outcome

Slice 1 shipped in v0.1.3 (PR #4): the my-changes panel, the reused my-diff pane, the install and the layout swap. Slice 2 shipped with this issue's close: a diff on another machine reloads every 10 s; Previous and Next step through the change blocks; Open in editor follows the Files panel's rule and is hidden for a deleted file; untracked lines are counted by one grep; and the changed words inside paired lines get a stronger tint. Slice 3 (syntax colors) was dropped by the owner, so Open in editor is the way to see the file colored. Not verified by automation: how the word tint looks in the app.
