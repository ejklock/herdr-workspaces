# herdr-workspaces: a workspace switcher layout for the Herdr app

A Herdr app layout and mod (`workspaces`) that groups your spaces into workspaces, so one Herdr window stays tidy when you run many AI coding agents across several herdr-core machines. The sidebar lists only the chosen workspace's spaces (Default, this computer's spaces, by default), with a "Workspace" selector at the top of the sidebar, above the spaces list, to pick, create, edit and delete workspaces (name, icon, color, core), and a "Move to workspace…" item in the right-click menu of a space on another machine. The status bar names this computer "default" instead of "This computer". Everything is served by one mod folder, `mods/workspaces/`.

![The workspaces layout: the Acme workspace active, its two spaces listed with no machine header, and the Workspace selector in the footer](preview.png)

## Features

- Workspaces with a name, an icon (ten to choose from), a color (six) and a core; create, edit and delete them from the workspace selector.
- The spaces list and the agents list both show only the active workspace; Default shows this computer's spaces.
- A workspace is its core: pick an attached `sh -c` machine in the Core row of the create/edit dialog (each core belongs to one workspace; the dialog never creates a core). The workspace lists every space of its core.
- Default is this computer's spaces.
- A space on another machine (one no workspace names, such as an SSH host) sits under a header for that machine, and its right-click menu has "Move to workspace…" to list it in a workspace. Spaces of this computer and of a workspace's core have no such item.
- Groups: each workspace, and Default, can hold named groups of its spaces, one level deep. The sidebar lists the spaces in no group first, then each group under a header with a chevron that folds it (the fold is kept in the window's `localStorage`). A worktree row nested under its main checkout belongs to the main checkout's group: its menu and a drag move the main checkout, and the worktrees go with it. In the narrow rail a folded group's spaces are not listed. A space's right-click menu has "Move to group…" with the workspace's groups, "No group" and "New group…"; dragging a space onto a group's header, or onto a row inside a group, moves it there, and dragging it onto a row in no group takes it out. A group header's right-click menu has Rename and Delete. Deleting a group leaves its spaces in no group. Another workspace and Default do not show a workspace's groups. Groups live in the workspace store file (`groups` and `grouped`).
- A workspace with no core shows the row "Choose this workspace's core in Edit", which opens the dialog.
- A core is made outside the app with `hc machine add --via 'sh -c' --name <workspace> --session <workspace>`.
- A new space is made on the active workspace's core. To make Cmd+N do that, set `"cmd-n": "workspaces:new-space"` in your `keys.json` (the mod never edits it).
- Agent status (working, blocked, done, idle), sub-agents, git branch and ahead/behind next to each space, a status bar with machine, branch and agent counts.
- The workspace store is one JSON file shared by every window of the app home.
- A window icon beside the Workspace selector (not in the narrow rail) opens the active workspace, or Default, in a new Herdr window. That window shows the workspace selected with its first listed space focused, and uses this home's workspace store. Each workspace has one window home, `~/.config/herdr-app-windows/<workspace id>` (Default: `_default`), reused on every open. If that window is already running, you get a notification and nothing else happens.

## Install

Ask your Herdr agent to add `herdr.dev/layouts/ejklock/workspaces` (the layout is listed there once the repository carries the `herdr-layout` topic). Herdr tells you before adding it that the mod runs programs and reads files outside its folder; see "What it runs, reads and writes".

Or by hand, from a clone of this repository:

```sh
bin/install ~/.config/herdr-app
```

The script copies `mods/workspaces` (without tests and editor files) and `layouts/Workspaces.json` (replacing an earlier `workspaces.json` it installed) into
the app home; Herdr draws a mod's icons and reloads its edits only from real files, not links. Rerun it
after each change: Herdr picks the edit up in the open window. The copy carries a `.installed-from` file
naming this repository. The layout's side-panel Files block uses the `my-files` mod when the editor
plugin is installed (the default), and Herdr's `files` with `--without editor`. A rerun replaces its own
earlier copy or an earlier link into this repository and refuses anything else (another folder, a foreign
link, a layout file it did not make), checking every target and the source layout before writing any. After updating from an install that used the earlier `workspaces` layout, pick Workspaces once in Settings; this starts Herdr's per-layout clicks (sidebar width, the layout's theme picks) fresh.

## Plugins

