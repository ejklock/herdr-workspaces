---
type: Issue
title: Installer marker names the project, not the checkout path
description: The .installed-from marker holds the project name, so a copy made from a release tarball and one made from a dev checkout replace each other.
status: closed
timestamp: 2026-11-02T19:44:13Z
---

## 0010. Installer marker names the project, not the checkout path

## What / Why

`bin/install` and the editor plugin's `bin/install-files` mark each copy they make with a `.installed-from` file holding the absolute path of the checkout (or of the plugin folder) that made it, and refuse a copy whose marker holds any other path. So an install from a release tarball extracted in one folder refuses the copy a dev checkout made, and the reverse. se-configs' install all is going to install this project from the release tarball, beside the owner's dev checkout, so the two must replace each other.

### Scope

- Both installers write `herdr-workspaces` into every marker they write: `mods/workspaces`, `mods/editor`, `mods/my-files`.
- A marker counts as ours when it holds exactly `herdr-workspaces`, or when it holds an absolute path, which is the earlier marker form.
- Everything else keeps being refused before anything is written: no marker, another name, a relative path, a marker that is a link where that is refused today, a foreign symlinked target.
- README and the plugin's README say what the marker holds.

### Decision

- The marker names the project, not the source path. That was the owner's choice, made in the se-configs session and confirmed here on 2026-11-02.
- An earlier marker, any absolute path, counts as ours, so installs already made are replaced without a manual step. The owner chose this knowing it accepts any path: only these installers ever wrote the file.
- Each script keeps its own check. The plugin's installer also runs alone from its folder, so a shared helper would tie the two scripts together for a few lines of shell.
- `bin/install` still does not run `npm ci`; whoever installs from a tarball runs it at the extracted root first, as se-configs plans to. The editor build needs `tsc` from the `typescript` devDependency. A clean v0.1.1 tarball built here without `node_modules` only because this machine has a global `tsc`. The build also reads `herdr.d.ts` and `gpui-kit.d.ts` from `HERDR_APP_HOME`, which a home Herdr has opened already holds; an empty home is refused with "herdr.d.ts is not a file".

### Acceptance

- After an install, each marker written holds `herdr-workspaces`.
- An install from a second copy of the repository, in another folder, replaces the first copy's mods and layout.
- A folder the project did not make is still refused, and nothing in the home is written.
- `npm test` is green.

### Outcome

Both installers write `herdr-workspaces` into `mods/workspaces`, `mods/editor` and `mods/my-files`. They accept a marker that holds exactly that name or an absolute path, and refuse anything else before writing. An install from a second copy of the repository replaces the first copy's mods and layout. Tests cover:
- the four markers that are replaced;
- the foreign markers that are refused (none, empty, another name, other case, leading space, relative path, a link where one was refused before, a folder);
- the second-checkout flow, through both installers.

`npm test` passes 240 root and 328 plugin tests, up from 205 and 302. One review round approved it. Accepted as is: `$(cat)` drops trailing newlines, so a marker of the name followed by newlines also counts, as the path check did before. The root installer still follows a link marker, as before, and unlinks it before writing.
