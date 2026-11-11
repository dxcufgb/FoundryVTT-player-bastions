import { MODULE_ID, isResponsibleGM, randomId, t } from "./util.js";
import { crumb, noteError, ownId } from "./debug-recorder.js";
import { withBastionLock } from "./lock.js";

/**
 * Player → GM relay. Players read their Bastion but never write it: every change is an action the responsible GM runs
 * (actions.js checks the user's rights again on the GM side). A GM calling an action runs it locally.
 */
const EVENT = `module.${MODULE_ID}`;
const pending = new Map();
let handlers = {};

/**
 * Runs one action and leaves a breadcrumb for the Debug Recorder: the action's own name, whether it worked, how long
 * it took, and whether a player's request was relayed. Never the action's data.
 */
/** Actions that lock inside their turn-runner call (see lock.js). */
const RUNS_ITSELF = new Set(["advanceTurn", "longRest", "countRest", "siegeDay", "finishProject", "finishAllProjects"]);

async function runAction(action, data, user, relayed) {
  const started = Date.now();
  const fn = handlers[action];
  if (!fn) {
    crumb("action.unknown", { relayed });
    return { ok: false, reason: "Unknown action" };
  }
  try {
    // Actions on one Bastion run one at a time, and wait for its turn (lock.js). The ones that run a turn, a rest, a
    // siege day or a finish take the lock inside (turn-runner.js) instead.
    const entryId = typeof data?.entryId === "string" && !RUNS_ITSELF.has(action) ? data.entryId : null;
    const result = await withBastionLock(entryId, () => fn(data ?? {}, user));
    crumb("action.run", () => ({ action: ownId(action, handlers), ok: result?.ok !== false, ms: Date.now() - started, relayed,
      byGM: !!user?.isGM }));
    return result;
  } catch (err) {
    noteError(`action.${ownId(action, handlers)}`);
    throw err;
  }
}

export function registerSocket(actionHandlers) {
  handlers = actionHandlers;
  game.socket.on(EVENT, async (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "request" && isResponsibleGM()) {
      const user = game.users.get(msg.userId);
      let result;
      try {
        if (!user) throw new Error("Unknown user");
        result = await runAction(msg.action, msg.data, user, true);
      } catch (err) {
        console.error(`${MODULE_ID} | relayed action ${msg.action} failed`, err);
        noteError("socket.relay");
        result = { ok: false, reason: err.message };
      }
      game.socket.emit(EVENT, { type: "response", requestId: msg.requestId, userId: msg.userId, result });
    } else if (msg.type === "response" && msg.userId === game.user.id) {
      const resolve = pending.get(msg.requestId);
      if (resolve) {
        pending.delete(msg.requestId);
        resolve(msg.result);
      }
    }
  });
}

/**
 * Runs an action on the responsible GM: locally there, over the socket from a player or another GM, so every change to
 * a Bastion goes through the one GM that holds its lock (lock.js). Resolves to the action's result.
 */
export async function request(action, data = {}) {
  if (isResponsibleGM() || (game.user.isGM && !game.users.activeGM)) return runAction(action, data, game.user, false);
  if (!game.users.activeGM) {
    crumb("socket.noGM", { action: ownId(action, handlers) });
    ui.notifications.warn(t("Notify.NoGM"));
    return { ok: false, reason: "noGM" };
  }
  crumb("socket.relay.send", { action: ownId(action, handlers) });
  const requestId = randomId();
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    game.socket.emit(EVENT, { type: "request", requestId, userId: game.user.id, action, data });
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        noteError("socket.timeout");
        resolve({ ok: false, reason: "timeout" });
      }
    // A GM's request may be a whole turn: it gets longer before it counts as lost.
    }, game.user.isGM ? 120000 : 15000);
  });
}
