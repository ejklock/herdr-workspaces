// Workspaces: one mod, a role per block. The layout and the overlays give each copy
// props { role }:
//   spaces    the sidebar's spaces list, filtered by the active workspace
//   agents    the sidebar's agents list, filtered by the active workspace, and its sort popup
//   chrome    the brand row, and (footer: true) the footer with the workspace switcher
//   status    the status bar
//   menu      a popup menu: a space's right-click menu, and the workspace list to move it to
//   switcher  the popup that picks, creates and edits workspaces
//   dialog    the create, edit and delete dialog

import { View, div } from "gpui-kit";
import { props } from "herdr";
import Spaces from "./spaces.js";
import Agents from "./agents.js";
import Chrome from "./chrome.js";
import Status from "./status.js";
import Menu from "./menu.js";
import Switcher from "./switcher.js";
import Dialog from "./dialog.js";

const ROLES = { spaces: Spaces, agents: Agents, chrome: Chrome, status: Status, menu: Menu, switcher: Switcher, dialog: Dialog };

export default class Workspaces extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    const Role = ROLES[pr.role];
    this.role = Role ? new Role() : null;
    this.role?.init?.(pr, cx);
  }

  render(cx) {
    if (!this.role) return div().child(`workspaces: no role "${props()?.role}"`);
    return this.role.render(cx);
  }

  async close(cx) {
    await this.role?.close?.(cx);
  }
}
