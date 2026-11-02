---
type: Issue
title: Editor plugin moved into the repository
description: Move herdr-editor into plugins/editor with its history and install it with the workspaces mod by default.
status: open
blocked_by: [herdr-editor file-icons work committed (t2c)]
timestamp: 2026-11-02T13:33:36Z
---

## 0004. Editor plugin moved into the repository

### What / Why

Implements [ADR 0003](/adr/0003-optional-plugins-live-self-contained-in-the-repository.md): the editor and my-files mods, today in the herdr-editor repository, move into `plugins/editor/` with their history, and one install covers them.

### Scope

- A clone of herdr-editor with one commit moving every tracked file under `plugins/editor/` (`git mv`), merged with `--allow-unrelated-histories`; nothing rewritten, herdr-editor itself untouched.
- A root npm workspace; root `npm test` runs both suites.
- `bin/install [--without <plugin>] <app home>`: installs `workspaces` and, unless skipped, builds `plugins/editor` and copies `editor` and `my-files` with the same marker and refusal rules as today; the Files block uses `my-files` when it is installed.
- README: the plugins, the install and the license note.

### Decision

- Plugins are on by default, `--without <plugin>` skips one; not taken: off by default with `--with`. Owner, 2026-11-02.
- `editor` and `my-files` are one plugin, because my-files opens the editor and reads its claims.
- The `editor` mod is copied too, replacing the owner's link into herdr-editor; one install rule for every mod.
- Waits until the in-flight file-icons work in herdr-editor is committed there, so the clone carries it.

### Acceptance

- `mods/` holds only `workspaces`; `git log --follow` on a moved file lists its herdr-editor commits.
- In a scratch app home, `bin/install` installs the three mods and `herdr-app check` passes; `--without editor` installs only `workspaces` with the Files block on `files`.
- `npm test`, the editor's typecheck and coverage pass from the new paths.

### Plan

One coder slice once herdr-editor's icons work is committed; push and the archive of herdr-editor wait for the owner.
