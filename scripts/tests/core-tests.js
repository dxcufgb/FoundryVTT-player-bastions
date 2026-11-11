import { mergeRules } from "../data/rules.js";
import { FORCES, EVENTS } from "../data/tables.js";
import { EXPANSIONS, GROUPS, MAX_LEVELS, levels } from "../data/catalog.js";
import { STRUCTURES, FIRST_BUILDINGS } from "../data/structures.js";
import { TERRAINS, SITES, bastionImage } from "../data/location.js";
import { payFromPurse } from "../core/coins.js";
import { buildCatalog, prerequisites, possibleHere, featureEffects, roadTier, projectMaterial } from "../core/catalog.js";
import { computeStats, averageFormula, rollFormula } from "../core/stats.js";
import { fullBuild, RIVER_KEEP } from "../core/fullbuild.js";
import { holdout, attackStrength, engineDamage, siegeDay } from "../core/siege.js";
import { quote, planProject, fund, transition, cancelRefund, advanceProjects, applyCompletion, BUILD_PACES, paceDays, repaceProjects, rescaleProgress, foldLegacyWalls, LEGACY_WALL_TIER } from "../core/projects.js";
import { quoteDispatch, methodAvailable, mergeOrders, arrivedBy } from "../core/dispatch.js";
import { rollMerchant, rollVisitor, eventForRoll, eventKeyFromText, requestForAid } from "../core/visitors.js";
import { advanceTurn, workDays, finishProject, finishAllProjects, feedBastion } from "../core/turn.js";
import { cancelHiddenApproach } from "../core/projects.js";
import { countRest, restsLeft, restsToTurn, REST_BATCH_MS } from "../core/rests.js";
import { BUILD_PRICES, priceGp } from "../core/price.js";
import { projectTeams, crewsInUse, crewStatus, canAssign, canDismiss, assignCrews, queueOrder, nextQueuePos, moveInQueue } from "../core/crews.js";
import { createRecord } from "../core/record.js";
import { footprintOf, groundsOf, extendGroundsBase, spaceUsed } from "../core/grounds.js";
import { GROUNDS, FOOTPRINTS } from "../data/grounds.js";
import { syncLayout, wallFixtures, buildingWalls, mergeSegments, boundsOf, ROAD } from "../core/layout.js";
import { mapPlan } from "../core/mapplan.js";
import { SECTIONS, SYSTEM_SECTION, sectionOfExpansion, sectionOfFacility, specialSlots, canTakeFacility, mergeSameKind } from "../core/sections.js";
import { settlementList, cleanSettlement, quoteRoute, makeRequest, rollTradeRequest, transitionRoute, advanceTrade, canAcceptRoute, routeTotals, tradeCandidates, requestChance, settlementRoom, routeCapacity, routeCharge, rememberSize } from "../core/trade.js";
import { CODEX_JOURNALS, INHABITANTS, codexId, codexUuid, codexJournalOf, journalId, pageId, folderId } from "../core/codex.js";

/**
 * Tests of the pure engine. Written against a small interface so the same tests run in Quench (Foundry) and in the
 * Node runner (tests/run-node.mjs): t = { describe(name, fn), it(name, fn), assert } where assert has
 * equal, strictEqual, deepEqual, ok, isFalse, isTrue, closeTo, include.
 */

let counter = 0;
const newId = () => `id${(++counter).toString().padStart(6, "0")}`;
/** A seeded rng (mulberry32) so tests are repeatable. */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The keep the engine tests were written against: a Bastion is founded with one building now, so the rest of that keep
 * comes in as its first build.
 */
const OLD_KEEP_FIRST = { id: "bedroom", size: "vast" };
const OLD_KEEP_REST = [{ id: "kitchen", size: "roomy" }, { id: "storage", size: "roomy" }, { id: "dining-room", size: "roomy" }, { id: "well" }];

/** The plan's worked example: a hilltop keep with 2 watchtowers, 12 DMG defenders (Armory stocked), 20 guards. */
export function workedExampleRecord() {
  return createRecord({
    name: "Test Keep",
    location: { terrain: "hills", site: "hilltop", settlement: { name: "Town", size: "village", distance: 20 }, road: "trail",
      waterway: "none", waterOnSite: "table", climate: "temperate", land: "fertile", resources: [], danger: "frontier",
      visibility: "ordinary", political: "freehold" },
    structure: { type: "keep", acquisition: "reward" }, first: OLD_KEEP_FIRST,
    // Bastions start without walls; the worked example's keep has built its wall up to stone, and a gatehouse.
    included: [...OLD_KEEP_REST, { id: "wall", tier: 2, count: 40 }, { id: "gatehouse" }, { id: "watchtower", count: 2 }],
    food: 3000, treasury: 0, guards: 20, servants: 4
  }, { newId, now: 0 });
}
export const WORKED_CTX = { dmgDefenders: 12, dmgHirelings: 10, armoryStocked: true };

