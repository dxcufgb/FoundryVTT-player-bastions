import { rollFormula } from "./stats.js";
import { advanceProjects, applyCompletion, fund } from "./projects.js";
import { syncLayout } from "./layout.js";
import { assignCrews } from "./crews.js";
import { arrivedBy, mergeOrders } from "./dispatch.js";
import { rollMerchant, rollVisitor } from "./visitors.js";

/**
 * One Bastion turn on the record, without Foundry. Returns { record, report }. The Foundry layer then runs the dnd5e
 * system's own facility advance, rolls the DMG events table when `report.rollEvent` is true, fills merchant stock,
 * posts the chat card and writes the record.
 *
 * opts: { stats, rules, catalog, now (game seconds), days, rng, newId(), partyLevel, payAsYouBuild, standingRule }
 */
export function advanceTurn(recordIn, opts) {
  const { stats, rules, now = 0, rng = Math.random, newId = () => Math.random().toString(36).slice(2, 18) } = opts;
  const days = opts.days ?? rules.turnDays;
  const record = structuredClone(recordIn);
  // Bastions from before grounds existed keep the size they have now from here on.
  if (!record.grounds && stats?.grounds?.key) record.grounds = stats.grounds.key;
  const report = { turn: (record.turn?.number ?? 0) + 1, days, lines: [], completed: [], dispatches: [], facilityOrders: [],
    signals: [], notes: [], rollEvent: false, mode: "maintain", income: 0, upkeep: 0, tax: 0, dividend: 0, merchant: null, visitor: null,
    neglected: false, foodDelta: 0 };
  const siege = !!record.siege;

  /* 1. Dispatches */
  const arrived = arrivedBy(record.dispatches, now);
  for (const d of arrived) {
    record.dispatches[d.id].status = "arrived";
    record.dispatches[d.id].arrivedTurn = report.turn;
    report.dispatches.push(d.id);
    if (d.gold) {
      record.treasury = (record.treasury ?? 0) + d.gold;
      report.lines.push(`An envoy delivered ${d.gold} GP to the treasury.`);
    }
  }
  const merged = mergeOrders(arrived.map(d => record.dispatches[d.id]));
  for (const pay of merged.payments) {
    const p = record.projects?.[pay.projectId];
    if (!p) continue;
    const amount = Math.min(Number(pay.gp) || 0, record.treasury ?? 0);
    const res = fund(p, amount, pay.from);
    if (res.ok) {
      record.projects[p.id] = res.project;
      record.treasury -= res.accepted;
      report.lines.push(`Paid ${res.accepted} GP into ${p.label} from the treasury (by dispatch).`);
    }
  }
  if (merged.standing.length) {
    record.standingOrders = merged.standing.at(-1).orders ?? record.standingOrders ?? [];
    report.lines.push("New standing orders arrived.");
  }
  report.facilityOrders = Object.values(merged.facility);
  report.signals = merged.signals;
  report.notes = merged.notes;

  /* 2. Mode: present, remote orders, standing orders, or Maintain */
  const present = record.presence === "present";
  const remoteOrders = report.facilityOrders.length > 0 && !merged.maintain;
  const standing = !!stats.flags?.standingOrders && (record.standingOrders?.length ?? 0) > 0 && opts.standingRule !== false;
  if (record.maintainOrder || merged.maintain || merged.signals.includes("maintain")) report.mode = "maintain";
  else if (present) report.mode = "present";
  else if (remoteOrders) report.mode = "remote";
  else if (standing) report.mode = "standing";
  else report.mode = "maintain";
  report.rollEvent = report.mode === "maintain";
  record.maintainOrder = false;

  /* 3. Projects (with the long-rest clock they move on each long rest instead: opts.skipProjects) */
  if (!siege && !opts.skipProjects) {
    const done = workDays(record, days, { ...opts, now, newId, crews: opts.crews ?? stats?.crews });
    report.completed.push(...done.completed);
    report.lines.push(...done.lines);
    if (done.layoutChanged) report.layoutChanged = true;
  }

  /* 4. Economy */
  const econ = stats.economy;
  let income = econ.incomeFlat;
  for (const dce of econ.dice) income += Math.round(rollFormula(dce.formula, rng) * (dce.mult ?? 1));
  if (siege) income = 0;
  const tax = econ.tax ? Math.round(income * (econ.tax / Math.max(1, econ.incomeAverage))) : 0;
  const upkeep = econ.upkeep;
  let net = income - tax - upkeep;
  record.treasury = (record.treasury ?? 0) + net;
  record.unpaidUpkeep = record.treasury < 0;
  if (record.treasury < 0) {
    report.lines.push(`The treasury could not cover upkeep (${-record.treasury} GP short).`);
    record.treasury = 0;
  }

  /* 5. Food: what the stores can't cover is bought with the treasury; who can't be fed moves away. */
  const food = feedBastion(record, stats, rules, { days, siege });
  Object.assign(report, { foodDelta: food.delta, foodBought: food.bought, foodCost: food.cost, left: food.left, returned: food.returned });
  report.lines.push(...food.lines);
  net -= food.cost;

  let dividend = 0;
  const pct = record.dividendPct ?? rules.dividendPct;
  if (net > 0 && pct > 0 && !record.unpaidUpkeep && !record.hungry) {
    dividend = Math.min(record.treasury, Math.floor(net * pct / 100));
    record.treasury -= dividend;
    record.dividends = (record.dividends ?? 0) + dividend;
  }
  Object.assign(report, { income, upkeep, tax, dividend, net });

  /* 6. Merchant */
  if (record.merchant && (record.merchant.leavesAt ?? 0) <= now) {
    report.lines.push(`${record.merchant.label} moved on.`);
    record.merchant = null;
  }
  if (!record.merchant && !siege) {
    const m = rollMerchant(stats, rng);
    if (m) {
      record.merchant = { ...m, id: newId(), arrivedAt: now, leavesAt: now + m.stayDays * 86400, stock: [] };
      report.merchant = record.merchant;
      report.lines.push(`A ${m.label.toLowerCase()} arrived (stays ${m.stayDays} day${m.stayDays === 1 ? "" : "s"}).`);
    }
  }

  /* 7. Visitor */
  if (!siege) {
    const v = rollVisitor(stats, record, rng);
    report.visitor = v;
    if (v.key !== "nobody") report.lines.push(`${v.label}: ${v.text}`);
    if (v.gp) {
      record.treasury += v.gp;
      report.lines.push(`They left ${v.gp} GP.`);
    }
  }

  /* 8. Neglect (DMG): no orders for consecutive turns equal to the owners' level */
  // Only a turn without orders counts (choosing Maintain is an order); any turn with orders starts the count again.
  const unordered = report.mode === "maintain" && !record.maintainChosen;
  record.neglect = unordered ? (record.neglect ?? 0) + 1 : 0;
  record.maintainChosen = false;
  const level = Math.max(1, Number(opts.partyLevel) || 5);
  const counts = rules.neglect && unordered && !stats.flags?.standingOrders;
  if (counts && record.neglect >= level) {
    report.neglected = true;
    report.lines.push("Neglected for too long: the hirelings have left.");
  } else if (counts && record.neglect === level - 1) report.lines.push("Warning: one more turn without orders and the hirelings leave.");

  /* 9. Clock and history */
  record.turn = { number: report.turn, lastTime: now };
  record.history = [{ turn: report.turn, time: now, mode: report.mode, lines: [...report.lines], income, upkeep, tax, dividend,
    treasury: record.treasury }, ...(record.history ?? [])].slice(0, 100);
  return { record, report };
}

