/**
 * A Bastion with everything built: every building its site allows at its top tier or level (rooms Vast, "each" at
 * its max, the wall round the whole perimeter, the road all the way), guards and servants to their caps, and Vast
 * bedrooms until everyone has a bed. For balancing (the engine tests hold every site within reach of the River Keep)
 * and for the GM's own sums through the API. Pure.
 */
import { createRecord } from "./record.js";
import { computeStats } from "./stats.js";
import { prerequisites, possibleHere } from "./catalog.js";
import { groundsInfo, spaceUsed, fittingGroundsIndex } from "./grounds.js";

/** The reference site: plains by a river, a town 10 miles off, timber, stone and game. */
export const RIVER_KEEP = {
  terrain: "plains", site: "flat", settlement: { name: "Town", size: "town", distance: 10 }, road: "road", waterway: "river",
  waterOnSite: "table", climate: "temperate", land: "fertile", resources: ["timber", "stone", "game"], danger: "safe",
  visibility: "ordinary", political: "freehold"
};

/**
 * Builds everything at a location. Returns { record, stats, gold, foodNet, foodBuy }: gold is a turn's net after
 * food bought and with the average merchant fees; foodNet is food a day (made minus eaten).
 */
export function fullBuild(location, { rules, catalog, structure = "keep", ownersPresent = 4 } = {}) {
  let n = 0;
  const newId = () => `fb${++n}`;
  const ctx = { ownersPresent };
  const stats = rec => computeStats(rec, { rules, catalog, ctx });
  const top = e => e?.tiers?.length ?? 1;
  const rec = createRecord({ name: "Fully built", location, structure: { type: structure, acquisition: "reward" },
    food: 0, treasury: 0, guards: 0, servants: 0 }, { newId, now: 0 });
  rec.projects = {};
  const built = new Set(Object.values(rec.features).map(f => f.id));
  const add = (e, extra = {}) => { rec.features[newId()] = { id: e.id, tier: top(e), builtAt: 0, ...extra }; built.add(e.id); };
  for (const f of Object.values(rec.features)) {
    const e = catalog.get(f.id);
    if (e?.unit === "sized") f.size = "vast";
    f.tier = top(e);
  }
  // Hidden Approach is left out: the road a fully built Bastion has ends it.
  const possible = [...catalog.values()].filter(e => !e.legacy && e.id !== "hidden-approach" && possibleHere(rec, e, catalog).ok);
  for (let changed = true, guard = 0; changed && guard < 20; guard++) {
    changed = false;
    const s = stats(rec);
    for (const e of possible) {
      if (built.has(e.id) && e.unit !== "mile") continue;
      if (!prerequisites(rec, e, catalog, s).ok) continue;
      if (e.unit === "sized") add(e, { size: "vast" });
      else if (e.unit === "each") add(e, { count: e.max ?? 1 });
      else if (e.unit === "mile") add(e, { count: Math.max(1, Number(rec.location.settlement?.distance) || 1) });
      else if (e.unit === "square") add(e, { count: 1 });
      else add(e);
      changed = true;
    }
  }
  let s = stats(rec);
  rec.garrison = { ...(rec.garrison ?? {}), guards: s.fx.guardsCap ?? 0, servants: s.fx.servantsCap ?? 0, mercenaries: 0, crews: 0 };
  const bedroom = catalog.get("bedroom");
  for (let i = 0; i < 60 && bedroom; i++) {
    s = stats(rec);
    if (s.housing >= s.population) break;
    add(bedroom, { size: "vast" });
  }
  const grounds = groundsInfo(fittingGroundsIndex(spaceUsed(rec, catalog), rules, 0), rules);
  rec.grounds = grounds.key;
  for (const f of Object.values(rec.features)) if (catalog.get(f.id)?.unit === "square") f.count = grounds.perimeter;
  s = stats(rec);
  const foodBuy = s.food.peaceNet < 0 ? Math.ceil(-s.food.peaceNet * (rules.turnDays ?? 7) * s.food.buyPrice) : 0;
  const gold = s.economy.net - foodBuy + (s.merchant.visitGoldAverage ?? 0);
  return { record: rec, stats: s, gold, foodNet: s.food.peaceNet, foodBuy };
}
