---
type: Issue
title: Space groups in the sidebar
description: Named folding groups, one level deep, per workspace, filled from the space menu or by drag.
status: closed
timestamp: 2026-11-02T13:33:35Z
---

## 0003. Space groups in the sidebar

### What / Why

With the machine headers gone ([issue 0002](/issues/0002-sidebar-without-machine-headers-each-workspace-bound-to-its-core.md)), a workspace's spaces are one flat list; BASE alone holds 16. The owner asked on 2026-11-02 for a way to organise them: folders, dividers or groups.

### Scope

- Named groups, one level deep, per workspace; Default has its own.
- A group header folds with a chevron, as the machine headers did (`mods/workspaces/spaces.js` today); the fold state stays in the window's `localStorage`.
- A space's menu has "Move to group…" with its groups, "No group" and "New group…"; a group's header menu renames and deletes it.
- Dragging a space onto a group header or into a group moves it there; dragging within a group keeps reordering.
- Spaces in no group show first, then each group in its order.

### Decision

- Groups are part of the `workspaces` mod, with no switch to turn them off; not taken: an optional plugin, which would need a second cloned sidebar. Owner, 2026-11-02.
- One level of folding groups; not taken: plain dividers, which hide nothing, or nested folders, much larger to draw and drag. Owner, 2026-11-02.
- Groups per workspace; not taken: one set of groups for every workspace. Owner, 2026-11-02.
- Menu and drag both, in one slice. Owner, 2026-11-02.
- Groups and their members live in the store file beside the workspaces, so every window sees them; deleting a group leaves its spaces in no group.

### Acceptance

- In BASE, creating a group, moving three spaces into it by menu and one by drag shows them under the group; folding hides them, and the fold survives a reload.
- Renaming and deleting a group work from its header; deleting leaves its spaces in no group.
- Another workspace and Default do not show BASE's groups.
- `npm test` covers the group store changes; `herdr-app check` passes.

### Plan

One coder slice after issue 0002, because it changes the same files.

### Outcome

Shipped in 7bacaef: named groups per workspace and Default, folding headers, "Move to group…", drag onto a group, Rename and Delete on a header; a nested worktree row moves with its main checkout. Tracked: the background git check of a nested worktree reads its own group entry instead of its main checkout's.
