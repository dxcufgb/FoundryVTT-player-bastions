import { ENLARGE, SIZES } from "../data/catalog.js";
import { TERRAINS, CLIMATES, DANGERS, RESOURCES } from "../data/location.js";
import { STRUCTURES } from "../data/structures.js";
import { prerequisites, sizeIndex } from "./catalog.js";
import { roomFor, projectSpace, extendGroundsBase } from "./grounds.js";
import { priceGp } from "./price.js";

/** Extending the grounds is a project like any other; this stands in for its catalog entry. */
export const GROUNDS_PROJECT = { id: "grounds", group: "fortifications", name: "Extend the grounds", unit: "flat" };

/**
 * Projects: quotes (cost and days), the state machine, funding and progress. Pure: every function returns a new
 * object or a patch and never touches Foundry.
 *
 * Project: { id, kind: "build"|"upgrade"|"enlarge"|"repair"|"grounds", expansionId, toGrounds?, walls?, featureId?, size?, count?, tier?, rush,
 *   extraCrews, enclosed?, cost, days, progress, funded, contributions: {actorId: gp}, state, createdBy, createdAt,
 *   startedAt, completedAt, label }
 * States: planned ⇄ queued → building ⇄ paused → complete (paused → queued too);  any → cancelled
 */
export const STATES = ["planned", "queued", "building", "paused", "complete", "cancelled"];

/**
 * Build pace presets. Adventures don't last years, so the default ("adventure") shrinks short jobs about tenfold and
 * long ones about twentyfold: big works bring more hands. Days here are work days; with the long-rest clock each
 * long rest is one work day.
 */
export const BUILD_PACES = {
  dmg: { scale: 1, power: 1 },
  campaign: { scale: 0.5, power: 0.85 },
  adventure: { scale: 0.21, power: 0.75 }
};

export { BUILD_PRICES, priceGp, samePrice } from "./price.js";

/** Base days at the given pace: round(scale × days^power), at least 1 (0 stays 0). */
export function paceDays(days, pace) {
  const d = Number(days) || 0;
  if (d <= 0) return 0;
  const scale = Number(pace?.scale) || 1;
  const power = Number(pace?.power) || 1;
  if (scale === 1 && power === 1) return d;
  return Math.max(1, Math.round(scale * Math.pow(d, power)));
}

/** The inverse of paceDays: the base days a paced number of days came from. */
export function unpaceDays(days, pace) {
  const d = Number(days) || 0;
  const scale = Number(pace?.scale) || 1;
  const power = Number(pace?.power) || 1;
  if (d <= 0 || (scale === 1 && power === 1)) return d;
  return Math.pow(d / scale, 1 / power);
}

const samePace = (a, b) => (Number(a?.scale) || 1) === (Number(b?.scale) || 1) && (Number(a?.power) || 1) === (Number(b?.power) || 1);

/**
 * Progress on a job that now takes `newDays` instead of `oldDays` (more or fewer crews, another build pace): the share
 * of the work still to do stays the same, and the days left round down (a job never goes from unfinished to finished,
 * so at least one day stays left). 2 of 8 done, then 3 crews on a 3-day job: 6/8 × 3 = 2.25 → 2 left, so 1 of 3 done.
 */
export function rescaleProgress(progress, oldDays, newDays) {
  const done = Math.max(0, Number(progress) || 0);
  if (!oldDays || newDays <= 0) return 0;
  if (done >= oldDays) return newDays;
  if (done <= 0) return 0;
  const left = Math.max(1, Math.floor((oldDays - done) / oldDays * newDays + 1e-9));
  return Math.max(0, newDays - left);
}

/**
 * Re-times the unfinished projects for a new build pace (projects from before paces existed were planned at the
 * DMG's). The share of the work still to do stays the same (`rescaleProgress`). Returns { projects, changed } with new objects.
 */
export function repaceProjects(projectsIn, pace) {
  const projects = structuredClone(projectsIn ?? {});
  let changed = false;
  for (const p of Object.values(projects)) {
    if (["complete", "cancelled"].includes(p.state)) continue;
    const from = p.pace ?? BUILD_PACES.dmg;
    if (samePace(from, pace)) continue;
    const oldDays = p.days;
    p.days = Math.max(1, paceDays(Math.round(unpaceDays(p.days, from)), pace));
    p.progress = rescaleProgress(p.progress, oldDays, p.days);
    p.pace = { scale: Number(pace?.scale) || 1, power: Number(pace?.power) || 1 };
    changed = true;
  }
  return { projects, changed };
}

