import { MODULE_ID, isResponsibleGM, randomId, t } from "./util.js";

/**
 * Player → GM relay. Players read their Bastion but never write it: every change is an action the responsible GM runs
 * (actions.js checks the user's rights again on the GM side). A GM calling an action runs it locally.
 */
const EVENT = `module.${MODULE_ID}`;
const pending = new Map();
let handlers = {};

export function registerSocket(actionHandlers) {
  handlers = actionHandlers;
  game.socket.on(EVENT, async (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "request" && isResponsibleGM()) {
      const user = game.users.get(msg.userId);
      let result;
      try {
        const fn = handlers[msg.action];
        if (!fn || !user) throw new Error("Unknown action");
        result = await fn(msg.data ?? {}, user);
      } catch (err) {
        console.error(`${MODULE_ID} | relayed action ${msg.action} failed`, err);
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

/** Runs an action as the GM: locally for a GM, over the socket for a player. Resolves to the action's result. */
export async function request(action, data = {}) {
  if (game.user.isGM) {
    const fn = handlers[action];
    if (!fn) return { ok: false, reason: "Unknown action" };
    return fn(data, game.user);
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(t("Notify.NoGM"));
    return { ok: false, reason: "noGM" };
  }
  const requestId = randomId();
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    game.socket.emit(EVENT, { type: "request", requestId, userId: game.user.id, action, data });
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        resolve({ ok: false, reason: "timeout" });
      }
    }, 15000);
  });
}
