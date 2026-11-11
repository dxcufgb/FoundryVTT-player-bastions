import { EXPANSIONS, SIZES } from "../data/catalog.js";
import { ROADS } from "../data/location.js";

/**
 * Catalog helpers: lookups with GM overrides, prerequisite checks and the combined effects of a built feature.
 * Pure: no Foundry globals.
 */

/** The catalog with GM overrides applied: { [id]: partial entry } replaces fields; { [id]: { disabled: true } } hides it;
 *  a new id adds a custom expansion. */
export function buildCatalog(overrides = {}) {
  const map = new Map(EXPANSIONS.map(e => [e.id, structuredClone(e)]));
  for (const [id, patch] of Object.entries(overrides ?? {})) {
    if (!patch) continue;
    const base = map.get(id);
    if (base) map.set(id, { ...base, ...patch, id });
    else if (patch.name) map.set(id, { group: "rooms", unit: "flat", cost: 0, days: 1, effects: {}, ...patch, id, custom: true });
  }
  for (const [id, e] of map) if (e.disabled) map.delete(id);
  return map;
}

export function sizeIndex(size) {
  const i = SIZES.indexOf(size);
  return i < 0 ? 0 : i;
}

/** Number value of an effect for a feature, resolving sized arrays. */
function pick(value, feature) {
  if (Array.isArray(value)) return value[sizeIndex(feature.size)] ?? 0;
  return value;
}

/** Keys added per unit when an expansion is built several times ("each"). */
const PER_UNIT = new Set(["defensePct", "integrity", "security", "concealment", "engineCut", "garrison", "upkeep", "housing", "income",
  "workers", "tradeRoutes", "tradePosts"]);
/** Keys that multiply instead of add. */
export const MULT_KEYS = new Set(["defenseMult", "farmMult", "innMult", "siegeFood", "merchantStock", "visitorPay", "defenderMult",
  "timberDiscount", "stoneDiscount", "palisadeTime"]);

/**
 * The effects of one built feature as a flat object: tiers added up to the feature's tier, sized values resolved,
 * "each" counts applied. Strings and booleans pass through (the last tier wins).
 */
export function featureEffects(exp, feature) {
  if (!exp) return {};
  const out = {};
  const add = (effects) => {
    for (const [k, raw] of Object.entries(effects ?? {})) {
      const v = pick(raw, feature);
      if (typeof v === "number") {
        if (MULT_KEYS.has(k)) out[k] = (out[k] ?? 1) * v;
        else out[k] = (out[k] ?? 0) + v;
      } else if (k === "incomeDice" && out[k]) out[k] = `${out[k]}+${v}`;
      else out[k] = v;
    }
  };
  if (exp.tiers?.length) {
    const tier = Math.clamp ? Math.clamp(feature.tier ?? 1, 1, exp.tiers.length) : Math.min(Math.max(feature.tier ?? 1, 1), exp.tiers.length);
    for (let i = 0; i < tier; i++) add(exp.tiers[i].effects);
  } else add(exp.effects);
  if (exp.unit === "each") {
    const n = Math.max(1, Number(feature.count) || 1);
    for (const k of Object.keys(out)) if (PER_UNIT.has(k) && typeof out[k] === "number") out[k] *= n;
  }
  if (exp.upkeep && !out.upkeep) out.upkeep = exp.upkeep * (exp.unit === "each" ? Math.max(1, Number(feature.count) || 1) : 1);
  return out;
}

/** Features of the record as [featureId, feature, expansion] (unknown expansions skipped), excluding damaged ones when asked. */
export function features(record, catalog, { includeDamaged = false } = {}) {
  const out = [];
  for (const [fid, f] of Object.entries(record?.features ?? {})) {
    if (!f) continue;
    const exp = catalog.get(f.id);
    if (!exp) continue;
    if (f.damaged && !includeDamaged) continue;
    out.push([fid, f, exp]);
  }
  return out;
}

export function hasFeature(record, id) {
  return Object.values(record?.features ?? {}).some(f => f?.id === id && !f.damaged);
}

