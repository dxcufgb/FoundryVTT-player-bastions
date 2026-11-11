/**
 * Trade routes: contracts with other settlements that pay gold or deliver food every turn. Pure (no Foundry globals).
 *
 * A route lives in record.tradeRoutes.<id>:
 *   { id, key, name, distance, size, goods, kind: "coin" | "food", income, food, setup,
 *     state: "requested" | "accepted" | "active", requestedTurn, deadline, signedTurn, questId, raidedTurn }
 * A settlement asks (rollTradeRequest, in the turn), the owners accept or decline, the party travels there and the GM
 * signs (setup paid from the treasury), and from then on the route pays every turn until it is cancelled. A request
 * (accepted or not) that isn't signed by its deadline lapses. Ended routes are removed from the record.
 */
import { TRADE_GOODS } from "../data/tables.js";

/** How much a settlement of each size trades. */
export const TRADE_SIZES = { hamlet: 0.5, village: 1, town: 1.6, city: 2.5, metropolis: 4 };
/** A settlement found only as a map note gets a size by these odds. */
const SIZE_ODDS = [["hamlet", 30], ["village", 40], ["town", 24], ["city", 6]];

export const OPEN_STATES = ["requested", "accepted", "active"];

const round5 = n => Math.max(5, Math.round(n / 5) * 5);
const round25 = n => Math.max(25, Math.round(n / 25) * 25);

/** The routes of a record (as an array), optionally only some states. */
export function routesOf(record, states = OPEN_STATES) {
  return Object.values(record?.tradeRoutes ?? {}).filter(r => r && states.includes(r.state));
}

/** Routes the Bastion can hold: a base, plus every trading building's share (stats fx.tradeRoutes). */
export function routeCapacity(fx, rules) {
  return Math.max(0, (rules?.tradeBaseRoutes ?? 1) + (Number(fx?.tradeRoutes) || 0));
}

/**
 * What a route to a settlement is worth: gold a turn (coin goods) or food a day (food goods), and the setup cost
 * (rules.tradeSetupTurns turns of its value; food valued at the price of bought food).
 */
export function quoteRoute({ size = "village", distance = 0, goods = "cloth" }, rules, { accessibility = 0, foodPrice = 0.2 } = {}) {
  const g = TRADE_GOODS[goods] ?? TRADE_GOODS.cloth;
  const sizeMult = TRADE_SIZES[size] ?? 1;
  const turnDays = rules?.turnDays ?? 7;
  if (g.kind === "food") {
    const food = Math.max(1, Math.round((rules?.tradeFood ?? 12) * sizeMult * g.mult));
    return { kind: "food", income: 0, food, setup: round25(food * turnDays * foodPrice * (rules?.tradeSetupTurns ?? 6)) };
  }
  // Farther settlements trade goods the Bastion's market lacks: worth more, up to double.
  const distF = Math.min(2, Math.max(0.6, 0.6 + (Number(distance) || 0) / 100));
  const accessF = 1 + 0.05 * (Number(accessibility) || 0);
  const income = round5((rules?.tradeIncome ?? 25) * sizeMult * g.mult * distF * accessF);
  return { kind: "coin", income, food: 0, setup: round25(income * (rules?.tradeSetupTurns ?? 6)) };
}

/** Settlements that can still ask: within reach, and without an open route or request. */
export function tradeCandidates(record, settlements, rules) {
  const taken = new Set(routesOf(record).map(r => r.key));
  const max = rules?.tradeMaxMiles ?? 150;
  return (settlements ?? []).filter(s => s?.key && !taken.has(s.key) && (Number(s.distance) || 0) <= max);
}

/** The chance (%) a settlement asks for a route this turn. */
export function requestChance(stats, rules) {
  const base = rules?.tradeRequestBase ?? 10;
  const c = base + 2 * (stats?.accessibility ?? 0) + 2 * (stats?.renown ?? 0) + ((stats?.fx?.tradeRoutes ?? 0) > 0 ? 5 : 0);
  return Math.max(0, Math.min(rules?.tradeRequestMax ?? 40, c));
}

function pickWeighted(list, rng) {
  const total = list.reduce((n, [, w]) => n + w, 0);
  let roll = rng() * total;
  for (const [k, w] of list) { if ((roll -= w) < 0) return k; }
  return list.at(-1)[0];
}