/**
 * The GM finishes one project at once: it becomes a building (or a bigger room, an upgrade, a repair, wider grounds)
 * whatever its funding and progress. In place on `record`. Returns { ok, completed, lines, layoutChanged } like workDays.
 */
export function finishProject(record, projectId, opts = {}) {
  const p = record.projects?.[projectId];
  if (!p) return { ok: false, reason: "No such project" };
  if (["complete", "cancelled"].includes(p.state)) return { ok: false, reason: "Already closed" };
  const others = record.projects;
  // Only this project moves: give it the rest of its days on its own.
  record.projects = { [projectId]: { ...p, state: "building" } };
  const done = workDays(record, Math.max(1, (p.days ?? 0) - (p.progress ?? 0)), { ...opts, payAsYouBuild: false, crews: undefined });
  record.projects = { ...others, ...record.projects };
  return { ok: true, ...done };
}

/** The GM finishes every open project at once, in the order they were planned. Same result shape as workDays. */
export function finishAllProjects(record, opts = {}) {
  const out = { ok: true, completed: [], lines: [], layoutChanged: false };
  const open = Object.values(record.projects ?? {}).filter(p => !["complete", "cancelled"].includes(p.state)).map(p => p.id);
  for (const id of open) {
    const res = finishProject(record, id, opts);
    if (!res.ok) continue;
    out.completed.push(...res.completed);
    out.lines.push(...res.lines);
    if (res.layoutChanged) out.layoutChanged = true;
  }
  return out;
}

/**
 * Building work for `days` work days, in place on `record` (projects, features, grounds, layout). Shared by the turn
 * and the long-rest clock. Returns { completed: [{projectId, featureId, label, kind, expansionId}], started, requeued:
 * [{projectId, label}], lines, layoutChanged }. opts: { rules, catalog, now, newId, payAsYouBuild, crews } — with
 * `crews` (the Bastion's building crews) queued projects start when crews are free and no more than that many work.
 */