export function featureOf(record, id) {
  return Object.entries(record?.features ?? {}).find(([, f]) => f?.id === id) ?? null;
}

/** Current road tier key, after road projects that cover the whole route. */
export function roadTier(record, catalog) {
  const loc = record?.location ?? {};
  let rank = ROADS[loc.road]?.rank ?? 0;
  const distance = Math.ceil(Number(loc.settlement?.distance) || 0);
  for (const [, f, exp] of features(record, catalog)) {
    const tier = exp.effects?.roadTier;
    if (!tier) continue;
    if ((Number(f.count) || 0) < distance) continue;
    rank = Math.max(rank, ROADS[tier]?.rank ?? 0);
  }
  return Object.keys(ROADS).find(k => ROADS[k].rank === rank) ?? "none";
}

/** Named prerequisite checks. `stats` may be null for checks that don't need it. */
export const CHECKS = {
  anyWall: (r, c) => features(r, c).some(([, , e]) => e.effects?.wall) || !!r?.structureWall,
  moatWater: r => ["stream", "river", "lake", "coast"].includes(r?.location?.waterway) || r?.location?.waterOnSite === "spring",
  fishing: r => ["stream", "river", "lake", "coast"].includes(r?.location?.waterway),
  highland: r => ["hills", "mountains"].includes(r?.location?.terrain) || r?.location?.land === "barren",
  wellSite: r => ["spring", "table"].includes(r?.location?.waterOnSite),
  rockSite: r => ["rock", "none"].includes(r?.location?.waterOnSite),
  notUnderground: r => r?.location?.terrain !== "underground",
  farmland: r => r?.location?.land !== "barren" && r?.location?.terrain !== "underground" && !r?.noFields,
  millSite: r => ["stream", "river"].includes(r?.location?.waterway) || ["plains", "hills"].includes(r?.location?.terrain),
  game: r => (r?.location?.resources ?? []).includes("game"),
  timber: r => (r?.location?.resources ?? []).includes("timber"),
  stone: r => (r?.location?.resources ?? []).includes("stone"),
  ore: r => (r?.location?.resources ?? []).some(x => x === "ore" || x === "gems"),
  roadBelowTrail: (r, c) => (ROADS[roadTier(r, c)]?.rank ?? 0) < 1,
  roadTrail: (r, c) => (ROADS[roadTier(r, c)]?.rank ?? 0) === 1,
  roadBelowRoad: (r, c) => (ROADS[roadTier(r, c)]?.rank ?? 0) < 2,
  roadRoad: (r, c) => (ROADS[roadTier(r, c)]?.rank ?? 0) >= 2,
  roadUnpaved: (r, c) => (ROADS[roadTier(r, c)]?.rank ?? 0) === 2,
  riverRoute: r => ["river", "lake"].includes(r?.location?.waterway) || !!r?.location?.riverOnRoute,
  pierWater: r => ["river", "lake", "coast"].includes(r?.location?.waterway),
  harborWater: r => ["coast", "river"].includes(r?.location?.waterway),
  access3: (r, c, s) => (s?.accessibility ?? 0) >= 3,
  access4: (r, c, s) => (s?.accessibility ?? 0) >= 4,
  access5: (r, c, s) => (s?.accessibility ?? 0) >= 5,
  marketTier2: r => Object.values(r?.features ?? {}).some(f => f?.id === "market-square" && (f.tier ?? 1) >= 2),
  courtyardRoomy: r => Object.values(r?.features ?? {}).some(f => f?.id === "courtyard" && ["roomy", "vast"].includes(f.size)),
  anyWater: r => ["stream", "river", "lake", "coast"].includes(r?.location?.waterway)
    || ["spring", "table"].includes(r?.location?.waterOnSite)
    || Object.values(r?.features ?? {}).some(f => ["well", "deep-well", "cistern"].includes(f?.id))
};