/** What a project would cost and take now. opts: { kind, size, count, tier, rush, extraCrews, featureId } */
export function quote(record, exp, opts, stats, rules) {
  const kind = opts.kind ?? "build";
  const loc = record?.location ?? {};
  const structure = STRUCTURES[record?.structure?.type] ?? null;
  const parts = [];
  let cost = 0;
  let days = 0;
  let count = 1;

  if (kind === "grounds") {
    const b = opts.groundsBase;
    if (!b?.ok) return { ok: false, reason: b?.reason ?? "The grounds can't grow any further" };
    cost = b.cost; // priced per square in extendGroundsBase
    days = b.days;
    parts.push(...b.parts);
  } else if (kind === "enlarge") {
    const feature = record.features?.[opts.featureId];
    const step = ENLARGE[feature?.size];
    if (!step) return { ok: false, reason: "Can't be enlarged further" };
    cost = priceGp(step.cost, rules.price);
    days = step.days;
    parts.push({ label: `Enlarge ${feature.size} → ${step.to}`, value: cost });
  } else if (kind === "upgrade") {
    const feature = record.features?.[opts.featureId];
    const nextTier = (feature?.tier ?? 1) + 1;
    const t = exp.tiers?.[nextTier - 1];
    if (!t) return { ok: false, reason: "No further upgrade" };
    cost = priceGp(t.cost, rules.price);
    days = t.days;
    // A wall's upgrade is priced per square, along its whole length.
    if (exp.unit === "square") {
      count = Math.max(1, Number(feature.count) || 1);
      cost *= count;
      days *= count;
    }
    parts.push({ label: `Upgrade to ${t.label}${exp.unit === "square" ? ` (${count} squares)` : ""}`, value: cost });
  } else {
    const unit = exp.unit;
    if (unit === "sized") {
      const i = sizeIndex(opts.size ?? "cramped");
      cost = exp.cost[i];
      days = exp.days[i];
    } else if (exp.tiers?.length) {
      cost = exp.tiers[0].cost;
      days = exp.tiers[0].days;
    } else {
      cost = Array.isArray(exp.cost) ? exp.cost[0] : exp.cost;
      days = Array.isArray(exp.days) ? exp.days[0] : exp.days;
    }
    cost = priceGp(cost, rules.price);
    if (["square", "mile", "each"].includes(unit)) {
      count = Math.max(1, Math.floor(Number(opts.count) || 1));
      cost *= count;
      days *= count;
    }
    parts.push({ label: "Base", value: cost });
  }

  // What it's built of: an upgrade's own tier can change it (a palisade becomes a stone wall).
  const tierNow = kind === "upgrade" ? exp?.tiers?.[(record.features?.[opts.featureId]?.tier ?? 1)] : exp?.tiers?.[0];
  const material = tierNow?.material ?? exp?.material;

  // Cost factors
  const factors = [];
  if (exp?.group === "rooms" && structure?.effects?.roomCost) factors.push({ label: "Town land", mult: structure.effects.roomCost });
  if (stats?.materialFactor && stats.materialFactor !== 1) factors.push({ label: "Hauling (Accessibility)", mult: stats.materialFactor });
  const region = DANGERS[loc.danger]?.effects?.buildCost ?? 1;
  if (region !== 1) factors.push({ label: "Dangerous region", mult: region });
  if (material === "stone" && stats?.fx?.stoneDiscount) factors.push({ label: "Quarry or brickworks", mult: stats.fx.stoneDiscount });
  if (material === "timber" && stats?.fx?.timberDiscount) factors.push({ label: "Lumber camp", mult: stats.fx.timberDiscount });
  const wardCost = (loc.resources ?? []).reduce((m, r) => m * (RESOURCES[r]?.effects?.wardCost ?? 1), 1);
  if (material === "magic" && wardCost !== 1) factors.push({ label: "Magical site", mult: wardCost });
  if (kind === "repair") factors.push({ label: "Repair", mult: rules.repairMult });
  if (opts.rush) factors.push({ label: "Rush", mult: rules.rushCostMult });
  const extraCrews = Math.max(0, Math.min(rules.maxExtraCrews, Math.floor(Number(opts.extraCrews) || 0)));
  if (extraCrews) factors.push({ label: `${extraCrews} extra crew(s)`, mult: 1 + rules.extraCrewCostPct * extraCrews / 100 });
  if (rules.costMult && rules.costMult !== 1) factors.push({ label: "House rule", mult: rules.costMult });
  for (const f of factors) cost *= f.mult;
  cost = Math.round(cost);

  // Time factors
  days = paceDays(days, rules.pace);
  const terrainTime = TERRAINS[loc.terrain]?.effects?.buildTime ?? 1;
  const climateTime = CLIMATES[loc.climate]?.effects?.buildTime ?? 1;
  let timeMult = terrainTime * climateTime;
  if (material === "timber" && exp?.unit === "square" && stats?.fx?.palisadeTime) timeMult *= stats.fx.palisadeTime;
  if (kind === "repair") timeMult *= rules.repairMult;
  if (opts.rush) timeMult *= rules.rushTimeMult;
  // Each crew on the job shares the work; the Bastion's crew count only limits how many can be on it (core/crews.js).
  const crews = 1 + extraCrews;
  days = Math.max(1, Math.ceil(days * timeMult / crews - 1e-9));

  return { ok: true, cost, days, crews, count, parts, factors, extraCrews,
    price: { scale: Number(rules.price?.scale) || 1, power: Number(rules.price?.power) || 1 } };
}

