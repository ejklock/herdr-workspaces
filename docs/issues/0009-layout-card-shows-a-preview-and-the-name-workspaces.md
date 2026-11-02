---
type: Issue
title: Layout card shows a preview and the name Workspaces
description: <One sentence — the change and its motivation.>
status: closed
timestamp: 2026-11-02T18:28:08Z
---

## 0009. Layout card shows a preview and the name Workspaces

## What / Why

In Herdr's Settings, the Layout row shows this repository's layout as a blank frame named `workspaces`, beside the shipped cards "Herdr", "Terminals" and "Herdr 98". The owner asked for a real preview and a capitalized name.

Probed in a scratch app home (2026-11-02):
- the root `"preview"` accepts a path inside the mod folder (`mods/workspaces/preview.svg` drew in the card);
- the root `"title"` does not change the card's name;
- Herdr maps only its shipped layouts to display names (`main` to "Herdr", `win98` to "Herdr 98"). Any other layout shows its file name as is;
- a layout file named `Workspaces.json` showed "Workspaces" in the card, and `herdr-app status` reported `"layout": "Workspaces"`.

### Scope

- A preview drawing of the layout in `mods/workspaces/preview.svg`, in the style of the shipped previews, named by the layout root's `"preview"`.
- The layout is renamed from `layouts/workspaces.json` to `layouts/Workspaces.json`, and every place that names it follows:
  - `bin/install` and its tests;
  - the new-window state and mirror in `mods/workspaces/lib.js`, and their tests;
  - README, RECIPE and ADR 0002's implementation note.
- The installer replaces an earlier `workspaces.json` it installed, so the target home keeps one layout file with the new name. macOS folders ignore case, so both names would otherwise refer to the same file.
- Kept: the mod folder `mods/workspaces`, every mod id `"workspaces"`, and the shared keys under `workspaces.`.

### Decision

- Rename the file rather than keep `workspaces` or migrate Herdr's state. The owner's choice: the card and the palette show "Workspaces". The cost is that Herdr's per-layout clicks (sidebar width, the layout's theme picks, shown and hidden panels, in `layouts/.state/`) start fresh once under the new name. Migrating them was rejected because Herdr's guide says not to edit those files.
- The preview lives in the mod folder, not in `layouts/`, so the installer needs no new copy step.

### Acceptance

- Settings shows the card "Workspaces" with the preview drawing, in a scratch app home installed by `bin/install`.
- After `bin/install` on a home holding the earlier `layouts/workspaces.json`, the folder lists `Workspaces.json` and no `workspaces.json`.
- A new workspace window's `shared.json` names the layout `Workspaces`, and its mirror copies `layouts/Workspaces.json`.
- `npm test` is green, and `herdr-app check` passes on the mod.

### Outcome

The layout is now `layouts/Workspaces.json`, and Settings shows it as the card "Workspaces". Its preview, `mods/workspaces/preview.svg`, is a grey wireframe of the sidebar, selector, spaces, agents, tabs and pane, in the style of the shipped previews.

`bin/install` writes the layout in place. It removes an earlier `workspaces.json` only when the folder lists that exact name. A new workspace window gets the new spelling too.

In a scratch copy of a home that had saved the `workspaces` layout, Herdr still opens the layout, but the card shows no check mark until the person picks it once. That pick starts Herdr's per-layout clicks fresh, and the README says so. Two review rounds; the install cases were also proved on a case-sensitive volume.