`bin/install` also installs the editor plugin from `plugins/editor/` by default; `bin/install --without editor
<app home>` skips it, builds nothing and leaves any editor or `my-files` copy already in the app home
untouched (the layout then goes back to Herdr's `files`). The plugin adds:

- `editor`: an editable file editor pane (save, formatters, conflict handling).
- `my-files`: the side-panel file tree, whose click opens a file in the editor, with a colored icon for each file type.

The plugin is TypeScript, so installing it needs Node and the `typescript` package (`npm install` at the
root of this repository) to build; the workspaces mod needs neither. The build reads Herdr's type files from the app home (`HERDR_APP_HOME`, else `~/.config/herdr-app`).
Its icons keep their own licenses:
`plugins/editor/mods/my-files/LICENSE-herdr-file-icons.txt` (Apache-2.0) and
`plugins/editor/mods/my-files/icons/LICENSE-material-icon-theme.txt` (MIT). See `plugins/editor/README.md`
for what each mod does.

If you used the old `herdr-editor` repository, with a link or a copy of its `editor` or `my-files` mod in
your app home: remove that link or copy (`mods/editor`, `mods/my-files`), then run `bin/install <app home>`.
The installer refuses a link pointing outside this repository and a folder it did not make, and writes
nothing in that case.

## Usage

Switch to the layout and back:

```sh
herdr-app do layout.switch '{"name":"Workspaces"}'
herdr-app do layout.switch '{"name":"main"}'
```

In the layout, click the "Workspace" selector at the top of the sidebar: pick Default or a workspace, or choose "New workspace…" to give one a name, an icon and a color. Click Edit on a workspace to pick its core; a space on another machine has "Move to workspace…" in its right-click menu to list it there. Each window keeps its own active workspace.

## Layout of the mod

`main.js` picks a role from `props().role` (spaces, agents, chrome, status, menu, switcher, dialog) and delegates
to that role's file; `window.js` opens a workspace in a new window. `lib.js` holds the pure store logic; `npm test` runs `lib.test.js`.

The store is `<store home>/workspaces/workspaces.json`, where the store home is the app home unless the
shared value `workspaces.home` holds an absolute path; the active workspace of a window is the shared
value `workspaces.active` (absent means Default, this computer's spaces).

## What it runs, reads and writes

Herdr warns installers about mods that reach the network, run programs or read files outside their folder. This one:

- Makes no network request.
- Runs `git` through `exec` (`status --porcelain=v2 --branch`, `rev-parse --show-toplevel`, `rev-parse --git-common-dir`) in each space's folder, on the space's machine (`spaces.js`, `menu.js`).
- Runs `hc machine ls --json` through `hc` every 15 seconds to list attached machines (`spaces.js`), and once when the workspace dialog opens, to list the cores to pick (`dialog.js`).
- Reads and writes `<store home>/workspaces/workspaces.json` (creating the folder), where the store home is the absolute path in the shared key `workspaces.home` when set, else this window's app home, and watches that folder for changes by other windows.
- Watches the git folder of each local repository a space is in, to refresh the branch and ahead/behind marks.
- Opens a workspace in a new window when the window icon is clicked (`window.js`): `/bin/test -e` on the optional sources, `/usr/bin/nc` on the window's socket to tell whether it already runs, `/bin/mkdir -p`, `/bin/rm -f` on the window's earlier `layouts/workspaces.json`, `/usr/bin/rsync -aL --delete` and `/bin/cp -f` into `~/.config/herdr-app-windows/<id>/` only, then `/usr/bin/open -n -b dev.herdr.app --env HERDR_APP_HOME=<that folder>`. It mirrors from the main home the mods `workspaces`, `editor` and `my-files`, `layouts/Workspaces.json`, `keys.json`, `settings.json` and `themes/` (those that exist), and writes the window's `shared.json` (`layout`, `workspaces.active`, `workspaces.home` and `workspaces.focus-first`, keeping its other keys). It never writes in the main home. A failed step shows as a notification naming it.
- Uses the shared state keys `workspaces.active`, `workspaces.home` (read only), `workspaces.focus-first` (set in a new workspace window, cleared once the first space is selected) and `workspaces.store`, and, as the shipped mods do, `space.colors`, `agents.sort`, `sidebar.width`, `sidebar.collapsed` and the `localStorage` keys `machines.folded` (one entry per machine header and section, so folding it under one group leaves it open under the others), `groups.folded`, `changed` and `pins`.
- Draws icons from its own folder and from the shipped `mods/workspace-chrome/` folder.

## Requirements

- The Herdr app, built and checked on `herdr-app` 0.1.10 (the shipped mods and layout it derives from are 0.1.9).
- `git` on the machine of each space, for the branch marks.
- `hc` to attach other cores as machines (optional).

## Derived from shipped mods (Herdr 0.1.9)

| File | Derived from |
|---|---|
| `spaces.js` | `spaces` |
| `agents.js` | `agents` |
| `menu.js` | `menu` |
| `chrome.js` and the SVGs | `workspace-chrome` |
| `status.js` | `workspace-status` |
| `dialog.js` | `prompt` (text field) |
| `group-dialog.js` | `prompt` (text field) |
| `switcher.js` | `menu` (popup) |
| `layouts/Workspaces.json` | `main` |

## Development

```sh
npm test                                   # this repository's tests, then each plugin's
bin/install <scratch app home>
herdr-app check <scratch app home>/mods/workspaces
```

`RECIPE.md` is the brief another agent can build the layout from.

## License

MIT, see `LICENSE`.