/** Builds a planned project (not yet stored). Returns { ok, project } or { ok: false, reason }. */
export function planProject(record, catalog, stats, rules, opts, { id, userId, now = 0 }) {
  const kind = opts.kind ?? "build";
  if (kind === "grounds") return planGrounds(record, catalog, stats, rules, opts, { id, userId, now });
  let exp = catalog.get(opts.expansionId);
  if (kind !== "build") {
    const feature = record.features?.[opts.featureId];
    if (!feature) return { ok: false, reason: "No such building" };
    exp = catalog.get(feature.id);
    if (kind === "repair" && !feature.damaged) return { ok: false, reason: "Not damaged" };
    if (kind === "enlarge" && (exp?.unit !== "sized" || !ENLARGE[feature.size])) return { ok: false, reason: "Can't be enlarged" };
    if (kind === "upgrade" && !exp?.tiers?.[(feature.tier ?? 1)]) return { ok: false, reason: "No further upgrade" };
    if (Object.values(record.projects ?? {}).some(p => p.featureId === opts.featureId && !["complete", "cancelled"].includes(p.state))) {
      return { ok: false, reason: "That building already has a project" };
    }
  }
  if (!exp) return { ok: false, reason: "Unknown expansion" };
  if (kind === "build" && exp.legacy) return { ok: false, reason: "Build or upgrade the Wall instead" };
  // Rings round the grounds (the wall, the spike barricade) are built once and grow with the grounds.
  if (kind === "build" && exp.once && Object.values(record.features ?? {}).some(f => f?.id === exp.id)) {
    return { ok: false, reason: exp.tiers ? `The ${exp.name.toLowerCase()} is built: upgrade it instead` : `The ${exp.name.toLowerCase()} is built` };
  }
  if (kind === "build" && exp.once && Object.values(record.projects ?? {}).some(p => p.expansionId === exp.id && p.kind === "build"
    && !["complete", "cancelled"].includes(p.state))) return { ok: false, reason: "Already planned" };
  if (kind === "build") {
    const pre = prerequisites(record, exp, catalog, stats);
    if (!pre.ok) return { ok: false, reason: `Needs ${pre.missing.join(", ")}` };
    // One at a time: a one-off building, and each step of the road (a trail, a road, paving), which covers the route.
    if ((exp.unit === "flat" || exp.effects?.roadTier) && Object.values(record.projects ?? {}).some(p => p.expansionId === exp.id && p.kind === "build"
      && !["complete", "cancelled"].includes(p.state))) return { ok: false, reason: "Already planned" };
  }
  // Room inside the walls: a new building, a bigger room or a bigger tier needs free ground.
  const squares = projectSpace(record, catalog, {
    kind, expansionId: exp.id, featureId: opts.featureId, size: opts.size, count: opts.count,
    tier: kind === "upgrade" ? (record.features[opts.featureId].tier ?? 1) + 1 : 1
  });
  const room = roomFor(record, catalog, rules, squares);
  if (!room.ok) return { ok: false, reason: room.reason, full: true, need: room.need, free: room.free };
  const q = quote(record, exp, { ...opts, kind }, stats, rules);
  if (!q.ok) return q;
  const label = kind === "build" ? exp.name
    : kind === "upgrade" ? `${exp.name}: ${exp.tiers[(record.features[opts.featureId].tier ?? 1)].label}`
      : kind === "enlarge" ? `Enlarge ${exp.name}` : `Repair ${exp.name}`;
  return {
    ok: true,
    project: {
      id, kind, expansionId: exp.id, featureId: opts.featureId ?? null, size: opts.size ?? null, count: q.count,
      tier: kind === "upgrade" ? (record.features[opts.featureId].tier ?? 1) + 1 : 1,
      rush: !!opts.rush, extraCrews: q.extraCrews, enclosed: opts.enclosed !== false,
      cost: q.cost, days: q.days, pace: { ...(rules.pace ?? BUILD_PACES.dmg) }, price: q.price, progress: 0, funded: 0, contributions: {}, state: "planned",
      createdBy: userId ?? null, createdAt: now, startedAt: null, completedAt: null, label, squares
    }
  };
}

