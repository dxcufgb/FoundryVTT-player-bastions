import {
  TERRAINS, SITES, SETTLEMENT_SIZES, ROADS, WATERWAYS, CLIMATES, LANDS, RESOURCES, DANGERS, VISIBILITY, POLITICAL,
  distanceAccessibility
} from "../data/location.js";
import { STRUCTURES } from "../data/structures.js";
import { MERCHANT_TIERS } from "../data/tables.js";
import { features, featureEffects, roadTier, MULT_KEYS } from "./catalog.js";
import { routeCapacity, routeTotals, routesOf } from "./trade.js";
import { groundsOf } from "./grounds.js";

/**
 * Computes every Bastion stat from the record. Pure.
 *
 * ctx (what the Foundry layer reads from the world):
 *   dmgDefenders     number of DMG Bastion Defenders on the owners' facilities
 *   dmgHirelings     number of DMG hirelings on the owners' facilities
 *   armoryStocked    the DMG Armory is stocked
 *   lieutenants      War Room lieutenants (DMG)
 *   pcsPresent       levels of player characters counted in the garrison (when the GM includes them)
 *   ownersPresent    number of owners living at the Bastion now
 *   teleportCircle   the DMG Teleportation Circle facility exists (exotic traders)
 *
 * Every score keeps a breakdown: [{ source, value }], shown on hover.
 */
