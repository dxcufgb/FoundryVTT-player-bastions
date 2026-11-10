import { GROUNDS, SIZE_FOOTPRINT, FOOTPRINTS, WALL_LAYERS, OUTER_WORKS } from "../data/grounds.js";
import { SIZES } from "../data/catalog.js";
import { STRUCTURES } from "../data/structures.js";
import { priceGp } from "./price.js";

/**
 * Grounds and space: how much room is inside the walls, what the buildings take, and what extending the grounds
 * costs. Pure.
 */

/** Squares one building takes. `feature` gives size, count and tier (a planned project can stand in for it). */
export function footprintOf(exp, feature = {}) {
  if (!exp) return 0;
  const spec = exp.footprint ?? FOOTPRINTS[exp.id] ?? (exp.unit === "sized" ? "sized" : 0);
  const count = exp.unit === "each" ? Math.max(1, Number(feature.count) || 1) : 1;
  if (spec === "sized") return (SIZE_FOOTPRINT[feature.size ?? "cramped"] ?? 0) * count;
  if (Array.isArray(spec)) {
    const tier = Math.max(1, Number(feature.tier) || 1);
    return (spec[Math.min(spec.length, tier) - 1] ?? 0) * count;
  }
  return (Number(spec) || 0) * count;
}

/** A grounds size by index, with its area, perimeter and buildable squares. */
export function groundsInfo(index, rules) {
  const i = Math.max(0, Math.min(GROUNDS.length - 1, index));
  const g = GROUNDS[i];
  const area = g.side * g.side;
  return {
    index: i, key: g.key, label: g.label, side: g.side, area, perimeter: g.side * 4,
    usable: Math.floor(area * (rules?.groundsUsablePct ?? 60) / 100),
    next: i < GROUNDS.length - 1 ? GROUNDS[i + 1].key : null
  };
}

export function groundsIndex(key) {
  const i = GROUNDS.findIndex(g => g.key === key);
  return i < 0 ? 0 : i;
}

/** Squares the built features take (damaged ones still stand on the ground). */
export function spaceUsed(record, catalog) {
  let used = 0;
  for (const f of Object.values(record?.features ?? {})) {
    if (!f) continue;
    used += footprintOf(catalog.get(f.id), f);
  }
  // The first watchtower stands in the middle of the grounds, 4 × 4 squares rather than 2 × 2.
  if (Object.values(record?.features ?? {}).some(f => f?.id === "watchtower")) used += CENTRE_TOWER_EXTRA;
  return used;
}

/** Extra squares the centre tower (the first watchtower, 4 × 4) takes over a watchtower's usual 4. */
export const CENTRE_TOWER_EXTRA = 12;

/** Extra squares a project will take when it is finished (0 for repairs and things outside the walls). */
export function projectSpace(record, catalog, p) {
  if (!p || p.kind === "repair" || p.kind === "grounds") return 0;
  if (p.kind === "build") {
    const first = p.expansionId === "watchtower" && !Object.values(record?.features ?? {}).some(f => f?.id === "watchtower");
    return footprintOf(catalog.get(p.expansionId), { size: p.size, count: p.count, tier: 1 }) + (first ? CENTRE_TOWER_EXTRA : 0);
  }
  const f = record?.features?.[p.featureId];
  const exp = catalog.get(f?.id ?? p.expansionId);
  if (!f || !exp) return 0;
  const before = footprintOf(exp, f);
  if (p.kind === "enlarge") {
    const to = SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(f.size) + 1)];
    return Math.max(0, footprintOf(exp, { ...f, size: to }) - before);
  }
  if (p.kind === "upgrade") return Math.max(0, footprintOf(exp, { ...f, tier: p.tier ?? (f.tier ?? 1) + 1 }) - before);
  return 0;
}

/** Squares held for projects that are planned or under way, so two plans can't promise the same ground. */
export function spaceReserved(record, catalog) {
  let n = 0;
  for (const p of Object.values(record?.projects ?? {})) {
    if (!p || ["complete", "cancelled"].includes(p.state)) continue;
    n += projectSpace(record, catalog, p);
  }
  return n;
}

