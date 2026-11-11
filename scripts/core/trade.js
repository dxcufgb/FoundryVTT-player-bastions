/**
 * Trade routes: contracts with other settlements that pay gold or deliver food every turn. Pure (no Foundry globals).
 *
 * Every route goes both ways: on a "coin" route the Bastion sends its goods and is paid in gold (income a turn); on a
 * "food" route the settlement sends food (food a day) and the Bastion pays for it in gold (cost a turn, below the price
 * of food bought in a hurry).
 * A route lives in record.tradeRoutes.<id>:
 *   { id, key, name, distance, size, goods, kind: "coin" | "food", income, food, cost, setup,
 *     state: "requested" | "accepted" | "active", requestedTurn, deadline, signedTurn, questId, raidedTurn }
 * Routes need a Trading Post (routeCapacity); one settlement holds several (ROUTES_PER_SETTLEMENT by size).
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

/**
 * Routes the Bastion can hold: none until a Trading Post stands (fx.tradePosts); then rules.tradeBaseRoutes plus every
 * trading building's share (fx.tradeRoutes).
 */
export function routeCapacity(fx, rules) {
  if (!((Number(fx?.tradePosts) || 0) > 0)) return 0;
  return Math.max(0, (rules?.tradeBaseRoutes ?? 0) + (Number(fx?.tradeRoutes) || 0));
}

/** How many routes one settlement holds at once, by its size. */
export const ROUTES_PER_SETTLEMENT = { hamlet: 3, village: 6, town: 9, city: 12, metropolis: 15 };

/** The open routes (requested, accepted or active) with one settlement. */
export function routesWith(record, key) {
  return routesOf(record).filter(r => r.key === key);
}

/**
 * Room for more routes with a settlement: { size, max, used, free }. A map note has no size until a route to it
 * rolls one; that size is kept in record.tradeSizes (rememberSize), even after its routes end (a note never asked
 * counts as a village).
 */
export function settlementRoom(record, settlement, rules) {
  const used = routesWith(record, settlement?.key);
  const kept = record?.tradeSizes?.[settlement?.key];
  const size = TRADE_SIZES[settlement?.size] ? settlement.size : TRADE_SIZES[kept] ? kept : (used.find(r => TRADE_SIZES[r.size])?.size ?? null);
  const table = rules?.tradeRoutesPerSettlement ?? ROUTES_PER_SETTLEMENT;
  const max = Math.max(1, Math.floor(Number(table[size ?? "village"] ?? ROUTES_PER_SETTLEMENT[size ?? "village"]) || 1));
  return { size, max, used: used.length, free: Math.max(0, max - used.length) };
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
    const food = Math.max(1, Math.round((rules?.tradeFood ?? 30) * sizeMult * g.mult));
    const value = food * turnDays * foodPrice;
    // The Bastion pays for the food: a contract price, below what food bought when the stores run dry costs.
    // A share of 0 (food given for nothing) stays free.
    const share = Math.max(0, Number(rules?.tradeFoodPrice ?? 0.6) || 0);
    const cost = share > 0 ? round5(value * share) : 0;
    // `days`: the turn length the charge was quoted for (a turn of another length pays for the food it brings).
    return { kind: "food", income: 0, food, cost, days: turnDays, setup: round25(value * (rules?.tradeSetupTurns ?? 6)) };
  }
  // Farther settlements trade goods the Bastion's market lacks: worth more, up to double.
  const distF = Math.min(2, Math.max(0.6, 0.6 + (Number(distance) || 0) / 100));
  const accessF = 1 + 0.05 * (Number(accessibility) || 0);
  const income = round5((rules?.tradeIncome ?? 25) * sizeMult * g.mult * distF * accessF);
  return { kind: "coin", income, food: 0, cost: 0, setup: round25(income * (rules?.tradeSetupTurns ?? 6)) };
}

/**
 * Every settlement a route can go to: the Bastion's own ("home"), the GM's list (record.settlements, key "gm:<id>")
 * and map notes near the marker (key = the note id) — a name the GM listed or the founding settlement is kept once.
 * notes: [{ id, name, distance }] nearest first.
 */
