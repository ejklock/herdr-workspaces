---
type: Issue
title: Workspace window inherits the main window's look and welcome state
description: A workspace window mirrors the main home's layouts/.state and carries frame.welcomed, so it opens with the owner's theme, the Changes/Files panel and no welcome.
status: open
timestamp: 2026-11-04T14:03:24Z
---

## 0014. Workspace window inherits the main window's look and welcome state

## What / Why

On 2026-11-04 the owner opened a workspace in a new window (the ⧉ button, [issue 0008](/issues/0008-open-the-active-workspace-in-a-new-herdr-window.md)). The window started like a fresh Herdr: it showed the welcome tutorial, it did not have the main window's theme, and Changes and Files were missing.

Cause, read from the files without opening a window:
- Herdr keeps a layout's clicks (sizes, shown or hidden, theme picks, background, text size, pane header look) in `layouts/.state/` (`~/.config/herdr-app/AGENTS.md:210-212`).
- The main home's `layouts/.state/workspaces.json` holds the theme `{light: paper, dark: ink}` and `panel.hidden: false`.
- The shipped `layouts/Workspaces.json` has `theme: null` and `panel.hidden: true`. The panel is where `my-changes` and `my-files` live.
- The open plan (`WINDOW_SOURCES` in `mods/workspaces/lib.js`) mirrors mods, the layout file, `keys.json`, `settings.json` and `themes/`, but not `layouts/.state/`. No window home under `~/.config/herdr-app-windows/` has one.
- The window's `shared.json` gets only `layout`, `workspaces.active`, `workspaces.home` and `workspaces.focus-first` (`windowShared`). The main home's `frame.welcomed` ("finished") is not carried, so the welcome shows. That this key alone gates the welcome is an inference from its name and value.

The defect dates from the window feature (0008). The `base` and `inovatec` window homes were created on 2026-11-04 without `.state`.

### Scope

Each open of a workspace window carries the main home's look and welcome state:
- It mirrors `layouts/.state/` from the main home, with the same `rsync -aL --delete` as the other folders, when it exists.
- It sets the window's `frame.welcomed` to the main home's value, read from the main home's `shared.json`, when that value is present.

Out of scope: other keys of the main `shared.json` (sidebar width, my-diff wrap, agent sort), which the owner did not report.

### Decision

- Copy on every open, not only the first one. The owner chose this on 2026-11-04 over copying once and leaving it as is. A window then always matches the main window, the same way the mods and settings already do. A size or theme picked only in a window goes back to the main window's on its next open.
- The welcome state comes from the main home's `shared.json` (the store home `workspaces.home` names), not from the opener's own shared state, so a window opened from another workspace window carries the main home's value too. `window.js` already reads and writes files in another home with `readTextFile` and `writeTextFile`.
- Herdr's guide says not to edit `layouts/.state/`. The open copies the main home's files into a window home whose Herdr is not running (the plan stops when its socket answers) and never edits a file's contents.

### Acceptance

- `npm test` at the repository root is green. New cases cover:
  - the plan mirrors `layouts/.state` when it is present and leaves it out when it is absent;
  - `frame.welcomed` is carried when the main home has it, kept as the window had it when the main home lacks it, and the main home's text being absent or unreadable is handled.
- In the app, a workspace window opened after `bin/install` shows the main window's theme, the Changes/Files panel, and no welcome.

### Outcome
