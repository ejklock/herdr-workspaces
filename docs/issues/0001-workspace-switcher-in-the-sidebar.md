---
type: Issue
title: Workspace switcher in the sidebar
description: Filter the sidebar by user-defined workspaces, with a switcher above Settings and assignment from the space menu.
status: open
timestamp: 2026-10-30T17:12:45Z
---

## 0001. Workspace switcher in the sidebar

### What / Why

Implements [ADR 0001](/adr/0001-one-core-per-company-attached-as-a-machine.md). With every company's core attached, the sidebar lists all spaces grouped by machine. The owner wants workspaces on top of that: Default holds the spaces in no workspace, and a + creates a workspace (name, icon, color) to which spaces are assigned through the usual space menu, with a switcher near Settings.

### Scope

- Clones of the shipped `spaces`, `menu`, `workspace-chrome` and `workspace-status` mods, as files of one `workspaces` mod, and of the `main` layout, as layout `workspaces`; Herdr's shipped files stay untouched.
- Sidebar filtered by the active workspace; machine groups with none of its spaces hidden.
- The Agents list filtered the same way: only agents in the visible spaces.
- A switcher row directly above Settings: active workspace's icon, color and name; a popup with Default, each workspace, and New workspace…; edit and delete.
- "Move to workspace…" in a space's right-click menu, with Default.
- The local machine labelled "default" instead of "This computer", in the sidebar and the status bar.
- `bin/install <app home>` copying the repository's mod and layout into a Herdr app home.

Kept: every shipped behavior of the cloned mods (fold, +, drag, worktree items, Rename, Close).

### Decision

- Workspaces are stored in `<app home>/workspaces/workspaces.json`, not in Herdr's `shared()` state, so another window can read them later (phase 2); not taken: `shared()`, which is per app home.
- Every view that follows the store also keeps the last store it read in `shared("workspaces.store")`, and a view starts from that copy before reading the file, so a popup opens with the full list at once; the file stays the only source of truth. Not taken: starting each popup from an empty store (the switcher and the move list showed only Default for about a second, owner 2026-10-30), or passing the store through overlay props (four files instead of one).
- The active workspace is per window (`shared("workspaces.active")`); not taken: a global active workspace, which would make every window switch together.
- UI text is English, matching Herdr's own; not taken: Portuguese labels mixed into an English app.
- The Agents list shows only the agents of the visible spaces, and `agent.next`/`agent.prev` and the row numbers follow that list; not taken: listing every agent under any workspace, which the owner saw as noise (2026-10-30).
- The first switcher entry is Default: the spaces in no workspace (an assignment to a deleted workspace counts as none), and their agents; moving a space into a workspace takes it out of Default, and moving it to Default takes it out of its workspace. Not taken: All listing every space, which the owner replaced on 2026-10-30 because a moved space stayed in the list.
- A space created in a window while a workspace is active joins that workspace (written to the store), only if it arrived after the view started, is the window's active space, is in no workspace, and is decided once when first seen; the owner changed this on 2026-10-30 after eight new spaces vanished into Default. Spaces that arrive otherwise (a machine reconnecting, another window) are not taken; with Default active a new space stays in Default. Not taken: leaving every new space in Default, which the filter hides.
- Every role lives in one mod folder, per [ADR 0002](/adr/0002-one-mod-folder-with-a-role-per-block.md).
- `bin/install` copies the mod and the layout into the app home; not taken: symlinks, under which Herdr 0.1.9 drew none of the mod's own SVG icons (seen 2026-10-30 in the owner's window) and did not reload edits.
- The switcher is a footer section titled "Workspace" with a bordered selector (icon in the workspace's color, name, ▾), set apart from Settings and Add machine by dividers; not taken: a selector at the top of the sidebar, or a bare row styled like Settings (too easy to miss).
- Deleting a workspace confirms in two steps inside its own dialog (Delete, then Confirm delete); not taken: Herdr's shipped `confirm` mod, which can only run an app command and so cannot write the store.

### Acceptance

- With layout `workspaces`, Default shows only the spaces in no workspace; choosing a workspace shows only its spaces, across machines.
- Creating, editing and deleting a workspace works from the switcher; invalid names (empty, duplicate ignoring case) are refused in the dialog; deleting the active one falls back to Default, where its spaces now show.
- Moving a space to a workspace, or to Default, updates the sidebar without a restart.
- With a workspace active, the Agents list shows only agents in its spaces; Default shows the agents of the spaces in no workspace.
- The local machine reads "default"; switching back to layout `main` restores the stock sidebar.
- `npm test` covers the store and the filter; `herdr-app check` passes for every mod.

### Plan

One coder slice, tested in a scratch app home and scratch cores; the session then installs into the owner's home and switches the layout with the owner.
