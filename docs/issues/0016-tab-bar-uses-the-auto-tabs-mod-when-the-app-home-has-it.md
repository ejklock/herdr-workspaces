---
type: Issue
title: Tab bar uses the auto-tabs mod when the app home has it
description: bin/install points the layout's tab bar at mods/auto-tabs when the app home has it, else the shipped tabs; workspace windows mirror it.
status: closed
timestamp: 2026-11-09T22:42:31Z
---

## 0016. Tab bar uses the auto-tabs mod when the app home has it

## What / Why

The Workspaces layout's tab bar names Herdr's shipped `tabs` mod (`layouts/Workspaces.json`, the `tabs` block), so tabs keep the names Herdr gives them. The owner wants tabs that name themselves from the Claude Code title, the program or the folder, which the third-party mod `auto-tabs` does ([longwave/herdr-auto-tabs](https://github.com/longwave/herdr-auto-tabs) at `4be0878`, a clone of the shipped `tabs` 0.1.9). Its README installs it by a hand edit of a layout's `"mod": "tabs"`, which the next `bin/install` would revert.

### Scope

`bin/install` (the layout's tab bar), `mods/workspaces/lib.js` (the window mirror list), their tests, README and RECIPE.

### Decision

The owner chose "se-configs + workspaces" on 2026-11-09 (se-configs issue 0162):

- se-configs' installer copies `auto-tabs` into `<app home>/mods/auto-tabs`, with a `.installed-from` marker holding `herdr-auto-tabs`, right before it runs this repository's `bin/install`.
- `bin/install` points the tab bar at `auto-tabs` when `<app home>/mods/auto-tabs` is a folder, else keeps the shipped `tabs`. The `"mod": "tabs"` anchor must appear exactly once in the source layout, like the Files and Changes anchors. The choice is independent of `--without editor`.
- A workspace window mirrors `mods/auto-tabs` as an optional source, like the editor's mods, so a window opened on a layout naming it has the mod.
- Not taken: this repository fetching `auto-tabs` itself; a hand edit of `Workspaces.json`.
- Cheap choice: presence is tested as a folder (`-d`, a link to a folder counts); the marker is not read, since se-configs owns that copy.

### Acceptance

- [x] With `mods/auto-tabs` in the app home the installed layout names `"mod": "auto-tabs"`; without it, `"mod": "tabs"`; with or without `--without editor` (`npm test`).
- [x] A source layout with the `"mod": "tabs"` anchor missing or doubled is refused before anything is written (`npm test`).
- [x] The window open plan mirrors `mods/auto-tabs` when present and lists it among the optional sources (`npm test`).
- [ ] In the owner's app, after se-configs installs `auto-tabs` and `bin/install` runs, the tabs rename themselves in the main window and in a workspace window.

### Plan

- S1: a workspace window mirrors `mods/auto-tabs` when the main home has it | files: mods/workspaces/lib.js, mods/workspaces/lib.test.js, README.md, RECIPE.md | after: none
- S2: `bin/install` points the tab bar at `auto-tabs` when `<app home>/mods/auto-tabs` is a folder, else `tabs`, refusing a source layout without exactly one `"mod": "tabs"` | files: bin/install, bin/install.test.js, README.md, RECIPE.md | after: S1 (both edit README.md and RECIPE.md, so they run one after the other in the main checkout)

### Outcome

Shipped in #14 (d0aa96b). `bin/install` points the tab bar at `auto-tabs` when `<app home>/mods/auto-tabs` is a folder and keeps `tabs` otherwise, independent of `--without editor`. A source layout without exactly one `"mod": "tabs"` is refused before any write. Workspace windows mirror `mods/auto-tabs` as an optional source. `npm test` is green (290 + 553). Planted faults fail by assertion: `-d` changed to `-e` or `-L`, the anchor check removed, `auto-tabs` always chosen, the choice tied to the editor flag, the check moved after the first write, and the window entry removed, made required or made a file. An install into a scratch home holding `mods/auto-tabs` wrote `"mod": "auto-tabs"`, and the window plan mirrors it. Not verified at release: the tabs renaming themselves in the owner's app, which needs se-configs to install `auto-tabs` and then run `bin/install ~/.config/herdr-app`.

Found in review and tracked apart, older than this issue: a workspace window probes the optional mods with `test -e`, so a regular file at an optional mod path would make opening a window fail.