export function workDays(record, days, opts = {}) {
  const out = { completed: [], started: [], requeued: [], lines: [], layoutChanged: false };
  if (record.siege || !(days > 0)) return out;
  const newId = opts.newId ?? (() => Math.random().toString(36).slice(2, 18));
  const now = opts.now ?? 0;
  // With a crew count the work goes day by day, so a crew freed by a finished project picks up the next queued one.
  const crews = Number.isFinite(opts.crews) ? Math.max(1, opts.crews) : null;
  const assign = () => {
    if (crews === null) return;
    const res = assignCrews(record.projects, crews, { payAsYouBuild: opts.payAsYouBuild, now });
    record.projects = res.projects;
    for (const p of res.requeued) { out.requeued.push({ projectId: p.id, label: p.label }); out.lines.push(`Waiting for a crew: ${p.label}.`); }
    for (const p of res.started) {
      out.requeued = out.requeued.filter(r => r.projectId !== p.id);
      out.started.push({ projectId: p.id, label: p.label });
      out.lines.push(`Started: ${p.label}.`);
    }
  };
  assign();
  let left = days;
  let finished = 0;
  while (left > 0) {
    const step = crews === null ? left : Math.min(left, 1);
    left -= step;
    const { projects, completed } = advanceProjects(record.projects, step, { payAsYouBuild: opts.payAsYouBuild, now });
    record.projects = projects;
    for (const p of completed) {
      const res = applyCompletion(record.features, p, newId());
      record.features = res.features;
      if (res.grounds) record.grounds = res.grounds;
      out.completed.push({ projectId: p.id, featureId: res.featureId, label: p.label, kind: p.kind, expansionId: p.expansionId });
      out.lines.push(`Finished: ${p.label}.`);
    }
    finished += completed.length;
    if (completed.length && left > 0) assign();
    if (!Object.values(record.projects ?? {}).some(p => p?.state === "building")) break;
  }
  // A crew freed on the last day starts its next job straight away (it works from the next day).
  if (finished) assign();
  // New and grown buildings take their place on the map when they are finished, so later builds can't push them about.
  if (finished && opts.catalog) {
    const lay = syncLayout(record, opts.catalog, opts.rules);
    if (lay.changed) { record.layout = lay.layout; out.layoutChanged = true; }
  }
  return out;
}

/** Who moves away first when the Bastion can't feed them (record.people and record.garrison keys). */
export const LEAVE_ORDER = [["people", "refugees"], ["people", "guests"], ["garrison", "servants"], ["workers", "workers"],
  ["garrison", "guards"], ["garrison", "mercenaries"]];

/**
 * A turn's food (mutates the record): the stores take the day's balance; a shortfall is bought from the treasury at
 * stats.food.buyPrice a person-day; what the treasury can't buy leaves people unfed, and that many move away
 * (LEAVE_ORDER; workers who leave are counted in record.people.workersAway and come back on fed turns).
 */
export function feedBastion(record, stats, rules, { days, siege = false } = {}) {
  const out = { delta: 0, bought: 0, cost: 0, left: [], returned: 0, lines: [] };
  const daily = stats.food.inside + (siege ? 0 : stats.food.outside) - stats.food.perDay;
  const before = Number(record.food) || 0;
  let after = before + daily * days;
  record.hungry = false;
  if (after < 0) {
    const short = Math.ceil(-after);
    const price = siege ? Infinity : Math.max(0, Number(stats.food.buyPrice) || 0);
    const affordable = price > 0 ? Math.floor((record.treasury ?? 0) / price) : (Number.isFinite(price) ? short : 0);
    out.bought = Math.min(short, affordable);
    out.cost = Number.isFinite(price) ? Math.ceil(out.bought * price) : 0;
    record.treasury = Math.max(0, (record.treasury ?? 0) - out.cost);
    if (out.bought) out.lines.push(`The stores ran dry: ${out.bought} days of food bought for ${out.cost} GP.`);
    const unfed = short - out.bought;
    after = 0;
    if (unfed > 0) {
      record.hungry = true;
      out.lines.push("The stores are empty and the treasury can't buy more: people go hungry.");
      // Those who couldn't be fed all turn leave (not in a siege: nobody gets out).
      let leaving = siege ? 0 : Math.ceil(unfed / Math.max(1, days * (rules.foodPerPerson ?? 1)));
      record.people ??= {};
      record.garrison ??= {};
      for (const [where, key] of LEAVE_ORDER) {
        if (leaving <= 0) break;
        if (where === "workers") {
          const here = Math.max(0, (stats.people.workersNeeded ?? 0) - (Number(record.people.workersAway) || 0));
          const n = Math.min(here, leaving);
          if (n) { record.people.workersAway = (Number(record.people.workersAway) || 0) + n; out.left.push({ key, n }); leaving -= n; }
          continue;
        }
        const have = Math.max(0, Number(record[where][key]) || 0);
        const n = Math.min(have, leaving);
        if (n) { record[where][key] = have - n; out.left.push({ key, n }); leaving -= n; }
      }
      if (out.left.length) out.lines.push(`Moved away for want of food: ${out.left.map(l => `${l.n} ${l.key}`).join(", ")}.`);
    }
  }
  // Fed: workers who left come back, a share each turn.
  const away = Math.max(0, Number(record.people?.workersAway) || 0);
  if (!record.hungry && away > 0 && !siege) {
    out.returned = Math.min(away, Math.max(1, Math.ceil(away * (rules.workersReturn ?? 0.5))));
    record.people.workersAway = away - out.returned;
    out.lines.push(`${out.returned} workers came back.`);
  }
  record.food = Math.max(0, Math.min(stats.food.cap, after));
  out.delta = record.food - before;
  return out;
}
