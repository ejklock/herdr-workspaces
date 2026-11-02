---
type: Issue
title: Editor opens files of a workspace core as local files
description: Files in a workspace's own core, which runs on this computer, open editable with Open in Fresh instead of read-only through the remote path.
status: closed
timestamp: 2026-11-02T23:35:53Z
---

## 0012. Editor opens files of a workspace core as local files

## What / Why

Since each workspace runs in its own herdr-core attached as a machine (ADR 0001, issue 0002), every space of a workspace has a `machine`. The Files and Changes panels open the editor with `on` set to that machine, so the editor treats the file as one on another computer:

- it opens read-only ("File on another machine");
- Open in Fresh is gone, because it is offered only in a space whose `machine` is null;
- the file is read through the app's remote path, and the pane stays on "Loading file…" for a long time.

The owner reported both symptoms on 2026-11-02 with `abby-support-ticket/npm-packages/abby-ui/src/ConfirmDialog.vue` in the planet-argon workspace. These cores run on the same computer, reached through a plain `sh -c` (`hc machine ls`: target `sh -c`, host this Mac). They share its files, paths and programs.

Measured outside the app: `hc exec --on planet-argon` and `hc file read --on planet-argon` take about 10 ms, and the editor's local shell steps (`realpath`, `wc`, formatter probe) about 20 ms. The cost of the app's own `readTextFile(path, { on })` was not measured.

### Scope

Only the editor plugin's `editor` mod (`plugins/editor/src/editor/`). Files and Changes keep passing the space's machine.

### Decision

The owner chose option A over two others: B (Files passes `on: null` for these cores, which leaves Fresh hidden) and C (keep read-only).

- On its first open, the editor asks `hc machine ls --json` once. It takes as being on this computer every machine whose target is exactly `sh -c`. This is the target rule the workspaces mod uses for its cores (`mods/workspaces/lib.js` `isSh`), with temporary machines included because they also run here. It is mirrored, not imported, because the plugin is self-contained (ADR 0003).
- A file whose `on` names such a machine is opened as a local file: editable, with the project's formatter.
- A pane in a space on such a machine is local for Open in Fresh. The Fresh terminal starts on the space's core, which runs on this computer.
- A failed or unparseable listing names no machine, which keeps today's behavior.

### Acceptance

- [x] `localMachines` names every machine reached through `sh -c` and none for ssh, another command, or output that is not a listing (`tests/editor/routing.test.ts`).
- [x] `isLocalPane` is true in a space on such a machine and false on any other (`tests/editor/routing.test.ts`).
- [x] `machineToReach` maps such a machine to this computer and leaves any other alone (`tests/editor/routing.test.ts`).
- [ ] In the owner's window, ConfirmDialog.vue opens editable, quickly, with Open in Fresh. Not verified at release: it needs `bin/install` into the owner's app, which was not run.
