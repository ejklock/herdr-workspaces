export const LIMIT = 1048576;

export type ExecResult = { code: number; stdout: string; stderr: string };

export type Host = {
  readTextFile(path: string, options?: { on?: string | null }): Promise<string | null>;
  writeTextFile(path: string, text: string, expected: string | null): Promise<null>;
  exec(command: string, args?: string[], options?: { cwd?: string; on?: string | null }): Promise<ExecResult>;
};

export type Status =
  | { kind: "loading" }
  | { kind: "editable" }
  | { kind: "readonly"; message: string }
  | { kind: "unavailable"; message: string };

export type Conflict = { disk: string | null };

type Opened = { status: Status; snapshot: string; target: string };

const KIND_PROBE = 'if [ -d "$1" ]; then echo dir; elif [ -e "$1" ]; then echo file; else echo missing; fi';

/** One file's open, save and conflict state; the text being edited lives in the view and is passed in. */
export class EditorDocument {
  status: Status = { kind: "loading" };
  snapshot = "";
  conflict: Conflict | undefined;
  failure: string | undefined;
  private target: string;
  private saving = false;
  private generation = 0;
  private readonly host: Host;
  private readonly path: string;
  private readonly on: string | null;

  constructor(host: Host, path: string, on: string | null = null) {
    this.host = host;
    this.path = path;
    this.on = on;
    this.target = path;
  }

  /** Dirty exactly while an editable file's text differs from the last text read or saved. */
  dirty(text: string): boolean {
    return this.status.kind === "editable" && text !== this.snapshot;
  }

  async open(): Promise<void> {
    const generation = ++this.generation;
    this.status = { kind: "loading" };
    this.snapshot = "";
    this.conflict = undefined;
    this.failure = undefined;
    this.saving = false;
    const opened = await this.classify();
    if (generation !== this.generation) return;
    this.status = opened.status;
    this.snapshot = opened.snapshot;
    this.target = opened.target;
  }

  async save(text: string): Promise<void> {
    if (this.status.kind !== "editable" || this.saving || this.conflict) return;
    await this.guarded(async generation => {
      if (text !== this.snapshot) return this.write(text, this.snapshot, generation);
      const disk = await this.readDisk();
      if (generation === this.generation && disk !== undefined && disk !== this.snapshot) this.conflict = { disk };
    });
  }

  async overwrite(text: string): Promise<void> {
    const conflict = this.conflict;
    if (this.status.kind !== "editable" || this.saving || !conflict) return;
    await this.guarded(generation => this.write(text, conflict.disk, generation));
  }

  private async guarded(work: (generation: number) => Promise<void>): Promise<void> {
    const generation = this.generation;
    this.saving = true;
    this.failure = undefined;
    try { await work(generation); } finally { if (generation === this.generation) this.saving = false; }
  }

  private async write(text: string, expected: string | null, generation: number): Promise<void> {
    let failure: unknown;
    try {
      await this.host.writeTextFile(this.target, text, expected);
    } catch (error) {
      failure = error;
    }
    if (failure === undefined) return this.saved(text, generation);
    const disk = await this.readDisk();
    if (generation !== this.generation) return;
    if (disk === text) return this.saved(text, generation);
    if (disk !== undefined && disk !== expected) this.conflict = { disk };
    else this.failure = `Could not save: ${failure instanceof Error ? failure.message : String(failure)}`;
  }

  private saved(text: string, generation: number): void {
    if (generation !== this.generation) return;
    this.snapshot = text;
    this.conflict = undefined;
  }

  private readDisk(): Promise<string | null | undefined> {
    return this.host.readTextFile(this.target).catch(() => undefined);
  }

  /** The real path a write goes to, or undefined when a local path cannot be resolved: such a path is never written, so a link is never replaced. */
  private async resolve(): Promise<string | undefined> {
    if (this.on) return this.path;
    const real = await this.host.exec("realpath", [this.path]).catch(() => undefined);
    const resolved = real?.code === 0 ? real.stdout.replace(/\n$/, "") : "";
    return resolved || undefined;
  }

  private async classify(): Promise<Opened> {
    const resolved = await this.resolve();
    const target = resolved ?? this.path;
    const unavailable = (message: string): Opened => ({ status: { kind: "unavailable", message }, snapshot: "", target });
    let text: string | null;
    try {
      text = await this.host.readTextFile(target, { on: this.on });
    } catch {
      return unavailable(await this.unreadable(target));
    }
    if (text === null) return unavailable("File not found");
    if (text.includes("\0")) return unavailable("Binary file · not editable");
    const readonly = (message: string): Opened => ({ status: { kind: "readonly", message }, snapshot: text, target });
    if (this.on) return readonly("File on another machine · read-only");
    if (resolved === undefined) return readonly("Could not resolve the file path · read-only");
    if (text.includes("�")) return readonly("Not valid UTF-8 · read-only");
    const size = await this.host.exec("sh", ["-c", 'wc -c < "$1"', "editor", target]).catch(() => undefined);
    const bytes = size?.code === 0 && /^\s*\d+\s*$/.test(size.stdout) ? Number(size.stdout) : Infinity;
    if (bytes >= LIMIT) return readonly("File too large to edit safely · read-only");
    return { status: { kind: "editable" }, snapshot: text, target };
  }

  private async unreadable(target: string): Promise<string> {
    if (this.on) return "Cannot open this file (too large or unreadable)";
    const probe = await this.host.exec("sh", ["-c", KIND_PROBE, "editor", target]).catch(() => undefined);
    const kind = probe?.code === 0 ? probe.stdout.trim() : "";
    if (kind === "dir") return "This path is a folder";
    if (kind === "missing") return "File not found";
    return "Cannot open this file (too large or unreadable)";
  }
}