/** Plans extending the grounds one size: new land, and every built wall layer lengthened to the new perimeter. */
function planGrounds(record, catalog, stats, rules, opts, { id, userId, now }) {
  if (Object.values(record.projects ?? {}).some(p => p.kind === "grounds" && !["complete", "cancelled"].includes(p.state))) {
    return { ok: false, reason: "The grounds are already being extended" };
  }
  const base = extendGroundsBase(record, catalog, rules);
  if (!base.ok) return base;
  const q = quote(record, GROUNDS_PROJECT, { ...opts, kind: "grounds", groundsBase: base }, stats, rules);
  if (!q.ok) return q;
  return {
    ok: true,
    project: {
      id, kind: "grounds", expansionId: "grounds", featureId: null, size: null, count: 1, tier: 1,
      fromGrounds: base.from.key, toGrounds: base.to.key, walls: base.walls,
      rush: !!opts.rush, extraCrews: q.extraCrews, enclosed: true,
      cost: q.cost, days: q.days, pace: { ...(rules.pace ?? BUILD_PACES.dmg) }, price: q.price, progress: 0, funded: 0, contributions: {}, state: "planned",
      createdBy: userId ?? null, createdAt: now, startedAt: null, completedAt: null,
      label: `Extend the grounds: ${base.from.label} → ${base.to.label}`, squares: 0
    }
  };
}

/** Adds gold to a project. Returns { ok, project, accepted } (accepted may be less than offered: never over the cost). */
export function fund(project, amount, actorId) {
  if (["complete", "cancelled"].includes(project.state)) return { ok: false, reason: "Project is closed" };
  const offered = Math.max(0, Math.floor(Number(amount) || 0));
  const accepted = Math.min(offered, Math.max(0, project.cost - project.funded));
  if (!accepted) return { ok: false, reason: "Nothing to pay" };
  const p = structuredClone(project);
  p.funded += accepted;
  const key = actorId || "treasury";
  p.contributions[key] = (p.contributions[key] ?? 0) + accepted;
  return { ok: true, project: p, accepted };
}

/** GM transitions. action: "queue" | "start" | "pause" | "resume" | "cancel". */
export function transition(project, action, { payAsYouBuild = false, now = 0 } = {}) {
  const p = structuredClone(project);
  const s = p.state;
  const fail = reason => ({ ok: false, reason });
  switch (action) {
    case "queue":
      if (!["planned", "paused"].includes(s)) return fail(`Can't queue a ${s} project`);
      p.state = "queued";
      p.queuedAt = now;
      break;
    case "unqueue":
      if (s !== "queued") return fail("Only a queued project can leave the queue");
      p.state = "planned";
      delete p.queuePos;
      delete p.queuedAt;
      break;
    case "start":
      if (!["planned", "queued", "paused"].includes(s)) return fail(`Can't start a ${s} project`);
      if (!payAsYouBuild && p.funded < p.cost) return fail(`Not fully funded (${p.funded} / ${p.cost} GP)`);
      p.state = "building";
      p.startedAt ??= now;
      delete p.queuePos;
      break;
    case "pause":
      if (s !== "building") return fail("Only a running project can be paused");
      p.state = "paused"; break;
    case "resume":
      if (s !== "paused") return fail("Only a paused project can be resumed");
      p.state = "building"; break;
    case "cancel":
      if (["complete", "cancelled"].includes(s)) return fail("Already closed");
      p.state = "cancelled"; break;
    default: return fail("Unknown action");
  }
  return { ok: true, project: p };
}

