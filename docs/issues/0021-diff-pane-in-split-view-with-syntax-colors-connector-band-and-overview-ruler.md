---
type: Issue
title: Diff pane in split view with syntax colors, connector band and overview ruler
description: Redesigns the my-diff pane as proposal C with the editor's syntax colors, a connector band and an overview ruler.
status: closed
timestamp: 2026-11-28T01:47:05Z
---

## 0021. Diff pane in split view with syntax colors, connector band and overview ruler

## What / Why

On 2026-11-27 the owner found the my-diff pane generic and hard to read (pane titled "my-diff", lines cut with an ellipsis, heavy rows, large text buttons) and asked for proposals. From five rendered proposals (`diff-proposals.html`, shared through the owner's transfer folder) the owner chose C: split view with a connector band between the halves and an overview ruler. The owner then asked for it "with the editor's colors, like this", showing VS Code's split diff: syntax-colored code, soft row tints, a stronger changed-word tint, `−`/`+` beside the line numbers and "N hidden lines" rows with an expand chevron.

### Scope

- Syntax colors in both halves, in the editor's palette, through highlight.js ([ADR 0004](../adr/0004-diff-pane-vendors-highlight-js-for-syntax-colors.md)).
- Rows like the reference: `−`/`+` beside the line number on changed rows, "N hidden lines" rows with a chevron, a connector band between the halves tinted by the block's kind.
- A compact header: the folder dimmed and the file name bold, `+N −N`, the `k/n` position, icon buttons for previous, next, wrap and open in editor.
- An overview ruler at the right edge marking every change block; a click on a mark scrolls to it.

### Decision

- Layout C (split, connector band, overview ruler). Owner, 2026-11-27. Not taken: A (calm split), B (unified), D (inline), E (gutter bar only).
- Syntax colors come from highlight.js vendored in the mod (ADR 0004). Owner, 2026-11-27, reversing the 2026-11-02 drop of syntax colors in issue 0011. Not taken: a tokenizer of our own; two read-only native editors; no syntax colors.
- Row and word tints stay as `plugins/editor/src/changes/tints.ts` has them (the owner's 2026-11-03 palette); the reference screenshot shows the same pattern of a soft row and a stronger word. Session judgment.
- The language comes from the file extension through highlight.js's own names and aliases (`getLanguage`); a file it does not know draws in the foreground color. Session judgment.
- VS Code's revert arrows in the middle band are out: they change the file, a feature of its own. Session judgment.
- Sticky hunk headers from proposal A are out: gpui-kit's virtual list has no sticky rows. Session judgment.

### Plan

- S1: the build vendors highlight.js and a pure module turns a file's text into per-line colored spans in the editor's syntax color names | files: plugins/editor/package.json, plugins/editor/bin/copy-highlight, plugins/editor/src/changes/syntax.ts, plugins/editor/tests/changes/syntax.test.ts, plugins/editor/.gitignore, plugins/editor/README.md | after: none
- S2: the diff rows draw syntax colors merged with the changed-word tint, `−`/`+` markers, chevron hidden-line rows, the connector band, and the compact header | files: plugins/editor/src/changes/pane.ts, plugins/editor/src/changes/words.ts, plugins/editor/tests/changes/words.test.ts, plugins/editor/README.md | after: S1
- S3: the overview ruler marks each change block and scrolls to it on click | files: plugins/editor/src/changes/pane.ts, plugins/editor/src/changes/nav.ts, plugins/editor/tests/changes/nav.test.ts, plugins/editor/README.md | after: S2

### Acceptance

- In a scratch app home installed by `bin/install`, a TypeScript and a PHP diff show syntax colors in the editor's palette on both halves, with row and word tints.
- Changed rows carry `−`/`+` beside the line number; hidden runs show "N hidden lines" with a chevron and expand on click; the band between halves is tinted per block.
- The ruler marks every change block, and a click scrolls to it.
- `npm test` in `plugins/editor` is green.

### Outcome

Shipped in #19 (8e291ce). The build vendors highlight.js 11.12.0 into the my-diff mod (ADR 0004); rows draw syntax colors in the editor's palette under the changed-word tint, `−`/`+` on changed rows, "↕ N hidden lines" rows and a band tinted per row; the header is compact and a right-edge ruler marks each change block and scrolls to it. `node --test` in plugins/editor is green (635). Not verified: highlight.js running in Herdr's engine, the look on screen, and `npm run build` on macOS.
