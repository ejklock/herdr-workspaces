// The context menus' item lists, pure so Node can test them. An item is
// [label, command, args, checked, workspace]; `terms` is the live terminal list, `git` the space's checkout kind.

import { newSpaceArgs, canMoveSpace } from "./lib.js";

function workspaceMoveItems(tg, store) {
  const current = store.assign[tg.id];
  return [
    ["Default", "workspaces.assign", { space: tg.id }, !store.workspaces.some((w) => w.id === current)],
    ...store.workspaces.map((w) => [w.name, "workspaces.assign", { space: tg.id, workspace: w.id }, current === w.id, w]),
  ];
}

function paneItems(tg, terms) {
  // A kept sub-agent can go back under its parent, still running.
  const term = terms.find((t) => t.address === tg.terminal);
  const parent = term?.parent && terms.find((t) => t.address === term.parent);
  // Once they go to the program, Shift+right-click still opens this menu.
  const toProgram = term?.labels?.["herdr.right-click"] === "program";
  return [
    ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
    ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
    ["Zoom", "pane.zoom", { pane: tg.pane }],
    ...(term
      ? [
          toProgram
            ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
            : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
        ]
      : []),
    ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
    ["Close pane", "pane.close", { pane: tg.pane }],
  ];
}

function tabItems(tg) {
  return [
    ["Rename", "tab.rename", { id: tg.id }],
    ["New tab", "tab.new", { space: tg.space }],
    ["Close", "tab.close", { id: tg.id }],
  ];
}

function spaceItems(tg, git, movable) {
  return [
    ["Rename", "space.rename", { id: tg.id }],
    ...(movable ? [["Move to workspace…", "workspaces.move", { space: tg.id }]] : []),
    ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
    ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
    ["Close", "space.close", { id: tg.id }],
  ];
}

function globalItems(store, activeId) {
  return [
    ["New space", "space.new", newSpaceArgs(store, activeId)],
    ["Keybinds", "app.help", {}],
    ["Theme: graphite", "app.theme", { name: "graphite" }],
    ["Theme: ink", "app.theme", { name: "ink" }],
    ["Theme: moss", "app.theme", { name: "moss" }],
    ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
  ];
}

/** The items of the menu `p.tab` names; "New space" carries the core of the workspace `activeId` names; `spaces` is the live space list, which decides whether a space can move. */
export function menuItems(p, git, store, activeId, terms, spaces = []) {
  const { tab, target } = p ?? {};
  const tg = target ?? {};
  switch (tab) {
    case "workspace-move":
      return workspaceMoveItems(tg, store);
    case "pane":
      return paneItems(tg, terms);
    case "tab":
      return tabItems(tg);
    case "space":
      return spaceItems(tg, git, canMoveSpace(store, spaces.find((s) => s.id === tg.id)));
    default:
      return globalItems(store, activeId);
  }
}
