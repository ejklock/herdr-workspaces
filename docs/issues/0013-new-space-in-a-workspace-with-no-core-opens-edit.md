---
type: Issue
title: New space in a workspace with no core opens Edit
description: In a workspace that names no core, + / Cmd+N / New space open the edit dialog instead of making the space on the local core, where only Default lists it.
status: in-progress
timestamp: 2026-11-03T20:38:15Z
---

## 0013. New space in a workspace with no core opens Edit

## What / Why

A workspace that names no core (no `machine` in the store) still let "+", Cmd+N (`workspaces:new-space`) and the menu's "New space" run `space.new` with no machine. The space was made on the local core, which only Default lists, so in the active workspace nothing appeared. The owner reported it on 2026-11-03 ("clico e não aparece") with Inovatec, BASE and Planet Argon all unbound in `~/.config/herdr-app/workspaces/workspaces.json` while their cores were attached (`hc machine ls --json`).

### Scope

`mods/workspaces/` only: the spaces role (`+`, Cmd+N) and the menu role ("New space").

### Decision

The owner chose option A over B (a toast, no space) and C (keep the behavior).

- With an active workspace that names no core, "+", Cmd+N and "New space" make no space and open that workspace in the edit dialog, where the Core row binds it.
- Default and a workspace with a core keep making the space as before (local core, the workspace's core).
- The store is read first when none is followed yet, as today, so the choice uses the settled store.

### Acceptance

- [x] The new-space choice opens Edit for an active workspace with no core, and makes the space on the core or the local core otherwise (`mods/workspaces/lib.test.js`).
- [x] "+" and Cmd+N in the spaces role, and "New space" in the menu, follow that choice.
- [ ] In the owner's window, "+" on an unbound workspace opens Edit.