export function computeStats(record, { rules, catalog, ctx = {} }) {
  const loc = record?.location ?? {};
  const structure = STRUCTURES[record?.structure?.type] ?? null;
  const B = {};
  const add = (stat, source, value) => {
    if (!value) return;
    (B[stat] ??= []).push({ source, value });
  };
  const sum = stat => (B[stat] ?? []).reduce((n, b) => n + b.value, 0);
  const clamp = (v, lo = 0, hi = 10) => Math.min(hi, Math.max(lo, v));

  /* ---------- features ---------- */
  const fx = {};        // summed / multiplied effects of all features
  const flags = {};     // boolean and string effects
  const incomeDice = [];
  let accessIncome = 0;
  // Workers (industries): those who moved away leave their buildings short-handed, earning that much less.
  const workersNeeded = features(record, catalog).reduce((n, [, f, exp]) => n + (Number(featureEffects(exp, f).workers) || 0), 0);
  const workersAway = Math.min(workersNeeded, Math.max(0, Math.floor(Number(record?.people?.workersAway) || 0)));
  const workforce = workersNeeded > 0 ? (workersNeeded - workersAway) / workersNeeded : 1;
  for (const [, f, exp] of features(record, catalog)) {
    const e = featureEffects(exp, f);
    const share = e.workers ? workforce : 1;
    if (share < 1 && typeof e.income === "number") e.income = Math.round(e.income * share);
    for (const [k, v] of Object.entries(e)) {
      if (k === "incomeDice") { incomeDice.push({ formula: v, source: exp.name, id: exp.id, share }); continue; }
      if (k === "wall" || k === "roadTier") continue;
      if (typeof v === "number") {
        if (MULT_KEYS.has(k)) fx[k] = (fx[k] ?? 1) * v;
        else {
          fx[k] = (fx[k] ?? 0) + v;
          if (["accessibility", "concealment", "security", "renown", "comfort", "housing"].includes(k)) add(k, exp.name, v);
        }
      } else flags[k] = v;
    }
    if (e.incomeAccess) accessIncome += e.income ?? 0;
  }
  if (flags.beacon) add("security", "Beacon Tower", 1);

  /* ---------- structure ---------- */
  const se = structure?.effects ?? {};
  for (const k of ["accessibility", "concealment", "security", "renown", "comfort"]) if (se[k]) add(k, structure.label, se[k]);

  /* ---------- location ---------- */
  const terrain = TERRAINS[loc.terrain]?.effects ?? {};
  const site = SITES[loc.site]?.effects ?? { siteMult: 1 };
  const danger = DANGERS[loc.danger]?.effects ?? {};
  const visibility = VISIBILITY[loc.visibility]?.effects ?? {};
  const political = POLITICAL[loc.political]?.effects ?? {};
  const climate = CLIMATES[loc.climate]?.effects ?? {};
  const tier = roadTier(record, catalog);
  const road = ROADS[tier];

  add("accessibility", `Road: ${road.label}`, road.accessibility);
  add("accessibility", `Settlement: ${SETTLEMENT_SIZES[loc.settlement?.size]?.label ?? "none"}`, SETTLEMENT_SIZES[loc.settlement?.size]?.accessibility ?? 0);
  add("accessibility", `Distance: ${Number(loc.settlement?.distance) || 0} mi`, distanceAccessibility(loc.settlement?.distance ?? 999));
  add("accessibility", `Waterway: ${WATERWAYS[loc.waterway]?.label ?? "none"}`, WATERWAYS[loc.waterway]?.accessibility ?? 0);
  add("accessibility", `Terrain: ${TERRAINS[loc.terrain]?.label ?? ""}`, terrain.accessibility ?? 0);

  add("concealment", "Base", 5);
  add("concealment", `Terrain: ${TERRAINS[loc.terrain]?.label ?? ""}`, terrain.concealment ?? 0);
  add("concealment", `Site: ${SITES[loc.site]?.label ?? ""}`, site.concealment ?? 0);
  add("concealment", `Visibility: ${VISIBILITY[loc.visibility]?.label ?? ""}`, visibility.concealment ?? 0);
  add("concealment", `Road: ${road.label}`, road.concealment);

  add("security", "Base", 2);
  add("security", `Land: ${POLITICAL[loc.political]?.label ?? ""}`, political.security ?? 0);

  add("renown", "Base", 1);
  add("renown", `Visibility: ${VISIBILITY[loc.visibility]?.label ?? ""}`, visibility.renown ?? 0);
  if (record?.renownBonus) add("renown", "Events and feasts", record.renownBonus);

  add("comfort", "Base", 3);

  const accessibility = clamp(sum("accessibility"));
  const accessRow = rules.access.find(r => accessibility <= r.max) ?? rules.access.at(-1);

  /* ---------- people ---------- */
  const guards = Math.max(0, Number(record?.garrison?.guards) || 0);
  const servants = Math.max(0, Number(record?.garrison?.servants) || 0);
  const mercenaries = Math.max(0, Number(record?.garrison?.mercenaries) || 0);
  const dmgDefenders = Math.max(0, Number(ctx.dmgDefenders) || 0);
  const hirelings = Math.max(0, Number(ctx.dmgHirelings) || 0) + Math.max(0, Number(record?.garrison?.hirelings) || 0);
  const guests = Math.max(0, Number(record?.people?.guests) || 0);
  const refugees = Math.max(0, Number(record?.people?.refugees) || 0);
  const ownersPresent = Math.max(0, Number(ctx.ownersPresent) || 0);
  const workers = workersNeeded - workersAway;
  const population = ownersPresent + hirelings + dmgDefenders + guards + mercenaries + servants + guests + refugees + workers;

  const housing = sum("housing");
  if (housing > 0 && population > housing) {
    const over = Math.ceil(((population - housing) / housing) * 100 / rules.crowdingPenaltyPer);
    add("comfort", "Crowding", -over);
  }
  if (record?.unpaidUpkeep) add("comfort", "Unpaid upkeep", -2);
  if (record?.hungry) add("comfort", "Hunger", -3);

  /* ---------- garrison ---------- */
  let defenderMult = fx.defenderMult ?? 1;
  if (ctx.armoryStocked) defenderMult *= rules.armoryMult;
  const pcs = (ctx.pcsPresent ?? []).reduce((n, lvl) => n + lvl * rules.pcPerLevel, 0);
  const garrison = dmgDefenders * defenderMult + guards + mercenaries + (fx.garrison ?? 0) + pcs;

  /* ---------- walls ---------- */
  const rank = { none: 0, palisade: 1, rock: 2, tower: 3, stone: 4, reinforced: 5 };
  let wallType = "none";
  let enclosed = false;
  let partial = false;
  const consider = (type, isEnclosed) => {
    if (!type) return;
    if (isEnclosed) {
      if (!enclosed || (rules.walls[type]?.integrity ?? 0) > (rules.walls[wallType]?.integrity ?? 0)) wallType = type;
      enclosed = true;
    } else partial = true;
  };
  if (structure?.wall && !record?.structureWallLost) consider(structure.wall.type, structure.wall.enclosed);
  for (const [, f, exp] of features(record, catalog)) {
    // The wall's tier decides what it is: palisade, stone, reinforced.
    const w = featureEffects(exp, f).wall;
    if (w) consider(w, f.enclosed !== false);
  }
  void rank;
  const wallMult = enclosed ? rules.walls[wallType].mult : (partial ? rules.partialWallMult : 1);
  const integrity = enclosed ? rules.walls[wallType].integrity + (fx.integrity ?? 0) : 0;

  /* ---------- defense ---------- */
  const towerCount = Object.values(record?.features ?? {}).filter(f => f?.id === "watchtower" && !f.damaged)
    .reduce((n, f) => n + (Number(f.count) || 1), 0);
  const towerPct = Math.min(towerCount, rules.towerPctMax) * 5;
  const bonusMult = (fx.defenseMult ?? 1) * (1 + towerPct / 100);
  const siteMult = site.siteMult ?? 1;
  const walled = Math.floor(garrison * wallMult * bonusMult * siteMult + 1e-9);
  const breached = Math.floor(garrison * rules.breachedMult * siteMult + 1e-9);

  /* ---------- food and water ---------- */
  const farmMult = (LANDS[loc.land]?.farm ?? 1) * (climate.farm ?? 1) * (fx.farmMult ?? 1);
  const resourceFood = (loc.resources ?? []).reduce((n, r) => n + (RESOURCES[r]?.effects?.food ?? 0), 0);
  const foodInside = fx.foodPerDay ?? 0;
  const trade = { ...routeTotals(record), capacity: routeCapacity(fx, rules), waiting: routesOf(record, ["requested", "accepted"]).length,
    accepted: routesOf(record, ["accepted"]).length };
  const foodOutside = Math.round((fx.foodOutside ?? 0) * farmMult) + resourceFood + trade.food;
  const foodCap = Math.round(((fx.foodStock ?? 0) + 500) * (1 + (fx.foodStockPct ?? 0) / 100));
  const foodStock = Math.max(0, Math.min(Number(record?.food ?? 0), foodCap));
  const perDay = population * rules.foodPerPerson;
  const peaceNet = foodInside + foodOutside - perDay;
  const peaceDays = peaceNet >= 0 ? Infinity : Math.floor(foodStock / -peaceNet);
  const siegeFoodMult = fx.siegeFood ?? 1;
  const siegeNeed = Math.max(0, perDay - foodInside);
  const siegeFoodDays = siegeNeed <= 0 ? Infinity : Math.floor((foodStock * siegeFoodMult) / siegeNeed + 1e-9);
  const waterUnlimited = !!flags.waterUnlimited;
  const cistern = fx.cistern ?? 0;
  const waterDays = waterUnlimited ? Infinity
    : (population > 0 ? Math.floor(cistern / population) + rules.waterDaysWithoutSource : Infinity);

  /* ---------- economy ---------- */
  const accessFactor = rules.incomeAccessBase + rules.incomeAccessPer * accessibility;
  let incomeFlat = (fx.income ?? 0) - accessIncome + Math.round(accessIncome * accessFactor);
  incomeFlat += (fx.tollPerAccess ?? 0) * accessibility;
  incomeFlat += trade.income;
  const gems = (loc.resources ?? []).includes("gems");
  const dice = incomeDice.map(d => {
    let mult = d.share ?? 1;
    if (d.id === "inn") mult *= fx.innMult ?? 1;
    if (d.id === "mine" && gems) mult *= 2;
    const { share, ...rest } = d;
    void share;
    return { ...rest, mult, average: Math.round(averageFormula(d.formula) * mult) };
  });
  const incomeAverage = incomeFlat + dice.reduce((n, d) => n + d.average, 0);
  const tax = political.tax ? Math.round(incomeAverage * political.tax) : 0;
  const upkeep = (structure?.upkeep ?? 0) + (fx.upkeep ?? 0) + guards * rules.guardUpkeep + servants * rules.servantUpkeep
    + Math.max(0, Math.floor(Number(record?.garrison?.crews) || 0)) * (rules.crewUpkeep ?? 0);
  const net = incomeAverage - tax - upkeep;
  const prosperity = clamp(Math.floor(Math.max(0, incomeAverage) / rules.prosperityPer));

  /* ---------- merchants ---------- */
  const renown = clamp(sum("renown"));
  let merchantChance = accessibility * rules.merchantPerAccess + (fx.merchant ?? 0) + renown * rules.merchantPerRenown + (danger.merchant ?? 0);
  merchantChance = Math.max(0, Math.min(rules.merchantCap, merchantChance));
  const tierScore = accessibility + prosperity;
  let tierIndex = 0;
  MERCHANT_TIERS.forEach((t, i) => { if (tierScore >= t.min) tierIndex = i; });
  tierIndex += fx.merchantTier ?? 0;
  const exotic = !!flags.exotic || !!ctx.teleportCircle;
  const maxTier = exotic ? MERCHANT_TIERS.length - 1 : MERCHANT_TIERS.length - 2;
  tierIndex = Math.max(0, Math.min(maxTier, tierIndex));

  /* ---------- travel ---------- */
  const distance = Number(loc.settlement?.distance) || 0;
  const travelDays = distance > 0 ? Math.ceil(distance / accessRow.milesPerDay) : 0;

  const stats = {
    accessibility,
    concealment: clamp(sum("concealment")),
    security: clamp(sum("security")),
    renown,
    comfort: clamp(sum("comfort")),
    prosperity,
    wards: Math.min(100, fx.wards ?? 0),
    housing,
    population,
    people: { ownersPresent, hirelings, dmgDefenders, guards, mercenaries, servants, guests, refugees, workers, workersAway, workersNeeded },
    garrison: Math.round(garrison * 100) / 100,
    wall: { type: wallType, enclosed, partial, mult: wallMult, integrity },
    defense: { walled, breached, bonusMult, siteMult, towers: towerCount },
    engineCut: Math.min(rules.engineCutMax, fx.engineCut ?? 0),
    lightCut: fx.lightCut ?? 0,
    lightHalve: !!flags.lightHalve,
    noSapping: !!flags.noSapping,
    siegeFood: siegeFoodMult,
    food: { stock: foodStock, cap: foodCap, inside: foodInside, outside: foodOutside, perDay, peaceNet, peaceDays, siegeDays: siegeFoodDays,
      buyPrice: Math.round((rules.foodBuyGp ?? 0.2) * (accessRow.material ?? 1) * 100) / 100 },
    water: { unlimited: waterUnlimited, cistern, days: waterDays },
    economy: { incomeFlat, dice, incomeAverage, tax, upkeep, net, accessFactor,
      dividend: net > 0 ? Math.floor(net * (record?.dividendPct ?? rules.dividendPct) / 100) : 0 },
    merchant: { chance: merchantChance, tierIndex, tier: MERCHANT_TIERS[tierIndex], score: tierScore, exotic,
      stockMult: fx.merchantStock ?? 1 },
    visitors: { chanceBonus: fx.visitors ?? 0, payMult: fx.visitorPay ?? 1 },
    travel: { distance, milesPerDay: accessRow.milesPerDay, days: travelDays, roadTier: tier },
    trade,
    materialFactor: accessRow.material,
    crews: 1 + Math.max(0, Math.floor(Number(record?.garrison?.crews) || 0)) + (fx.crews ?? 0),
    grounds: groundsOf(record, catalog, rules),
    flags,
    fx,
    breakdown: B
  };
  // GM overrides of single scores.
  for (const [k, v] of Object.entries(record?.overrides ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof stats[k] === "number") stats[k] = Number(v);
  }
  return stats;
}

/** Average of a simple dice formula like "2d6*5", "3d6*10+3d6*10" or "4d6*10". */
export function averageFormula(formula) {
  return String(formula ?? "").split("+").reduce((total, part) => {
    const m = part.trim().match(/^(\d+)d(\d+)(?:\*(\d+))?$/);
    if (!m) return total + (Number(part) || 0);
    const [, n, d, mult] = m;
    return total + Number(n) * (Number(d) + 1) / 2 * (Number(mult) || 1);
  }, 0);
}

/** Rolls a simple dice formula with an rng returning [0, 1). */
export function rollFormula(formula, rng = Math.random) {
  return String(formula ?? "").split("+").reduce((total, part) => {
    const m = part.trim().match(/^(\d+)d(\d+)(?:\*(\d+))?$/);
    if (!m) return total + (Number(part) || 0);
    const [, n, d, mult] = m;
    let s = 0;
    for (let i = 0; i < Number(n); i++) s += 1 + Math.floor(rng() * Number(d));
    return total + s * (Number(mult) || 1);
  }, 0);
}
