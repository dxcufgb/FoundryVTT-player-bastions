/**
 * Trade routes, Foundry side: the settlements that can ask (the Bastion's own settlement and the map notes near its
 * marker) and the quest in Dxcufgb's Quest Log (`dxcufgbs-quest-log`, optional) that follows an accepted route.
 * The rules are in core/trade.js.
 */
import { MODULE_ID, t, rules, gp } from "./util.js";
import { settlementsNear } from "./marker.js";
import { settlementList } from "./core/trade.js";

const QUEST_LOG = "dxcufgbs-quest-log";

/**
 * Settlements a route can go to: the Bastion's own ("home"), the GM's list (record.settlements) and the map notes
 * within reach of its marker (core settlementList: { key, name, distance, size?, source }).
 */
export function tradeSettlements(record) {
  const notes = [];
  const scene = record?.marker?.sceneUuid ? fromUuidSync(record.marker.sceneUuid) : null;
  const note = scene && record.marker?.noteId ? scene.notes.get(record.marker.noteId) : null;
  if (note) {
    const max = rules().tradeMaxMiles ?? 150;
    for (const s of settlementsNear(scene, note)) {
      if (s.distance > max) break;
      notes.push({ id: s.id, name: s.name, distance: s.distance });
    }
  }
  return settlementList(record, notes);
}

/** Dxcufgb's Quest Log API, when that module is active and ready. */
export function questLog() {
  const mod = game.modules.get(QUEST_LOG);
  return mod?.active && mod.api?.createQuest ? mod.api : null;
}

const worth = r => (r.kind === "food" ? t("Trade.FoodWorth", { n: r.food }) : t("Trade.CoinWorth", { gold: gp(r.income) }));

/** A side quest for an accepted route (GM side). Returns the quest id or null. */
export async function createRouteQuest(record, route) {
  const api = questLog();
  if (!api) return null;
  try {
    return await api.createQuest({
      title: t("Trade.QuestTitle", { name: route.name }),
      giver: route.name,
      acquiredAt: record.name,
      reward: worth(route),
      questType: "side",
      tags: [t("Trade.QuestTag"), record.name],
      description: `<p>${t("Trade.QuestText", { name: route.name, bastion: record.name, goods: t(`Trade.Goods.${route.goods}`),
        worth: worth(route), setup: gp(route.setup), deadline: route.deadline })}</p>`,
      objectives: [t("Trade.QuestTravel", { name: route.name, miles: route.distance }), t("Trade.QuestTerms"),
        t("Trade.QuestSign", { setup: gp(route.setup) })]
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Quest Log`, err);
    return null;
  }
}

/** Closes a route's quest: "completed" when signed, "failed" when it lapsed or was withdrawn. */
export async function closeRouteQuest(route, status) {
  const api = questLog();
  if (!api || !route?.questId) return;
  try {
    if (api.getQuest && !api.getQuest(route.questId)) return;
    await api.setStatus(route.questId, status);
  } catch (err) {
    console.warn(`${MODULE_ID} | Quest Log`, err);
  }
}
