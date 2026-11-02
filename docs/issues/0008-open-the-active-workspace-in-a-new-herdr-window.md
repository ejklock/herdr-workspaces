---
type: Issue
title: Open the active workspace in a new Herdr window
description: An icon beside the Workspace selector opens the active workspace in a second Herdr window that shares the same store.
status: closed
timestamp: 2026-11-02T17:32:37Z
---

## 0008. Open the active workspace in a new Herdr window

### Scope

An icon (⧉) beside the Workspace selector at the top of the sidebar opens the active workspace in a new Herdr window. The new window opens with that workspace selected and shows its spaces. Both windows read and write the same workspace store, so a workspace, group or move made in one shows in the other.

### Decision

- The owner chose on 2026-11-02 an icon beside the selector over one icon per row in the switcher popup.
- Herdr has no command for a new window, and runs one window per app home (`HERDR_APP_HOME`). A new window is therefore a second Herdr process with its own home. It is opened from the mod with `exec("/usr/bin/open", ["-n", "-a", "/Applications/Herdr.app", "--env", "HERDR_APP_HOME=<home>"])`.
- A probe in scratch homes on 2026-11-02 proved the mechanism (agent-memory observation 7593):
  - the second window attaches to the same herdr-core and lists the same spaces;
  - the `exec` returns at once;
  - a home whose `shared.json` names `layout: "workspaces"` and `workspaces.active` opens on that workspace.
- Owner's choices on 2026-11-02:
  - **Store:** the new home's `shared.json` carries `workspaces.home`, the path of the main home, and the mod reads, writes and watches the store there. A symlinked `workspaces/` folder was not taken, because the watch and the atomic write through a link are unproven.
  - **Home:** each window's home is `~/.config/herdr-app-windows/<id>`, one per workspace, reused on the next open. The main home is never written. `~/Library/Application Support` was not taken: hidden, and macOS only.
  - **Copy:** every open copies again from the main home the mods (workspaces, editor, my-files), the workspaces layout, `keys.json`, `settings.json` and `themes/`, so a reinstall reaches the next window. Copying only the first time was not taken.
  - **Focus:** the new window selects the workspace's first space in sidebar order with `space.select`. The last space used was not taken, because it needs new state.
- Open: the constitution lists "distinct Dock or Cmd+Tab entries per workspace: one app stays one app" as out of scope. A second Herdr process is, by inference, a second Dock and Cmd+Tab entry. That was not checked in the probe. The owner decides.

### Acceptance

- Clicking ⧉ opens a new Herdr window with the active workspace selected. Its focused space is one of that workspace's spaces.
- Clicking ⧉ again for the same workspace reuses that workspace's home.
- A workspace, group or move made in either window shows in the other.
- The owner's main window and its home are not changed by opening one.
- README and RECIPE describe the icon, the homes it makes, and what it runs (`open`).

### Plan

To be written once the open decisions are settled.

### Outcome

The window button beside the selector opens the active workspace in a Herdr process of its own, with its own app home at `~/.config/herdr-app-windows/<id>`. The workspace's spaces are listed and its first space is focused.
- Each open mirrors the main home's mods and settings, then writes the window's `shared.json` (the layout, the workspace, `workspaces.home` pointing at the main home's store, and a focus flag), then starts Herdr with `open -n --env HERDR_APP_HOME`.
- The window reads and writes the main home's store, so both windows see the same workspaces.

An end-to-end run in scratch homes found a defect. A mod's `fs/promises` writes only inside its own app home, so the window could never create the store folder and never read it. Every store folder is now made with `exec /bin/mkdir -p`. A rejected store read no longer ends the follower loop. The button stays inert for a home until the new window answers on its socket, or for at most 15 seconds.

The work took three review rounds. The last end-to-end run showed the workspace and focused its first space, and two clicks opened one window.