/** The smallest grounds that hold `squares` of buildings. */
export function fittingGroundsIndex(squares, rules, atLeast = 0) {
  for (let i = Math.max(0, atLeast); i < GROUNDS.length; i++) if (groundsInfo(i, rules).usable >= squares) return i;
  return GROUNDS.length - 1;
}

/**
 * The record's grounds. Older Bastions (from before grounds existed) get the smallest size that holds what they
 * already have, never smaller than their structure's.
 */
export function groundsOf(record, catalog, rules) {
  const used = spaceUsed(record, catalog);
  const reserved = spaceReserved(record, catalog);
  let index;
  if (record?.grounds) index = groundsIndex(record.grounds);
  else {
    const base = groundsIndex(STRUCTURES[record?.structure?.type]?.grounds ?? "plot");
    index = fittingGroundsIndex(used, rules, base);
  }
  const info = groundsInfo(index, rules);
  return { ...info, used, reserved, free: Math.max(0, info.usable - used - reserved), over: Math.max(0, used - info.usable) };
}

/** Whether `squares` more fit now: { ok, need, free, reason }. */
export function roomFor(record, catalog, rules, squares) {
  const g = groundsOf(record, catalog, rules);
  if (squares <= 0 || squares <= g.free) return { ok: true, need: squares, free: g.free, grounds: g };
  return {
    ok: false, need: squares, free: g.free, grounds: g, full: true,
    reason: `No room inside the walls: needs ${squares} squares, ${g.free} free. Extend the grounds first.`
  };
}

/**
 * What extending the grounds one size costs before the usual factors (hauling, region, crews, rush): clearing the
 * new land, lengthening the wall to the new perimeter at its price per square for every tier it has (a palisade
 * upgraded to a reinforced stone wall costs and takes all three steps per square), and digging
 * any ditch or moat out to the new line (its share of the new perimeter). So the more the walls have been upgraded,
 * the longer extending takes. Returns { ok, from, to, cost, days, parts, walls: {expansionId: extraSquares} }.
 */
export function extendGroundsBase(record, catalog, rules) {
  const g = groundsOf(record, catalog, rules);
  if (!g.next) return { ok: false, reason: "The grounds can't grow any further" };
  const to = groundsInfo(g.index + 1, rules);
  const newArea = to.area - g.area;
  const landMult = rules.groundsTerrainMult?.[record?.location?.terrain] ?? 1;
  const landCost = Math.round(newArea * rules.groundsLandCost * landMult);
  const landDays = Math.ceil(newArea / 100 * rules.groundsLandDays);
  const parts = [{ label: `Clear and level ${newArea} squares`, value: landCost }];
  let cost = landCost;
  let days = landDays;
  const walls = {};
  const extra = to.perimeter - g.perimeter;
  for (const id of WALL_LAYERS) {
    const f = Object.values(record?.features ?? {}).find(x => x?.id === id && x.enclosed !== false);
    const exp = catalog.get(id);
    if (!f || !exp) continue;
    // Every tier built so far, per square.
    const tiers = exp.tiers?.length ? exp.tiers.slice(0, Math.max(1, Math.min(exp.tiers.length, f.tier ?? 1))) : null;
    const perCost = tiers ? tiers.reduce((n, t) => n + priceGp(t.cost, rules?.price), 0) : priceGp(Array.isArray(exp.cost) ? exp.cost[0] : exp.cost, rules?.price);
    const perDays = tiers ? tiers.reduce((n, t) => n + t.days, 0) : (Array.isArray(exp.days) ? exp.days[0] : exp.days);
    const c = perCost * extra;
    walls[id] = extra;
    cost += c;
    days += perDays * extra;
    const name = tiers && tiers.length > 1 ? `${exp.name} (${tiers.map(t => t.label.toLowerCase()).join(" + ")})` : exp.name;
    parts.push({ label: `${name}: ${extra} more squares`, value: c });
  }
  for (const id of OUTER_WORKS) {
    const exp = catalog.get(id);
    if (!exp || !Object.values(record?.features ?? {}).some(f => f?.id === id)) continue;
    const share = extra / to.perimeter;
    const c = Math.round(priceGp(exp.cost, rules?.price) * share);
    cost += c;
    days += Math.ceil(exp.days * share);
    parts.push({ label: `${exp.name}: dug out to the new line`, value: c });
  }
  return { ok: true, from: g, to, cost, days, parts, walls };
}
