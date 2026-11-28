// The bare name, not node:crypto: Herdr's module host declares "crypto" only, and Node accepts both.
import { createHash } from "crypto";
import { baseName } from "./language.ts";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]);

/** The extension of a file name, lowercased; a dotfile such as `.png` has none. */
function extensionOf(path: string): string | undefined {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
}

export function isImage(path: string): boolean {
  const ext = extensionOf(path);
  return ext !== undefined && IMAGE_EXTENSIONS.has(ext);
}

/** The app-home-relative name of an image's copy: one per source path, and only letters and digits, so no source path can steer it elsewhere. */
export function previewName(path: string): string {
  const hash = String(createHash("sha256").update(path).digest("hex")).slice(0, 16);
  const ext = extensionOf(path);
  return `editor-preview/${hash}.${ext !== undefined && /^[a-z0-9]+$/.test(ext) ? ext : "img"}`;
}
