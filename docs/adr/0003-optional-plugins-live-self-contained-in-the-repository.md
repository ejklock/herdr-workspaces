---
type: ADR
title: Optional plugins live self-contained in the repository
description: Optional plugins such as the editor live self-contained under plugins/, installed by the one bin/install, with their history merged in.
owner: Evaldo Klock
status: Accepted
timestamp: 2026-11-02T13:32:02Z
---

# 0003. Optional plugins live self-contained in the repository

## Context

The editor pane and the my-files tree live in their own repository, herdr-editor (5 commits, no remote, TypeScript built by `tsc`, its build output ignored by git). The owner asked on 2026-11-02 for one repository: "quero sim que o workspaces venha com opção de plugins dentro dele. onde vamos colocar o editor.. não quero dois separados". Herdr refuses a mod import that resolves outside the mod's own folder ([ADR 0002](/adr/0002-one-mod-folder-with-a-role-per-block.md)), so the editor and my-files stay separate mod folders whatever the layout, and my-files only makes sense with the editor: its file click opens an editor pane, and it reads the editor's `shared("editor.claims")`.

## Decision

We will keep each optional plugin self-contained under `plugins/<name>/`, with its own `package.json`, sources, tests, build and `mods/` folders; the first is `plugins/editor/`, holding the `editor` and `my-files` mods. The root `mods/` keeps only `workspaces`, which stays plain JavaScript with no build. One `bin/install <app home>` installs `workspaces` and every plugin by default, building a plugin before copying its mods; `--without <plugin>` skips one. herdr-editor's history comes in without a rewrite: in a fresh clone, one commit moves every file under `plugins/editor/` with `git mv`, and herdr-workspaces merges that clone with `--allow-unrelated-histories`.

Rejected: separate repositories with one install command. It keeps each toolchain apart, but the owner does not want two repositories (2026-11-02).

Rejected: every mod flat in the root `mods/`, TypeScript sources in a root `src/`, one `package.json`. One toolchain and one test command, but it brings a build into a repository that has none, retires ADR 0002's single-folder check, and scatters the moved history over new paths.

## Consequences

**Easier / gained:**
- One repository and one install for the switcher, the editor and my-files.
- The editor keeps its `tsc` build, tests and coverage as they are; `workspaces` keeps editing with no build step.
- `git log --follow` and blame reach herdr-editor's commits through the one rename commit.

**Harder / accepted trade-offs:**
- Two `package.json` files (an npm workspace at the root); `npm test` at the root runs both suites.
- `bin/install` needs Node and the plugin's dev dependencies to build `plugins/editor` unless it is skipped.
- herdr-workspaces is public under MIT on GitHub: the first push after the merge publishes the editor's code under that license, with the file icons' own license file kept beside them.
- The owner's `~/.config/herdr-app/mods/editor`, today a link into herdr-editor, is replaced by a copy at the next install.

**Follow-ups:**
- [Issue 0004](/issues/0004-editor-plugin-moved-into-the-repository.md): the move and the install.

## Verification

**Implementation impact:** `plugins/editor/`, `package.json`, `bin/install`, `bin/install.test.js`, README.

**Verification criteria:** `mods/` holds only `workspaces`; `git log --follow plugins/editor/src/editor/main.ts` lists herdr-editor's commits that touched that file (`--follow` takes one file, never a folder); `bin/install <scratch home>` installs `workspaces`, `editor` and `my-files`, and `bin/install --without editor <scratch home>` installs only `workspaces` with the Files block on `files`.
