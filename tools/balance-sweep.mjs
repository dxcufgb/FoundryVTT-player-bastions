/**
 * Balance sweep (not shipped): builds everything at every combination of the main location choices and reports how
 * far each falls from the River Keep in gold a turn and food a day. Run: node tools/balance-sweep.mjs [--all]
 * (default: no resources, a far hamlet, hostile and hidden; --all also tries every resource at once).
 */
import { mergeRules } from "../scripts/data/rules.js";
import { buildCatalog } from "../scripts/core/catalog.js";
import { BUILD_PACES, BUILD_PRICES } from "../scripts/core/projects.js";
import { fullBuild, RIVER_KEEP } from "../scripts/core/fullbuild.js";

const fair = BUILD_PRICES.fair;
const rules = mergeRules({ price: { scale: fair.scale, power: fair.power }, crewHireCost: fair.crewHireCost, crewUpkeep: fair.crewUpkeep, pace: BUILD_PACES.adventure });
const catalog = buildCatalog();
const river = fullBuild(RIVER_KEEP, { rules, catalog });
const floor = river.gold - 750;
const T = ["plains", "forest", "hills", "mountains", "swamp", "desert", "coast", "arctic", "underground", "urban"];
const L = ["fertile", "poor", "barren"], C = ["temperate", "cold", "hot", "arid"], W = ["none", "stream", "river", "lake", "coast"];
const R = process.argv.includes("--all") ? [[], ["timber", "stone", "ore", "gems", "game", "herbs", "magic"]] : [[]];
const rows = [];
for (const terrain of T) for (const land of L) for (const climate of C) for (const waterway of W) for (const resources of R)
for (const political of ["freehold", "grant"]) for (const structure of ["keep", "cave"]) {
  const loc = { ...RIVER_KEEP, terrain, land, climate, waterway, resources, political, waterOnSite: "none", road: "none",
    settlement: { name: "Hamlet", size: "hamlet", distance: 60 }, danger: "hostile", visibility: "hidden" };
  const r = fullBuild(loc, { rules, catalog, structure });
  rows.push({ terrain, land, climate, waterway, res: resources.length ? "all" : "none", political, structure, gold: r.gold, food: r.foodNet });
}
const gold = rows.map(r => r.gold), food = rows.map(r => r.food);
console.log(`River Keep: ${river.gold} GP a turn, ${river.foodNet} food a day. Floor ${floor}.`);
console.log(`${rows.length} sites: gold ${Math.min(...gold)}…${Math.max(...gold)}, food ${Math.min(...food)}…${Math.max(...food)}`);
console.log(`Below the floor: ${rows.filter(r => r.gold < floor).length}; short of food: ${rows.filter(r => r.food < 0).length}`);
console.table(rows.sort((a, b) => a.gold - b.gold).slice(0, 10));
