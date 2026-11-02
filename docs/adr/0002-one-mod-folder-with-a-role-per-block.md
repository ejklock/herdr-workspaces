---
type: ADR
title: One mod folder with a role per block
description: All workspace roles live in one Herdr mod folder, chosen by props, because Herdr refuses imports from outside a mod's folder.
owner: Evaldo Klock
status: Accepted
timestamp: 2026-10-30T17:22:43Z
---

# 0002. One mod folder with a role per block

## Context

[Issue 0001](/issues/0001-workspace-switcher-in-the-sidebar.md) needs the same workspace logic (parse and write the store, filter the visible spaces) in the sidebar list, the space menu, the footer switcher, the switcher popup and the create/edit dialog. Herdr 0.1.9 refuses a mod import that resolves outside the mod's own folder ("resolves outside the application directory"), and resolves symlinks to their real path first, so a shared `ws-lib` folder cannot be imported by the other mods (probed 2026-10-30 with `herdr-app check` in a scratch app home).

## Decision

We will ship one mod folder, `mods/workspaces/`, holding one file per role (the clones of `spaces`, `menu`, `workspace-chrome` and `workspace-status`, the switcher popup, the dialog) and the shared logic; its `main.js` picks the role from `props().role`, and every layout block and overlay names `mod: "workspaces"` with its role.

Rejected: one folder per role with the logic copied into each by `bin/install`. It keeps Herdr's "one mod per idea" shape, but five copies and a sync step invite edits to the wrong copy.

Rejected: only the new mods merged, the clones kept apart. The cloned sidebar and menu still need the filter and the store writes, so the logic would still be duplicated.

## Consequences

**Easier / gained:**
- The store and filter live once, tested once by `npm test`.
- Each clone stays a separate file, so its diff from Herdr's shipped source stays readable when Herdr ships a new version.

**Harder / accepted trade-offs:**
- Saving any file reloads every role at once.
- Herdr's `<mod>.<command>` key commands reach every shown copy of `workspaces`; a role that handles a command ignores the others.
- Herdr's `mod.clone` records one `cloned_from`; the README records which file came from which shipped mod and version.

**Follow-ups:**
- None.

## Verification

**Implementation impact:** `mods/workspaces/`, `layouts/Workspaces.json`, `bin/install`.

**Verification criteria:** `mods/` holds exactly one folder; `herdr-app check` passes on it; `layouts/Workspaces.json` names no mod other than `workspaces` and Herdr's shipped ones.
