---
type: Issue
title: SSH machine can be a workspace's core
description: The dialog's Core row offers every attached machine, SSH included, so a remote machine such as dev-home can be a workspace's core.
status: open
timestamp: 2026-11-07T02:27:37Z
---

## 0015. SSH machine can be a workspace's core

## What / Why

The owner cannot put the SSH machine `dev-home` in a workspace (reported 2026-11-06). The workspace "Dev Home" exists in `~/.config/herdr-app/workspaces/workspaces.json` with no `machine`, and `hc machine ls --json` lists `dev-home` as connected with `target: "dev-home"`. Two rules of [issue 0002](/issues/0002-sidebar-without-machine-headers-each-workspace-bound-to-its-core.md) block it together:

- The dialog's Core row offers only `sh -c` machines (`mods/workspaces/lib.js` › `dialogCores`), so `dev-home` cannot be bound.
- A space of a machine that no workspace names, and that nobody moved, shows nowhere (`visibleSpaces`), so its right-click menu, which holds "Move to workspace…", never opens.

"+" in the unbound workspace opens Edit ([issue 0013](/issues/0013-new-space-in-a-workspace-with-no-core-opens-edit.md)), which leads back to the first rule.

### Scope

`mods/workspaces/` (the dialog's core list), README, RECIPE and a constitution amendment.

### Decision

The owner chose option A on 2026-11-06:

- The Core row offers every attached machine that is not temporary and that no other workspace names, whatever its target (SSH included), with its state when not connected.
- A machine bound as a core loses its machine header and its "Move to workspace…" item, as the `sh -c` cores already do.
- Not taken: B, Default lists the spaces of machines that no workspace names, under their header, so they can be moved. That would reverse the 0002 decision that these spaces show nowhere.
- Not taken: A + B together.
- The editor's local-file routing (`plugins/editor`) still treats only `sh -c` machines as this computer. An SSH core's files stay remote.

### Acceptance

- [ ] The dialog's Core row lists `dev-home` (SSH, connected) and `abby-stg` (SSH, unreachable, with its state), and still leaves out temporary machines and the cores of other workspaces (`npm test`).
- [ ] With "Dev Home" bound to `dev-home`, the sidebar lists the `dev-home` spaces with no header, and "+" makes a space on `dev-home`. Verified in the owner's window after `bin/install`.
