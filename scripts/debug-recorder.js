import { MODULE_ID } from "./util.js";

/*
 * Optional integration with Dxcufgb's Debug Recorder (dxcufgbs-debug-recorder).
 *
 * The recorder is NOT a dependency: when it is missing, inactive or broken, everything here does nothing and the
 * Bastions work exactly as without it. When it is there, this module registers a snapshot of its runtime state
 * (see `debugSnapshot` in main.js) and leaves breadcrumbs at its main actions while the GM is recording.
 *
 * Privacy: snapshots and breadcrumbs hold only counts, booleans, numbers and this module's own fixed ids (action
 * names, project states and kinds, structure, terrain and grounds ids, setting choices, error codes). Never Bastion,
 * character, user or place names, notes, letters, chat text, image paths or URLs.
 */

const RECORDER_ID = "dxcufgbs-debug-recorder";

/** The recorder's API once this module is registered with it. */
let recorder = null;
/** A stand-in recorder for the self-tests (see `testing`); while set, breadcrumbs go to it instead. */
let standIn = null;
let snapshotFn = () => ({});
/** Error codes this module caught since the page loaded: {code: count}, and the latest one. */
const errors = { counts: {}, last: null, lastAt: 0 };

/**
 * Leaves a breadcrumb (only while the recorder is recording). `data` is a small, flat object without names or text;
 * a function is only called while recording (for data that costs something to build).
 * @param {string} key     dot-namespaced, e.g. "action.run"
 * @param {object|(() => object)} [data]
 */
export function crumb(key, data) {
  try {
    const rec = standIn ?? recorder;
    if (rec?.isRecording?.()) rec.breadcrumb(MODULE_ID, key, typeof data === "function" ? data() : data);
  } catch (err) {
    console.warn(`${MODULE_ID} | debug recorder breadcrumb failed`, err);
  }
}

/**
 * Notes an error the module caught, by a fixed code of this module (e.g. "socket.relay", "map.upload"), never its
 * message. Counted for the snapshot even when nothing is recording.
 */
export function noteError(code) {
  try {
    // A fixed code: letters, digits, dots and dashes, short; at most 50 different ones (the rest count as "other").
    code = String(code ?? "unknown").replace(/[^\w.-]/g, "").slice(0, 40) || "unknown";
    if (!(code in errors.counts) && Object.keys(errors.counts).length >= 50) code = "other";
    errors.counts[code] = (errors.counts[code] ?? 0) + 1;
    errors.last = code;
    errors.lastAt = Date.now();
    crumb("error.caught", { code });
  } catch {
    // Never let the bookkeeping itself break anything.
  }
}

/** The error codes counted so far, for the snapshot. */
export function errorSummary() {
  return { counts: { ...errors.counts }, last: errors.last, lastAt: errors.lastAt };
}

/**
 * A value as one of the module's own fixed ids: `value` when it is one of `allowed` (an array, or the keys of an
 * object), else "other". Keeps anything typed by hand (house-rule ids, custom catalog entries) out of a breadcrumb.
 */
export function ownId(value, allowed) {
  const ok = Array.isArray(allowed) ? allowed.includes(value)
    : (allowed && typeof value === "string" && Object.hasOwn(allowed, value));
  return ok ? value : "other";
}

function snapshot() {
  try {
    return snapshotFn() ?? {};
  } catch (err) {
    console.warn(`${MODULE_ID} | debug recorder snapshot failed`, err);
    return { snapshotError: true };
  }
}

/** How often a failed registration is retried, and how long to wait between tries. */
const RETRIES = 3;
const RETRY_MS = 5000;
let retries = 0;

/**
 * Registers with the recorder once (whichever of its ready hook or the fallback comes first). The API is only kept
 * once `register` succeeded (it returns false on failure), so a failed registration doesn't block the other path; it
 * is also retried a few times.
 */
function connect(rec) {
  if (recorder || !rec || typeof rec.register !== "function") return;
  try {
    if (rec.register(MODULE_ID, { snapshot }) !== false) recorder = rec;
    else if (retries++ < RETRIES) setTimeout(() => connect(rec), RETRY_MS);
  } catch (err) {
    console.warn(`${MODULE_ID} | debug recorder registration failed`, err);
    if (retries++ < RETRIES) setTimeout(() => connect(rec), RETRY_MS);
  }
}

// Listen from import time, so the recorder's ready hook is never missed whatever the load order.
Hooks.once(`${RECORDER_ID}.ready`, rec => connect(rec));

/**
 * Sets the snapshot function and registers with the recorder if its API is already there (it became ready before
 * this module's code ran). Called from "init" and again from "ready".
 * @param {{snapshot: () => object}} options
 */
export function registerDebugRecorder({ snapshot: fn } = {}) {
  if (typeof fn === "function") snapshotFn = fn;
  try {
    const mod = game.modules.get(RECORDER_ID);
    if (mod?.active && mod.api) connect(mod.api);
  } catch (err) {
    console.warn(`${MODULE_ID} | debug recorder lookup failed`, err);
  }
}

/** Whether this module is registered with the recorder (for the self-tests). */
export function recorderConnected() {
  return !!recorder;
}

/**
 * For the self-tests only: route breadcrumbs to a stand-in recorder and register with it the way the real one is
 * registered, without touching the real recorder's state (it can still connect meanwhile). Returns a function that
 * removes the stand-in.
 */
export const testing = {
  swap(rec) {
    standIn = rec ?? null;
    try { rec?.register?.(MODULE_ID, { snapshot }); } catch (err) { console.warn(`${MODULE_ID} | stand-in recorder`, err); }
    return () => { if (standIn === rec) standIn = null; };
  }
};