/** Gold returned when a project is cancelled, split by who paid: { total, byPayer: {id: gp} }. */
export function cancelRefund(project, rules) {
  const spent = project.days ? project.cost * Math.min(1, project.progress / project.days) : 0;
  const spentOfFunded = Math.min(project.funded, spent);
  const total = Math.floor(project.funded - spentOfFunded + spentOfFunded * rules.cancelRefundPct / 100);
  const byPayer = {};
  let given = 0;
  const payers = Object.entries(project.contributions ?? {});
  payers.forEach(([id, gp], i) => {
    const share = i === payers.length - 1 ? total - given : Math.floor(total * gp / (project.funded || 1));
    byPayer[id] = share;
    given += share;
  });
  return { total, byPayer };
}

/**
 * Advances building projects by `days`. Returns { projects, completed: [project] } with new objects.
 * With pay-as-you-build a project only progresses as far as its funding covers.
 */
export function advanceProjects(projects, days, { payAsYouBuild = false, now = 0 } = {}) {
  const out = structuredClone(projects ?? {});
  const completed = [];
  for (const p of Object.values(out)) {
    if (p.state !== "building") continue;
    let cap = p.days;
    if (payAsYouBuild && p.cost > 0) cap = Math.floor(p.days * Math.min(1, p.funded / p.cost));
    p.progress = Math.min(cap, p.progress + days);
    if (p.progress >= p.days) {
      p.state = "complete";
      p.completedAt = now;
      completed.push(p);
    }
  }
  return { projects: out, completed };
}

/** Applies a finished project to the features. Returns { features, featureId, grounds? }. */
/** The old separate wall expansions and the Wall tier each one is now. */
export const LEGACY_WALL_TIER = { palisade: 1, "stone-wall": 2, "reinforce-wall": 3, "wall-walk": 4 };

/**
 * Folds the old separate Palisade, Stone Wall, Reinforce Stone Wall and Wall Walk into one Wall at the highest tier
 * built (old saves). Unfinished projects for them become Wall builds or upgrades. Returns { features, projects, changed }.
 */
export function foldLegacyWalls(featuresIn, projectsIn) {
  const features = structuredClone(featuresIn ?? {});
  const projects = structuredClone(projectsIn ?? {});
  let changed = false;
  const legacy = Object.entries(features).filter(([, f]) => LEGACY_WALL_TIER[f?.id] && f.enclosed !== false);
  let wallEntry = Object.entries(features).find(([, f]) => f?.id === "wall");
  if (legacy.length) {
    const tier = Math.max(wallEntry?.[1].tier ?? 0, ...legacy.map(([, f]) => LEGACY_WALL_TIER[f.id]));
    const count = Math.max(Number(wallEntry?.[1].count) || 0, ...legacy.map(([, f]) => Number(f.count) || 0));
    // Keep the most important feature's id (the stone wall's, else the first) so links to it stay good.
    const keep = wallEntry ?? legacy.find(([, f]) => f.id === "stone-wall") ?? legacy[0];
    for (const [fid] of legacy) if (fid !== keep[0]) delete features[fid];
    features[keep[0]] = { ...keep[1], id: "wall", tier, count, damaged: legacy.some(([, f]) => f.damaged) || keep[1].damaged || undefined };
    if (features[keep[0]].damaged === undefined) delete features[keep[0]].damaged;
    wallEntry = [keep[0], features[keep[0]]];
    changed = true;
  }
  for (const p of Object.values(projects)) {
    const tier = LEGACY_WALL_TIER[p.expansionId];
    if (!tier || ["complete", "cancelled"].includes(p.state)) continue;
    const label = ["Palisade", "Stone wall", "Reinforced stone wall", "Wall walk and crenellations"][tier - 1];
    if (wallEntry && p.kind === "build") {
      Object.assign(p, { kind: "upgrade", expansionId: "wall", featureId: wallEntry[0], tier: Math.max(tier, (wallEntry[1].tier ?? 1) + 1),
        count: wallEntry[1].count ?? p.count, label: `Wall: ${label}` });
    } else Object.assign(p, { expansionId: "wall", tier, label: `Wall: ${label}`, featureId: p.kind === "build" ? null : wallEntry?.[0] ?? p.featureId });
    changed = true;
  }
  return { features, projects, changed };
}

