---
type: Issue
title: Sidebar without machine headers, each workspace bound to its core
description: Each workspace names its core; the sidebar drops the headers of the local and workspace cores, and new spaces go to the active workspace's core.
status: open
timestamp: 2026-11-02T13:33:34Z
---

## 0002. Sidebar without machine headers, each workspace bound to its core

### What / Why

Builds on [ADR 0001](/adr/0001-one-core-per-workspace-attached-as-a-machine.md) and [issue 0001](/issues/0001-workspace-switcher-in-the-sidebar.md). The owner does not want the attached cores listed as machines in the sidebar (2026-11-02 screenshot: base-digital, inovatec and planet-argon headers, each with "New space there", under Default). The data already pairs them one to one: in the owner's store every live assigned space of BASE is on base-digital (16), of Planet Argon on planet-argon (10), of Inovatec on inovatec (3); the two other assignments name spaces that no longer exist. So a workspace becomes its core, and the machine layer leaves the screen while each workspace keeps its own core.

### Scope

- A workspace may name its core: an optional `machine` field in the store (version stays 1), chosen in the create/edit dialog from the attached `sh -c` machines that no other workspace names.
- Every space on a workspace's core belongs to that workspace with no assignment; Default is the local core's spaces.
- No machine header for the local core or a workspace's core; another machine (for example `abby-stg`, an SSH machine no workspace names) keeps its header, shown only with spaces of the active workspace on it.
- "Move to workspace…" only on spaces of another machine; its assignment stays in `assign`.
- The sidebar's + and the space menu's "New space" create on the active workspace's core, on the local core under Default; a mod command `workspaces.new-space` does the same for Cmd+N.
- A workspace with no core shows a row asking to choose one in Edit, plus its moved spaces.
- The join-on-create rule of commit f91588f goes.
- README and RECIPE describe the new model and the Cmd+N binding.

### Decision

- The binding is explicit in the store; not taken: deducing the core from the assigned spaces (ambiguous with none, or with spaces on two cores), or matching names (`base` is not `base-digital`). Owner, 2026-11-02.
- Membership by core; not taken: keeping manual assignment, under which an unassigned space shows nowhere. Owner, 2026-11-02.
- Another machine keeps its header, because its terminals run on another computer; not taken: hiding every header. Owner, 2026-11-02.
- Default is the local core only; spaces of a machine no workspace names and nobody moved show nowhere. Not taken: listing them in Default under their headers. Owner, 2026-11-02.
- The dialog only picks an attached core; creating a core stays outside the app (`hc machine add --via 'sh -c' --name <workspace> --session <workspace>`, as the README says). Not taken: the dialog starting a herdr-core session. Owner, 2026-11-02.
- The owner binds BASE, Planet Argon and Inovatec in the dialog; not taken: a one-time automatic migration. Owner, 2026-11-02.
- Cmd+N calls `workspaces.new-space`, one line in the owner's `keys.json` (shared by every profile), changed by the owner; not taken: Cmd+N always on the local core. Owner, 2026-11-02.
- Two workspaces naming one core are refused in the dialog; an assignment of a space not on another machine is ignored, not deleted.

### Acceptance

- With BASE bound to base-digital, choosing BASE lists every base-digital space with no machine header, and Default lists only the local core's spaces.
- The sidebar's +, the space menu's "New space" and `workspaces.new-space` create the space on the active workspace's core, and it shows at once; under Default they create on the local core.
- A space of `abby-stg` moved to Planet Argon shows under an `abby-stg` header only in Planet Argon; spaces of a workspace's core have no "Move to workspace…".
- The dialog lists only unbound `sh -c` machines, keeps the current one when editing, and an unbound workspace shows its choose-a-core row.
- The Agents list follows the same membership.
- `npm test` covers the binding, membership and the dialog's refusals; `herdr-app check` passes; layout `main` still restores the stock sidebar.

### Plan

One coder slice in `mods/workspaces/` (lib, spaces, menu, dialog, agents, main) and the docs, tested in a scratch app home with scratch cores; the session then installs into the owner's home, the owner binds the three workspaces and changes Cmd+N.
