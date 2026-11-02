---
type: Issue
title: Editor plugin builds on any machine with Herdr installed
description: The editor plugin's TypeScript config reads Herdr's type files from one machine's absolute path; it should read them from the app home of whoever builds.
status: closed
timestamp: 2026-11-02T14:37:11Z
---

## 0005. Editor plugin builds on any machine with Herdr installed

Follows [issue 0004](/issues/0004-editor-plugin-moved-into-the-repository.md): `plugins/editor/tsconfig.json` points `herdr` and `gpui-kit.d.ts` at `/Users/ejklock/.config/herdr-app`, carried over from herdr-editor. In a public repository the build, typecheck and tests then only run on the author's machine, and `bin/install` builds the plugin by default.

### Scope

- Before each build, typecheck and test, the plugin copies `herdr.d.ts` and `gpui-kit.d.ts` from the app home (`HERDR_APP_HOME`, else `~/.config/herdr-app`) into a git-ignored `plugins/editor/types/`; the tsconfigs name only that folder.
- A missing app home or type file stops with a message naming the path and `HERDR_APP_HOME`, before tsc runs.
- No tracked file in `plugins/editor` names a user's home.
- Kept: the compiler options, the build output paths and `bin/install`'s order.

### Decision

- The type files are copied from the app home on every run; not taken: committing Herdr's type files (they change with each Herdr release and are Herdr's to license), or a link (a stale link fails later and less clearly). Owner, 2026-11-02 (fix now).

### Acceptance

- With `HOME` and `HERDR_APP_HOME` pointing at a scratch app home holding the two type files, the plugin's build, typecheck and tests pass.
- With no type files there, each stops before tsc with the message, non-zero.
- `git ls-files plugins/editor | xargs grep -l /Users/` prints nothing.

### Outcome

Shipped in ddaa23a (`plugins/editor/bin/copy-types` copies Herdr's type files from `HERDR_APP_HOME`, else `~/.config/herdr-app`, before build and typecheck) and b750eb6 (docs).
