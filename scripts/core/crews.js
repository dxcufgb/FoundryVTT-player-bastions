/**
 * Building crews. A Bastion starts with one crew, hires more (record.garrison.crews) and gets one from each Workers'
 * Lodge. Every running project ("building") takes 1 + its extraCrews of them, and no more can be at work than the
 * Bastion has. A queued project waits for a free crew and starts by itself, in the party's queue order (queuePos).
 * Pure: no Foundry calls.
 */

const OPEN = ["planned", "queued", "building", "paused"];

/** The crews one project works with. */
export function projectTeams(p) {
  return 1 + Math.max(0, Math.floor(Number(p?.extraCrews) || 0));
}

/** Crews at work on running projects, leaving out one project (the one being changed). */
export function crewsInUse(projects, exceptId) {
  return Object.values(projects ?? {}).reduce((n, p) => n + (p?.state === "building" && p.id !== exceptId ? projectTeams(p) : 0), 0);
}

/** { total, used, free, hired, lodge, over } — total = 1 + hired + crews from buildings. */
export function crewStatus(record, stats) {
  const hired = Math.max(0, Math.floor(Number(record?.garrison?.crews) || 0));
  const total = Math.max(1, stats?.crews ?? 1 + hired);
  const used = crewsInUse(record?.projects);
  return { total, used, free: Math.max(0, total - used), hired, lodge: Math.max(0, total - 1 - hired), over: used > total };
}

/**
 * Whether a project can run with `teams` crews: the crews the other running projects have plus these must fit.
 * Returns { ok } or { ok: false, reason, free }.
 */
export function canAssign(record, stats, projectId, teams) {
  const { total } = crewStatus(record, stats);
  const free = total - crewsInUse(record?.projects, projectId);
  if (teams > total) return { ok: false, code: "tooMany", free, total, reason: `The Bastion has only ${total} building crew${total === 1 ? "" : "s"}` };
  if (teams > free) {
    return { ok: false, code: free > 0 ? "short" : "busy", free, total, reason: free > 0
      ? `Only ${free} building crew${free === 1 ? " is" : "s are"} free`
      : "Every building crew is busy: queue it, or hire another crew" };
  }
  return { ok: true, free, total };
}

/**
 * Queued projects in the order they wait: by the party's queue position (queuePos), then first queued first. A project
 * without a position (older saves) goes after those with one.
 */
export function queueOrder(projects) {
  const pos = p => (Number.isFinite(p.queuePos) ? p.queuePos : Infinity);
  return Object.values(projects ?? {}).filter(p => p?.state === "queued")
    .sort((a, b) => pos(a) - pos(b) || (a.queuedAt ?? a.createdAt ?? 0) - (b.queuedAt ?? b.createdAt ?? 0)
      || String(a.id).localeCompare(String(b.id)));
}

/** The queue position for a project joining the end of the queue. */
export function nextQueuePos(projects) {
  return queueOrder(projects).reduce((m, p) => Math.max(m, Number.isFinite(p.queuePos) ? p.queuePos : 0), 0) + 1;
}

/**
 * Moves a queued project in the queue: `to` is "up", "down", "first", "last" or a 0-based index. Every queued
 * project gets a fresh position 1..n. Returns { ok, projects } (new objects) or { ok: false, reason }.
 */
export function moveInQueue(projectsIn, projectId, to) {
  const projects = structuredClone(projectsIn ?? {});
  const order = queueOrder(projects);
  const i = order.findIndex(p => p.id === projectId);
  if (i < 0) return { ok: false, reason: "That project isn't in the queue" };
  let j = to === "up" ? i - 1 : to === "down" ? i + 1 : to === "first" ? 0 : to === "last" ? order.length - 1 : Math.floor(Number(to));
  if (!Number.isFinite(j)) return { ok: false, reason: "Unknown place in the queue" };
  j = Math.max(0, Math.min(order.length - 1, j));
  const [p] = order.splice(i, 1);
  order.splice(j, 0, p);
  order.forEach((q, n) => { projects[q.id].queuePos = n + 1; });
  return { ok: true, projects, moved: j !== i };
}

/**
 * Puts the crews to work. If more crews are at work than the Bastion has (it lost a Workers' Lodge, an old save),
 * the projects started last go back to the queue. Then queued projects start, first queued first, while there are
 * crews for them; a queued project that isn't paid for yet (unless pay-as-you-build) waits without holding up the
 * ones behind it. Returns { projects, started: [project], requeued: [project] } with new objects.
 */
export function assignCrews(projectsIn, total, { payAsYouBuild = false, now = 0 } = {}) {
  const projects = structuredClone(projectsIn ?? {});
  const started = [];
  const requeued = [];
  const running = Object.values(projects).filter(p => p?.state === "building")
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || String(a.id).localeCompare(String(b.id)));
  let used = running.reduce((n, p) => n + projectTeams(p), 0);
  // Sent back to the head of the queue: they were already under way.
  let head = queueOrder(projects).reduce((m, q) => Math.min(m, Number.isFinite(q.queuePos) ? q.queuePos : m), 1);
  while (used > total && running.length) {
    const p = running.pop();
    used -= projectTeams(p);
    p.state = "queued";
    p.queuedAt = now;
    p.queuePos = --head;
    requeued.push(p);
  }
  for (const p of queueOrder(projects)) {
    if (requeued.includes(p)) continue;
    const teams = projectTeams(p);
    if (used + teams > total) continue;
    if (!payAsYouBuild && (p.funded ?? 0) < (p.cost ?? 0)) continue;
    p.state = "building";
    p.startedAt ??= now;
    delete p.queuePos;
    used += teams;
    started.push(p);
  }
  return { projects, started, requeued };
}

/** Whether the hired crews can go down to `hired` without leaving running projects short. */
export function canDismiss(record, stats, hired) {
  const s = crewStatus(record, stats);
  const total = s.total - (s.hired - hired);
  if (hired < 0) return { ok: false, reason: "No hired crews to dismiss" };
  if (total < s.used) return { ok: false, reason: `${s.used} crew${s.used === 1 ? " is" : "s are"} at work: pause a project first` };
  return { ok: true };
}

/** Open (not finished or cancelled) projects. */
export function openProjects(projects) {
  return Object.values(projects ?? {}).filter(p => OPEN.includes(p?.state));
}
