---
type: Issue
title: Install test needs herdr.d.ts in the real app home
description: bin/install.test.js:610 fails on a host whose ~/.config/herdr-app has no herdr.d.ts, keeping npm test red.
status: open
timestamp: 2026-11-23T23:48:57Z
---

## 0018. Install test needs herdr.d.ts in the real app home

## What / Why

`npm test` fails on dev-home in `bin/install.test.js:610` ("the real repository installs every mod with its built output"), with the message "refusing: /home/ejklock/.config/herdr-app/herdr.d.ts is not a file". The editor plugin build expects that file in the real app home. The failure reproduces with the issue 0017 changes stashed, so it does not come from them. It keeps the full suite red on this host.

### Scope

`bin/install.test.js` and the editor plugin build's lookup of `herdr.d.ts`.

### Acceptance

- [ ] `npm test` is green on a host whose app home has no `herdr.d.ts`, or the test skips with a stated reason.