/** A new request from a settlement (picked or rolled), or null. Not rolled during a siege. */
export function makeRequest(settlement, stats, rules, { rng = Math.random, turn = 0, id, goods } = {}) {
  if (!settlement) return null;
  const size = TRADE_SIZES[settlement.size] ? settlement.size : pickWeighted(SIZE_ODDS, rng);
  const g = TRADE_GOODS[goods] ? goods : pickWeighted(Object.entries(TRADE_GOODS).map(([k, v]) => [k, v.weight ?? 1]), rng);
  const distance = Math.max(0, Math.round(Number(settlement.distance) || 0));
  const q = quoteRoute({ size, distance, goods: g }, rules, { accessibility: stats?.accessibility ?? 0, foodPrice: stats?.food?.buyPrice ?? 0.2 });
  return { id, key: settlement.key, name: settlement.name, distance, size, goods: g, ...q, state: "requested",
    requestedTurn: turn, deadline: turn + (rules?.tradeRequestTurns ?? 3) };
}

/** A turn's roll for a request: at most rules.tradeMaxOpen requests waiting at once. */
export function rollTradeRequest(record, stats, rules, settlements, { rng = Math.random, turn = 0, id } = {}) {
  if (record?.siege) return null;
  const waiting = routesOf(record, ["requested", "accepted"]).length;
  if (waiting >= (rules?.tradeMaxOpen ?? 2)) return null;
  const candidates = tradeCandidates(record, settlements, rules);
  if (!candidates.length) return null;
  if (rng() * 100 >= requestChance(stats, rules)) return null;
  const settlement = candidates[Math.floor(rng() * candidates.length)];
  return makeRequest(settlement, stats, rules, { rng, turn, id });
}

/**
 * A route's next state. ops: accept, decline (requested → gone), sign (accepted → active), withdraw (accepted → gone),
 * cancel (active → gone), lapse (requested or accepted past the deadline → gone). Returns { ok, route, ended }.
 */
export function transitionRoute(route, op, { turn = 0 } = {}) {
  const r = { ...route };
  const end = reason => ({ ok: true, route: { ...r, state: "ended", ended: reason }, ended: true });
  switch (op) {
    case "accept": return r.state === "requested" ? { ok: true, route: { ...r, state: "accepted", acceptedTurn: turn } } : { ok: false };
    case "decline": return r.state === "requested" ? end("declined") : { ok: false };
    case "sign": return r.state === "accepted" ? { ok: true, route: { ...r, state: "active", signedTurn: turn } } : { ok: false };
    case "withdraw": return r.state === "accepted" ? end("withdrawn") : { ok: false };
    case "cancel": return r.state === "active" ? end("cancelled") : { ok: false };
    case "lapse": return ["requested", "accepted"].includes(r.state) ? end("lapsed") : { ok: false };
    default: return { ok: false };
  }
}

/** Whether another route can be accepted: active and accepted routes are within the capacity. */
export function canAcceptRoute(record, capacity) {
  return routesOf(record, ["accepted", "active"]).length < capacity;
}

/** What the active routes bring: gold a turn and food a day. */
export function routeTotals(record) {
  const active = routesOf(record, ["active"]);
  return {
    active: active.length,
    income: active.reduce((n, r) => n + (r.kind === "coin" ? Number(r.income) || 0 : 0), 0),
    food: active.reduce((n, r) => n + (r.kind === "food" ? Number(r.food) || 0 : 0), 0)
  };
}

/**
 * A turn's trade (mutates the record): requests and accepted routes past their deadline lapse; each active route may
 * be raided (rules.tradeRaid by the land's danger): it pays nothing this turn. A siege stops every caravan.
 * Returns { lapsed: [route], raided: [route], lostIncome, lostFood (a day), lines }.
 */
export function advanceTrade(record, rules, { rng = Math.random, turn = 0, danger = "frontier", siege = false } = {}) {
  const out = { lapsed: [], raided: [], lostIncome: 0, lostFood: 0, lines: [] };
  record.tradeRoutes ??= {};
  for (const r of Object.values(record.tradeRoutes)) {
    if (!r) continue;
    if (["requested", "accepted"].includes(r.state) && turn > (r.deadline ?? Infinity)) {
      out.lapsed.push({ ...r });
      delete record.tradeRoutes[r.id];
      out.lines.push(`The trade route offer from ${r.name} lapsed: nobody came to sign.`);
      continue;
    }
    if (r.state !== "active") continue;
    const chance = siege ? 100 : (rules?.tradeRaid?.[danger] ?? 0);
    if (chance > 0 && rng() * 100 < chance) {
      record.tradeRoutes[r.id] = { ...r, raidedTurn: turn };
      out.raided.push(r);
      if (r.kind === "coin") out.lostIncome += Number(r.income) || 0;
      else out.lostFood += Number(r.food) || 0;
      out.lines.push(siege ? `No caravan from ${r.name} got through the siege.` : `The caravan from ${r.name} was raided: nothing arrived this turn.`);
    }
  }
  return out;
}
