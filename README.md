# herdr-workspaces

A Herdr app layout named `workspaces`. Its sidebar lists only the chosen workspace's spaces (Default, the spaces in no workspace, by
default), with a "Workspace" selector in the footer, set apart from Settings, to pick, create, edit and delete workspaces (name, icon,
color), and a "Move to workspace…" item in each space's right-click menu. The local machine reads
"default" instead of "This computer". Everything is served by one mod folder, `mods/workspaces/`.

## Install

```sh
bin/install ~/.config/herdr-app
```

The script copies `mods/workspaces` (without tests and editor files) and `layouts/workspaces.json` into
the app home; Herdr draws a mod's icons and reloads its edits only from real files, not links. Rerun it
after each change: Herdr picks the edit up in the open window. The copy carries a `.installed-from` file
naming this repository. A rerun replaces its own earlier copy or an earlier link into this repository
and refuses anything else (another folder, a foreign link, a layout file it did not make), checking both
targets before writing either.

## Switch to the layout and back

```sh
herdr-app do layout.switch '{"name":"workspaces"}'
herdr-app do layout.switch '{"name":"main"}'
```

## Layout of the mod

`main.js` picks a role from `props().role` (spaces, agents, chrome, status, menu, switcher, dialog) and delegates
to that role's file. `lib.js` holds the pure store logic; `npm test` runs `lib.test.js`.

The store is `<app home>/workspaces/workspaces.json`; the active workspace of a window is the shared
value `workspaces.active` (absent means Default, the spaces in no workspace).

## Derived from shipped mods (Herdr 0.1.9)

| File | Derived from |
|---|---|
| `spaces.js` | `spaces` |
| `agents.js` | `agents` |
| `menu.js` | `menu` |
| `chrome.js` and the SVGs | `workspace-chrome` |
| `status.js` | `workspace-status` |
| `dialog.js` | `prompt` (text field) |
| `switcher.js` | `menu` (popup) |
| `layouts/workspaces.json` | `main` |
