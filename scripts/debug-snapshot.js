import { MODULE_ID, isResponsibleGM, setting, clockMode, calendarModules, rules } from "./util.js";
import { allBastions, getRecord, canAct } from "./store.js";
import { statsFor } from "./context.js";
import { errorSummary, ownId } from "./debug-recorder.js";
import { crewStatus, queueOrder } from "./core/crews.js";
import { STATES } from "./core/projects.js";
import { STRUCTURES } from "./data/structures.js";
import { TERRAINS } from "./data/location.js";
import { GROUNDS } from "./data/grounds.js";
import { MAP_GROUNDS } from "./data/map-style.js";
import { BastionSheet } from "./apps/bastion-sheet.js";

/**
 * The module's runtime state for Dxcufgb's Debug Recorder (see debug-recorder.js). Only counts, booleans, numbers,
 * document ids and this module's own fixed ids: never a Bastion's, character's, user's or place's name, its notes,
 * letters or history text, image paths or URLs.
 */

const KINDS = ["build", "upgrade", "enlarge", "repair", "grounds"];
const DISPATCH = ["transit", "arrived", "applied", "lost", "intercepted", "superseded"];
const SETTINGS = { clock: ["auto", "calendar", "rests"], buildPace: ["adventure", "campaign", "dmg"],
  buildPrice: ["fair", "thrifty", "dmg"], timePrompt: ["off", "prompt", "auto"] };
const GROUND_KEYS = GROUNDS.map(g => g.key);

/** {value: count} for the values of `key`, each one of `allowed` (anything else counts as "other"). */
function countBy(list, key, allowed) {
  const out = {};
  for (const item of list) {
    const v = ownId(item?.[key], allowed);
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

function settingsState() {
  const out = {};
  for (const [key, allowed] of Object.entries(SETTINGS)) {
    try { out[key] = ownId(setting(key), allowed); } catch { out[key] = "unset"; }
  }
  for (const key of ["payAsYouBuild", "strictDispatch", "processSystemTurns"]) {
    try { out[key] = !!setting(key); } catch { out[key] = null; }
  }
  let overrides = {};
  let catalogOverrides = {};
  try { overrides = game.settings.get(MODULE_ID, "rules") ?? {}; } catch { /* not registered */ }
  try { catalogOverrides = game.settings.get(MODULE_ID, "catalog") ?? {}; } catch { /* not registered */ }
  out.houseRuleKeys = Object.keys(overrides).length;
  out.catalogOverrides = Object.keys(catalogOverrides).length;
  return out;
}

function bastionState(entry, index) {
  const r = getRecord(entry);
  if (!r) return { index, docId: entry.id, record: false };
  let stats = null;
  try { stats = statsFor(r).stats; } catch { stats = null; }
  const projects = Object.values(r.projects ?? {});
  const features = Object.values(r.features ?? {});
  const crew = stats ? crewStatus(r, stats) : null;
  const sceneId = r.map?.sceneUuid?.split(".").pop() ?? null;
  return {
    index,
    docId: entry.id,
    canAct: (() => { try { return canAct(r); } catch { return false; } })(),
    presence: ownId(r.presence, ["present", "away"]),
    structure: ownId(r.structure?.type, STRUCTURES),
    terrain: ownId(r.location?.terrain, TERRAINS),
    grounds: ownId(stats?.grounds?.key, GROUND_KEYS),
    mapGround: r.mapGround ? ownId(r.mapGround, MAP_GROUNDS) : "auto",
    statsOk: !!stats,
    turn: Number(r.turn?.number) || 0,
    restsSinceTurn: Number(r.rests?.sinceTurn) || 0,
    owners: (r.ownerUuids?.length ?? 0) + (r.groupUuid ? 1 : 0),
    features: features.length,
    damaged: features.filter(f => f?.damaged).length,
    walled: features.some(f => f?.id === "wall" && f.enclosed !== false),
    projects: countBy(projects, "state", STATES),
    projectKinds: countBy(projects.filter(p => !["complete", "cancelled"].includes(p.state)), "kind", KINDS),
    queue: queueOrder(r.projects).length,
    crews: crew ? { total: crew.total, used: crew.used, hired: crew.hired, over: crew.over } : null,
    treasury: Number(r.treasury) || 0,
    food: Number(r.food) || 0,
    dispatches: countBy(Object.values(r.dispatches ?? {}), "status", DISPATCH),
    eventsPending: Object.values(r.events ?? {}).filter(x => x?.state === "pending").length,
    siege: !!r.siege,
    merchant: !!r.merchant,
    hasMarker: !!r.marker?.noteId,
    hasMap: !!r.map?.sceneUuid,
    mapSceneExists: sceneId ? !!game.scenes?.get(sceneId) : false,
    layoutItems: Object.keys(r.layout ?? {}).length,
    historyEntries: r.history?.length ?? 0
  };
}

export function debugSnapshot() {
  const entries = allBastions();
  let dnd5eBastions = null;
  try { dnd5eBastions = game.settings.get("dnd5e", "bastionConfiguration")?.enabled !== false; } catch { dnd5eBastions = null; }
  let openSheets = 0;
  for (const app of BastionSheet.instances.values()) if (app.rendered) openSheets++;
  const R = rules();
  return {
    version: game.modules.get(MODULE_ID)?.version ?? null,
    isGM: game.user.isGM,
    responsibleGM: isResponsibleGM(),
    activeGMPresent: !!game.users.activeGM,
    system: game.system?.id === "dnd5e" ? "dnd5e" : "other",
    systemVersion: game.system?.version ?? null,
    dnd5eBastionsEnabled: dnd5eBastions,
    clockMode: clockMode(),
    calendarModules: calendarModules().length,
    quench: !!game.modules.get("quench")?.active,
    settings: settingsState(),
    rules: { turnDays: R.turnDays, price: { ...R.price }, pace: { ...R.pace }, crewHireCost: R.crewHireCost, crewUpkeep: R.crewUpkeep },
    bastions: { total: entries.length, list: entries.map(bastionState) },
    openSheets,
    errors: errorSummary()
  };
}
