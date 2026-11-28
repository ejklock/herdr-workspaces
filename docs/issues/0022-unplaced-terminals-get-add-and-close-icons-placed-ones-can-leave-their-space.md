---
type: Issue
title: Unplaced terminals get add and close icons; placed ones can leave their space
description: Replaces the Unplaced popup's ranked list of spaces with one item that adds the terminal to the shown space.
status: closed
timestamp: 2026-11-28T02:20:43Z
---

## 0022. Unplaced terminals get add and close icons; placed ones can leave their space

## What / Why

[Issue 0017](0017-terminals-with-no-space-are-invisible-in-the-sidebar.md) added the Unplaced section: a click or right-click on a terminal opens a popup of every space on the terminal's machine (parent's space first, then by folder, then the rest), and choosing one runs `hc label <terminal> herdr.space=<id>` (`mods/workspaces/menu.js` › place, `mods/workspaces/menu-items.js` › placeItems, `mods/workspaces/lib.js` › placeOptions). On 2026-11-27 the owner found the long list confusing and asked for one option: add the terminal to the space.

### Scope

- Each Unplaced row shows two icon buttons at its right end: `+` (`plus.svg`) adds the terminal to the shown (active) space by labeling it with that space's id and selecting the space, as the place action does today; `x` (`x.svg`) closes the terminal (`terminal.kill`). The popup of spaces goes away, and a click elsewhere on the row does nothing.
- When the shown space is on another machine than the terminal (the label cannot reach it) or no space is shown, the `+` is not drawn; `x` stays.
- A terminal pane's right-click menu gains "Remove from space" when the terminal carries a `herdr.space` label: it runs `hc label <terminal> herdr.space=` (the documented way to remove a label, `hc label --help`), so the terminal goes back to Unplaced; a failure shows a toast.
- The ranked list of spaces goes away, with `placeOptions`, the "place" menu and their tests.

### Decision

- Adding goes to the shown space only. Owner, 2026-11-27. Not taken: opening the terminal as a tab in the shown space without a label (`terminal.keep`), which would leave it in Unplaced; doing both.
- The owner also asked for removing from the space and closing ("opção de remover também do space, fechar"), then for plain icons ("pode ser só um ícone x e +"), 2026-11-27: the row carries `+` and `x` buttons instead of a popup. Not taken: a popup with "Add to <space>" and "Close terminal" items.
- Removing lives in a placed terminal's pane menu as "Remove from space", since a placed terminal has no Unplaced row. Session judgment; cheap to move.
- A terminal and a shown space on different machines get no `+`, since `herdr.space` names a space of the terminal's own core (`placeLabelArgs` already refuses a cross-machine pair). Session judgment.

### Acceptance

- With a local space shown, a click on a local Unplaced terminal shows "Add to <name>"; choosing it labels the terminal, it leaves Unplaced, and the space is selected.
- With the shown space on another machine, the popup shows the explanatory item and changes nothing.
- `node --test mods` passes.

### Outcome

Shipped in #19 (8e291ce). Unplaced rows carry `+` (labels the terminal into the shown space; hidden across machines or with no shown space) and `x` (`terminal.kill`); the popup of spaces and `placeOptions` are gone; a placed terminal's pane menu offers "Remove from space". `node --test mods` is green (214). Not verified: the icons and actions on screen in the owner's app.