export function registerCoreTests({ describe, it, assert }) {
  const rules = mergeRules();
  const catalog = buildCatalog();
  const stats = (rec, ctx = WORKED_CTX) => computeStats(rec, { rules, catalog, ctx });

  describe("Data", () => {
    it("ships 97 expansions (4 of them old wall entries kept for old saves) in seven groups, all with names, groups and costs", () => {
      assert.equal(EXPANSIONS.length, 97);
      assert.equal(EXPANSIONS.filter(e => e.legacy).length, 4);
      for (const e of EXPANSIONS) {
        assert.ok(e.name, `${e.id} has a name`);
        assert.ok(GROUPS[e.group], `${e.id} has a known group`);
        assert.ok(e.cost !== undefined && e.days !== undefined, `${e.id} has cost and days`);
      }
      assert.equal(new Set(EXPANSIONS.map(e => e.id)).size, EXPANSIONS.length, "ids are unique");
    });
    it("every structure feature and every requirement points at a real expansion", () => {
      for (const b of Object.values(FIRST_BUILDINGS)) assert.ok(catalog.get(b.feature.id), `${b.label}: ${b.feature.id}`);
      for (const s of Object.values(STRUCTURES)) assert.ok(FIRST_BUILDINGS[s.first], `${s.label} suggests a first building`);
      for (const e of EXPANSIONS) for (const id of [...(e.requires?.features ?? []), ...(e.requires?.anyFeature ?? [])]) {
        assert.ok(catalog.get(id), `${e.id} requires ${id}`);
      }
    });
    it("has the ten terrains, four sites and the DMG event ranges 1-100", () => {
      assert.equal(Object.keys(TERRAINS).length, 10);
      assert.equal(Object.keys(SITES).length, 4);
      let next = 1;
      for (const e of EVENTS) { assert.equal(e.min, next); next = e.max + 1; }
      assert.equal(next, 101);
    });
    it("revenue buildings have at least two tiers", () => {
      for (const id of ["market-square", "inn", "craftsmens-row", "fields", "mine", "trading-company", "harbor", "quarry", "lumber-camp"]) {
        assert.ok(catalog.get(id).tiers?.length >= 2, id);
      }
    });
    it("GM overrides change, disable and add expansions", () => {
      const c = buildCatalog({ chapel: { cost: 1 }, rookery: { disabled: true }, "my-tower": { name: "My Tower", cost: 5, days: 2 } });
      assert.equal(c.get("chapel").cost, 1);
      assert.isFalse(c.has("rookery"));
      assert.equal(c.get("my-tower").name, "My Tower");
    });
  });

  describe("Stats: the plan's worked example", () => {
    const rec = workedExampleRecord();
    const s = stats(rec);
    it("garrison 35 (12 defenders x1.25 + 20 guards)", () => assert.equal(s.garrison, 35));
    it("walled defense 212", () => assert.equal(s.defense.walled, 212));
    it("breached defense 63", () => assert.equal(s.defense.breached, 63));
    it("Integrity 160 (stone 120 + gatehouse 30 + 2 towers)", () => assert.equal(s.wall.integrity, 160));
    it("population 46 and 65 days of food in a siege", () => {
      assert.equal(s.population, 46);
      assert.equal(s.food.siegeDays, 65);
    });
    it("unlimited water from the Well", () => assert.isTrue(s.water.unlimited));
    it("every score is between 0 and 10 and has a breakdown", () => {
      for (const k of ["accessibility", "concealment", "security", "renown", "comfort", "prosperity"]) {
        assert.ok(s[k] >= 0 && s[k] <= 10, k);
      }
      assert.ok(s.breakdown.accessibility.length > 0);
    });
    it("GM overrides replace a score", () => {
      const r2 = structuredClone(rec);
      r2.overrides = { security: 9 };
      assert.equal(stats(r2).security, 9);
    });
  });

  describe("Siege holdout (worked example table)", () => {
    const rec = workedExampleRecord();
    const s = stats(rec);
    const expect = { bandits: 65, raiders: 65, warband: 17, giants: 8, dragon: 5, company: 1, army: 1 };
    for (const [key, days] of Object.entries(expect)) {
      it(`${FORCES[key].label}: ${days} days`, () => assert.equal(holdout(s, FORCES[key], rules).days, days));
    }
    it("attack strengths match the table", () => {
      assert.equal(Math.round(attackStrength(FORCES.bandits, rules)), 13);
      assert.equal(attackStrength(FORCES.raiders, rules), 45);
      assert.equal(attackStrength(FORCES.giants, rules), 160);
      assert.equal(attackStrength(FORCES.dragon, rules), 68);
      assert.equal(attackStrength(FORCES.company, rules), 450);
      assert.equal(attackStrength(FORCES.army, rules), 2056);
    });
    it("reasons: food, overrun, stormed", () => {
      assert.equal(holdout(s, FORCES.raiders, rules).reason, "food");
      assert.equal(holdout(s, FORCES.warband, rules).reason, "overrun");
      assert.equal(holdout(s, FORCES.company, rules).reason, "stormed");
    });
    it("a Wet Moat makes the warband take 33 days", () => {
      const r2 = structuredClone(rec);
      r2.features.moat = { id: "wet-moat", tier: 1 };
      const s2 = stats(r2);
      assert.equal(s2.defense.walled, 255);
      assert.equal(holdout(s2, FORCES.warband, rules).days, 33);
    });
    it("Lesser Wards make the dragon take 6 days", () => {
      const r2 = structuredClone(rec);
      r2.features.wards = { id: "lesser-wards", tier: 1 };
      assert.equal(holdout(stats(r2), FORCES.dragon, rules).days, 6);
    });
    it("no sapping below 50 troops; sapping 2 a day from 50", () => {
      assert.equal(engineDamage(FORCES.bandits, s, rules), 0);
      assert.equal(engineDamage({ troops: 50, quality: "rabble", engine: "none" }, s, rules), 2);
    });
    it("a live siege day eats food and wears the walls", () => {
      const day1 = siegeDay({ day: 0 }, s, FORCES.warband, rules);
      assert.equal(day1.day, 1);
      assert.equal(day1.integrity, 150);
      assert.equal(day1.food, 3000 - 46);
    });
  });

  describe("Projects: cost, time, state", () => {
    const base = createRecord({ name: "P", location: {}, structure: { type: "farmstead" }, food: 0, treasury: 0 }, { newId });
    const s = stats(base, {});
    it("default location has Accessibility 4 (material x1.0)", () => assert.equal(s.accessibility, 4));
    it("Stone Wall, 40 squares: 10,000 GP and 400 days; 2 crews: same cost and 200 days", () => {
      const exp = catalog.get("stone-wall");
      const q1 = quote(base, exp, { count: 40 }, s, rules);
      assert.equal(q1.cost, 10000);
      assert.equal(q1.days, 400);
      const q2 = quote(base, exp, { count: 40, extraCrews: 1 }, s, rules);
      assert.equal(q2.cost, 10000);
      assert.equal(q2.days, 200);
      assert.equal(quote(base, exp, { count: 40, extraCrews: 1 }, s, { ...rules, extraCrewCostPct: 15 }).cost, 11500, "a house-rule surcharge");
    });
    it("adventure pace: rooms 2 / 4 / 8 days, a great hall 8, a 40-square stone wall 19 (10 with a second crew)", () => {
      const fast = { ...rules, pace: BUILD_PACES.adventure };
      const bed = catalog.get("bedroom");
      assert.deepEqual(["cramped", "roomy", "vast"].map(size => quote(base, bed, { size }, s, fast).days), [2, 4, 8]);
      assert.equal(quote(base, catalog.get("great-hall"), {}, s, fast).days, 8);
      const wall = catalog.get("stone-wall");
      assert.equal(quote(base, wall, { count: 40 }, s, fast).days, 19);
      assert.equal(quote(base, wall, { count: 40, extraCrews: 1 }, s, fast).days, 10);
      assert.equal(quote(base, wall, { count: 40 }, s, fast).cost, 10000, "the price doesn't change");
    });
    it("pace keeps short jobs at a day or more and leaves the DMG pace alone", () => {
      assert.equal(paceDays(1, BUILD_PACES.adventure), 1);
      assert.equal(paceDays(7, BUILD_PACES.adventure), 1);
      assert.equal(paceDays(0, BUILD_PACES.adventure), 0);
      assert.equal(paceDays(125, BUILD_PACES.dmg), 125);
      assert.ok(paceDays(125, BUILD_PACES.campaign) < 125 && paceDays(125, BUILD_PACES.campaign) > paceDays(125, BUILD_PACES.adventure));
    });
    it("unfinished projects are re-timed for a new pace and keep their share of work done", () => {
      const old = { g: { id: "g", state: "building", days: 343, progress: 172 }, d: { id: "d", state: "planned", days: 80, progress: 0 },
        c: { id: "c", state: "complete", days: 60, progress: 60 } };
      const { projects, changed } = repaceProjects(old, BUILD_PACES.adventure);
      assert.isTrue(changed);
      assert.equal(projects.g.days, paceDays(343, BUILD_PACES.adventure));
      // 171 of 343 days were still to do: that share of the new days, rounded down, is left.
      assert.equal(projects.g.days - projects.g.progress, Math.floor(171 / 343 * projects.g.days));
      assert.equal(projects.d.days, paceDays(80, BUILD_PACES.adventure));
      assert.equal(projects.c.days, 60, "finished projects stay as they were");
      assert.isFalse(repaceProjects(projects, BUILD_PACES.adventure).changed, "already at this pace");
      const back = repaceProjects(projects, BUILD_PACES.dmg).projects;
      assert.ok(Math.abs(back.d.days - 80) <= 8, `back to about 80 days (rounding) (${back.d.days})`);
    });
    it("more or fewer crews: the share of work left stays the same, the days left round down", () => {
      assert.equal(rescaleProgress(2, 8, 3), 1, "2/8 done, three crews on a 3-day job: 2 of 3 left");
      assert.equal(rescaleProgress(0, 8, 3), 0, "not started stays not started");
      assert.equal(rescaleProgress(8, 8, 3), 3, "done stays done");
      assert.equal(rescaleProgress(7, 8, 3), 2, "1/8 left of 3 days rounds down to 0, but one day stays left");
      assert.equal(rescaleProgress(1, 3, 8), 3, "a crew leaves: 2/3 left of 8 days = 5.33, so 5 left");
      assert.equal(rescaleProgress(3, 9, 3), 1, "2/3 of 3 days: exactly 2 left");
    });
    it("sized rooms use the DMG ladder", () => {
      const exp = catalog.get("bedroom");
      assert.equal(quote(base, exp, { size: "vast" }, s, rules).cost, 3000);
      assert.equal(quote(base, exp, { size: "roomy" }, s, rules).days, 45);
    });
    it("rush costs x1.5 and takes x0.67 the days", () => {
      const q = quote(base, catalog.get("chapel"), { rush: true }, s, rules);
      assert.equal(q.cost, 1500);
      assert.equal(q.days, Math.ceil(30 * 0.67));
    });
    it("prerequisites block what can't be built yet", () => {
      assert.isFalse(prerequisites(base, catalog.get("drawbridge"), catalog, s).ok);
      assert.isFalse(prerequisites(base, catalog.get("trading-company"), catalog, s).ok);
      assert.isFalse(prerequisites(base, catalog.get("inn"), catalog, s).ok, "a new farmstead is just a house: no kitchen yet");
      const withKitchen = { ...base, features: { ...base.features, k: { id: "kitchen", size: "cramped", tier: 1 } } };
      assert.isTrue(prerequisites(withKitchen, catalog.get("inn"), catalog, stats(withKitchen, {})).ok, "a kitchen and Accessibility 4");
      assert.isTrue(prerequisites(base, catalog.get("chapel"), catalog, s).ok);
    });
    it("planning, funding, starting and finishing a Roomy Granary adds 6,000 food stock", () => {
      const rec = structuredClone(base);
      const plan = planProject(rec, catalog, s, rules, { expansionId: "granary", size: "roomy" }, { id: "g1", userId: "u1" });
      assert.isTrue(plan.ok);
      let p = plan.project;
      assert.isFalse(transition(p, "start").ok, "can't start unfunded");
      const f1 = fund(p, 600, "a1");
      const f2 = fund(f1.project, 999999, "a2");
      assert.equal(f2.accepted, p.cost - 600, "funding never goes over the cost");
      p = transition(f2.project, "start").project;
      assert.equal(p.state, "building");
      rec.projects = { g1: p };
      const adv = advanceProjects(rec.projects, 45);
      assert.equal(adv.completed.length, 1);
      const before = stats(rec, {}).food.cap;
      const applied = applyCompletion(rec.features, adv.completed[0], "newfeat");
      rec.features = applied.features;
      assert.equal(stats(rec, {}).food.cap - before, 6000);
    });
    it("cancel refunds unspent gold pro rata", () => {
      const p = { cost: 1000, funded: 1000, days: 10, progress: 0, contributions: { a: 600, b: 400 } };
      const r = cancelRefund(p, rules);
      assert.equal(r.total, 1000);
      assert.equal(r.byPayer.a, 600);
      assert.equal(r.byPayer.b, 400);
    });
    it("upgrading a tiered building adds the next tier's effects", () => {
      const rec = structuredClone(base);
      rec.location.settlement.distance = 3;
      rec.features.m = { id: "market-square", tier: 1 };
      const s1 = stats(rec, {});
      rec.features.m.tier = 3;
      const s3 = stats(rec, {});
      assert.ok(s3.economy.incomeAverage > s1.economy.incomeAverage);
      assert.equal(featureEffects(catalog.get("market-square"), { tier: 3 }).income, 85);
    });
    it("roads count only when they reach the settlement", () => {
      const rec = structuredClone(base);
      rec.location.road = "none";
      rec.features.r = { id: "clear-trail", count: 10 };
      assert.equal(roadTier(rec, catalog), "none");
      rec.features.r.count = 20;
      assert.equal(roadTier(rec, catalog), "trail");
    });
  });

  describe("Grounds and room inside the walls", () => {
    // A keep that has built its wall up to stone, and a gatehouse (Bastions start without walls).
    const keepAt = (extra = {}) => createRecord({ name: "G", location: { terrain: "hills", site: "hilltop" },
      structure: { type: "keep", acquisition: "reward" }, first: OLD_KEEP_FIRST, ...extra,
      included: [...OLD_KEEP_REST, { id: "wall", tier: 2, count: 1 }, { id: "gatehouse" }, ...(extra.included ?? [])] }, { newId, now: 0 });

    it("every expansion has a footprint; rooms use the DMG sizes", () => {
      for (const e of EXPANSIONS) assert.ok(FOOTPRINTS[e.id] !== undefined, `${e.id} has a footprint`);
      const bedroom = catalog.get("bedroom");
      assert.deepEqual(["cramped", "roomy", "vast"].map(size => footprintOf(bedroom, { size })), [4, 16, 36]);
      assert.equal(footprintOf(catalog.get("fields"), {}), 0, "fields lie outside the walls");
      assert.equal(footprintOf(catalog.get("watchtower"), { count: 3 }), 12, "each tower takes its own room");
      assert.deepEqual([1, 2, 3].map(tier => footprintOf(catalog.get("market-square"), { tier })), [36, 49, 64]);
    });

    it("five sizes, each with a buildable share of its area", () => {
      assert.deepEqual(GROUNDS.map(g => g.key), ["plot", "compound", "holding", "fortress", "citadel"]);
      const g = groundsOf(keepAt(), catalog, rules);
      assert.equal(g.key, "plot");
      assert.equal(g.area, 256);
      assert.equal(g.usable, 153, "60 % of 16 x 16");
      assert.equal(g.perimeter, 64);
    });

    it("a new Bastion gets the smallest grounds that hold it, or the size the GM chose", () => {
      const keep = keepAt();
      assert.equal(keep.grounds, "plot");
      assert.equal(groundsOf(keep, catalog, rules).used, 94, "vast bedroom 36 + three roomy rooms 48 + gatehouse 9 + well 1");
      const wall = Object.values(keep.features).find(f => f.id === "wall");
      assert.equal(wall.count, 64, "the wall goes all the way round");
      const bare = createRecord({ name: "B", location: {}, structure: { type: "keep" } }, { newId, now: 0 });
      assert.isFalse(Object.values(bare.features).some(f => !!catalog.get(f.id)?.effects?.wall || f.id === "gatehouse"), "no walls by default");
      const castle = createRecord({ name: "C", location: {}, structure: { type: "castle" } }, { newId, now: 0 });
      assert.equal(castle.grounds, "compound");
      const big = keepAt({ grounds: "holding" });
      assert.equal(big.grounds, "holding");
      assert.equal(Object.values(big.features).find(f => f.id === "wall").count, 128);
      const crowded = keepAt({ included: [{ id: "great-hall" }, { id: "training-yard" }] });
      assert.equal(crowded.grounds, "compound", "a first build too big for a plot needs a compound");
    });

    it("nothing more can be built or enlarged when the grounds are full", () => {
      const rec = keepAt();
      const s = stats(rec);
      assert.equal(s.grounds.free, 59);
      const hall = planProject(rec, catalog, s, rules, { expansionId: "great-hall" }, { id: "p1" });
      assert.isFalse(hall.ok, "a 64-square hall doesn't fit in 59");
      assert.ok(hall.full);
      assert.include(hall.reason, "Extend the grounds");
      const chapel = planProject(rec, catalog, s, rules, { expansionId: "chapel" }, { id: "p2" });
      assert.isTrue(chapel.ok, "a 16-square chapel fits");
      assert.equal(chapel.project.squares, 16);
      const fields = planProject(rec, catalog, s, rules, { expansionId: "fields" }, { id: "p3" });
      assert.isTrue(fields.ok, "fields outside the walls take no room");
    });

    it("planned projects hold their room, so two plans can't promise the same ground", () => {
      let rec = keepAt();
      const a = planProject(rec, catalog, stats(rec), rules, { expansionId: "pleasure-gardens" }, { id: "a" });
      assert.isTrue(a.ok);
      rec = { ...rec, projects: { a: a.project } };
      assert.equal(stats(rec).grounds.reserved, 36);
      const b = planProject(rec, catalog, stats(rec), rules, { expansionId: "garrison-hall" }, { id: "b" });
      assert.isFalse(b.ok, "36 held + 36 more is more than 59 free");
      rec.projects.a = { ...a.project, state: "cancelled" };
      assert.isTrue(planProject(rec, catalog, stats(rec), rules, { expansionId: "garrison-hall" }, { id: "b" }).ok);
    });

    it("enlarging a room and upgrading a building need the extra room", () => {
      const rec = keepAt({ included: [{ id: "storage", size: "cramped" }, { id: "market-square" }] });
      const s = stats(rec);
      assert.equal(rec.grounds, "plot");
      assert.equal(s.grounds.free, 153 - 94 - 4 - 36);
      const storage = Object.entries(rec.features).find(([, f]) => f.id === "storage" && f.size === "cramped")[0];
      assert.isTrue(planProject(rec, catalog, s, rules, { kind: "enlarge", featureId: storage }, { id: "e" }).ok, "+12 fits in 19 free");
      const market = Object.entries(rec.features).find(([, f]) => f.id === "market-square")[0];
      const up = planProject(rec, catalog, s, rules, { kind: "upgrade", featureId: market }, { id: "u" });
      assert.isTrue(up.ok, "Market Hall: +13 fits in 19");
      const both = { ...rec, projects: { u: up.project } };
      assert.isFalse(planProject(both, catalog, stats(both), rules, { kind: "enlarge", featureId: storage }, { id: "e" }).ok,
        "with 13 held, +12 no longer fits in 6");
    });

    it("extending the grounds clears new land and lengthens every built wall layer", () => {
      const rec = keepAt();
      const base = extendGroundsBase(rec, catalog, rules);
      assert.isTrue(base.ok);
      assert.equal(base.to.key, "compound");
      assert.deepEqual(base.walls, { wall: 32 }, "96 - 64 more squares of wall");
      assert.equal(base.cost, 320 * 2 + 32 * (50 + 250), "land 2 GP a square + palisade 50 and stone 250 GP a square");
      assert.equal(base.days, 16 + 32 * (2 + 10));
      const plan = planProject(rec, catalog, stats(rec), rules, { kind: "grounds" }, { id: "g" });
      assert.isTrue(plan.ok);
      assert.equal(plan.project.toGrounds, "compound");
      const again = planProject({ ...rec, projects: { g: plan.project } }, catalog, stats(rec), rules, { kind: "grounds" }, { id: "g2" });
      assert.isFalse(again.ok, "one extension at a time");
    });

    it("a finished extension grows the grounds and the walls, and frees room", () => {
      const rec = keepAt();
      const plan = planProject(rec, catalog, stats(rec), rules, { kind: "grounds" }, { id: "g" });
      const done = { ...plan.project, state: "complete", completedAt: 100 };
      const res = applyCompletion(rec.features, done, "x");
      assert.equal(res.grounds, "compound");
      assert.equal(Object.values(res.features).find(f => f.id === "wall").count, 96);
      const after = { ...rec, features: res.features, grounds: res.grounds };
      const g = stats(after).grounds;
      assert.equal(g.usable, 345);
      assert.equal(g.free, 345 - 94);
      assert.isTrue(planProject(after, catalog, stats(after), rules, { expansionId: "great-hall" }, { id: "h" }).ok);
    });

    it("a turn finishes the extension; older Bastions keep the size they had", () => {
      const rec = keepAt();
      const plan = planProject(rec, catalog, stats(rec), rules, { kind: "grounds" }, { id: "g" });
      let r = { ...rec, projects: { g: { ...plan.project, state: "building", progress: plan.project.days - 1 } } };
      const res = advanceTurn(r, { stats: stats(r), rules, now: 604800, rng: seeded(3), newId });
      assert.equal(res.record.grounds, "compound");
      const legacy = structuredClone(rec);
      delete legacy.grounds;
      assert.equal(stats(legacy).grounds.key, "plot", "worked out from what is built");
      const t2 = advanceTurn(legacy, { stats: stats(legacy), rules, now: 604800, rng: seeded(4), newId });
      assert.equal(t2.record.grounds, "plot", "and kept from the next turn on");
    });

    it("extending land is dearer in towns and underground", () => {
      const town = createRecord({ name: "T", location: { terrain: "urban" }, structure: { type: "townhouse" } }, { newId, now: 0 });
      const cave = createRecord({ name: "U", location: { terrain: "underground" }, structure: { type: "cave" } }, { newId, now: 0 });
      assert.equal(extendGroundsBase(town, catalog, rules).parts[0].value, 320 * 2 * 4);
      assert.equal(extendGroundsBase(cave, catalog, rules).parts[0].value, 320 * 2 * 5);
    });
  });

  describe("Walls: none to start; one wall, palisade → stone → reinforced → wall walk", () => {
    const keepWith = (included = []) => createRecord({ name: "W", location: { terrain: "plains", waterway: "river" },
      structure: { type: "keep", acquisition: "built" }, included }, { newId, now: 0, catalog, rules });
    const wallOf = rec => Object.entries(rec.features).find(([, f]) => f.id === "wall");
    it("a Bastion is founded with exactly one building: the GM's pick, else the structure's suggestion", () => {
      for (const [type, st] of Object.entries(STRUCTURES)) {
        const rec = createRecord({ name: "O", location: {}, structure: { type, acquisition: "built" } }, { newId, now: 0, catalog, rules });
        const fs = Object.values(rec.features);
        assert.equal(fs.length, 1, type);
        assert.equal(fs[0].id, FIRST_BUILDINGS[st.first].feature.id, type);
      }
      const pick = createRecord({ name: "P", location: {}, structure: { type: "keep", acquisition: "built" }, first: "chapel",
        included: [{ id: "kitchen", size: "cramped" }] }, { newId, now: 0, catalog, rules });
      assert.deepEqual(Object.values(pick.features).map(f => f.id).sort(), ["chapel", "kitchen"], "the pick, plus the First build step's");
      const ruin = createRecord({ name: "R", location: {}, structure: { type: "keep", acquisition: "captured" }, first: "hall" }, { newId, now: 0, catalog, rules });
      assert.isTrue(Object.values(ruin.features)[0].damaged, "a captured hall starts damaged");
    });
    it("no structure comes with a wall", () => {
      for (const [key, st] of Object.entries(STRUCTURES)) {
        assert.isFalse("features" in st, `${key}: no buildings of its own`);
        if (st.wall) assert.equal(st.wall.type, "rock", `${key}: only a cave's rock`);
      }
      for (const type of Object.keys(STRUCTURES).filter(k => k !== "cave")) {
        const rec = createRecord({ name: "N", location: {}, structure: { type, acquisition: "built" } }, { newId, now: 0, catalog, rules });
        const s = stats(rec);
        assert.equal(s.wall.type, "none", type);
        assert.isFalse(s.wall.enclosed, type);
        assert.equal(mapPlan(rec, catalog, rules, s).wall, null, `${type}: no wall on the map`);
      }
    });
    it("the wall is built as a palisade and upgraded in place, each step priced along its whole length", () => {
      let rec = keepWith();
      const plan = planProject(rec, catalog, stats(rec), rules, { expansionId: "wall", count: 64 }, { id: "b" });
      assert.isTrue(plan.ok, plan.reason);
      assert.equal(plan.project.label, "Wall");
      assert.equal(plan.project.cost, quote(rec, catalog.get("wall"), { count: 64 }, stats(rec), rules).cost);
      rec = keepWith([{ id: "wall" }]);
      const [fid, wall] = wallOf(rec);
      assert.equal(wall.count, 64);
      assert.equal(stats(rec).wall.type, "palisade");
      assert.equal(stats(rec).wall.mult, 2);
      assert.isFalse(planProject(rec, catalog, stats(rec), rules, { expansionId: "wall", count: 64 }, { id: "c" }).ok, "one wall");
      const exp = catalog.get("wall");
      const steps = [["Stone wall", 250, 10, "stone", 4], ["Reinforced stone wall", 125, 4, "reinforced", 5], ["Wall walk and crenellations", 25, 1, "reinforced", 5]];
      for (const [label, cost, days, type, mult] of steps) {
        const q = quote(rec, exp, { kind: "upgrade", featureId: fid }, stats(rec), rules);
        assert.equal(q.parts[0].value, cost * 64, `${label}: ${cost} GP a square, all 64`);
        assert.ok(q.days >= days * 64, `${label}: ${days} days a square (${q.days})`);
        const up = planProject(rec, catalog, stats(rec), rules, { kind: "upgrade", featureId: fid }, { id: "u" });
        assert.isTrue(up.ok, up.reason);
        assert.include(up.project.label, label);
        wall.tier += 1;
        assert.equal(stats(rec).wall.type, type);
        assert.equal(stats(rec).wall.mult, mult);
      }
      assert.closeTo(stats(rec).defense.bonusMult, 1.05, 1e-9, "the wall walk");
      assert.isFalse(planProject(rec, catalog, stats(rec), rules, { kind: "upgrade", featureId: fid }, { id: "v" }).ok, "the last step");
    });
    it("a palisade is timber (lumber camp), the stone steps are stone (quarry)", () => {
      const rec = keepWith([{ id: "wall" }]);
      const [fid] = wallOf(rec);
      const s = stats(rec);
      s.fx = { ...s.fx, stoneDiscount: 0.5, timberDiscount: 0.8 };
      const up = quote(rec, catalog.get("wall"), { kind: "upgrade", featureId: fid }, s, rules);
      assert.ok(up.factors.some(f => f.label === "Quarry or brickworks") && !up.factors.some(f => f.label === "Lumber camp"));
      const build = quote(keepWith(), catalog.get("wall"), { count: 64 }, s, rules);
      assert.ok(build.factors.some(f => f.label === "Lumber camp") && !build.factors.some(f => f.label === "Quarry or brickworks"));
    });
    it("old separate walls can't be planned, and old saves fold into one wall at the highest step", () => {
      const rec = keepWith();
      for (const id of ["palisade", "stone-wall", "reinforce-wall", "wall-walk"]) {
        assert.isFalse(planProject(rec, catalog, stats(rec), rules, { expansionId: id, count: 64 }, { id: "x" }).ok, id);
      }
      rec.features.a = { id: "palisade", count: 64, tier: 1 };
      rec.features.b = { id: "stone-wall", count: 64, tier: 1 };
      rec.features.c = { id: "reinforce-wall", count: 64, tier: 1 };
      rec.projects = { p: { id: "p", kind: "build", expansionId: "wall-walk", state: "planned", count: 64, days: 9, progress: 0 } };
      const fold = foldLegacyWalls(rec.features, rec.projects);
      assert.isTrue(fold.changed);
      const walls = Object.entries(fold.features).filter(([, f]) => LEGACY_WALL_TIER[f.id] || f.id === "wall");
      assert.equal(walls.length, 1, "one wall");
      assert.equal(walls[0][0], "b", "keeps the stone wall's id");
      assert.equal(walls[0][1].id, "wall");
      assert.equal(walls[0][1].tier, 3, "reinforced");
      assert.equal(fold.projects.p.kind, "upgrade");
      assert.equal(fold.projects.p.featureId, "b");
      assert.equal(fold.projects.p.tier, 4);
      assert.equal(stats({ ...rec, features: fold.features }).wall.type, "reinforced");
      assert.isFalse(foldLegacyWalls(fold.features, fold.projects).changed);
    });
    it("extending the grounds takes longer the more the wall has been upgraded, ditch and moat included", () => {
      const low = keepWith([{ id: "wall" }]);
      const a = extendGroundsBase(low, catalog, rules);
      const high = keepWith([{ id: "wall", tier: 4 }, { id: "wet-moat" }]);
      const b = extendGroundsBase(high, catalog, rules);
      const extra = a.walls.wall;
      assert.equal(b.walls.wall, extra);
      assert.equal(b.days - a.days, (10 + 4 + 1) * extra + Math.ceil(120 * extra / b.to.perimeter), "stone + reinforced + walk + moat");
      assert.ok(b.cost > a.cost);
      assert.ok(b.parts.some(p => /Wet Moat/.test(p.label)));
    });
    it("the spike barricade: once, after the wall, round the foot of it, lengthened (and adding time) when the grounds grow", () => {
      const bare = keepWith();
      const exp = catalog.get("spike-barricade");
      assert.isFalse(planProject(bare, catalog, stats(bare), rules, { expansionId: "spike-barricade", count: 64 }, { id: "s" }).ok, "needs the wall");
      const walled = keepWith([{ id: "wall" }]);
      const plan = planProject(walled, catalog, stats(walled), rules, { expansionId: "spike-barricade", count: 64 }, { id: "s" });
      assert.isTrue(plan.ok, plan.reason);
      const spiked = keepWith([{ id: "wall" }, { id: "spike-barricade" }]);
      assert.equal(Object.values(spiked.features).find(f => f.id === "spike-barricade").count, 64, "all the way round");
      assert.isFalse(planProject(spiked, catalog, stats(spiked), rules, { expansionId: "spike-barricade", count: 64 }, { id: "t" }).ok, "only once");
      assert.closeTo(stats(spiked).defense.bonusMult, 1.05, 1e-9);
      const a = extendGroundsBase(walled, catalog, rules);
      const b = extendGroundsBase(spiked, catalog, rules);
      assert.equal(b.walls["spike-barricade"], a.walls.wall);
      assert.equal(b.days - a.days, exp.days * a.walls.wall, "a day a square more");
      const done = applyCompletion(spiked.features, { kind: "grounds", walls: b.walls, toGrounds: b.to.key }, "x");
      assert.equal(Object.values(done.features).find(f => f.id === "spike-barricade").count, 64 + a.walls.wall);
      const ditch = keepWith([{ id: "wall" }, { id: "spike-barricade" }, { id: "dry-ditch" }]);
      const pl = mapPlan(ditch, catalog, rules, stats(ditch));
      assert.equal(pl.spikes.d, 2, "just outside the wall");
      assert.ok(pl.spikes.d < pl.moatD, "inside the ditch");
    });
    it("the map: no wall ring without a wall; palisade or stone on the grounds' edge, moat outside it", () => {
      const none = mapPlan(keepWith(), catalog, rules, stats(keepWith()));
      assert.equal(none.wall, null);
      assert.isFalse(none.walls.some(w => w.outer));
      const pal = keepWith([{ id: "wall" }, { id: "dry-ditch" }]);
      const p1 = mapPlan(pal, catalog, rules, stats(pal));
      const h = p1.side / 2;
      assert.equal(p1.wall.type, "palisade");
      assert.ok(p1.walls.some(w => w.outer && w.y0 === h + 1 && w.door === 1), "a gate where the road goes through");
      assert.isTrue(p1.bridge);
      const top = keepWith([{ id: "wall", tier: 4 }, { id: "gatehouse" }]);
      const p2 = mapPlan(top, catalog, rules, stats(top));
      assert.equal(p2.wall.type, "stone");
      assert.isTrue(p2.wall.reinforced);
      assert.isTrue(p2.wall.walk);
    });
  });

  describe("Battle map ground", () => {
    const at = (terrain, type, mapGround) => {
      const rec = createRecord({ name: "M", location: { terrain }, structure: { type, acquisition: "built" }, mapGround }, { newId, now: 0, catalog, rules });
      return mapPlan(rec, catalog, rules, stats(rec));
    };
    it("follows the terrain (and a cave) unless the GM picks one", () => {
      assert.equal(at("arctic", "keep").ground, "snow");
      assert.equal(at("plains", "cave").bailey, "cave");
    });
    it("the GM's pick wins whatever the terrain or structure, inside and out, and the dressing follows it", () => {
      const p = at("arctic", "keep", "sand");
      assert.equal(p.ground, "sand");
      assert.equal(p.bailey, "sand");
      assert.isTrue(at("arctic", "keep").trees.some(t => t.p === "pine"), "pines on snow");
      assert.isFalse(p.trees.some(t => t.p === "pine"), "no snowy pines on sand");
      const c = at("plains", "cave", "grass");
      assert.equal(c.ground, "grass");
      assert.equal(c.bailey, "grass");
      assert.equal(at("desert", "keep", "nonsense").ground, "sand", "an unknown pick falls back to the terrain");
      assert.equal(at("forest", "keep", "rock").ground, "rock", "bright rock");
    });
  });

  describe("Map layout", () => {
    const keepAt = (extra = {}) => createRecord({ name: "L", location: { terrain: "hills" },
      structure: { type: "keep", acquisition: "reward" }, first: OLD_KEEP_FIRST, ...extra,
      included: [...OLD_KEEP_REST, { id: "wall", tier: 2, count: 1 }, { id: "gatehouse" }, ...(extra.included ?? [])] }, { newId, now: 0, catalog, rules });
    const overlap = (a, b) => a.x < b.x + b.s && b.x < a.x + a.s && a.y < b.y + b.s && b.y < a.y + a.s;
    const fidOf = (rec, id) => Object.entries(rec.features).find(([, f]) => f.id === id)[0];

    it("a new Bastion has every building inside the walls, none overlapping, the keep's rooms in one block", () => {
      const rec = keepAt();
      const lay = syncLayout(rec, catalog, rules);
      assert.isFalse(lay.changed, "createRecord stores the layout");
      assert.deepEqual(lay.unplaced, []);
      const { min, max } = boundsOf(16);
      for (const a of lay.items) {
        assert.ok(a.x >= min && a.y >= min && a.x + a.s - 1 <= max && a.y + a.s - 1 <= max, `${a.id} inside`);
        for (const b of lay.items) if (a !== b) assert.isFalse(overlap(a, b), `${a.id} / ${b.id}`);
      }
      const rooms = lay.items.filter(i => i.kind === "room");
      assert.equal(rooms.length, 4);
      // Every room touches another room: one connected keep.
      const touches = (a, b) => a.x <= b.x + b.s && b.x <= a.x + a.s && a.y <= b.y + b.s && b.y <= a.y + a.s && !overlap(a, b);
      for (const r of rooms) assert.ok(rooms.some(o => o !== r && touches(r, o)), `${r.id} joins the keep`);
      assert.equal(lay.items.find(i => i.id === "bedroom").s, 6, "a vast room is 6 x 6");
      const gate = lay.fixtures.find(f => f.id === "gatehouse");
      assert.equal(gate.where, "south");
      for (const a of lay.items) assert.isFalse(a.x <= ROAD.x1 && a.x + a.s - 1 >= ROAD.x0 && a.y + a.s - 1 >= ROAD.y0, `${a.id} keeps the gate road clear`);
    });

    it("the same record always gives the same layout", () => {
      const a = keepAt({ included: [{ id: "chapel" }, { id: "kitchen-garden" }] });
      const b = structuredClone(a);
      b.layout = {};
      assert.deepEqual(syncLayout(b, catalog, rules).layout, a.layout);
    });

    it("extending the grounds and building more never moves what is already standing", () => {
      const rec = keepAt({ included: [{ id: "chapel" }, { id: "smokehouse" }] });
      const before = structuredClone(rec.layout);
      rec.grounds = "compound";
      rec.features.n1 = { id: "inn", builtAt: 10 };
      rec.features.n2 = { id: "orchard", builtAt: 11 };
      rec.features.n3 = { id: "bedroom", size: "roomy", builtAt: 12 };
      const lay = syncLayout(rec, catalog, rules);
      assert.isTrue(lay.changed);
      for (const [fid, p] of Object.entries(before)) assert.deepEqual(lay.layout[fid], p, `${rec.features[fid].id} stays put`);
      for (const id of ["n1", "n2", "n3"]) assert.ok(lay.layout[id], `${rec.features[id].id} placed`);
      const orchard = lay.layout.n2;
      assert.ok(Math.abs(orchard.x + 3) > 6 && Math.abs(orchard.y + 3) > 6, "open ground goes out toward the corners");
    });

    it("an enlarged room grows round its old squares when it can, and moves only when it can't", () => {
      const rec = keepAt({ grounds: "compound", included: [{ id: "storage", size: "cramped" }] });
      const fid = Object.entries(rec.features).find(([, f]) => f.id === "storage" && f.size === "cramped")[0];
      const old = rec.layout[fid];
      rec.features[fid].size = "roomy";
      const lay = syncLayout(rec, catalog, rules);
      const now = lay.layout[fid];
      assert.equal(now.s, 4);
      const covers = now.x <= old.x && now.y <= old.y && now.x + now.s >= old.x + old.s && now.y + now.s >= old.y + old.s;
      const item = lay.items.find(i => i.fid === fid);
      assert.ok(covers || item.moved, "grown in place, or marked as moved");
      for (const [k, p] of Object.entries(rec.layout)) if (k !== fid) assert.deepEqual(lay.layout[k], p);
    });

    it("what doesn't fit waits, and is placed once the grounds are extended", () => {
      const rec = keepAt();
      rec.features.big = { id: "great-hall", builtAt: 5 };
      const tight = syncLayout(rec, catalog, rules);
      assert.deepEqual(tight.unplaced.map(u => u.id), ["great-hall"]);
      assert.equal(tight.layout.big, undefined);
      rec.grounds = "compound";
      const roomy = syncLayout(rec, catalog, rules);
      assert.deepEqual(roomy.unplaced, []);
      assert.equal(roomy.layout.big.s, 8);
    });

    it("wall fixtures sit on the wall and follow it out when the grounds grow", () => {
      const rec = keepAt({ included: [{ id: "watchtower", count: 2 }, { id: "ballista", count: 1 }] });
      const small = wallFixtures(rec, catalog, 16);
      assert.deepEqual(small.filter(f => f.id === "watchtower").map(f => f.where), ["centre", "ne"], "the first tower in the middle");
      const mid = small.find(f => f.where === "centre");
      assert.deepEqual([mid.x, mid.y, mid.w, mid.h], [-2, -2, 4, 4], "4 × 4, exactly centred");
      assert.deepEqual(wallFixtures(rec, catalog, 24).find(f => f.where === "centre").x, -2, "it doesn't move when the grounds grow");
      const big = wallFixtures(rec, catalog, 24);
      const gate16 = small.find(f => f.id === "gatehouse");
      const gate24 = big.find(f => f.id === "gatehouse");
      assert.equal(gate24.y - gate16.y, 4, "the gate moves out with the south wall");
      const lay = syncLayout(rec, catalog, rules);
      for (const f of lay.fixtures) for (const b of lay.items) {
        assert.isFalse(f.x < b.x + b.s && b.x < f.x + f.w && f.y < b.y + b.s && b.y < f.y + f.h, `${b.id} clear of ${f.id}`);
      }
    });

    it("an older layout with rooms where the centre tower now stands: those rooms move, the tower takes the middle", () => {
      const rec = keepAt();
      rec.layout = syncLayout(rec, catalog, rules).layout;
      const centreTaken = Object.values(rec.layout).some(p => p.x <= 1 && p.x + p.s - 1 >= -2 && p.y <= 1 && p.y + p.s - 1 >= -2);
      rec.features.t = { id: "watchtower", count: 1, builtAt: 999 };
      const lay = syncLayout(rec, catalog, rules);
      const tower = lay.fixtures.find(f => f.where === "centre");
      assert.ok(tower, "the tower is in the middle");
      for (const b of lay.items) assert.isFalse(tower.x < b.x + b.s && b.x < tower.x + tower.w && tower.y < b.y + b.s && b.y < tower.y + tower.h, `${b.id} clear of the tower`);
      if (centreTaken) assert.ok(lay.items.some(i => i.moved), "something had to move");
      assert.equal(spaceUsed(rec, catalog) - spaceUsed({ ...rec, features: { ...rec.features, t: undefined } }, catalog), 16, "16 squares for the centre tower");
    });
    it("without a wall nothing leans on it: no clutter along the edge, extra towers stand free near the middle", () => {
      const rec = createRecord({ name: "F", location: {}, structure: { type: "tower", acquisition: "built" },
        included: [{ id: "watchtower", count: 2 }, { id: "kitchen", size: "roomy" }] }, { newId, now: 0, catalog, rules });
      const plan = mapPlan(rec, catalog, rules, stats(rec));
      assert.equal(plan.clutter.length, 0, "no barrels and crates against a wall that isn't there");
      const towers = plan.fixtures.filter(f => f.id === "watchtower");
      assert.equal(towers.length, 3, "the centre tower and two more");
      const h = plan.side / 2;
      for (const t of towers.filter(f => f.where !== "centre")) {
        assert.equal(t.where, "free");
        assert.ok(t.x >= -h && t.y >= -h && t.x + t.w <= h && t.y + t.h <= h, "inside the grounds, not on a wall line");
        for (const b of plan.items) assert.isFalse(t.x < b.x + b.s && b.x < t.x + t.w && t.y < b.y + b.s && b.y < t.y + t.h, `clear of ${b.id}`);
      }
      // With a wall they go back to the corners, and the clutter comes back.
      rec.features.w = { id: "wall", tier: 2, count: 64 };
      const walled = mapPlan(rec, catalog, rules, stats(rec));
      assert.deepEqual(walled.fixtures.filter(f => f.id === "watchtower").map(f => f.where), ["centre", "ne", "nw"]);
      assert.ok(walled.clutter.length > 0);
    });
    it("the road: the chosen type runs into the grounds until there is a wall; inside a wall it's paved", () => {
      const at = (road, included = []) => {
        const rec = createRecord({ name: "R", location: { terrain: "plains", road }, structure: { type: "farmstead", acquisition: "built" }, included },
          { newId, now: 0, catalog, rules });
        return mapPlan(rec, catalog, rules, stats(rec)).roads;
      };
      assert.deepEqual(at("none"), [], "no road");
      const trail = at("trail");
      assert.equal(trail.length, 1, "one road from the edge of the map into the grounds");
      assert.equal(trail[0].tex, "dirt");
      assert.ok(trail[0].w < 2, "a trail is narrow");
      assert.equal(at("road")[0].tex, "dirt");
      assert.equal(at("highway")[0].tex, "cobble");
      assert.isFalse(at("road").some(r => r.tex === "cobble"), "no stone road without a wall");
      const walled = at("road", [{ id: "wall" }]);
      assert.deepEqual(walled.map(r => r.tex), ["dirt", "cobble"], "outside the chosen road, inside the wall paved");
    });
    it("the centre tower on the map: Foundry walls round it with a door facing the road", () => {
      const rec = createRecord({ name: "T", location: {}, structure: { type: "tower", acquisition: "built" } }, { newId, now: 0, catalog, rules });
      const plan = mapPlan(rec, catalog, rules, stats(rec));
      const ring = plan.walls.filter(w => w.tower);
      assert.equal(ring.length, 8);
      assert.equal(ring.filter(w => w.door === 1).length, 1);
      const door = ring.find(w => w.door === 1);
      assert.ok(door.y0 > 0 && door.y1 > 0, "on the south side");
      assert.ok(plan.fixtures.some(f => f.id === "watchtower" && f.where === "centre"));
    });

    it("finishing a project places the new building on the map that turn", () => {
      const rec = keepAt();
      const plan = planProject(rec, catalog, stats(rec), rules, { expansionId: "chapel" }, { id: "c" });
      const r = { ...rec, projects: { c: { ...plan.project, state: "building", progress: plan.project.days - 1 } } };
      const res = advanceTurn(r, { stats: stats(r), rules, catalog, now: 604800, rng: seeded(5), newId });
      const fid = res.report.completed[0].featureId;
      assert.ok(res.record.layout[fid], "the chapel has its squares");
      assert.isTrue(res.report.layoutChanged);
    });

    it("the map plan: walled grounds with a gate door, furnished buildings, breaches during a siege", () => {
      const rec = keepAt({ included: [{ id: "chapel" }, { id: "postern" }] });
      const plan = mapPlan(rec, catalog, rules, stats(rec));
      assert.equal(plan.total, 16 + 2 + 10);
      assert.equal(plan.wall.type, "stone");
      const outer = plan.walls.filter(w => w.outer);
      assert.equal(outer.filter(w => w.door === 1).length, 1, "one gate");
      assert.equal(outer.filter(w => w.door === 2).length, 1, "the postern is a secret door");
      const len = outer.reduce((n, w) => n + Math.abs(w.x1 - w.x0) + Math.abs(w.y1 - w.y0), 0);
      assert.equal(len, 18 * 4, "the outer wall closes all the way round");
      for (const it of plan.items) {
        for (const p of it.props) {
          assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.n <= it.s && p.y + p.n <= it.s, `${p.p} inside ${it.id}`);
        }
        const cells = new Set();
        if (it.kind !== "yard") for (const p of it.props) for (let j = p.y; j < p.y + p.n; j++) for (let i = p.x; i < p.x + p.n; i++) {
          assert.isFalse(cells.has(`${i},${j}`), `${it.id}: props don't overlap`);
          cells.add(`${i},${j}`);
        }
      }
      assert.ok(plan.items.find(i => i.id === "chapel").props.some(p => p.p === "altar"));
      assert.deepEqual(mapPlan(rec, catalog, rules, stats(rec)).items, plan.items, "same record, same map");
      const besieged = { ...rec, siege: { integrity: 0 } };
      const broken = mapPlan(besieged, catalog, rules, stats(besieged));
      assert.equal(broken.breaches.length, 3);
      const len2 = broken.walls.filter(w => w.outer).reduce((n, w) => n + Math.abs(w.x1 - w.x0) + Math.abs(w.y1 - w.y0), 0);
      assert.equal(len2, len - 9, "three gaps of three squares");
    });

    it("buildings get walls with doors; rooms of the keep share walls with a door between", () => {
      const rec = keepAt({ included: [{ id: "chapel" }] });
      const lay = syncLayout(rec, catalog, rules);
      const segs = buildingWalls(lay.items);
      const chapel = lay.items.find(i => i.id === "chapel");
      const own = segs.filter(s => s.fid === chapel.fid);
      assert.equal(own.length, chapel.s * 4, "one edge per square of perimeter");
      assert.equal(own.filter(s => s.door).length, 1, "one door");
      const roomDoors = segs.filter(s => s.door && lay.items.find(i => i.fid === s.fid)?.kind === "room");
      assert.ok(roomDoors.length >= 4, "doors between rooms and out of the keep");
      const merged = mergeSegments(segs);
      assert.ok(merged.length < segs.length, "straight runs are merged");
      assert.equal(merged.filter(s => s.door).length, segs.filter(s => s.door).length, "doors stay single");
    });
  });

  describe("Economy and revenue", () => {
    it("income buildings can turn the Bastion into a revenue stream that pays a dividend", () => {
      const rec = createRecord({ name: "E", location: { settlement: { size: "town", distance: 3 }, road: "road" },
        structure: { type: "keep" } }, { newId });
      const poor = stats(rec, {});
      assert.ok(poor.economy.net < 0, "a bare keep costs upkeep");
      rec.features.a = { id: "market-square", tier: 3 };
      rec.features.b = { id: "craftsmens-row", tier: 3 };
      rec.features.c = { id: "trading-company", tier: 2 };
      const rich = stats(rec, {});
      assert.ok(rich.economy.net > 0, "income now beats upkeep");
      assert.ok(rich.economy.dividend > 0, "and the party gets a share");
    });
    it("a Bastion keeps the picture the GM chose, else shows its terrain", () => {
      const rec = createRecord({ name: "Pic", location: { terrain: "swamp", site: "cliff" }, image: "worlds/x/keep.webp" }, { newId, now: 0 });
      assert.equal(bastionImage(rec), "worlds/x/keep.webp");
      const plain = createRecord({ name: "Plain", location: { terrain: "swamp" } }, { newId, now: 0 });
      assert.equal(bastionImage(plain), "modules/dxcufgbs-player-bastions/assets/terrains/swamp.webp");
    });
    it("pays prices below 1 GP from a purse of gold, with change", () => {
      assert.deepEqual(payFromPurse({ gp: 2 }, 20), { cp: 0, sp: 8, ep: 0, gp: 1, pp: 0 });
      assert.deepEqual(payFromPurse({ sp: 1, gp: 1 }, 15), { cp: 5, sp: 9, ep: 0, gp: 0, pp: 0 });
      assert.deepEqual(payFromPurse({ cp: 3 }, 3), { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
      assert.deepEqual(payFromPurse({ pp: 1 }, 250), { cp: 0, sp: 5, ep: 0, gp: 7, pp: 0 });
      assert.equal(payFromPurse({ sp: 1 }, 20), null, "not enough money");
    });
    it("averages and rolls dice formulas", () => {
      assert.equal(averageFormula("2d6*5"), 35);
      assert.equal(averageFormula("3d6*10+3d6*10"), 210);
      const r = rollFormula("2d6*5", seeded(3));
      assert.ok(r >= 10 && r <= 60);
    });
  });

  describe("Dispatches", () => {
    const rec = workedExampleRecord();
    const s = stats(rec);
    it("an envoy on foot covers 120 miles off-road in 7 days", () => {
      const q = quoteDispatch("envoy", s, rules, rec, { distance: 120 });
      assert.isTrue(q.ok);
      assert.equal(q.days, 7);
      assert.equal(q.cost, 14);
    });
    it("Sending is instant; a bird needs a Rookery", () => {
      assert.isTrue(quoteDispatch("sending", s, rules, rec, { distance: 500 }).instant);
      assert.isFalse(methodAvailable("bird", s).ok);
    });
    it("Animal Messenger has a range by slot level", () => {
      assert.isFalse(quoteDispatch("animalMessenger", s, rules, rec, { distance: 100, slotLevel: 2 }).ok);
      assert.isTrue(quoteDispatch("animalMessenger", s, rules, rec, { distance: 100, slotLevel: 3 }).ok);
    });
    it("strict DMG rules allow only magic", () => {
      assert.isFalse(methodAvailable("envoy", s, { strict: true }).ok);
      assert.isTrue(methodAvailable("sending", s, { strict: true }).ok);
    });
    it("capacity limits the orders a method carries", () => {
      assert.isFalse(quoteDispatch("sending", s, rules, rec, { orders: 3 }).ok);
    });
    it("later dispatches win for the same facility", () => {
      const m = mergeOrders([
        { id: "a", from: "x", orders: [{ type: "facility", facility: "f1", order: "craft" }] },
        { id: "b", from: "y", orders: [{ type: "facility", facility: "f1", order: "harvest" }, { type: "maintain" }] }
      ]);
      assert.equal(m.facility.f1.order, "harvest");
      assert.isTrue(m.maintain);
    });
    it("only arrived dispatches are delivered", () => {
      const list = arrivedBy({ a: { id: "a", status: "transit", arrivesAt: 10 }, b: { id: "b", status: "transit", arrivesAt: 99 } }, 50);
      assert.equal(list.length, 1);
    });
  });

  describe("Merchants, visitors and events", () => {
    const rec = workedExampleRecord();
    const s = stats(rec);
    it("merchant chance follows Accessibility, buildings and Renown", () => {
      const expected = s.accessibility * 5 + s.renown * 2;
      assert.equal(s.merchant.chance, expected);
    });
    it("rolls merchants and visitors repeatably with a seed", () => {
      const a = rollMerchant({ ...s, merchant: { ...s.merchant, chance: 100 } }, seeded(7));
      assert.ok(a && a.budget > 0);
      const v1 = rollVisitor(s, rec, seeded(9));
      const v2 = rollVisitor(s, rec, seeded(9));
      assert.equal(v1.key, v2.key);
    });
    it("a visiting merchant pays market fees into the treasury: by its tier, more with a bigger market, none without one", () => {
      const r = workedExampleRecord();
      assert.equal(stats(r).merchant.visitGold, 0, "no market, no fees");
      r.features.m = { id: "market-square", tier: 1 };
      const tierKey = k => stats(r).merchant.tier.key === k;
      const fee = () => stats(r).merchant.visitGold;
      const square = fee();
      assert.equal(square, rules.merchantVisitGold[stats(r).merchant.tier.key] * rules.merchantMarketMult[0]);
      r.features.m.tier = 3;
      assert.ok(fee() > square, "a Market Town takes more than a Market Square");
      assert.ok(tierKey(stats(r).merchant.tier.key));
      // The turn a merchant arrives, the fees go into the treasury.
      const before = { ...r, treasury: 0, food: 5000 };
      const st = stats(before);
      const run = fees => advanceTurn(structuredClone(before), { stats: { ...st, merchant: { ...st.merchant, chance: 100, visitGold: fees } },
        rules, now: 604800, rng: seeded(3), newId });
      const paid = run(st.merchant.visitGold);
      assert.ok(paid.report.merchant, "a merchant came");
      assert.equal(paid.report.merchantGold, st.merchant.visitGold);
      assert.equal(paid.record.treasury - run(0).record.treasury, st.merchant.visitGold, "the fees are in the treasury");
    });
    it("maps d100 and table text to events", () => {
      assert.equal(eventForRoll(53).key, "attack");
      assert.equal(eventForRoll(100).key, "treasure");
      assert.equal(eventKeyFromText("Request for Aid"), "aid");
      assert.equal(eventKeyFromText("Criminal Hireling"), "criminal");
    });
    it("request for aid: 10+ succeeds", () => {
      const r = requestForAid(4, () => 0.99);
      assert.isTrue(r.success);
      assert.equal(r.deaths, 0);
    });
  });

  describe("The long-rest clock", () => {
    it("members resting within half an hour count once; the same member again counts", () => {
      let r = countRest(undefined, "hero", 0);
      assert.isTrue(r.counted);
      r = countRest(r.rests, "ally", 60000);
      assert.isFalse(r.counted);
      assert.equal(r.rests.count, 1);
      r = countRest(r.rests, "hero", 120000);
      assert.isTrue(r.counted, "the hero resting again is a new rest");
      assert.equal(r.rests.count, 2);
      r = countRest(r.rests, "ally", 120000 + REST_BATCH_MS + 1);
      assert.isTrue(r.counted, "long after the last rest");
      r = countRest(r.rests, "hero", 120000 + REST_BATCH_MS + 2, { force: true });
      assert.isTrue(r.counted, "the GM's button always counts");
      assert.equal(r.rests.sinceTurn, 4);
      assert.equal(restsToTurn(r.rests, 7), 3);
    });
    it("a counted rest is a day of work: a 2-day room is done after two", () => {
      const rec = workedExampleRecord();
      rec.projects = { p: { id: "p", kind: "build", expansionId: "bedroom", size: "cramped", state: "building", progress: 0, days: 2,
        cost: 0, funded: 0, label: "Bedroom" } };
      let done = workDays(rec, 1, { rules, catalog, newId });
      assert.equal(done.completed.length, 0);
      assert.equal(restsLeft(rec.projects.p), 1);
      done = workDays(rec, 1, { rules, catalog, newId });
      assert.equal(done.completed[0].projectId, "p");
      assert.ok(Object.values(rec.features).some(f => f.id === "bedroom" && f.size === "cramped"));
    });
    it("the GM's Finish now builds one project at once and leaves the others alone", () => {
      const rec = workedExampleRecord();
      rec.projects = {
        a: { id: "a", kind: "build", expansionId: "chapel", state: "planned", progress: 0, days: 9, cost: 1000, funded: 0, label: "Chapel" },
        b: { id: "b", kind: "build", expansionId: "rookery", state: "building", progress: 1, days: 4, cost: 500, funded: 500, label: "Rookery" }
      };
      const res = finishProject(rec, "a", { rules, catalog, newId });
      assert.isTrue(res.ok);
      assert.equal(rec.projects.a.state, "complete");
      assert.equal(rec.projects.a.progress, 9);
      assert.equal(res.completed[0].projectId, "a");
      assert.ok(Object.values(rec.features).some(f => f.id === "chapel"));
      assert.equal(rec.projects.b.progress, 1, "the rookery didn't move");
      assert.isFalse(finishProject(rec, "a", { rules, catalog, newId }).ok, "already finished");
    });
    it("Finish all builds every open project and leaves finished and cancelled ones alone", () => {
      const rec = workedExampleRecord();
      rec.projects = {
        a: { id: "a", kind: "build", expansionId: "chapel", state: "planned", progress: 0, days: 9, cost: 1000, funded: 0, label: "Chapel" },
        b: { id: "b", kind: "build", expansionId: "rookery", state: "paused", progress: 1, days: 4, cost: 500, funded: 500, label: "Rookery" },
        c: { id: "c", kind: "build", expansionId: "well", state: "cancelled", progress: 0, days: 2, cost: 0, funded: 0, label: "Well" }
      };
      const res = finishAllProjects(rec, { rules, catalog, newId });
      assert.deepEqual(res.completed.map(c => c.projectId), ["a", "b"]);
      assert.equal(rec.projects.a.state, "complete");
      assert.equal(rec.projects.b.state, "complete");
      assert.equal(rec.projects.c.state, "cancelled");
      assert.ok(["chapel", "rookery"].every(id => Object.values(rec.features).some(f => f.id === id)));
    });
    it("a turn on this clock leaves the building work to the rests", () => {
      const rec = workedExampleRecord();
      rec.projects = { p: { id: "p", kind: "build", expansionId: "chapel", state: "building", progress: 0, days: 3, cost: 0, funded: 0, label: "Chapel" } };
      const { record } = advanceTurn(rec, { stats: stats(rec), rules, now: 604800, rng: seeded(1), newId, skipProjects: true });
      assert.equal(record.projects.p.progress, 0);
    });
  });

  describe("Turns", () => {
    it("away with no orders: Maintain and a Bastion event", () => {
      const rec = workedExampleRecord();
      rec.presence = "away";
      const { report } = advanceTurn(rec, { stats: stats(rec), rules, now: 604800, rng: seeded(1), newId });
      assert.equal(report.mode, "maintain");
      assert.isTrue(report.rollEvent);
    });
    it("standing orders with a Steward's Office keep the Bastion off Maintain", () => {
      const rec = workedExampleRecord();
      rec.presence = "away";
      rec.features.s = { id: "stewards-office" };
      rec.standingOrders = [{ facility: "x", order: "craft" }];
      const { record, report } = advanceTurn(rec, { stats: stats(rec), rules, now: 604800, rng: seeded(1), newId });
      assert.equal(report.mode, "standing");
      assert.equal(record.neglect, 0);
    });
    it("a dispatch delivers gold and orders when it arrives", () => {
      const rec = workedExampleRecord();
      rec.presence = "away";
      rec.dispatches = { d1: { id: "d1", status: "transit", arrivesAt: 100, gold: 250, from: "a1",
        orders: [{ type: "facility", facility: "f1", order: "craft" }] } };
      const { record, report } = advanceTurn(rec, { stats: stats(rec), rules, now: 200, rng: seeded(2), newId });
      assert.equal(report.mode, "remote");
      assert.equal(record.dispatches.d1.status, "arrived");
      assert.ok(record.treasury >= 0);
      assert.equal(report.facilityOrders.length, 1);
    });
    it("projects finish during a turn and become features", () => {
      const rec = workedExampleRecord();
      rec.projects = { p: { id: "p", kind: "build", expansionId: "chapel", state: "building", progress: 25, days: 30, cost: 0,
        funded: 0, contributions: {}, label: "Chapel", count: 1 } };
      const { record, report } = advanceTurn(rec, { stats: stats(rec), rules, now: 604800, rng: seeded(4), newId });
      assert.equal(report.completed.length, 1);
      assert.ok(Object.values(record.features).some(f => f.id === "chapel"));
    });
    it("neglect counts turns without orders and warns before the hirelings leave", () => {
      let rec = workedExampleRecord();
      rec.presence = "away";
      let report;
      for (let i = 0; i < 5; i++) ({ record: rec, report } = advanceTurn(rec, { stats: stats(rec), rules, now: i * 604800,
        rng: seeded(i + 1), newId, partyLevel: 5 }));
      assert.isTrue(report.neglected);
    });
    it("neglect: the warning comes one turn before, and a turn with orders gives no warning", () => {
      let rec = workedExampleRecord();
      rec.presence = "away";
      const turn = (i, extra = {}) => advanceTurn(rec, { stats: stats(rec), rules, now: i * 604800, rng: seeded(i + 1), newId, partyLevel: 3, ...extra });
      let r = turn(1); rec = r.record;
      assert.equal(rec.neglect, 1);
      assert.ok(!r.report.lines.some(l => l.startsWith("Warning")), "no warning after the first quiet turn");
      r = turn(2); rec = r.record;
      assert.ok(r.report.lines.some(l => l.startsWith("Warning")), "warned one turn before");
      assert.isFalse(r.report.neglected);
      // Orders arrive: the count starts again and there is no warning.
      rec.maintainChosen = true;
      r = turn(3); rec = r.record;
      assert.equal(rec.neglect, 0);
      assert.ok(!r.report.lines.some(l => l.startsWith("Warning") || l.startsWith("Neglected")), "no warning on a turn with orders");
    });
    it("food goes up and down with production and people", () => {
      const rec = workedExampleRecord();
      const { report } = advanceTurn(rec, { stats: stats(rec), rules, now: 604800, rng: seeded(5), newId });
      assert.equal(report.foodDelta, -46 * 7);
    });
  });

  describe("Building crews", () => {
    const job = (id, extra = {}) => ({ id, kind: "build", expansionId: "bedroom", size: "cramped", state: "planned", progress: 0,
      days: 4, cost: 0, funded: 0, label: `Job ${id}`, createdAt: 0, ...extra });
    it("a new Bastion has one building crew; hired crews and a Workers' Lodge add more, and hired crews have upkeep", () => {
      const rec = workedExampleRecord();
      const s0 = stats(rec);
      assert.equal(s0.crews, 1);
      assert.deepEqual(crewStatus(rec, s0), { total: 1, used: 0, free: 1, hired: 0, lodge: 0, over: false });
      rec.garrison.crews = 2;
      rec.features.lodge = { id: "workers-lodge" };
      const s1 = stats(rec);
      assert.equal(s1.crews, 4);
      const c = crewStatus(rec, s1);
      assert.equal(c.hired, 2);
      assert.equal(c.lodge, 1);
      assert.equal(s1.economy.upkeep - s0.economy.upkeep, 2 * rules.crewUpkeep);
    });
    it("a project takes 1 + its extra crews, and only running projects hold crews", () => {
      assert.equal(projectTeams(job("a")), 1);
      assert.equal(projectTeams(job("a", { extraCrews: 2 })), 3);
      const projects = { a: job("a", { state: "building", extraCrews: 1 }), b: job("b", { state: "paused", extraCrews: 3 }), c: job("c", { state: "queued" }) };
      assert.equal(crewsInUse(projects), 2);
      assert.equal(crewsInUse(projects, "a"), 0);
    });
    it("with one crew, a second project can't start; it can with a second crew, and two crews on one project use both", () => {
      const rec = workedExampleRecord();
      rec.projects = { a: job("a", { state: "building" }), b: job("b") };
      let chk = canAssign(rec, stats(rec), "b", 1);
      assert.isFalse(chk.ok);
      assert.equal(chk.code, "busy");
      rec.garrison.crews = 1;
      assert.isTrue(canAssign(rec, stats(rec), "b", 1).ok);
      chk = canAssign(rec, stats(rec), "b", 2);
      assert.isFalse(chk.ok, "only one crew is free");
      assert.equal(chk.code, "short");
      assert.equal(canAssign(rec, stats(rec), "b", 3).code, "tooMany");
      // The running project itself can take both crews when nothing else holds one.
      assert.isTrue(canAssign(rec, stats(rec), "a", 2).ok);
    });
    it("two crews halve the time and cost nothing more (unless a house rule adds a surcharge)", () => {
      const rec = workedExampleRecord();
      const exp = catalog.get("chapel");
      const one = quote(rec, exp, {}, stats(rec), rules);
      const two = quote(rec, exp, { extraCrews: 1 }, stats(rec), rules);
      assert.equal(two.cost, one.cost);
      assert.equal(two.days, Math.ceil(one.days / 2 - 1e-9) || 1);
      assert.equal(two.crews, 2);
      // A Workers' Lodge adds a crew to the Bastion; it no longer speeds up every project on its own.
      rec.features.lodge = { id: "workers-lodge" };
      assert.equal(quote(rec, exp, {}, stats(rec), rules).days, one.days);
    });
    it("queued projects start by themselves, first queued first, when crews are free; unpaid ones wait without blocking", () => {
      const projects = { a: job("a", { state: "queued", queuedAt: 5 }), b: job("b", { state: "queued", queuedAt: 1, cost: 100, funded: 0 }),
        c: job("c", { state: "queued", queuedAt: 3 }) };
      assert.deepEqual(queueOrder(projects).map(p => p.id), ["b", "c", "a"]);
      let res = assignCrews(projects, 1);
      assert.deepEqual(res.started.map(p => p.id), ["c"], "b isn't paid for, so c goes first");
      assert.equal(res.projects.a.state, "queued");
      res = assignCrews(projects, 1, { payAsYouBuild: true });
      assert.deepEqual(res.started.map(p => p.id), ["b"], "pay as you build: b starts");
      res = assignCrews(projects, 5);
      assert.deepEqual(res.started.map(p => p.id).sort(), ["a", "c"]);
    });
    it("more crews at work than the Bastion has: the projects started last go back to the queue", () => {
      const projects = { a: job("a", { state: "building", startedAt: 1 }), b: job("b", { state: "building", startedAt: 2, extraCrews: 1 }) };
      const res = assignCrews(projects, 2);
      assert.deepEqual(res.requeued.map(p => p.id), ["b"]);
      assert.equal(res.projects.b.state, "queued");
      assert.equal(res.projects.a.state, "building");
      assert.equal(res.started.length, 0, "b doesn't start again at once");
    });
    it("a day of work: one crew finishes the first job, then picks up the queued one", () => {
      const rec = workedExampleRecord();
      rec.projects = { a: job("a", { state: "building", days: 2 }), b: job("b", { state: "queued", days: 2, queuedAt: 1 }) };
      let done = workDays(rec, 1, { rules, catalog, newId, crews: 1 });
      assert.equal(rec.projects.b.state, "queued", "b waits while a has the crew");
      done = workDays(rec, 1, { rules, catalog, newId, crews: 1 });
      assert.equal(done.completed[0].projectId, "a");
      assert.deepEqual(done.started.map(s => s.projectId), ["b"]);
      assert.equal(rec.projects.b.state, "building");
      assert.equal(rec.projects.b.progress, 0, "b's crew starts on the next day");
      done = workDays(rec, 2, { rules, catalog, newId, crews: 1 });
      assert.equal(done.completed[0].projectId, "b");
    });
    it("a week's turn: the crew moves on to the queued job mid-turn", () => {
      const rec = workedExampleRecord();
      rec.projects = { a: job("a", { state: "building", days: 3 }), b: job("b", { state: "queued", days: 3, queuedAt: 1 }) };
      const done = workDays(rec, 7, { rules, catalog, newId, crews: 1 });
      assert.deepEqual(done.completed.map(c => c.projectId), ["a", "b"]);
    });
    it("without a crew count (older callers) every running project works, as before", () => {
      const rec = workedExampleRecord();
      rec.projects = { a: job("a", { state: "building", days: 1 }), b: job("b", { state: "building", days: 1 }), c: job("c", { state: "queued", days: 1 }) };
      const done = workDays(rec, 1, { rules, catalog, newId });
      assert.equal(done.completed.length, 2);
      assert.equal(rec.projects.c.state, "queued");
    });
    it("the turn uses the Bastion's crews: two running projects and one crew means one goes back to the queue", () => {
      let rec = workedExampleRecord();
      rec.projects = { a: job("a", { state: "building", days: 30, startedAt: 1 }), b: job("b", { state: "building", days: 30, startedAt: 2 }) };
      const { record } = advanceTurn(rec, { stats: stats(rec), rules, now: 604800, rng: seeded(3), newId });
      assert.equal(record.projects.a.state, "building");
      assert.equal(record.projects.b.state, "queued");
      assert.equal(record.projects.b.progress, 0);
    });
    it("crews at work can't be dismissed", () => {
      const rec = workedExampleRecord();
      rec.garrison.crews = 1;
      rec.projects = { a: job("a", { state: "building", extraCrews: 1 }) };
      assert.isFalse(canDismiss(rec, stats(rec), 0).ok);
      rec.projects.a.state = "paused";
      assert.isTrue(canDismiss(rec, stats(rec), 0).ok);
    });
    it("the party's queue order: positions first, then first queued; new ones join the end", () => {
      const projects = { a: job("a", { state: "queued", queuePos: 2, queuedAt: 1 }), b: job("b", { state: "queued", queuePos: 1, queuedAt: 9 }),
        c: job("c", { state: "queued", queuedAt: 0 }), d: job("d") };
      assert.deepEqual(queueOrder(projects).map(p => p.id), ["b", "a", "c"], "c has no place yet (an older save): last");
      assert.equal(nextQueuePos(projects), 3);
      assert.equal(nextQueuePos({}), 1);
    });
    it("moving a project up, down, first or last in the queue renumbers it 1..n", () => {
      const projects = { a: job("a", { state: "queued", queuePos: 1 }), b: job("b", { state: "queued", queuePos: 2 }),
        c: job("c", { state: "queued", queuePos: 3 }) };
      let res = moveInQueue(projects, "c", "up");
      assert.deepEqual(queueOrder(res.projects).map(p => p.id), ["a", "c", "b"]);
      res = moveInQueue(res.projects, "b", "first");
      assert.deepEqual(queueOrder(res.projects).map(p => p.id), ["b", "a", "c"]);
      assert.deepEqual(["a", "b", "c"].map(id => res.projects[id].queuePos), [2, 1, 3]);
      res = moveInQueue(res.projects, "b", "up");
      assert.isFalse(res.moved, "already first");
      assert.isFalse(moveInQueue(projects, "nope", "up").ok);
      assert.equal(projects.c.queuePos, 3, "the input isn't changed");
    });
    it("the crew takes the party's next queued project the moment one is done", () => {
      const rec = workedExampleRecord();
      rec.projects = { a: job("a", { state: "building", days: 1 }), x: job("x", { state: "queued", queuePos: 2, days: 1 }),
        y: job("y", { state: "queued", queuePos: 1, days: 1 }) };
      let done = workDays(rec, 1, { rules, catalog, newId, crews: 1 });
      assert.deepEqual(done.completed.map(c => c.projectId), ["a"]);
      assert.deepEqual(done.started.map(c => c.projectId), ["y"], "y is first in the queue");
      assert.equal(rec.projects.y.queuePos, undefined, "a started project leaves the queue");
      done = workDays(rec, 1, { rules, catalog, newId, crews: 1 });
      assert.deepEqual(done.completed.map(c => c.projectId), ["y"]);
      assert.deepEqual(done.started.map(c => c.projectId), ["x"]);
    });
    it("a project sent back for want of crews goes to the head of the queue", () => {
      const projects = { a: job("a", { state: "building", startedAt: 1 }), b: job("b", { state: "building", startedAt: 2 }),
        q: job("q", { state: "queued", queuePos: 1 }) };
      const res = assignCrews(projects, 1);
      assert.deepEqual(queueOrder(res.projects).map(p => p.id), ["b", "q"]);
    });
    it("a queued project can leave the queue again", () => {
      const r = transition(job("a", { state: "queued", queuePos: 3, queuedAt: 5 }), "unqueue");
      assert.isTrue(r.ok);
      assert.equal(r.project.state, "planned");
      assert.equal(r.project.queuePos, undefined);
      assert.isFalse(transition(job("a"), "unqueue").ok);
    });
    it("queueing sets when it joined the queue; a paused project can be queued again", () => {
      let r = transition(job("a"), "queue", { now: 42 });
      assert.equal(r.project.queuedAt, 42);
      r = transition(job("a", { state: "paused" }), "queue", { now: 50 });
      assert.isTrue(r.ok);
      assert.equal(r.project.state, "queued");
    });
  });

  describe("Prices", () => {
    const fair = { ...rules, price: { scale: BUILD_PRICES.fair.scale, power: BUILD_PRICES.fair.power } };
    const thrifty = { ...rules, price: { scale: BUILD_PRICES.thrifty.scale, power: BUILD_PRICES.thrifty.power } };
    it("DMG prices are unchanged; Fair and Thrifty take more off the dearer work, rounded to 5 GP", () => {
      assert.equal(priceGp(500, rules.price), 500);
      assert.equal(priceGp(500, fair.price), 440);
      assert.equal(priceGp(3000, fair.price), 2410);
      assert.equal(priceGp(7500, fair.price), 5760);
      assert.equal(priceGp(500, thrifty.price), 405);
      assert.equal(priceGp(7500, thrifty.price), 4610);
      assert.equal(priceGp(50, fair.price), 49);
      assert.equal(priceGp(10, thrifty.price), 10, "small jobs keep their price");
      assert.equal(priceGp(0, fair.price), 0);
      for (const c of [1, 7, 60, 250, 999, 12000]) assert.ok(priceGp(c, thrifty.price) <= c, `never dearer: ${c}`);
    });
    it("a quote uses the price model: a Cramped bedroom, a stone wall per square, an enlargement", () => {
      const rec = workedExampleRecord();
      const s = stats(rec);
      assert.equal(quote(rec, catalog.get("bedroom"), {}, s, fair).cost, Math.round(440 * (s.materialFactor ?? 1)));
      const wall = catalog.get("wall");
      const one = quote(rec, wall, { count: 1 }, s, fair).cost;
      const ten = quote(rec, wall, { count: 10 }, s, fair).cost;
      assert.equal(ten, Math.round(10 * priceGp(wall.tiers[0].cost, fair.price) * (s.materialFactor ?? 1)), "priced per square, then times the length");
      assert.ok(one <= wall.tiers[0].cost);
      assert.deepEqual(quote(rec, wall, { count: 1 }, s, fair).price, fair.price, "the quote says which prices it used");
    });
    it("extending the grounds prices the wall per square with the same model", () => {
      const rec = workedExampleRecord();
      const dmgBase = extendGroundsBase(rec, catalog, rules);
      const fairBase = extendGroundsBase(rec, catalog, fair);
      if (dmgBase.ok) assert.ok(fairBase.cost <= dmgBase.cost);
    });
    it("each preset sets the crews' wages: Fair 40 / 8, Thrifty 25 / 5, DMG 50 / 10", () => {
      assert.deepEqual([BUILD_PRICES.fair.crewHireCost, BUILD_PRICES.fair.crewUpkeep], [40, 8]);
      assert.deepEqual([BUILD_PRICES.thrifty.crewHireCost, BUILD_PRICES.thrifty.crewUpkeep], [25, 5]);
      assert.deepEqual([BUILD_PRICES.dmg.crewHireCost, BUILD_PRICES.dmg.crewUpkeep], [rules.crewHireCost, rules.crewUpkeep]);
    });
  });

  describe("One of a kind", () => {
    const plan = (rec, opts, id = "x") => planProject(rec, catalog, stats(rec), rules, opts, { id });
    it("a Parlor and a Courtyard can only be built once (enlarge them instead), also not planned twice", () => {
      for (const id of ["parlor", "courtyard"]) {
        const rec = workedExampleRecord();
        for (const [fid, f] of Object.entries(rec.features)) if (f.id === id) delete rec.features[fid];
        const first = plan(rec, { expansionId: id, size: "cramped" });
        assert.isTrue(first.ok, `${id}: ${first.reason}`);
        rec.projects = { [first.project.id]: first.project };
        assert.isFalse(plan(rec, { expansionId: id, size: "cramped" }, "y").ok, `${id}: not planned twice`);
        rec.projects = {};
        rec.features.built = { id, size: "cramped" };
        assert.isFalse(plan(rec, { expansionId: id, size: "roomy" }, "z").ok, `${id}: not built twice`);
      }
    });
    it("one Beacon Tower", () => {
      const rec = workedExampleRecord();
      assert.isTrue(plan(rec, { expansionId: "beacon-tower" }).ok);
      rec.features.beacon = { id: "beacon-tower" };
      assert.isFalse(plan(rec, { expansionId: "beacon-tower" }, "y").ok);
    });
    it("the road is paved once: not once it is a highway, and not planned twice", () => {
      const rec = workedExampleRecord();
      rec.location.road = "road";
      for (const [fid, f] of Object.entries(rec.features)) if (["clear-trail", "build-road", "pave-road"].includes(f.id)) delete rec.features[fid];
      assert.equal(roadTier(rec, catalog), "road");
      const first = plan(rec, { expansionId: "pave-road", count: 3 });
      assert.isTrue(first.ok, first.reason);
      rec.projects = { [first.project.id]: first.project };
      assert.isFalse(plan(rec, { expansionId: "pave-road", count: 3 }, "y").ok, "not planned twice");
      rec.projects = {};
      rec.location.road = "highway";
      assert.isFalse(plan(rec, { expansionId: "pave-road", count: 3 }, "z").ok, "a highway is paved already");
      rec.location.road = "road";
      rec.features.paved = { id: "pave-road", count: Math.ceil(rec.location.settlement?.distance ?? 1) };
      assert.equal(roadTier(rec, catalog), "highway");
      assert.isFalse(plan(rec, { expansionId: "pave-road", count: 3 }, "w").ok, "paved: no more paving");
    });
  });

  describe("Facilities page sections", () => {
    it("every expansion has a section, and every group is one", () => {
      for (const g of Object.keys(GROUPS)) assert.include(SECTIONS, g);
      for (const e of EXPANSIONS) assert.include(SECTIONS, sectionOfExpansion(e), e.id);
      assert.equal(sectionOfExpansion({ group: "supplies", room: "storage" }), "supplies", "a granary is food and water");
    });
    it("the system's facilities go to their sections: basic ones with the rooms, special ones by kind", () => {
      assert.equal(sectionOfFacility({ type: "basic", subtype: "bedroom" }), "rooms");
      assert.equal(sectionOfFacility({ type: "special", subtype: "armory" }), "fortifications");
      assert.equal(sectionOfFacility({ type: "special", subtype: "library" }), "arcane");
      assert.equal(sectionOfFacility({ type: "special", subtype: "someHomebrew" }), "staff");
      for (const s of Object.values(SYSTEM_SECTION)) assert.include(SECTIONS, s);
    });
    it("special facility slots follow the character's level", () => {
      const adv = { 5: 2, 9: 4, 13: 5, 17: 6 };
      assert.equal(specialSlots(4, adv), 0);
      assert.equal(specialSlots(9, adv), 4);
      assert.equal(specialSlots(20, adv), 6);
    });
    it("a character takes a special facility only at its level, with a free slot, and not twice", () => {
      const adv = { 5: 2, 9: 4 };
      const smithy = { name: "Smithy", subtype: "smithy", level: 5 };
      const who = { level: 5, facilities: [{ type: "basic", subtype: "bedroom", name: "Bedroom" }] };
      assert.isTrue(canTakeFacility(who, smithy, adv).ok);
      assert.equal(canTakeFacility({ ...who, level: 4 }, smithy, adv).reason, "level");
      assert.equal(canTakeFacility({ ...who, facilities: [{ type: "special", subtype: "smithy", name: "Smithy" }] }, smithy, adv).reason, "have");
      const full = { level: 5, facilities: [{ type: "special", subtype: "pub", name: "Pub" }, { type: "special", subtype: "garden", name: "Garden" }] };
      assert.equal(canTakeFacility(full, smithy, adv).reason, "slots");
      full.facilities[1].free = true;
      assert.isTrue(canTakeFacility(full, smithy, adv).ok, "a free facility takes no slot");
      assert.isTrue(canTakeFacility({ ...full, facilities: [full.facilities[0], { type: "special", subtype: "pub2", name: "Inn" }] },
        { ...smithy, free: true }, adv).ok, "and a free one can be taken with no slot left");
    });
  });
  describe("Codex", () => {
    it("ids are stable, 16 characters and unique", () => {
      assert.equal(codexId("page:bedroom"), codexId("page:bedroom"));
      assert.equal(codexId("x").length, 16);
      const refs = [...EXPANSIONS.filter(e => !e.legacy).map(e => e.id), ...Object.keys(INHABITANTS)];
      const ids = new Set([...refs.map(pageId), ...CODEX_JOURNALS.map(j => journalId(j.key)), folderId("facilities"), folderId("inhabitants")]);
      assert.equal(ids.size, refs.length + CODEX_JOURNALS.length + 2);
      for (const id of ids) assert.ok(/^[A-Za-z0-9]{16}$/.test(id), id);
    });
    it("every building and inhabitant has a journal and a page uuid", () => {
      for (const g of Object.keys(GROUPS)) assert.ok(CODEX_JOURNALS.some(j => j.key === g && j.kind === "facility"), g);
      for (const e of EXPANSIONS.filter(x => !x.legacy)) {
        assert.equal(codexJournalOf("facility", e.id, e.group), e.group, e.id);
        assert.ok(codexUuid("mod", "facility", e.id, e.group).endsWith(`JournalEntryPage.${pageId(e.id)}`), e.id);
      }
      for (const [k, v] of Object.entries(INHABITANTS)) assert.ok(CODEX_JOURNALS.some(j => j.key === v.journal && j.kind === "inhabitant"), k);
      assert.equal(codexUuid("mod", "inhabitant", "guards"), `Compendium.mod.codex.JournalEntry.${journalId("defenders")}.JournalEntryPage.${pageId("guards")}`);
      assert.equal(codexUuid("mod", "facility", "bedroom", "nope"), null);
      assert.equal(codexUuid("mod", "inhabitant", "dragons"), null);
    });
  });
  describe("Industries, workers and food", () => {
    const exp = id => EXPANSIONS.find(e => e.id === id);
    it("the brewery, charter, mine and quarry have 10 levels, each dearer than the last, and every level needs workers", () => {
      for (const id of ["brewery", "merchant-charter", "mine", "quarry"]) {
        const tiers = exp(id).tiers;
        assert.equal(tiers.length, MAX_LEVELS, id);
        for (let i = 1; i < tiers.length; i++) {
          assert.ok(tiers[i].cost > tiers[i - 1].cost || i < 3, `${id} ${i}: dearer`);
          assert.ok(tiers[i].effects.workers >= 1, `${id} ${i}: workers`);
        }
      }
      const l = levels([{ label: "Shop", cost: 1000, days: 10, effects: { income: 5 } }], { income: 2 }, 4);
      assert.deepEqual(l.map(x => x.label), ["Shop", "Shop II", "Shop III", "Shop IV"]);
      assert.deepEqual(l.map(x => x.cost), [1000, 1600, 2550, 4075]);
    });
    it("the garrison hall houses up to 100 guards at its top tier", () => {
      const rec = workedExampleRecord();
      rec.features.gh = { id: "garrison-hall", tier: 4 };
      assert.equal(stats(rec).fx.guardsCap, 100);
    });
    it("workers count as people: they need beds and food; workers away cut the industries' income", () => {
      const rec = workedExampleRecord();
      const before = stats(rec);
      rec.location.resources = ["stone"];
      rec.features.q = { id: "quarry", tier: 3 };
      const s = stats(rec);
      assert.equal(s.people.workers, 6 + 6 + 5);
      assert.equal(s.population, before.population + 17);
      assert.equal(s.food.perDay, before.food.perDay + 17);
      assert.equal(s.economy.upkeep - before.economy.upkeep, 17 * rules.workerWage, "the workers' wages");
      const full = s.economy.incomeFlat;
      rec.people = { ...(rec.people ?? {}), workersAway: 8 };
      const short = stats(rec);
      assert.equal(short.people.workers, 9);
      // No stone project under way: the quarry sells its stone, earning double (rules.surplusSaleMult).
      assert.equal(full - short.economy.incomeFlat, 2 * 70 - 2 * Math.round(70 * 9 / 17), "the quarry earns its share of the workers still there");
      assert.equal(short.economy.upkeep - before.economy.upkeep, 9 * rules.workerWage, "only the workers there are paid");
    });
    it("the Quarry and Lumber Camp sell their stone and timber while no project under way uses it", () => {
      const rec = workedExampleRecord();
      rec.location.resources = ["stone", "timber"];
      rec.projects = {};
      const base = stats(rec).economy.incomeFlat;
      rec.features.q = { id: "quarry", tier: 1 };
      rec.features.l = { id: "lumber-camp", tier: 2 };
      let s = stats(rec);
      assert.deepEqual(s.surplus, { stone: true, timber: true });
      assert.equal(s.economy.incomeFlat - base, 2 * 15 + 2 * 20, "both earn double");
      // A stone gatehouse under way: the quarry's stone goes into it.
      rec.projects.g = { id: "g", kind: "build", expansionId: "gatehouse", state: "building", days: 9, progress: 1 };
      s = stats(rec);
      assert.deepEqual(s.surplus, { stone: false, timber: true });
      assert.equal(s.economy.incomeFlat - base, 15 + 2 * 20);
      // Only a project at work counts; a palisade raised to a stone wall is a stone job.
      rec.projects.g.state = "paused";
      rec.projects.w = { id: "w", kind: "upgrade", expansionId: "wall", tier: 2, state: "building", days: 9, progress: 0 };
      assert.equal(projectMaterial(rec.projects.w, catalog), "stone");
      assert.equal(projectMaterial({ kind: "build", expansionId: "wall" }, catalog), "timber", "a new wall starts as a palisade");
      assert.deepEqual(stats(rec).surplus, { stone: false, timber: true });
    });
    it("buildings with workers pay their way from level 3: income beats wages, the workers' food at the dearest price and upkeep", () => {
      const dearest = Math.max(...rules.access.map(r => r.material)) * rules.foodBuyGp;
      const perWorker = rules.workerWage + rules.foodPerPerson * rules.turnDays * dearest;
      const withWorkers = [...catalog.values()].filter(e => !e.legacy && (e.tiers ?? [{ effects: e.effects }]).some(t => t.effects?.workers));
      for (const id of ["brewery", "merchant-charter", "quarry", "mine", "hunters-guild", "trading-post"]) assert.include(withWorkers.map(e => e.id), id);
      for (const e of withWorkers) {
        const top = e.tiers?.length ?? 1;
        for (let tier = Math.min(3, top); tier <= top; tier++) {
          const fx = featureEffects(e, { id: e.id, tier, count: 1 });
          const dice = String(fx.incomeDice ?? "").split("+").filter(Boolean).reduce((n, f) => n + averageFormula(f), 0);
          const income = (fx.income ?? 0) + dice;
          const cost = (fx.workers ?? 0) * perWorker + (fx.upkeep ?? 0);
          assert.ok(income > cost, `${e.id} level ${tier}: ${income} GP in, ${cost.toFixed(1)} GP out`);
        }
      }
    });
    it("a shortfall is bought from the treasury; when the gold runs out, outsiders leave first, then servants, workers and guards", () => {
      const rec = workedExampleRecord();
      const s = stats(rec);
      // Bought: 46 people a day, no stores.
      let r = { ...rec, food: 0, treasury: 1000, people: {}, garrison: { ...rec.garrison } };
      let out = feedBastion(r, s, rules, { days: 7 });
      assert.equal(out.bought, -s.food.peaceNet * 7);
      assert.equal(out.cost, Math.ceil(out.bought * s.food.buyPrice));
      assert.isFalse(r.hungry);
      // No gold: hungry, and people leave in order.
      r = { ...rec, food: 0, treasury: 0, people: { refugees: 3, guests: 1 }, garrison: { ...rec.garrison } };
      out = feedBastion(r, s, rules, { days: 7 });
      assert.isTrue(r.hungry);
      assert.deepEqual(out.left.slice(0, 3).map(l => l.key), ["refugees", "guests", "servants"]);
      assert.equal(r.people.refugees, 0);
      assert.ok(r.garrison.guards < rec.garrison.guards, "then guards (no workers here)");
      // Fed again: workers who left come back, half a turn.
      r = { ...rec, food: 5000, treasury: 0, people: { workersAway: 10 }, garrison: { ...rec.garrison } };
      out = feedBastion(r, s, rules, { days: 7 });
      assert.equal(out.returned, 5);
      assert.equal(r.people.workersAway, 5);
    });
    it("a turn pays for the food it buys before any dividend", () => {
      const rec = workedExampleRecord();
      rec.food = 0;
      rec.treasury = 500;
      const { report, record } = advanceTurn(rec, { stats: stats(rec), rules, now: 604800, rng: seeded(5), newId });
      assert.ok(report.foodCost > 0);
      assert.equal(record.food, 0);
      assert.equal(report.dividend, 0, "no dividend while food is bought at a loss");
    });
    it("a road to the Bastion ends the Hidden Approach; a trail keeps it; it can't be planned once the road is built", () => {
      const rec = workedExampleRecord();
      rec.features.ha = { id: "hidden-approach", tier: 1 };
      const trail = applyCompletion(rec.features, { kind: "build", expansionId: "clear-trail", count: 5 }, "t1");
      assert.ok(trail.features.ha, "a trail keeps it");
      const road = applyCompletion(trail.features, { kind: "build", expansionId: "build-road", count: 5 }, "r1");
      assert.equal(road.features.ha, undefined, "a road ends it");
      assert.deepEqual(road.removed, ["ha"]);
      const r2 = { ...workedExampleRecord(), location: { ...workedExampleRecord().location, settlement: { name: "X", distance: 5 } } };
      r2.features = { r: { id: "build-road", count: 5, tier: 1 } };
      assert.isFalse(prerequisites(r2, catalog.get("hidden-approach"), catalog, stats(r2)).ok);
    });
    it("a finished road cancels a Hidden Approach still planned or under way, refunded like a cancel", () => {
      const rec = workedExampleRecord();
      rec.treasury = 0;
      rec.projects = {
        ha: { id: "ha", kind: "build", expansionId: "hidden-approach", label: "Hidden Approach", state: "building", cost: 1000, funded: 1000,
          days: 10, progress: 5, contributions: { treasury: 600, hero: 400 } },
        rd: { id: "rd", kind: "build", expansionId: "build-road", label: "Road", state: "building", cost: 100, funded: 100, days: 1, progress: 0, count: 5 }
      };
      const done = workDays(rec, 1, { rules, newId });
      assert.equal(rec.projects.rd.state, "complete");
      assert.equal(rec.projects.ha.state, "cancelled", "the Hidden Approach can't be finished beside a road");
      assert.equal(rec.projects.ha.cancelledBy, "road");
      const refund = cancelRefund(rec.projects.ha, rules);
      assert.equal(rec.treasury + (done.refunds?.hero ?? 0), refund.total, "the payers get the cancel refund");
      assert.ok(done.refunds.hero > 0, "a character's share is returned for the GM side to pay");
      assert.equal(done.cancelled.length, 1);
      assert.ok(done.lines.some(l => l.startsWith("Cancelled: Hidden Approach")));
      // Finishing the road at once does the same to a Hidden Approach that wasn't in view.
      const r2 = workedExampleRecord();
      r2.projects = { ha: { id: "ha", kind: "build", expansionId: "hidden-approach", label: "HA", state: "planned", cost: 1000, funded: 0, days: 10, progress: 0 },
        rd: { id: "rd", kind: "build", expansionId: "pave-road", label: "Paving", state: "planned", cost: 100, funded: 0, days: 3, progress: 0, count: 5 } };
      const fin = finishProject(r2, "rd", { rules, newId });
      assert.isTrue(fin.ok);
      assert.equal(r2.projects.ha.state, "cancelled");
      assert.deepEqual(cancelHiddenApproach(r2, rules).cancelled, [], "once only");
    });
    it("possibleHere: a prerequisite cycle can't be built; alternatives don't spoil each other; the caller's set isn't touched", () => {
      const rec = workedExampleRecord();
      const C = new Map(catalog);
      C.set("loop-a", { id: "loop-a", name: "A", requires: { features: ["loop-b"] } });
      C.set("loop-b", { id: "loop-b", name: "B", requires: { features: ["loop-a"] } });
      C.set("shared", { id: "shared", name: "Shared" });
      C.set("either", { id: "either", name: "Either", requires: { anyFeature: ["via-1", "via-2"] } });
      C.set("via-1", { id: "via-1", name: "V1", requires: { features: ["shared"] } });
      C.set("via-2", { id: "via-2", name: "V2", requires: { features: ["shared"] } });
      assert.isFalse(possibleHere(rec, C.get("loop-a"), C).ok, "a cycle");
      const path = new Set(["unrelated"]);
      assert.isTrue(possibleHere(rec, C.get("either"), C, path).ok, "both branches share a building");
      assert.deepEqual([...path], ["unrelated"], "the set passed in is left alone");
    });
    it("the Facilities page gives buildings of one kind a single row with their stats added up", () => {
      const cols = [{ key: "defense", kind: "pct" }, { key: "upkeep", kind: "gp" }];
      const rows = mergeSameKind([
        { group: "exp:watchtower", name: "Watchtower", fid: "a", raw: [2, 0], subtitle: "" },
        { group: "exp:watchtower", name: "Watchtower", fid: "b", raw: [2, 0], subtitle: "", upgrade: { kind: "upgrade" } },
        { group: "exp:wall", name: "Wall", fid: "w", raw: [10, 5] },
        { group: "exp:watchtower", name: "Watchtower", building: true }
      ], cols);
      assert.equal(rows.length, 3);
      assert.equal(rows[0].many, 2);
      assert.deepEqual(rows[0].raw, [4, 0]);
      assert.equal(rows[0].fid, "b", "the row acts on the one that can be upgraded");
      // A damaged one with its repair under way isn't the one to act on; multipliers multiply.
      const m = mergeSameKind([
        { group: "exp:x", fid: "d", damaged: true, repair: false, raw: [1.5] },
        { group: "exp:x", fid: "u", upgrade: { kind: "upgrade" }, raw: [2] }
      ], [{ key: "defense", kind: "mult" }]);
      assert.equal(m[0].fid, "u");
      assert.deepEqual(m[0].raw, [3]);
      assert.isTrue(m[0].damaged);
    });
    it("what the site rules out for good: no ore, no water, no farmland; and what needs a building that can't be built", () => {
      const rec = workedExampleRecord();
      rec.location = { ...rec.location, terrain: "mountains", land: "barren", waterway: "none", waterOnSite: "rock", resources: ["stone", "ore"] };
      const C = catalog;
      const exp = id => C.get(id);
      assert.isFalse(possibleHere(rec, exp("fishery"), C).ok, "no water");
      assert.isFalse(possibleHere(rec, exp("fields"), C).ok, "barren");
      assert.isFalse(possibleHere(rec, exp("hunting-lodge"), C).ok, "no game");
      assert.isTrue(possibleHere(rec, exp("mine"), C).ok, "ore");
      assert.isTrue(possibleHere(rec, exp("trading-company"), C).ok, "needs only buildings and Accessibility: later");
      for (const id of ["hunters-guild", "highland-herds", "mushroom-cellars", "kitchen-garden", "greenhouse", "livestock"]) {
        assert.isTrue(possibleHere(rec, exp(id), C).ok, `${id}: food in barren mountains`);
      }
      rec.location.terrain = "underground";
      assert.isTrue(possibleHere(rec, exp("mushroom-cellars"), C).ok, "mushrooms grow underground");
      assert.isFalse(possibleHere(rec, exp("hunters-guild"), C).ok);
    });
    it("new food buildings: fishery needs a waterway; greenhouse food counts in a siege", () => {
      const rec = workedExampleRecord();
      assert.isFalse(prerequisites(rec, exp("fishery"), catalog, stats(rec)).ok);
      rec.features.gh = { id: "greenhouse", tier: 3 };
      assert.equal(stats(rec).food.inside - stats(workedExampleRecord()).food.inside, 30 + 30 + 38, "20, 20 and 25 a day, half as much again");
    });
  });
  describe("Balance: fully built Bastions", () => {
    const exp = id => catalog.get(id);
    it("every site, fully built, earns within 750 GP a turn of the River Keep and feeds itself", () => {
      const river = fullBuild(RIVER_KEEP, { rules, catalog });
      assert.ok(river.gold > 1000 && river.foodNet > 0, `River Keep: ${river.gold} GP, ${river.foodNet} food a day`);
      const terrains = ["plains", "forest", "hills", "mountains", "swamp", "desert", "coast", "arctic", "underground", "urban"];
      const misses = [];
      // The poorest choices: no resources, a far hamlet, a lord's grant (10% tax), barren or arid land, no river or coast.
      for (const terrain of terrains) for (const waterway of ["none", "lake"]) for (const land of ["fertile", "barren"])
      for (const climate of ["temperate", "arid"]) for (const structure of ["keep", "cave"]) {
        const loc = { ...RIVER_KEEP, terrain, waterway, land, climate, resources: [], waterOnSite: "none", road: "none",
          settlement: { name: "Hamlet", size: "hamlet", distance: 60 }, danger: "hostile", visibility: "hidden", political: "grant" };
        const r = fullBuild(loc, { rules, catalog, structure });
        if (r.gold < river.gold - 750 || r.foodNet < 0) misses.push(`${terrain}/${waterway}/${land}/${climate}/${structure}: ${r.gold} GP, ${r.foodNet} food`);
      }
      assert.deepEqual(misses, [], `River Keep earns ${river.gold}`);
    });
    it("site buildings make up for what a site lacks: each needs its own kind of land", () => {
      const at = loc => ({ ...workedExampleRecord(), location: { ...workedExampleRecord().location, ...loc } });
      const can = (id, loc) => possibleHere(at(loc), exp(id), catalog).ok;
      assert.isTrue(can("fungus-farms", { terrain: "underground" }));
      assert.isFalse(can("fungus-farms", { terrain: "plains" }));
      assert.isTrue(can("caravan-depot", { waterway: "none" }));
      assert.isFalse(can("caravan-depot", { waterway: "river" }));
      assert.isTrue(can("oasis-gardens", { terrain: "desert", waterOnSite: "spring" }));
      assert.isTrue(can("sealing-camp", { climate: "cold" }));
      assert.isTrue(can("eel-weirs", { terrain: "swamp" }));
      assert.isTrue(can("foragers-lodge", { land: "barren" }));
      assert.isTrue(can("brickworks", { terrain: "plains", resources: [] }));
      assert.isFalse(can("brickworks", { terrain: "mountains" }), "mountains have stone");
      assert.isTrue(can("lumber-camp", { terrain: "forest", resources: [] }), "a forest has timber");
    });
    it("hunting, fishing and herding feed a Bastion on barren land; only farms need good soil", () => {
      const rec = workedExampleRecord();
      rec.location.land = "barren";
      const before = stats(rec).food.outside;
      rec.features.h = { id: "hunters-guild", tier: 1 };
      rec.features.f = { id: "fields", tier: 1 };
      assert.equal(stats(rec).food.outside - before, featureEffects(exp("hunters-guild"), { tier: 1 }).foodOutside, "the fields grow nothing");
    });
  });
  describe("Trade routes", () => {
    const towns = [{ key: "a", name: "Ashford", distance: 30, size: "town" }, { key: "b", name: "Brook", distance: 80 },
      { key: "far", name: "Farhold", distance: 400 }];
    it("a route's worth: gold for goods, food for grain and livestock; bigger and farther pays more", () => {
      const cloth = quoteRoute({ size: "village", distance: 40, goods: "cloth" }, rules);
      assert.equal(cloth.kind, "coin");
      assert.equal(cloth.income, 25);
      assert.equal(cloth.setup, 150);
      assert.ok(quoteRoute({ size: "city", distance: 40, goods: "cloth" }, rules).income > cloth.income);
      assert.ok(quoteRoute({ size: "village", distance: 120, goods: "cloth" }, rules).income > cloth.income);
      const grain = quoteRoute({ size: "town", distance: 40, goods: "grain" }, rules);
      assert.equal(grain.kind, "food");
      assert.equal(grain.food, 48);
      assert.equal(grain.income, 0);
      assert.equal(grain.cost, 40, "the Bastion pays for its grain: 48 a day × 7 × 0.2 GP × 0.6, to the nearest 5");
      assert.ok(grain.cost < grain.food * 7 * 0.2, "less than food bought in a hurry");
      assert.equal(grain.days, 7, "quoted for a turn of 7 days");
      assert.equal(quoteRoute({ size: "town", distance: 40, goods: "grain" }, { ...rules, tradeFoodPrice: 0 }).cost, 0, "food given for nothing stays free");
      assert.equal(routeCharge({ ...grain }, 7), 40);
      assert.equal(routeCharge({ ...grain }, 14), 80, "a turn twice as long pays for twice the food");
      assert.equal(routeCharge({ kind: "coin", income: 30, cost: 99 }, 7), 0);
    });
    it("a map note keeps the size its first route rolled, after that route has ended", () => {
      const rec = workedExampleRecord();
      const note = { key: "note1", name: "Mill End", distance: 20 };
      const route = { id: "r", key: "note1", size: "city", state: "requested" };
      assert.deepEqual(rememberSize(rec, route), { "tradeSizes.note1": "city" });
      assert.equal(rememberSize(rec, { ...route, size: "hamlet" }), null, "the first size stays");
      rec.tradeRoutes = {};
      assert.equal(settlementRoom(rec, note, rules).size, "city", "no routes left, the size is kept");
      assert.equal(settlementList(rec, [{ id: "note1", name: "Mill End", distance: 20 }]).find(x => x.key === "note1").size, "city");
    });
    it("a full build takes the founding building to its most (four watchtowers)", () => {
      const r = fullBuild(RIVER_KEEP, { rules, catalog });
      const towers = Object.values(r.record.features).filter(f => f.id === "watchtower").reduce((n, f) => n + (Number(f.count) || 1), 0);
      assert.equal(towers, catalog.get("watchtower").max ?? 4);
    });
    it("food caravans the treasury can't pay for keep their food back", () => {
      const rec = workedExampleRecord();
      rec.treasury = 0;
      rec.food = 0;
      rec.tradeRoutes = { f: { id: "f", key: "b", name: "B", state: "active", kind: "food", income: 0, food: 50, cost: 100000, days: 7 } };
      const st = stats(rec);
      const paid = advanceTurn({ ...rec, tradeRoutes: { f: { ...rec.tradeRoutes.f, cost: 0 } } }, { stats: stats({ ...rec, tradeRoutes: { f: { ...rec.tradeRoutes.f, cost: 0 } } }), rules, now: 604800, rng: () => 0.99, newId });
      const { report } = advanceTurn(rec, { stats: st, rules, now: 604800, rng: () => 0.99, newId });
      assert.ok(report.unpaidRoutes > 0, "the charge it couldn't pay");
      assert.ok(report.foodDelta < paid.report.foodDelta, "less food came in than when paid");
    });
    it("settlements ask now and then (with a Trading Post); never more than two waiting, never beyond reach, never in a siege", () => {
      const rec = workedExampleRecord();
      assert.equal(rollTradeRequest(rec, stats(rec), rules, towns, { rng: () => 0, turn: 4, id: "r0" }), null, "no Trading Post, nobody asks");
      rec.features.tp = { id: "trading-post", count: 1 };
      const s = stats(rec);
      assert.deepEqual(tradeCandidates(rec, towns, rules).map(x => x.key), ["a", "b"]);
      const chance = requestChance(s, rules);
      assert.ok(chance > 0 && chance <= rules.tradeRequestMax);
      const req = rollTradeRequest(rec, s, rules, towns, { rng: () => 0, turn: 4, id: "r1" });
      assert.equal(req.key, "a");
      assert.equal(req.state, "requested");
      assert.equal(req.deadline, 4 + rules.tradeRequestTurns);
      assert.equal(rollTradeRequest(rec, s, rules, towns, { rng: () => 0.99, turn: 4, id: "r2" }), null, "the roll failed");
      rec.tradeRoutes = { r1: req };
      assert.deepEqual(tradeCandidates(rec, towns, rules).map(x => x.key), ["a", "b"], "a town holds several routes");
      rec.tradeRoutes.r2 = { ...req, id: "r2", key: "b" };
      assert.equal(rollTradeRequest(rec, s, rules, towns, { rng: () => 0, turn: 4, id: "r3" }), null, "two waiting already");
      assert.equal(rollTradeRequest({ ...workedExampleRecord(), siege: { day: 1 } }, s, rules, towns, { rng: () => 0, id: "r4" }), null);
    });
    it("accept, sign, cancel; a request nobody signs lapses", () => {
      const req = makeRequest(towns[0], null, rules, { rng: () => 0, turn: 1, id: "r1", goods: "wine" });
      assert.isFalse(transitionRoute(req, "sign").ok, "sign only after accepting");
      const acc = transitionRoute(req, "accept", { turn: 2 }).route;
      assert.equal(acc.state, "accepted");
      const act = transitionRoute(acc, "sign", { turn: 3 }).route;
      assert.equal(act.state, "active");
      assert.isTrue(transitionRoute(act, "cancel").ended);
      const rec = { tradeRoutes: { r1: acc } };
      const out = advanceTrade(rec, rules, { turn: acc.deadline + 1, danger: "safe" });
      assert.equal(out.lapsed.length, 1);
      assert.deepEqual(rec.tradeRoutes, {});
    });
    it("no routes without a Trading Post; three per Trading Post and two more with a Trading Company", () => {
      const rec = workedExampleRecord();
      assert.equal(stats(rec).trade.capacity, 0);
      assert.equal(routeCapacity({ tradeRoutes: 2 }, rules), 0, "a Trading Company alone opens no routes");
      rec.features.tp = { id: "trading-post", count: 2 };
      const s = stats(rec);
      assert.equal(s.trade.capacity, 6);
      assert.equal(routeCapacity({ tradeRoutes: 8, tradePosts: 2 }, rules), 8, "with a Trading Company");
      assert.equal(s.people.workers, 6, "the posts' clerks and carters");
      rec.tradeRoutes = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`r${i}`, { id: `r${i}`, key: `k${i}`, state: "active", kind: "coin", income: 10 }]));
      assert.isFalse(canAcceptRoute(rec, s.trade.capacity));
    });
    it("one settlement holds several routes, by its size: hamlet 3 to metropolis 15", () => {
      const rec = { tradeRoutes: {} };
      const room = (s, r = rec) => settlementRoom(r, s, rules);
      assert.deepEqual([["hamlet", 3], ["village", 6], ["town", 9], ["city", 12], ["metropolis", 15]].map(([size]) => room({ key: "x", size }).max), [3, 6, 9, 12, 15]);
      for (let i = 0; i < 3; i++) rec.tradeRoutes[`h${i}`] = { id: `h${i}`, key: "ham", state: i ? "active" : "requested", size: "hamlet" };
      assert.deepEqual(room({ key: "ham", size: "hamlet" }), { size: "hamlet", max: 3, used: 3, free: 0 });
      assert.deepEqual(tradeCandidates(rec, [{ key: "ham", name: "H", distance: 5, size: "hamlet" }], rules), [], "full");
      // A map note keeps the size its first route rolled.
      rec.tradeRoutes.n = { id: "n", key: "note1", state: "active", size: "city" };
      assert.equal(room({ key: "note1" }).max, 12);
      assert.equal(tradeCandidates(rec, [{ key: "note1", name: "N", distance: 5, source: "map" }], rules)[0].size, "city");
      assert.equal(room({ key: "fresh" }).max, 6, "a note nobody traded with yet counts as a village");
    });
    it("active routes pay gold or food every turn; a raided caravan brings nothing that turn", () => {
      const rec = workedExampleRecord();
      const before = stats(rec);
      rec.tradeRoutes = {
        c: { id: "c", key: "a", name: "A", state: "active", kind: "coin", income: 40, food: 0 },
        f: { id: "f", key: "b", name: "B", state: "active", kind: "food", income: 0, food: 20, cost: 15 },
        w: { id: "w", key: "x", name: "X", state: "requested", kind: "coin", income: 99, food: 0, deadline: 99 }
      };
      assert.deepEqual(routeTotals(rec), { active: 2, income: 40, cost: 15, food: 20 });
      const s = stats(rec);
      assert.equal(s.economy.incomeFlat - before.economy.incomeFlat, 40);
      assert.equal(s.food.outside - before.food.outside, 20);
      assert.equal(s.economy.upkeep - before.economy.upkeep, 15, "the Bastion pays for its food deliveries");
      const raid = advanceTrade(structuredClone(rec), { ...rules, tradeRaid: { frontier: 100 } }, { rng: () => 0, turn: 5, danger: "frontier" });
      assert.equal(raid.raided.length, 2);
      assert.equal(raid.lostIncome, 40);
      assert.equal(raid.lostFood, 20);
      assert.equal(raid.savedCost, 15, "a raided delivery isn't paid for");
      const quiet = advanceTrade(structuredClone(rec), rules, { rng: () => 0.99, turn: 5, danger: "frontier" });
      assert.equal(quiet.raided.length, 0);
    });
    it("settlements: the Bastion's own, the GM's list (any distance) and map notes, each name once", () => {
      const rec = workedExampleRecord();
      rec.location.settlement = { name: "Ashford", size: "town", distance: 12 };
      rec.settlements = { s1: cleanSettlement({ name: "  Port  Vell ", distance: "420", size: "city" }, "s1"),
        s2: cleanSettlement({ name: "Brook", distance: 35 }, "s2") };
      assert.deepEqual(rec.settlements.s1, { id: "s1", name: "Port Vell", distance: 420, size: "city" });
      assert.equal(rec.settlements.s2.size, "village");
      assert.equal(cleanSettlement({ name: " " }, "x"), null);
      const list = settlementList(rec, [{ id: "n1", name: "brook", distance: 30 }, { id: "n2", name: "Mill End", distance: 50 },
        { id: "n3", name: "Ashford", distance: 12 }]);
      assert.deepEqual(list.map(x => x.key), ["home", "gm:s2", "gm:s1", "n2"]);
      assert.deepEqual(tradeCandidates(rec, list, rules).map(x => x.key), ["home", "gm:s2", "gm:s1", "n2"], "the GM's far city counts");
    });
    it("a turn can bring a request from a nearby settlement", () => {
      const rec = workedExampleRecord();
      rec.features.tp = { id: "trading-post", count: 1 };
      const { report, record } = advanceTurn(rec, { stats: stats(rec), rules: { ...rules, tradeRequestBase: 100, tradeRequestMax: 100 }, now: 604800,
        rng: seeded(5), newId, settlements: towns });
      assert.ok(report.tradeRequest, "a request");
      assert.equal(record.tradeRoutes[report.tradeRequest.id].state, "requested");
    });
  });
}
