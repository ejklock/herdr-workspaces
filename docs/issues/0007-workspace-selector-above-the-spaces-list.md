---
type: Issue
title: Workspace selector above the spaces list
description: The workspace selector moves from the sidebar footer to the top, above the spaces, so the workspace is chosen where its spaces are listed.
status: closed
timestamp: 2026-11-02T17:16:00Z
---

## 0007. Workspace selector above the spaces list

### Scope

The sidebar's "Workspace" selector moves from the footer to the top of the sidebar, above the spaces list. The sidebar has one place where the workspace is chosen, and the spaces under it are that workspace's. The footer keeps Settings and Add machine.

### Decision

- The owner asked on 2026-11-02 for the selector to sit above the spaces "to be a bit more organized". That reverses the choice in [issue 0001](/issues/0001-workspace-switcher-in-the-sidebar.md), which had not taken a selector at the top of the sidebar.
- The selector gets its own layout block, `workspace-selector`, between `brand` and `sidebar-lists`. It is drawn by the `chrome` role with a `selector` prop. The footer block keeps the `footer` prop and loses the selector. The layout is chosen over a header inside the spaces block because the spaces block scrolls and the selector must not.

### Acceptance

- In the workspaces layout, the sidebar shows, top to bottom: the brand row, the "Workspace" label and selector, the spaces list, the agents list, and a footer with Settings and Add machine.
- The selector behaves as before: it opens the switcher popup, and it shows the active workspace's icon, color and name, or "Default".
- In the narrow rail, the selector shows only the icon, as before.
- README and RECIPE describe the selector at the top.

### Plan

One coder slice: `layouts/workspaces.json`, `mods/workspaces/chrome.js`, README.md, RECIPE.md.

### Outcome

The Workspace selector now sits in its own block between the brand row and the spaces list, with a bottom border. Settings and Add machine stay in the footer. The block follows the store, so it shows every workspace on the first frame. A review approved it, with one finding: stale comments in main.js and switcher.js, which were fixed.
