/**
 * Every number the engine uses, in one table. The GM can override any of these in the Rules settings menu
 * (stored as a partial object and deep-merged over these defaults).
 */
export const DEFAULT_RULES = {
  turnDays: 7,
  /** Siege */
  walls: {
    none: { mult: 1, integrity: 0 },
    palisade: { mult: 2, integrity: 40 },
    rock: { mult: 3, integrity: 250 },
    tower: { mult: 4, integrity: 100 },
    stone: { mult: 4, integrity: 120 },
    reinforced: { mult: 5, integrity: 200 }
  },
  partialWallMult: 1.5,
  breachedMult: 1.5,
  towerPctMax: 4,
  engineCutMax: 40,
  sappingMinTroops: 50,
  sappingDamage: 2,
  monsterPerCR: 4,
  casterPerLevel: 2,
  pcPerLevel: 2,
  armoryMult: 1.25,
  waterDaysWithoutSource: 3,
  /** DMG attack dice (6d6, -2 when fully walled, -1 per War Room lieutenant) */
  attackDice: 6,
  attackWallReduction: 2,
  /** People and supplies */
  foodPerPerson: 1,
  /** Food bought when the stores run dry: gold per person-day (times the access's hauling factor) */
  foodBuyGp: 0.2,
  /** The Quarry's and Lumber Camp's income while no project under way uses stone / timber: they sell it instead */
  surplusSaleMult: 2,
  /** What each worker (industries, the Trading Post, the Hunters' Guild) is paid a turn, as upkeep */
  workerWage: 1,
  /** Share of the workers who moved away that come back each turn the Bastion is fed */
  workersReturn: 0.5,
  crowdingPenaltyPer: 10,
  guardUpkeep: 7,
  servantUpkeep: 1,
  /** Building crews: the Bastion starts with one; each hired crew costs crewHireCost once and crewUpkeep a turn */
  crewHireCost: 50,
  crewUpkeep: 10,
  maxHiredCrews: 4,
  /** Projects */
  /** More than one crew on a project: the most extra crews one project can take, and a surcharge (0: none) */
  extraCrewCostPct: 0,
  maxExtraCrews: 5,
  rushCostMult: 1.5,
  rushTimeMult: 0.67,
  repairMult: 0.5,
  /**
   * Build pace: a project's base days become round(scale × days^power) (at least 1) before terrain, rush and crews.
   * { scale: 1, power: 1 } is the DMG's own time. The "Build pace" setting picks a preset (see BUILD_PACES in
   * core/projects.js) unless the house rules set `pace` themselves.
   */
  pace: { scale: 1, power: 1 },
  /**
   * Prices: a base price becomes scale × price^power (see BUILD_PRICES in core/projects.js); { 1, 1 } is the DMG's.
   * The "Prices" setting picks a preset (prices and crew wages) unless the house rules set `price` themselves.
   */
  price: { scale: 1, power: 1 },
  /** Grounds (see data/grounds.js): share of the walled area buildings can use, and extending the grounds */
  groundsUsablePct: 60,
  groundsLandCost: 2,
  groundsLandDays: 5,
  groundsTerrainMult: { urban: 4, underground: 5, mountains: 2, swamp: 1.5 },
  cancelRefundPct: 50,
  costMult: 1,
  /** Economy */
  dividendPct: 25,
  incomeAccessBase: 0.5,
  incomeAccessPer: 0.1,
  prosperityPer: 25,
  /** Accessibility table */
  access: [
    { max: 1, milesPerDay: 12, material: 1.3 },
    { max: 3, milesPerDay: 18, material: 1.15 },
    { max: 6, milesPerDay: 24, material: 1.0 },
    { max: 8, milesPerDay: 30, material: 0.95 },
    { max: 10, milesPerDay: 30, material: 0.9 }
  ],
  merchantPerAccess: 5,
  merchantPerRenown: 2,
  merchantCap: 90,
  /** Dispatches */
  routeFactor: 1.25,
  roadRouteFactor: 1.0,
  envoyMounted: 40,
  envoyRelay: 60,
  /** Trade routes (only with a Trading Post): routes on top of the trading buildings' own, gold and food per route (scaled by the settlement and goods),
   *  setup cost in turns of the route's value, request chance (%, per turn), open requests at once, turns to sign,
   *  how far away a settlement can be, and the chance (%) a caravan is raided each turn by the land's danger */
  tradeBaseRoutes: 0,
  /** Routes one settlement holds at once, by its size */
  tradeRoutesPerSettlement: { hamlet: 3, village: 6, town: 9, city: 12, metropolis: 15 },
  tradeIncome: 25,
  tradeFood: 30,
  /** What the Bastion pays for a food route's deliveries: this share of the price of food bought when the stores run dry */
  tradeFoodPrice: 0.6,
  tradeSetupTurns: 6,
  tradeRequestBase: 10,
  tradeRequestMax: 40,
  tradeMaxOpen: 2,
  tradeRequestTurns: 3,
  tradeMaxMiles: 150,
  tradeRaid: { safe: 0, frontier: 5, wild: 10, hostile: 20 },
  /** Neglect (DMG): turns without orders equal to the owners' level */
  neglect: true
};

/** Deep-merges overrides (partial) over the defaults. Arrays are replaced, not merged. */
export function mergeRules(overrides = {}) {
  const out = structuredClone(DEFAULT_RULES);
  const merge = (target, src) => {
    for (const [k, v] of Object.entries(src ?? {})) {
      if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
        merge(target[k], v);
      } else target[k] = v;
    }
  };
  merge(out, overrides);
  return out;
}
