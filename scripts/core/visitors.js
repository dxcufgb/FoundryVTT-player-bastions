import { MERCHANT_TIERS, VISITORS, EVENTS, GUESTS, TREASURE } from "../data/tables.js";

/** Merchants, visitors and the fallback events table. Pure; rng returns [0, 1). */

export function d(n, rng = Math.random) {
  return 1 + Math.floor(rng() * n);
}

export function rollDice(expr, rng = Math.random) {
  const m = String(expr).match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
  if (!m) return Number(expr) || 0;
  let s = Number(m[3]) || 0;
  for (let i = 0; i < Number(m[1]); i++) s += d(Number(m[2]), rng);
  return s;
}

/** Rolls whether a merchant comes this turn. Returns null or { tierKey, label, budget, stayDays, rarities }. */
export function rollMerchant(stats, rng = Math.random) {
  const roll = d(100, rng);
  if (roll > stats.merchant.chance) return null;
  const tier = stats.merchant.tier ?? MERCHANT_TIERS[0];
  return {
    tierKey: tier.key,
    label: tier.label,
    budget: Math.round(tier.budget * (stats.merchant.stockMult ?? 1)),
    stayDays: rollDice(tier.stay, rng),
    rarities: tier.rarities,
    roll
  };
}

/** Visitor weights from the stats and location. */
export function visitorWeights(stats, record) {
  const loc = record?.location ?? {};
  const f = stats.flags ?? {};
  const w = {
    nobody: Math.max(2, 12 - stats.accessibility),
    recruits: 2 + Math.floor(stats.renown / 2) + (stats.fx?.guardsCap ? 3 : 0),
    pilgrims: 1 + (record?.features && Object.values(record.features).some(x => x?.id === "chapel") ? 3 : 0) + Math.floor(stats.renown / 3),
    adventurers: stats.renown >= 6 ? 3 : 0,
    refugees: loc.danger === "hostile" ? 4 : loc.danger === "frontier" ? 2 : loc.danger === "wild" ? 3 : 0,
    taxman: loc.political === "grant" ? 2 : 0,
    envoy: stats.renown >= 5 || loc.political === "contested" ? 2 : 0,
    spy: Math.max(0, 5 - stats.security)
  };
  if (f.rumors) w.adventurers += 1;
  return w;
}

/** Rolls a visitor (weighted). Returns { key, label, text, gp? }. */
export function rollVisitor(stats, record, rng = Math.random) {
  const w = visitorWeights(stats, record);
  const total = Object.values(w).reduce((n, v) => n + v, 0);
  let r = rng() * total;
  let key = "nobody";
  for (const [k, v] of Object.entries(w)) {
    if (r < v) { key = k; break; }
    r -= v;
  }
  const out = { key, ...VISITORS[key] };
  if (key === "pilgrims") out.gp = Math.round(rollDice("1d6", rng) * 10 * (stats.visitors?.payMult ?? 1));
  if (key === "recruits") out.count = rollDice("1d4", rng);
  return out;
}

/** The fallback events table: d100 → event. */
export function eventForRoll(roll) {
  return EVENTS.find(e => roll >= e.min && roll <= e.max) ?? EVENTS[0];
}

/** Maps a result text from any "Bastion Events" roll table to an event key by keywords. */
export function eventKeyFromText(text) {
  const s = String(text ?? "").toLowerCase();
  const map = [
    ["allIsWell", /all is well|nothing/], ["attack", /attack/], ["criminal", /criminal/], ["opportunity", /opportunit/],
    ["visitors", /friendly visitor|visitors/], ["guest", /guest/], ["lostHirelings", /lost hireling|hirelings? (leave|lost)/],
    ["discovery", /magical discovery|discovery/], ["refugees", /refugee/], ["aid", /request for aid|aid/], ["treasure", /treasure/]
  ];
  for (const [k, re] of map) if (re.test(s)) return k;
  return "allIsWell";
}

export function guestForRoll(roll) {
  return GUESTS[Math.min(4, Math.max(1, roll))];
}

export function treasureForRoll(roll) {
  return TREASURE.find(t => roll >= t.min && roll <= t.max) ?? TREASURE[0];
}

/** Request for aid: sends n defenders, rolls 1d6 each. Returns { total, success, reward, deaths }. */
export function requestForAid(n, rng = Math.random) {
  let total = 0;
  for (let i = 0; i < n; i++) total += d(6, rng);
  const base = d(6, rng) * 100;
  const success = total >= 10;
  return { total, success, reward: success ? base : Math.floor(base / 2), deaths: success ? 0 : (n > 0 ? 1 : 0) };
}