export function settlementList(record, notes = []) {
  const out = [];
  const seen = new Set();
  const norm = s => String(s ?? "").trim().toLowerCase();
  const home = record?.location?.settlement;
  if (home?.name) {
    out.push({ key: "home", name: home.name, distance: Math.round(Number(home.distance) || 0), size: home.size, source: "home" });
    seen.add(norm(home.name));
  }
  const listed = Object.values(record?.settlements ?? {}).filter(s => s?.name)
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0) || a.name.localeCompare(b.name));
  for (const s of listed) {
    if (seen.has(norm(s.name))) continue;
    seen.add(norm(s.name));
    out.push({ key: `gm:${s.id}`, id: s.id, name: s.name, distance: Math.max(0, Math.round(Number(s.distance) || 0)),
      size: TRADE_SIZES[s.size] ? s.size : "village", source: "gm" });
  }
  for (const n of notes) {
    if (!n?.name || seen.has(norm(n.name))) continue;
    seen.add(norm(n.name));
    // A map note has no size of its own: the one its first route rolled is kept (record.tradeSizes).
    const size = TRADE_SIZES[record?.tradeSizes?.[n.id]] ? record.tradeSizes[n.id] : undefined;
    out.push({ key: n.id, name: n.name, distance: Math.round(Number(n.distance) || 0), ...(size ? { size } : {}), source: "map" });
  }
  return out;
}

/** A settlement the GM keeps for a Bastion: { id, name, distance (miles), size }, cleaned. Null when unusable. */
export function cleanSettlement(raw, id) {
  const name = String(raw?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name || !id) return null;
  return { id, name, distance: Math.min(5000, Math.max(0, Math.round(Number(raw?.distance) || 0))),
    size: TRADE_SIZES[raw?.size] ? raw.size : "village" };
}

/**
 * Settlements that can still ask: within reach, and with room for another route (settlementRoom). A map note that a
 * route already went to keeps the size that route rolled.
 */
export function tradeCandidates(record, settlements, rules) {
  const max = rules?.tradeMaxMiles ?? 150;
  const out = [];
  for (const s of settlements ?? []) {
    // The GM's own list is always in reach: the GM put it there.
    if (!s?.key || (s.source !== "gm" && (Number(s.distance) || 0) > max)) continue;
    const room = settlementRoom(record, s, rules);
    if (room.free > 0) out.push(room.size && !s.size ? { ...s, size: room.size } : s);
  }
  return out;
}

/** Keeps the size a route rolled for its settlement (record.tradeSizes.<key>), in place. Returns the dot-path change or null. */
export function rememberSize(record, route) {
  if (!route?.key || !TRADE_SIZES[route.size] || TRADE_SIZES[record?.tradeSizes?.[route.key]]) return null;
  record.tradeSizes = { ...(record.tradeSizes ?? {}), [route.key]: route.size };
  return { [`tradeSizes.${route.key}`]: route.size };
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
  // No Trading Post, no trade: nobody asks.
  if ((stats?.trade?.capacity ?? routeCapacity(stats?.fx, rules)) <= 0) return null;
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

/** What the active routes bring and cost: gold in a turn, gold paid a turn (for food), food a day. */
/**
 * What a food route charges for a turn of `days` days: its quoted charge for the turn length it was quoted for
 * (route.days), scaled to the days of food it brings. Coin routes charge nothing. Without `days`: the quoted charge.
 */
export function routeCharge(route, days) {
  if (route?.kind !== "food") return 0;
  const cost = Number(route.cost) || 0;
  const quoted = Number(route.days) || 0;
  if (!(days > 0) || !(quoted > 0) || days === quoted) return cost;
  return Math.round(cost * days / quoted);
}

/** Active routes' totals; `days` (the turn length) scales food routes' charges (routeCharge). */
export function routeTotals(record, days) {
  const active = routesOf(record, ["active"]);
  return {
    active: active.length,
    income: active.reduce((n, r) => n + (r.kind === "coin" ? Number(r.income) || 0 : 0), 0),
    cost: active.reduce((n, r) => n + routeCharge(r, days), 0),
    food: active.reduce((n, r) => n + (r.kind === "food" ? Number(r.food) || 0 : 0), 0)
  };
}

/**
 * A turn's trade (mutates the record): requests and accepted routes past their deadline lapse; each active route may
 * be raided (rules.tradeRaid by the land's danger): it pays nothing this turn. A siege stops every caravan.
 * A raided food delivery isn't paid for. Returns { lapsed: [route], raided: [route], lostIncome, lostFood (a day),
 * savedCost, lines }.
 */
export function advanceTrade(record, rules, { rng = Math.random, turn = 0, danger = "frontier", siege = false, days = rules?.turnDays } = {}) {
  const out = { lapsed: [], raided: [], lostIncome: 0, lostFood: 0, savedCost: 0, lines: [] };
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
      else { out.lostFood += Number(r.food) || 0; out.savedCost += routeCharge(r, days); }
      out.lines.push(siege ? `No caravan from ${r.name} got through the siege.` : `The caravan from ${r.name} was raided: nothing arrived this turn.`);
    }
  }
  return out;
}
