import { MODULE_ID, t, isResponsibleGM } from "./util.js";

/**
 * The dnd5e system's own Bastion rules (System Settings → Bastions) can be off in a world. The module works without
 * them, so it never switches them on by itself: once per world it whispers the GMs a chat card that says so, with a
 * button to turn them on (keeping the system's own turn button off, the module runs the turns) and one to keep them
 * off. The setting "systemRulesNotice" remembers the outcome: "" (not asked yet), "posted", "enabled", "dismissed".
 */

const FLAG = "systemRules";

function systemConfig() {
  try { return game.settings.get("dnd5e", "bastionConfiguration") ?? null; } catch { return null; }
}

function plain(cfg) {
  const data = typeof cfg?.toObject === "function" ? cfg.toObject() : { ...(cfg ?? {}) };
  return { button: !!data.button, enabled: !!data.enabled, duration: Number(data.duration) || 7 };
}

export function registerSystemRulesSetting() {
  game.settings.register(MODULE_ID, "systemRulesNotice", { scope: "world", config: false, type: String, default: "" });
}

function cardHTML(state = "ask") {
  const head = `<h3><i class="fa-solid fa-chess-rook"></i> ${t("SystemRules.Title")}</h3>`;
  if (state === "enabled") return `<div class="dxpb-card dxpb-system-rules">${head}<p>${t("SystemRules.Enabled")}</p></div>`;
  if (state === "dismissed") return `<div class="dxpb-card dxpb-system-rules">${head}<p>${t("SystemRules.Dismissed")}</p></div>`;
  return `<div class="dxpb-card dxpb-system-rules">${head}<p>${t("SystemRules.Body")}</p><p>${t("SystemRules.TurnOn")}</p>
    <div class="dxpb-button-row">
      <button type="button" data-dxpb-system-rules="enable"><i class="fa-solid fa-toggle-on"></i> ${t("SystemRules.Enable")}</button>
      <button type="button" data-dxpb-system-rules="dismiss"><i class="fa-solid fa-xmark"></i> ${t("SystemRules.Keep")}</button>
    </div></div>`;
}

/**
 * Responsible GM, on ready: whispers the card to the GMs if the system's rules are off and the world hasn't been asked.
 * @returns {Promise<ChatMessage|null>}
 */
export async function postSystemRulesNotice({ force = false, responsible = isResponsibleGM() } = {}) {
  if (!responsible || !game.user.isGM || game.system?.id !== "dnd5e") return null;
  const cfg = systemConfig();
  if (!cfg) return null;
  const state = game.settings.get(MODULE_ID, "systemRulesNotice");
  if (cfg.enabled) {
    // On already: nothing to ask, now or later.
    if (!state) await game.settings.set(MODULE_ID, "systemRulesNotice", "enabled");
    return null;
  }
  if (state && !force) return null;
  const message = await ChatMessage.create({
    content: cardHTML("ask"),
    speaker: { alias: game.modules.get(MODULE_ID)?.title ?? "Player Bastions" },
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    flags: { [MODULE_ID]: { [FLAG]: true } }
  });
  await game.settings.set(MODULE_ID, "systemRulesNotice", "posted");
  return message;
}

/** A GM's answer on the card: "enable" turns the system's rules on (its turn button off), "dismiss" keeps them off. */
export async function resolveSystemRulesNotice(choice, message = null) {
  if (!game.user.isGM) return false;
  if (choice === "enable") {
    const cfg = systemConfig();
    if (!cfg) return false;
    await game.settings.set("dnd5e", "bastionConfiguration", { ...plain(cfg), enabled: true, button: false });
  }
  const state = choice === "enable" ? "enabled" : "dismissed";
  await game.settings.set(MODULE_ID, "systemRulesNotice", state);
  if (message?.isOwner) await message.update({ content: cardHTML(state) });
  return true;
}

/** Wires the card's buttons (renderChatMessageHTML). */
export function bindSystemRulesCard(message, html) {
  if (!message.getFlag(MODULE_ID, FLAG)) return;
  html.querySelectorAll("[data-dxpb-system-rules]").forEach(btn => {
    if (!game.user.isGM) { btn.remove(); return; }
    btn.addEventListener("click", async () => {
      html.querySelectorAll("[data-dxpb-system-rules]").forEach(b => (b.disabled = true));
      try { await resolveSystemRulesNotice(btn.dataset.dxpbSystemRules, message); }
      catch (err) {
        console.error(`${MODULE_ID} | system Bastion rules`, err);
        html.querySelectorAll("[data-dxpb-system-rules]").forEach(b => (b.disabled = false));
      }
    });
  });
}
