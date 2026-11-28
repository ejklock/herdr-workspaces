---
type: Issue
title: Open files show Markdown rendered and images
description: Files opened from the Files panel show Markdown rendered with a Preview / Source switch, and images as images.
status: open
timestamp: 2026-11-28T01:14:30Z
---

## 0020. Open files show Markdown rendered and images

## What / Why

On 2026-11-27 the owner asked that files opened from the Files panel show Markdown rendered and images as images. Today every file opens in the text editor pane (`plugins/editor/src/editor/main.ts`).

### Scope

- A Markdown file (`.md`, `.markdown`) opens rendered, with a Preview / Source switch in the editor header; Source is the existing editor.
- An image file opens as the image.

### Decision

- Markdown renders with gpui-kit `TextView.markdown(id, markdown)` (`plugins/editor/types/gpui-kit.d.ts`), the host's own renderer; no Markdown package. Session judgment.
- A Markdown file opens in Preview; the preview draws the editor's current text, unsaved edits included. Session judgment.
- gpui-kit `image(path)` reads only from the application's own directory, so an image is copied first into `<app home>/editor-preview/` and drawn from there. Unverified: whether `image` resolves that folder; the session cannot run Herdr on Linux. An image on another machine shows a message instead. Session judgment.

### Plan

- S1: a Markdown file opens rendered with a Preview / Source switch | files: plugins/editor/src/editor/main.ts, plugins/editor/src/editor/language.ts, plugins/editor/tests/editor/language.test.ts, plugins/editor/README.md | after: none
- S2: an image file opens as the image | files: plugins/editor/src/editor/main.ts, plugins/editor/src/editor/preview.ts, plugins/editor/tests/editor/preview.test.ts, plugins/editor/README.md | after: S1

### Acceptance

- In a scratch app home, a `.md` file clicked in Files shows rendered headings, lists and code; Source shows the editable text; switching back shows unsaved edits rendered.
- A local `.png`, `.jpg` or `.svg` clicked in Files shows the image; a remote one shows a message.
- `npm test` in `plugins/editor` is green.
