---
type: ADR
title: One core per company attached as a machine
description: Each company keeps its own herdr-core session, attached to the default core as a machine so one window shows them all.
owner: Evaldo Klock
status: Accepted
timestamp: 2026-10-30T17:12:45Z
---

# 0001. One core per company attached as a machine

## Context

The owner works for several companies and runs one Herdr window per company today, each with its own app home (`HERDR_APP_HOME`) and its own herdr-core session (`HC_SESSION`), opened by `herdr-profile <name>`. Herdr app updates have twice closed the per-company windows and reopened only the default one. The owner wants to switch between company workspaces inside one window.

Herdr keeps each machine's spaces, tabs and splits in that machine's core (`~/.config/herdr-app/AGENTS.md`, The model), and one window shows every attached machine grouped in the sidebar.

## Decision

We will keep one herdr-core session per company and attach each to the default core as a machine with `hc machine add --via 'sh -c' --name <company> --session <company>`, so the default window shows every company's spaces while each company's terminals stay in their own core.

Rejected: one core holding every company's spaces, grouped only by a mod. It is the simplest, but it merges the four cores, losing the per-company isolation, and a core restart would hit every company at once.

Rejected: patched copies of Herdr.app per company (own Dock icon and name). The owner asked for an official, Herdr-only way, and patched bundles break on every app update.

## Consequences

**Easier / gained:**
- One window shows all companies; an app update reopens it whole.
- Each company's core keeps running, and can be restarted, on its own; `herdr-profile <company>` still opens a company's own window on the same spaces.
- No SSH or macOS Remote Login: `--via 'sh -c'` runs the remote side locally (proved 2026-10-30 with scratch sessions, `hc` 0.1.14).

**Harder / accepted trade-offs:**
- The default core depends on the company cores being reachable; a stopped company core shows as not connected until it runs again (whether the attach recovers by itself after a reboot is unverified).
- Space order is fixed by Herdr: local machine first, then machines by name.

**Follow-ups:**
- [Issue 0001](/issues/0001-workspace-switcher-in-the-sidebar.md): the workspace switcher that filters the sidebar by a user-defined workspace.

## Verification

**Implementation impact:** the owner's default core's machine list; no file in this repository.

**Verification criteria:** `HC_SESSION=default hc machine ls --json` lists every company core (for example `company-a`, `company-b`) as `connected`, and `herdr-app ls` lists their spaces with `machine` set to the company name.
