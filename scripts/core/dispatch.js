import { DISPATCH_METHODS } from "../data/tables.js";
import { DANGERS } from "../data/location.js";

/**
 * Dispatches: which methods can reach the Bastion, how long they take, what they cost and how risky they are. Pure.
 *
 * Dispatch: { id, method, from (actorId), orders: [{ type: "facility"|"maintain"|"payment"|"standing"|"signal"|"note",
 *   ... }], gold, distance, sentAt, arrivesAt, status: "transit"|"arrived"|"applied"|"lost"|"intercepted"|"superseded",
 *   risk, cost }
 */

/** Whether a method is usable for this Bastion: { ok, reason }. strict = only magic counts as orders (strict DMG). */
export function methodAvailable(key, stats, { strict = false, siege = false } = {}) {
  const m = DISPATCH_METHODS[key];
  if (!m) return { ok: false, reason: "Unknown method" };
  if (strict && !m.magic) return { ok: false, reason: "Strict DMG rules: only magic carries orders" };
  const f = stats?.flags ?? {};
  switch (m.requires) {
    case "rookery": if (!f.rookery) return { ok: false, reason: "Needs a Rookery" }; break;
    case "sendingStation": if (!f.sendingStation) return { ok: false, reason: "Needs a Sending Stone Station" }; break;
    case "beacon": if (!f.beacon) return { ok: false, reason: "Needs Beacon Towers" }; break;
    case "scrying": if (!f.scrying) return { ok: false, reason: "Needs a Scrying Pool" }; break;
    case "access3": if ((stats?.accessibility ?? 0) < 3) return { ok: false, reason: "The Bastion needs Accessibility 3+" }; break;
    default: break;
  }
  if (siege && !m.magic && !(key === "envoy" && f.postern)) return { ok: false, reason: "Nothing mundane gets through a siege" };
  return { ok: true };
}

/** Envoy speed with the Coach House and Waystation. */
export function envoySpeed(stats, rules) {
  const f = stats?.flags ?? {};
  if (f.mountedEnvoys && f.relay) return rules.envoyRelay;
  if (f.mountedEnvoys) return rules.envoyMounted;
  return DISPATCH_METHODS.envoy.speed;
}

/**
 * The quote shown before sending: { ok, reason?, instant, days, capacity, cost, risk, gold, reply, rangeMiles? }.
 * opts: { distance (miles), slotLevel (Animal Messenger), orders (count), strict, siege }
 */
export function quoteDispatch(key, stats, rules, record, opts = {}) {
  const m = DISPATCH_METHODS[key];
  const avail = methodAvailable(key, stats, opts);
  if (!avail.ok) return { ok: false, reason: avail.reason };
  const distance = Math.max(0, Number(opts.distance) || 0);
  const onRoad = ["road", "highway"].includes(stats?.travel?.roadTier);
  const factor = m.flying ? 1 : (onRoad ? rules.roadRouteFactor : rules.routeFactor);
  const miles = distance * factor;
  let days = 0;
  let instant = false;
  let rangeMiles = null;
  if (m.speed === null) instant = true;
  else if (m.speed === "night") days = 1;
  else {
    const speed = key === "envoy" ? envoySpeed(stats, rules) : m.speed;
    days = Math.ceil(miles / speed - 1e-9);
  }
  if (m.rangePerSlot) {
    const slot = Math.max(2, Math.floor(Number(opts.slotLevel) || 2));
    const hours = 24 + 48 * (slot - 2);
    rangeMiles = Math.floor(m.speed * hours / 24);
    if (miles > rangeMiles) return { ok: false, reason: `Out of range: ${rangeMiles} miles with a level ${slot} slot` };
  }
  let cost = 0;
  if (m.cost?.perDay) cost = m.cost.perDay * Math.max(1, days);
  if (m.cost?.flat) cost += m.cost.flat;
  const dangerRisk = m.dangerRisk ? (DANGERS[record?.location?.danger]?.effects?.dispatchRisk ?? 0) : 0;
  const risk = Math.min(95, (m.risk ?? 0) + dangerRisk);
  const capacity = m.capacity;
  const orders = Math.max(0, Number(opts.orders) || 0);
  if (orders > capacity) return { ok: false, reason: `Carries at most ${capacity} order${capacity === 1 ? "" : "s"}` };
  return { ok: true, instant, days, waitDice: m.wait ?? null, capacity, cost, risk, gold: m.gold, reply: m.reply,
    rangeMiles, presetOnly: !!m.presetOnly, lookOnly: !!m.lookOnly, miles: Math.round(miles) };
}

/** Number of "orders" a dispatch carries (capacity units). */
export function orderCount(orders = []) {
  return orders.filter(o => o && o.type !== "note").length;
}

/**
 * Dispatches that have arrived by `now` (seconds of game time) and are still in transit, oldest first.
 */
export function arrivedBy(dispatches, now) {
  return Object.values(dispatches ?? {})
    .filter(d => d.status === "transit" && (d.arrivesAt ?? 0) <= now)
    .sort((a, b) => (a.arrivesAt ?? 0) - (b.arrivesAt ?? 0));
}

/**
 * Merges the orders of arrived dispatches: later arrivals win for the same facility. Returns
 * { facility: {facilityKey: order}, maintain, payments: [{projectId, gp}], standing: [...], signals: [...], notes: [...] }
 */
export function mergeOrders(dispatches) {
  const out = { facility: {}, maintain: false, payments: [], standing: [], signals: [], notes: [] };
  for (const d of dispatches) {
    for (const o of d.orders ?? []) {
      if (o.type === "facility") out.facility[o.facility] = { ...o, from: d.from, dispatchId: d.id };
      else if (o.type === "maintain") out.maintain = true;
      else if (o.type === "payment") out.payments.push({ ...o, from: d.from });
      else if (o.type === "standing") out.standing.push(o);
      else if (o.type === "signal") out.signals.push(o.signal);
      else if (o.type === "note") out.notes.push(o.text);
    }
  }
  return out;
}