/** Road steps that end a Hidden Approach: a road leads anyone straight to the Bastion. */
export const ROADS_END_HIDDEN = ["build-road", "pave-road"];

/**
 * A finished road also ends any Hidden Approach still planned or under way: it could never be built beside the road.
 * Those projects are cancelled like a cancel by the party (cancelRefund: unspent funding back, a share of what was
 * spent): the treasury's share goes back into the treasury, the characters' shares are owed in refundsDue
 * ({ actorId: gp }, kept until the Foundry side has paid each one). The record isn't changed: returns
 * { projects, treasury, refundsDue, cancelled: [{projectId, label, refunded}], refunds: { actorId: gp }, lines }.
 */
export function cancelHiddenApproach(record, rules = {}) {
  const projects = { ...(record?.projects ?? {}) };
  let treasury = Number(record?.treasury) || 0;
  const refundsDue = { ...(record?.refundsDue ?? {}) };
  const out = { cancelled: [], refunds: {}, lines: [] };
  for (const p of Object.values(projects)) {
    if (p?.expansionId !== "hidden-approach" || ["complete", "cancelled"].includes(p.state)) continue;
    const res = transition(p, "cancel");
    if (!res.ok) continue;
    const refund = cancelRefund(p, { cancelRefundPct: rules.cancelRefundPct ?? 50 });
    for (const [payer, gold] of Object.entries(refund.byPayer)) {
      if (payer === "treasury") treasury += gold;
      else if (gold > 0) {
        out.refunds[payer] = (out.refunds[payer] ?? 0) + gold;
        refundsDue[payer] = (Number(refundsDue[payer]) || 0) + gold;
      }
    }
    res.project.refunded = refund.total;
    res.project.cancelledBy = "road";
    delete res.project.queuePos;
    projects[p.id] = res.project;
    out.cancelled.push({ projectId: p.id, label: p.label, refunded: refund.total });
    out.lines.push(`Cancelled: ${p.label} (the road leads straight to the Bastion now; ${refund.total} GP back).`);
  }
  return { projects, treasury, refundsDue, ...out };
}

export function applyCompletion(featuresIn, project, newId) {
  const features = structuredClone(featuresIn ?? {});
  if (project.kind === "grounds") {
    // The walls grow with the grounds: each built layer gets the extra squares.
    for (const [id, extra] of Object.entries(project.walls ?? {})) {
      const f = Object.values(features).find(x => x?.id === id && x.enclosed !== false);
      if (f) f.count = (Number(f.count) || 0) + extra;
    }
    return { features, featureId: null, grounds: project.toGrounds };
  }
  if (project.kind === "build" && (LEGACY_WALL_TIER[project.expansionId] || project.expansionId === "wall")) {
    // One wall: building it again (or an old save's separate wall project) raises the existing wall instead.
    const wall = Object.entries(features).find(([, x]) => x?.id === "wall");
    const tier = LEGACY_WALL_TIER[project.expansionId] ?? project.tier ?? 1;
    if (wall) {
      wall[1].tier = Math.max(wall[1].tier ?? 1, tier);
      return { features, featureId: wall[0] };
    }
    const f = { id: "wall", builtAt: project.completedAt, tier, count: project.count };
    if (project.enclosed === false) f.enclosed = false;
    features[newId] = f;
    return { features, featureId: newId };
  }
  if (project.kind === "build") {
    // A road to the Bastion ends the Hidden Approach.
    const removed = [];
    if (ROADS_END_HIDDEN.includes(project.expansionId)) {
      for (const [fid, x] of Object.entries(features)) if (x?.id === "hidden-approach") { delete features[fid]; removed.push(fid); }
    }
    const f = { id: project.expansionId, builtAt: project.completedAt };
    if (project.size) f.size = project.size;
    if (project.count && project.count > 1) f.count = project.count;
    else if (project.count) f.count = project.count;
    f.tier = 1;
    if (project.enclosed === false) f.enclosed = false;
    features[newId] = f;
    return { features, featureId: newId, removed };
  }
  const f = features[project.featureId];
  if (!f) return { features, featureId: null };
  if (project.kind === "upgrade") f.tier = project.tier;
  if (project.kind === "enlarge") f.size = SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(f.size) + 1)];
  if (project.kind === "repair") delete f.damaged;
  return { features, featureId: project.featureId };
}
