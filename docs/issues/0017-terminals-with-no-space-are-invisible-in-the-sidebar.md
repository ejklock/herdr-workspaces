---
type: Issue
title: Terminals with no space are invisible in the sidebar
description: Terminals started without a herdr.space label (agents via hc run --bg, shells outside the app) never show; options to list and place them from the workspaces mod.
status: open
timestamp: 2026-11-23T16:40:24Z
---

## 0017. Terminals with no space are invisible in the sidebar

## What / Why

A terminal with no `herdr.space` label never shows in the Herdr app, so the owner cannot see sessions that agents open. On 2026-11-23 on dev-home, `hc ls --json` listed 39 live local terminals and `hc get <t> --json` showed no `herdr.space` on most of them, for example `t4y` and `t4z`, which `t4m` started with `hc run --bg` without `--label herdr.space=…`. The terminals that the app shows carry `herdr.space`, `herdr.tab` and `where`. Running `hc label t4m herdr.space=<space id>` was enough: within seconds the app wrote `where` (`living-docs-skill / Claude Code`) and listed it in that space with no tab. The space travels from parent to child only when the parent has one. `t52`, started after `t4m` got its space, carried `herdr.space` from its first `hc get`.

### Scope

`mods/workspaces` (sidebar list, its menu, `lib.js` and its tests). Option C would touch launchers outside this repository instead.

### Where the gap is

- The app places a terminal only through `herdr.space`. `spaces()`, `agents()` and `panes()` in `mods/workspaces/gpui-kit.d.ts` hold nothing without it. This is the app's model, not this repository's.
- The mod draws only what `spaces()` and `agents()` give. `visibleAgents` in `mods/workspaces/lib.js` drops any agent whose space is not listed, and `tree()` in `mods/workspaces/agents.js` hangs sub-agents under a listed parent. A space-less root therefore hides its whole subtree.
- The mod can still see these terminals: `terminals()` returns every core terminal with its `labels`, `parent` and `cwd`. It can also fix them: `hc(["label", <address>, "herdr.space=<id>"])` is the same write that worked by hand, and `terminal.keep` then gives the terminal a pane.
- Unverified: whether `hc events` signals a new terminal soon enough to label it before the owner looks. The options below do not depend on it, because `terminals()` is live.

### Constraint

The constitution says nothing moves terminals between cores. A space-less terminal may get a space only on its own machine: for `base-digital/t7`, a space whose `machine` is `base-digital`.

### Options

| Option | What changes | What the owner sees | Cost to reverse |
|---|---|---|---|
| A. "Unplaced" section | The sidebar lists the live terminals of the active workspace's cores that have no `herdr.space`, each with "Move to space…". That item labels the terminal and runs `terminal.keep`. The space suggested first is the parent's space, then the space whose `folder` is the longest prefix of the terminal's `cwd`. | A section that is empty most of the time; nothing moves without a click. | Low: mod-only; drop the section. |
| B. Automatic placement | Like A, but the mod labels the terminal itself when its parent's space or its cwd gives exactly one candidate. Only terminals with no candidate stay in Unplaced. | Agent sessions show up in the right space by themselves. | Medium: the mod writes core labels on its own. A wrong guess is fixed with `hc label <t> herdr.space=<other>`, but the space ids it wrote stay in the cores. |
| C. Launcher only | No change here. Every launcher (session-fleet, `hc run` wrappers) must pass `--label herdr.space=…`. | No change for a terminal the owner starts outside the app (like `t4m`) or for the 13 existing ones. | None here; the gap stays. |
| D. Doctor command | A new script under `bin/` lists space-less terminals per core and labels them by the same rule as B after a prompt. | A command to run by hand. | Low: script only. |

Recommendation: A, with the suggestion rule of B as the default choice in "Move to space…". B can come later as a setting once A shows that the guesses are right. The choice is cheap to reverse, so no ADR is needed unless B is chosen. B would make the mod write core state on its own, and that is worth an ADR.

### Decision

Waiting for the owner's choice.

### Acceptance

- [ ] A live terminal with no `herdr.space` on a core that the active workspace (or Default) shows appears in the sidebar.
- [ ] Placing it sets `herdr.space` to a space on the terminal's own machine, and the terminal then shows under that space with its sub-agents.
- [ ] No space on another machine is ever offered.
