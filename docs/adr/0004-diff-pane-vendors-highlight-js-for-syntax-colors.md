---
type: ADR
title: Diff pane vendors highlight.js for syntax colors
description: The my-diff pane draws syntax colors from highlight.js's self-contained ES build, vendored at build time from a pinned dev dependency.
owner: Evaldo Klock
status: Accepted
timestamp: 2026-11-28T01:46:03Z
---

# 0004. Diff pane vendors highlight.js for syntax colors

# 0004. Diff pane vendors highlight.js for syntax colors

## Context

On 2026-11-27 the owner chose a VS Code-style redesign of the my-diff pane and asked for the editor's syntax colors in it, reversing the 2026-11-02 choice in [issue 0011](../issues/0011-changes-panel-and-side-by-side-diff-pane.md) to drop syntax colors. Herdr gives a mod no syntax tokens: gpui-base `EditorState` (`plugins/editor/types/gpui-kit.d.ts`, "HERDR: built-in source editing") takes only `language` and `syntax` colors and draws its own lines, with no per-line background or decoration, and gpui-kit `TextView.html` supports no CSS. The diff's tinted rows and changed-word highlights must stay, so the tokens have to come from inside the mod.

A mod loads ES modules from its own folder only. The npm `highlight.js` 11.12.0 `es/core.js` re-exports `../lib/core.js`, which is CommonJS, so it cannot load in a mod. The official `@highlightjs/cdn-assets` 11.12.0 ships `es/highlight.js`: one self-contained ES module (no imports, 316 KB) with the common languages, under BSD-3-Clause.

## Decision

We will vendor `@highlightjs/cdn-assets`'s `es/highlight.js` into the my-diff mod at build time, from a pinned dev dependency of `plugins/editor`, together with its license, and color each token with the editor's own `syntaxColors(theme())` palette.

Rejected:
- A tokenizer of the plugin's own, by regular expressions: fewer languages and edge cases wrong; one was built and discarded in issue 0011.
- Two read-only native `Editor` panes, one per side: the host's exact colors, but no tinted rows, no changed-word highlight and two independent scrolls, which loses the diff itself.
- The npm `highlight.js` package: its ES entry points load CommonJS.
- Committing the vendored file to git: the build already copies Herdr's types fresh; a pinned dependency keeps one version source and an auditable upgrade.

## Consequences

**Easier / gained:**
- Syntax colors in the diff for the 36 languages of the common build (among them bash, c, cpp, csharp, css, go, java, javascript, json, kotlin, markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml/html, yaml), in the editor's palette.

**Harder / accepted trade-offs:**
- A 316 KB third-party file ships in the my-diff mod; upgrades and its BSD-3-Clause notice are ours to carry.
- The host's JavaScript engine must run highlight.js's regular expressions, four of them with lookbehind; this is checked only in the app. A file in a language outside the build shows without syntax colors.
- Tokenizing costs CPU on each diff load; it runs once per loaded file, not per frame.

**Follow-ups:**
- None.

## Verification

**Implementation impact:** `plugins/editor/package.json`, the build step that copies the vendored file, `plugins/editor/src/changes/`, `plugins/editor/bin/install-files`.

**Verification criteria:**
- `npm run build` leaves `mods/my-diff/vendor/highlight.js` and its license file; `bin/install-files` copies both.
- A test tokenizes a TypeScript and a PHP sample and maps the tokens to the editor's syntax color names.