/** Human labels for the checks, for "needs ..." messages. */
export const CHECK_LABELS = {
  anyWall: "a wall", moatWater: "a spring, stream, river, lake or coast", fishing: "a stream, river, lake or coast", highland: "hills, mountains or barren land", wellSite: "water on site (spring or high water table)",
  rockSite: "a rock site without water", notUnderground: "open sky (not underground)", farmland: "farmland (fertile or poor land)",
  millSite: "a stream, river, plains or hills", game: "game in the area", timber: "timber nearby", stone: "stone nearby",
  ore: "ore or gems nearby", roadBelowTrail: "no road yet", roadTrail: "a trail", roadBelowRoad: "no road to the Bastion (a trail is fine)", roadRoad: "a road", roadUnpaved: "a road that isn't paved yet", riverRoute: "a river on the route",
  pierWater: "a river, lake or coast", harborWater: "a coast or large river", access3: "Accessibility 3+", access4: "Accessibility 4+",
  access5: "Accessibility 5+", marketTier2: "a Market Hall (Market Square upgraded once)", courtyardRoomy: "a Roomy or Vast Courtyard",
  anyWater: "a water source"
};

/**
 * Checks fixed by where the Bastion stands (terrain, land, water, resources): building something can't change them.
 * The others (a wall, the road, Accessibility, a Market Hall, water from a well) can change.
 */
/** Checks that stay failed once the road has passed them (roads are never torn up): not "later". */
export const ROAD_PASSED_CHECKS = ["roadBelowTrail", "roadBelowRoad"];

export const SITE_CHECKS = ["moatWater", "fishing", "highland", "wellSite", "rockSite", "notUnderground", "farmland", "millSite", "game",
  "timber", "stone", "ore", "riverRoute", "pierWater", "harborWater"];

/**
 * Whether an expansion can ever be built at this Bastion: its site checks pass, and every building it needs can be
 * built here too (any one of anyFeature). { ok, missing: [labels] } with the site's reasons.
 */
export function possibleHere(record, exp, catalog, seen = new Set()) {
  if (!exp) return { ok: false, missing: [] };
  if (seen.has(exp.id)) return { ok: true, missing: [] };
  seen.add(exp.id);
  const missing = [];
  const req = exp.requires ?? {};
  for (const check of req.check ?? []) {
    if (SITE_CHECKS.includes(check) && CHECKS[check] && !CHECKS[check](record, catalog, null)) missing.push(CHECK_LABELS[check] ?? check);
  }
  const can = id => hasFeature(record, id) || possibleHere(record, catalog.get(id), catalog, seen).ok;
  for (const id of req.features ?? []) if (!can(id)) missing.push(catalog.get(id)?.name ?? id);
  if (req.anyFeature?.length && !req.anyFeature.some(can)) missing.push(req.anyFeature.map(id => catalog.get(id)?.name ?? id).join(" or "));
  return { ok: missing.length === 0, missing };
}

/** Whether an expansion can be planned now: { ok, missing: [labels] }. Upgrades of tiered buildings use canUpgrade. */
export function prerequisites(record, exp, catalog, stats) {
  const missing = [];
  const req = exp?.requires ?? {};
  for (const id of req.features ?? []) if (!hasFeature(record, id)) missing.push(catalog.get(id)?.name ?? id);
  if (req.anyFeature?.length && !req.anyFeature.some(id => hasFeature(record, id))) {
    missing.push(req.anyFeature.map(id => catalog.get(id)?.name ?? id).join(" or "));
  }
  for (const check of req.check ?? []) {
    const fn = CHECKS[check];
    if (fn && !fn(record, catalog, stats)) missing.push(CHECK_LABELS[check] ?? check);
  }
  // One-of buildings can't be built twice (except "each" up to max, and repeatable rooms, walls and roads).
  if (["flat"].includes(exp?.unit) && hasFeature(record, exp.id)) missing.push("already built");
  if (exp?.unit === "each") {
    const have = Object.values(record?.features ?? {}).filter(f => f?.id === exp.id).reduce((n, f) => n + (Number(f.count) || 1), 0);
    if (exp.max && have >= exp.max) missing.push(`at most ${exp.max}`);
  }
  return { ok: missing.length === 0, missing };
}
