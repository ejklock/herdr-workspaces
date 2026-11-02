// Opens a workspace in its own Herdr window: a separate Herdr process whose app home is a folder of its own,
// holding a mirror of this home's mods and settings, and sharing this home's workspace store.
// `openPlan` (lib.js) decides the steps; this runs them and reports the one that failed.

import { exec, home, appHome, readTextFile, writeTextFile, notify, shared } from "herdr";
import { OPTIONAL_WINDOW_SOURCES, openPlan, runOpen, storeHome, windowHome, windowShared } from "./lib.js";

// The window homes whose open is in progress: a second request for one of them does nothing until its new window
// answers on its socket (or a deadline passes) or its open fails.
const opening = new Set();

const TITLE = "Could not open the workspace window";

const failure = (step, detail) => `${step}: ${String(detail).trim() || "no details"}`;

/** Which of the optional sources exist in the main home, as the relative paths `openPlan` takes. */
async function presentSources(mainHome) {
  const found = await Promise.all(OPTIONAL_WINDOW_SOURCES.map(async (path) => ((await exec("/bin/test", ["-e", `${mainHome}/${path}`])).code === 0 ? path : undefined)));
  return found.filter((path) => path !== undefined);
}

// A folder is mirrored with its deletions (a mod removed from the main home goes from the copy too) and symlinks
// followed, since keys.json and settings.json are often links.
const mirrorCommand = ({ from, to, dir }) => (dir ? ["/usr/bin/rsync", ["-aL", "--delete", `${from}/`, `${to}/`]] : ["/bin/cp", ["-f", from, to]]);

// A live Herdr answers on its socket; nc exits 0 once it connected, whatever the stale file a crash left behind.
const isRunning = async (socket) => (await exec("/bin/sh", ["-c", 'exec /usr/bin/nc -w 2 -U "$0" </dev/null', socket])).code === 0;

async function writeShared({ path, id, mainHome }) {
  const text = await readTextFile(path);
  await writeTextFile(path, `${JSON.stringify(windowShared(text, id, mainHome), null, 2)}\n`, text);
}

const pause = (ms) => exec("/bin/sleep", [String(ms / 1000)]);

/** Runs one planned step; gives the reason it failed, or undefined. */
async function runStep(step) {
  if (step.kind === "shared") {
    await writeShared(step);
    return undefined;
  }
  const [command, args] =
    step.kind === "folders" ? ["/bin/mkdir", ["-p", ...step.paths]] : step.kind === "mirror" ? mirrorCommand(step) : step.kind === "remove" ? ["/bin/rm", ["-f", step.path]] : [step.command, step.args];
  const result = await exec(command, args);
  return result.code === 0 ? undefined : result.stderr || `exit code ${result.code}`;
}

const LABELS = { folders: "Making the window's folders", remove: "Removing the earlier layout file", mirror: "Copying the mods and settings", shared: "Writing the window's state", launch: "Starting Herdr" };

/**
 * Runs the plan for the workspace `id`: gives { error } naming the step that failed, { launched: true } once the
 * window was started, or {} when nothing was started (already open here or elsewhere, or no window folder for the id).
 */
async function startOpen(id) {
  try {
    const mainHome = storeHome(shared("workspaces.home"), appHome());
    const plan = openPlan({ userHome: home(), mainHome, id, appHome: appHome(), present: await presentSources(mainHome) });
    if (!plan) {
      const own = windowHome(home(), id) === appHome();
      notify(own ? { title: "This workspace is already open here", body: "This window is the one that shows it.", level: "info" } : { title: TITLE, body: "The workspace id cannot name a window folder.", level: "error" });
      return {};
    }
    if (await isRunning(plan[0].socket)) {
      notify({ title: "This workspace is already open", body: "Its window is running; switch to it from the Dock or Mission Control.", level: "info" });
      return {};
    }
    for (const step of plan.slice(1)) {
      const reason = await runStep(step).catch((e) => e.message ?? String(e));
      if (reason !== undefined) return { error: failure(LABELS[step.kind], reason) };
    }
    return { launched: true, socket: plan[0].socket };
  } catch (e) {
    return { error: failure("Opening the window", e.message ?? e) };
  }
}

/**
 * Opens the workspace `id` (undefined for Default) in a new Herdr window, or says so when that window is already open.
 * A failed step stops the open and shows as a notification naming the step and its error. The window's home stays held
 * in `opening` until the new Herdr answers on its socket or the deadline passes, or until a failure frees it.
 */
export async function openWorkspaceWindow(id) {
  let socket;
  const result = await runOpen({
    opening,
    key: windowHome(home(), id),
    start: async () => {
      const started = await startOpen(id);
      socket = started.socket;
      return started;
    },
    probe: () => isRunning(socket),
    sleep: pause,
    now: Date.now,
  });
  if (result.error !== undefined) notify({ title: TITLE, body: result.error, level: "error" });
}
