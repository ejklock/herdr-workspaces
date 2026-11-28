---
type: Issue
title: Changes and Files move to a stack of views in the left sidebar
description: Moves Changes and Files from the right panel into a VS Code-style stack of views in the left sidebar.
status: open
timestamp: 2026-11-28T00:50:15Z
---

## 0019. Changes and Files move to a stack of views in the left sidebar

## What / Why

On 2026-11-27 the owner asked for a stack on the left, like VS Code's side bar, with Changes moved there. Today Files and Changes live in the right panel: the `panel` column, hidden by default, holds the `panel-body` stack in `layouts/Workspaces.json`. The left `sidebar-lists` column holds only the `spaces` and `agents` blocks.

### Scope

- The left `sidebar-lists` becomes a stack of views: Spaces (with Agents under it), Changes and Files. A row of icons switches the view with `layout.select {stack, child}`.
- The right `panel` column and its `panel-body` stack leave the layout.
- `bin/install` keeps swapping `files` and `changes` to `my-files` and `my-changes` by mod name, so the swap still works after the move.

### Decision

- Format: a stack of views in the left sidebar, VS Code style. Owner, 2026-11-27. Not taken: a third fixed block under Agents; moving the whole right panel to the left; keeping the layout as it is.
- Files and Changes leave the right panel, so each view lives in one place. Owner, 2026-11-27. Not taken: keeping them on both sides.
- The tab bar's Files and Changes buttons (`auto-tabs` and Herdr's `tabs`, which show the `panel` column and select in `panel-body`, listed by `shared("workspace.panels")`, default `["files", "changes"]`) stay as they are. Owner, 2026-11-27, after first choosing to hide them while the Workspaces layout is shown. Not taken: hiding them through `workspace.panels`; pointing them at the left stack by reusing the `panel` and `panel-body` ids.
- Node ids: the stack is `sidebar-views` with children `sidebar-spaces` (the column of the `spaces` and `agents` blocks, active by default), `files` and `changes`; the icon row is the block `sidebar-views-bar`, a `workspaces` copy with props `{ role: "chrome", views: true }`, above the stack. Icons from `mods/workspaces/`: `layers.svg` Spaces, `files.svg` Files, `git-compare.svg` Changes. Session judgment.
- In the narrow rail (sidebar under 160px) the row shows only the active view's icon, and a click moves to the next view: three icons do not fit in 44px. Session judgment.

### Acceptance

- In a scratch app home installed by `bin/install`, the left sidebar shows the icon row; a click shows Spaces, Changes or Files in the same area.
- The layout has no `panel` column.
- A click on a changed file in the left Changes view opens the diff in one reused `my-diff` pane.
- `node --test bin/install.test.js` and the workspaces mod tests pass.

### Plan

- S1: the left sidebar shows a row of view icons (Spaces, Files, Changes) over a stack of those views, and the right `panel` column is gone | files: layouts/Workspaces.json, mods/workspaces/chrome.js, mods/workspaces/lib.js, mods/workspaces/lib.test.js, RECIPE.md, README.md | after: none
