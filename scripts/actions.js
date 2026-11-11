import { MODULE_ID, rules, catalog, randomId, now, setting, t, SECONDS_PER_DAY, gp, escapeHTML, bastionNow } from "./util.js";
import { payFromPurse } from "./core/coins.js";
import { getEntry, getRecord, patchRecord, createBastionEntry, canAct, ownerActors, ownershipFor, bastionForActor } from "./store.js";
import { statsFor } from "./context.js";
import { createRecord } from "./core/record.js";
import { planProject as corePlan, fund as coreFund, transition, cancelRefund } from "./core/projects.js";
import { assignCrews, canAssign, canDismiss, crewStatus, crewsInUse, projectTeams, nextQueuePos, moveInQueue } from "./core/crews.js";
import { quoteDispatch, orderCount } from "./core/dispatch.js";
import { holdout } from "./core/siege.js";
import { FORCES, DISPATCH_METHODS } from "./data/tables.js";
import { placeMarker, partyDistance } from "./marker.js";
import { rollDice } from "./core/visitors.js";
import { runTurn, runSiegeDay, runRest, runFinish, runFinishAll } from "./turn-runner.js";
import { resolveEventChoice } from "./events.js";
import { canTakeFacility } from "./core/sections.js";
import { transitionRoute, canAcceptRoute, makeRequest, tradeCandidates } from "./core/trade.js";
import { tradeSettlements, createRouteQuest, closeRouteQuest } from "./trade.js";

/**
 * GM-side actions. Every handler gets (data, user) and re-checks the user's rights, because players reach them over
 * the socket. They return { ok, ... } or { ok: false, reason }.
 */

/**
 * Starts queued projects that now have crews (see core/crews.js), writing them into `changes` (a project already in
 * `changes`, under `changedId`, is taken from there). Returns the projects that started.
 */
function startWaiting(projects, total, changes, changedId) {
  if (crewsInUse(projects) >= total) return [];
  const res = assignCrews(projects, total, { payAsYouBuild: !!setting("payAsYouBuild"), now: now() });
  // Only start waiting projects here: one that's over the count stays until the next day of work sorts it.
  for (const p of res.started) changes[`projects.${p.id}`] = p;
  if (changedId && !res.started.some(p => p.id === changedId)) changes[`projects.${changedId}`] = projects[changedId];
  return res.started;
}

function load(entryId) {
  const entry = getEntry(entryId);
  const record = getRecord(entry);
  if (!entry || !record) throw new Error("No such Bastion");
  return { entry, record };
}

function gmOnly(user) {
  if (!user.isGM) throw new Error("GM only");
}

function ownerOnly(record, user) {
  if (!canAct(record, user)) throw new Error("Not your Bastion");
}

/** Takes gold from a character, using the system's currency manager when there is one (makes change from other coins). */
async function takeGold(actor, amount) {
  // Prices below 1 GP are real (a sack is 1 CP): work in copper so nothing rounds down to free.
  const copper = Math.max(0, Math.round((Number(amount) || 0) * 100));
  if (!copper) return true;
  const CM = dnd5e?.applications?.CurrencyManager;
  if (copper % 100 === 0 && CM?.deductActorCurrency) {
    try {
      await CM.deductActorCurrency(actor, copper / 100, "gp", { recursive: true, priority: "high" });
      return true;
    } catch { /* fall back to paying from the purse with change */ }
  }
  const purse = payFromPurse(actor.system?.currency ?? {}, copper);
  if (!purse) return false;
  await actor.update({ "system.currency": purse });
  return true;
}

async function giveGold(actor, amount) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!amount || !actor) return;
  await actor.update({ "system.currency.gp": (actor.system?.currency?.gp ?? 0) + amount });
}

function actorFor(record, actorId, user) {
  const actor = game.actors.get(actorId);
  if (!actor) throw new Error("No such character");
  if (!user.isGM && !actor.testUserPermission(user, "OWNER")) throw new Error("Not your character");
  if (!ownerActors(record, { includeGroup: true }).some(a => a.id === actor.id)) throw new Error("Not an owner of this Bastion");
  return actor;
}

export const ACTIONS = {
  /** Founds a Bastion from the wizard's answers. */
  async found(data, user) {
    gmOnly(user);
    const record = createRecord(data.answers, { newId: randomId, now: now(), catalog: catalog(), rules: rules() });
    const entry = await createBastionEntry(record);
    if (data.answers.marker?.sceneUuid) {
      const marker = await placeMarker(entry, record, data.answers.marker);
      await patchRecord(entry, { marker });
    }
    Hooks.callAll(`${MODULE_ID}.founded`, entry, getRecord(entry));
    return { ok: true, entryId: entry.id };
  },

  async moveMarker({ entryId, sceneUuid, x, y }, user) {
    gmOnly(user);
    const { entry, record } = load(entryId);
    const marker = await placeMarker(entry, record, { sceneUuid, x, y });
    await patchRecord(entry, { marker });
    return { ok: true, marker };
  },

  async updateRecord({ entryId, changes }, user) {
    gmOnly(user);
    const { entry } = load(entryId);
    const before = getRecord(entry);
    await patchRecord(entry, changes);
    if (changes.ownerUuids || changes.groupUuid) await entry.update({ ownership: ownershipFor(getRecord(entry)) });
    // A new map ground (or terrain) redraws an existing battle map.
    if (("mapGround" in changes && (changes.mapGround ?? null) !== (before.mapGround ?? null))
      || (changes.location?.terrain && changes.location.terrain !== before.location?.terrain)) {
      Hooks.callAll(`${MODULE_ID}.mapLookChanged`, { entryId: entry.id });
    }
    return { ok: true };
  },

  /**
   * GM: delete a Bastion for good: its record, its marker on the world map, its battle map scene and the room
   * facilities it added to the owners' sheets. `confirm` must be "DELETE" (the GM typed it).
   */
  async deleteBastion({ entryId, confirm }, user) {
    gmOnly(user);
    if (confirm !== "DELETE") return { ok: false, reason: t("Delete.NotConfirmed") };
    const { entry, record } = load(entryId);
    if (record.marker?.sceneUuid && record.marker?.noteId) {
      const note = await fromUuid(`${record.marker.sceneUuid}.Note.${record.marker.noteId}`);
      await note?.delete();
    }
    if (record.map?.sceneUuid) await (await fromUuid(record.map.sceneUuid))?.delete();
    for (const actor of game.actors) {
      const ids = actor.items.filter(i => i.getFlag(MODULE_ID, "entryId") === entry.id).map(i => i.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
    }
    Hooks.callAll(`${MODULE_ID}.bastionDeleted`, { entryId: entry.id, name: record.name });
    // The owners' (and former owners') system Bastion name showed this Bastion's name: clear it again, unless another
    // Bastion has them now.
    const { forgetBastionNames } = await import("./apps/bastion-tab.js");
    const named = forgetBastionNames(entry.id, record.name);
    const actors = new Map(ownerActors(record).map(a => [a.id, a]));
    for (const id of named.actors) if (!actors.has(id) && game.actors.get(id)) actors.set(id, game.actors.get(id));
    for (const actor of actors.values()) {
      const other = bastionForActor(actor);
      if (other && other.id !== entry.id) continue;
      if (actor.type === "character" && actor.system?.bastion?.name === record.name) await actor.update({ "system.bastion.name": "" });
    }
    await entry.delete();
    return { ok: true };
  },

  /* ---------------- Projects ---------------- */
  async planProject({ entryId, opts }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    const { stats } = statsFor(record);
    const id = randomId();
    const res = corePlan(record, catalog(), stats, rules(), opts, { id, userId: user.id, now: now() });
    if (!res.ok) return res;
    const changes = { [`projects.${id}`]: res.project };
    // Bastions from before grounds existed keep the size they have now from here on.
    if (!record.grounds && stats.grounds?.key) changes.grounds = stats.grounds.key;
    await patchRecord(entry, changes);
    Hooks.callAll(`${MODULE_ID}.projectStateChanged`, entry, res.project, null, "planned");
    return { ok: true, projectId: id };
  },

  async removeProject({ entryId, projectId }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    const p = record.projects?.[projectId];
    if (!p) return { ok: false, reason: "No such project" };
    if (!user.isGM && (p.state !== "planned" || p.funded > 0 || p.createdBy !== user.id)) {
      return { ok: false, reason: t("Notify.OnlyOwnUnfunded") };
    }
    await patchRecord(entry, { [`projects.${projectId}`]: undefined });
    return { ok: true };
  },

  /** Pays into a project from a character (actorId) or from the Bastion treasury (from: "treasury"). */
  async fundProject({ entryId, projectId, amount, actorId, from }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    const p = record.projects?.[projectId];
    if (!p) return { ok: false, reason: "No such project" };
    const want = Math.min(Math.max(0, Math.floor(Number(amount) || 0)), Math.max(0, p.cost - p.funded));
    if (!want) return { ok: false, reason: t("Notify.NothingToPay") };
    const changes = {};
    let payer = "treasury";
    if (from === "treasury") {
      if ((record.treasury ?? 0) < want) return { ok: false, reason: t("Notify.TreasuryShort") };
      changes.treasury = record.treasury - want;
    } else {
      if (record.presence !== "present" && !user.isGM) return { ok: false, reason: t("Notify.AwayUseDispatch") };
      const actor = actorFor(record, actorId, user);
      if (!(await takeGold(actor, want))) return { ok: false, reason: t("Notify.NotEnoughGold") };
      payer = actor.id;
    }
    const res = coreFund(p, want, payer);
    if (!res.ok) return res;
    changes[`projects.${projectId}`] = res.project;
    // A queued project that's now paid for starts if a crew is free.
    if (res.project.state === "queued") startWaiting({ ...record.projects, [projectId]: res.project }, statsFor(record).stats.crews, changes, projectId);
    await patchRecord(entry, changes);
    return { ok: true, accepted: res.accepted };
  },

  /**
   * GM: queue / start / pause / resume / cancel, and how many crews work on it. A project only starts (or takes more
   * crews) when the Bastion has the crews free; a queued one starts by itself when a crew comes free.
   */
  async construction({ entryId, projectId, action, extraCrews }, user) {
    gmOnly(user);
    const { entry, record } = load(entryId);
    let p = record.projects?.[projectId];
    if (!p) return { ok: false, reason: "No such project" };
    const changes = {};
    if (action === "crews") action = undefined; // older callers sent the crews op as an action
    if (extraCrews !== undefined && ["complete", "cancelled"].includes(p.state)) {
      return { ok: false, reason: t("Notify.CrewsLocked") };
    }
    const { stats } = statsFor(record);
    const crewFail = chk => ({ ok: false, code: chk.code, reason: t(`Notify.Crews.${chk.code}`, { free: chk.free, total: chk.total }) });
    if (extraCrews !== undefined) {
      const want = Math.max(0, Math.min(rules().maxExtraCrews, Math.floor(Number(extraCrews) || 0)));
      const teams = 1 + want;
      const chk = canAssign(record, stats, p.id, teams);
      // A running project needs the crews free now; a waiting one only needs the Bastion to have that many.
      if (!chk.ok && (p.state === "building" || chk.code === "tooMany")) return crewFail(chk);
      const { quote, GROUNDS_PROJECT } = await import("./core/projects.js");
      const grounds = p.kind === "grounds";
      const exp = grounds ? GROUNDS_PROJECT : catalog().get(p.expansionId);
      const groundsBase = grounds ? (await import("./core/grounds.js")).extendGroundsBase(record, catalog(), rules()) : undefined;
      const q = quote(record, exp, { kind: p.kind, size: p.size, count: p.count, featureId: p.featureId, rush: p.rush, extraCrews: want,
        groundsBase }, stats, rules());
      if (q.ok) {
        // Work already done keeps its share of the job.
        const share = p.days ? Math.min(1, (p.progress ?? 0) / p.days) : 0;
        p = { ...p, extraCrews: q.extraCrews, cost: Math.max(q.cost, p.funded), days: q.days, pace: { ...rules().pace }, price: q.price };
        p.progress = Math.min(p.days, Math.floor(share * p.days + 1e-9));
      }
    }
    if (action) {
      const from = p.state;
      if (["start", "resume"].includes(action)) {
        const chk = canAssign({ ...record, projects: { ...record.projects, [p.id]: p } }, stats, p.id, projectTeams(p));
        if (!chk.ok) return crewFail(chk);
      }
      const res = transition(p, action, { payAsYouBuild: !!setting("payAsYouBuild"), now: now() });
      if (!res.ok) return res;
      p = res.project;
      // Joins the end of the party's queue.
      if (action === "queue") p.queuePos = nextQueuePos(Object.fromEntries(Object.entries(record.projects).filter(([id]) => id !== p.id)));
      if (action === "cancel") {
        const refund = cancelRefund(p, rules());
        for (const [payer, gold] of Object.entries(refund.byPayer)) {
          if (payer === "treasury") changes.treasury = (changes.treasury ?? record.treasury ?? 0) + gold;
          else await giveGold(game.actors.get(payer), gold);
        }
        p.refunded = refund.total;
      }
      Hooks.callAll(`${MODULE_ID}.projectStateChanged`, entry, p, from, p.state);
    }
    changes[`projects.${projectId}`] = p;
    // Crews freed (a pause, a cancel, fewer crews) or a project queued: queued projects start if crews are free.
    const started = startWaiting({ ...record.projects, [projectId]: p }, stats.crews, changes, projectId);
    await patchRecord(entry, changes);
    for (const s of started) Hooks.callAll(`${MODULE_ID}.projectStateChanged`, entry, s, "queued", "building");
    return { ok: true, project: changes[`projects.${projectId}`], started: started.map(s => s.id) };
  },

  /**
   * The party's build queue (owners and the GM): op "add" puts a planned project at the end of the queue, "remove" takes
   * a queued one back out, "up" / "down" / "first" / "last" move it. Queued projects start by themselves, in this
   * order, as soon as a crew is free and they are paid for, so the next one starts the moment one is done.
   */
  /** Adds one of the system's special facilities defined in the world to an owner's sheet (level and slots checked). */
  async addSystemFacility({ entryId, uuid, actorId }, user) {
    const { record } = load(entryId);
    ownerOnly(record, user);
    const actor = actorFor(record, actorId, user);
    // Only a catalog source the sender can see: a world item or an item in a compendium, never one on an actor.
    if (typeof uuid !== "string") return { ok: false, reason: t("Fac.Need.NotFacility") };
    const parsed = foundry.utils.parseUuid(uuid);
    const pack = uuid.startsWith("Compendium.") ? game.packs.get(parsed?.collection?.collection ?? "") ?? null : null;
    if (uuid.startsWith("Compendium.") && !pack) return { ok: false, reason: t("Fac.Need.NotFacility") };
    if (!parsed || parsed.embedded?.length || parsed.documentType !== "Item") return { ok: false, reason: t("Fac.Need.NotFacility") };
    if (pack && !pack.testUserPermission(user, "OBSERVER")) return { ok: false, reason: t("Fac.Need.NotFacility") };
    const item = await fromUuid(uuid);
    if (item?.type !== "facility" || item.system?.type?.value !== "special" || item.parent) return { ok: false, reason: t("Fac.Need.NotFacility") };
    if (!pack && !item.testUserPermission(user, "LIMITED")) return { ok: false, reason: t("Fac.Need.NotFacility") };
    const level = actor.system?.details?.level ?? 0;
    const facilities = (actor.itemTypes?.facility ?? []).map(i => ({ type: i.system.type?.value, subtype: i.system.type?.subtype,
      name: i.name, free: !!i.system.free }));
    const check = canTakeFacility({ level, facilities }, { name: item.name, subtype: item.system.type?.subtype, level: item.system.level, free: !!item.system.free },
      CONFIG.DND5E?.facilities?.advancement?.special ?? {});
    if (!check.ok) {
      const reason = check.reason === "level" ? t("Fac.Need.Level", { level: item.system.level })
        : check.reason === "have" ? t("Fac.Need.Have") : t("Fac.Need.Slots", { used: check.used, max: check.max });
      return { ok: false, reason };
    }
    const data = item.toObject();
    delete data._id;
    data._stats = { ...(data._stats ?? {}), compendiumSource: item.pack ? item.uuid : (data._stats?.compendiumSource ?? null) };
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.entryId`, entryId);
    const [created] = await actor.createEmbeddedDocuments("Item", [data]);
    return { ok: !!created, name: item.name, actor: actor.name };
  },

  /* ---------------- Trade routes ---------------- */

  /** Owners answer a settlement's request (accept / decline), withdraw an accepted one, or cancel an active route. */
  async tradeRoute({ entryId, routeId, op }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    if (!["accept", "decline", "withdraw", "cancel"].includes(op)) return { ok: false, reason: "Unknown trade-route operation" };
    const route = record.tradeRoutes?.[routeId];
    if (!route) return { ok: false, reason: t("Trade.Gone") };
    const turn = record.turn?.number ?? 0;
    if (op === "accept") {
      const { stats } = statsFor(record);
      if (!canAcceptRoute(record, stats.trade.capacity)) return { ok: false, reason: t("Trade.Full", { n: stats.trade.capacity }) };
    }
    const res = transitionRoute(route, op, { turn });
    if (!res.ok) return { ok: false, reason: t("Trade.WrongState") };
    if (res.ended) {
      await patchRecord(entry, { [`tradeRoutes.${routeId}`]: undefined });
      if (op === "withdraw") await closeRouteQuest(route, "failed");
      Hooks.callAll(`${MODULE_ID}.tradeRouteEnded`, entry, { ...route, ended: res.route.ended });
      return { ok: true };
    }
    // Accepted: the party travels there to sign, followed by a quest in Dxcufgb's Quest Log when it is active.
    const next = res.route;
    next.questId = await createRouteQuest(record, next);
    await patchRecord(entry, { [`tradeRoutes.${routeId}`]: next });
    Hooks.callAll(`${MODULE_ID}.tradeRouteAccepted`, entry, next);
    return { ok: true, questId: next.questId };
  },

  /** The GM signs an accepted route once the party has been there: the setup is paid from the treasury (or waived). */
  async signTradeRoute({ entryId, routeId, from = "treasury" }, user) {
    gmOnly(user);
    const { entry, record } = load(entryId);
    const route = record.tradeRoutes?.[routeId];
    if (!route) return { ok: false, reason: t("Trade.Gone") };
    const res = transitionRoute(route, "sign", { turn: record.turn?.number ?? 0 });
    if (!res.ok) return { ok: false, reason: t("Trade.WrongState") };
    const changes = { [`tradeRoutes.${routeId}`]: res.route };
    if (from !== "free") {
      if ((record.treasury ?? 0) < (route.setup ?? 0)) return { ok: false, reason: t("Notify.TreasuryShort") };
      changes.treasury = (record.treasury ?? 0) - (route.setup ?? 0);
    }
    await patchRecord(entry, changes);
    await closeRouteQuest(route, "completed");
    Hooks.callAll(`${MODULE_ID}.tradeRouteSigned`, entry, res.route);
    return { ok: true };
  },

  /** The GM makes a settlement ask for a route now (key from tradeSettlements; goods optional, else rolled). */
  async requestTradeRoute({ entryId, key, goods }, user) {
    gmOnly(user);
    const { entry, record } = load(entryId);
    const settlement = tradeCandidates(record, tradeSettlements(record), { ...rules(), tradeMaxMiles: Infinity }).find(s => s.key === key);
    if (!settlement) return { ok: false, reason: t("Trade.NoSettlement") };
    const { stats } = statsFor(record);
    const id = randomId();
    const route = makeRequest(settlement, stats, rules(), { turn: record.turn?.number ?? 0, id, goods });
    await patchRecord(entry, { [`tradeRoutes.${id}`]: route });
    Hooks.callAll(`${MODULE_ID}.tradeRouteRequested`, entry, route);
    return { ok: true, routeId: id };
  },

  async queueProject({ entryId, projectId, op }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    const p = record.projects?.[projectId];
    if (!p) return { ok: false, reason: "No such project" };
    const changes = {};
    let projects = record.projects;
    if (op === "add" || op === "remove") {
      if (op === "add" && p.state !== "planned") return { ok: false, reason: t("Notify.Queue.notPlanned") };
      const res = transition(p, op === "add" ? "queue" : "unqueue", { now: now() });
      if (!res.ok) return { ok: false, reason: op === "remove" ? t("Notify.Queue.notQueued") : res.reason };
      if (op === "add") res.project.queuePos = nextQueuePos(record.projects);
      projects = { ...record.projects, [projectId]: res.project };
      changes[`projects.${projectId}`] = res.project;
      Hooks.callAll(`${MODULE_ID}.projectStateChanged`, entry, res.project, p.state, res.project.state);
    } else {
      const res = moveInQueue(record.projects, projectId, op);
      if (!res.ok) return { ok: false, reason: t("Notify.Queue.notQueued") };
      projects = res.projects;
      for (const q of Object.values(res.projects)) if (q.state === "queued") changes[`projects.${q.id}`] = q;
    }
    const started = startWaiting(projects, statsFor(record).stats.crews, changes);
    await patchRecord(entry, changes);
    for (const s of started) Hooks.callAll(`${MODULE_ID}.projectStateChanged`, entry, s, "queued", "building");
    return { ok: true, started: started.map(s => s.id) };
  },

  /**
   * Hires or dismisses building crews: `crews` is the number of hired crews wanted (the Bastion's own first crew and
   * the Workers' Lodges' come on top). Hiring costs rules.crewHireCost a crew, paid from the treasury
   * (from: "treasury") or a character (actorId); the GM can hire for nothing (from: "free"). Crews at work can't be
   * dismissed.
   */
  async hireCrews({ entryId, crews, actorId, from = "treasury" }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    const { stats } = statsFor(record);
    const status = crewStatus(record, stats);
    const want = Math.max(0, Math.min(rules().maxHiredCrews, Math.floor(Number(crews) || 0)));
    if (want === status.hired) {
      return { ok: false, reason: Number(crews) > rules().maxHiredCrews ? t("Notify.Crews.maxHired", { n: rules().maxHiredCrews }) : t("Notify.Crews.same") };
    }
    const changes = { "garrison.crews": want };
    if (want < status.hired) {
      const chk = canDismiss(record, stats, want);
      if (!chk.ok) return { ok: false, reason: t("Notify.Crews.dismissBusy", { used: status.used }) };
    } else {
      const cost = (want - status.hired) * (rules().crewHireCost ?? 0);
      if (from === "free") {
        if (!user.isGM) return { ok: false, reason: "Only the GM can hire for nothing" };
      } else if (from === "treasury") {
        if ((record.treasury ?? 0) < cost) return { ok: false, reason: t("Notify.TreasuryShort") };
        if (cost) changes.treasury = record.treasury - cost;
      } else {
        if (record.presence !== "present" && !user.isGM) return { ok: false, reason: t("Notify.AwayUseDispatch") };
        const actor = actorFor(record, actorId, user);
        if (cost && !(await takeGold(actor, cost))) return { ok: false, reason: t("Notify.NotEnoughGold") };
      }
      // The new crews pick up queued projects straight away.
      startWaiting(record.projects, status.total + (want - status.hired), changes);
    }
    await patchRecord(entry, changes);
    return { ok: true, hired: want };
  },

  /** GM: finish a project immediately, whatever its funding and progress. */
  async finishProject({ entryId, projectId }, user) {
    gmOnly(user);
    const entry = getEntry(entryId);
    if (!getRecord(entry)?.projects?.[projectId]) return { ok: false, reason: "No such project" };
    return runFinish(entry, projectId);
  },

  /** GM: finish every open project (planned, queued, building or paused) at once. */
  async finishAllProjects({ entryId }, user) {
    gmOnly(user);
    const entry = getEntry(entryId);
    if (!getRecord(entry)) return { ok: false, reason: "No such Bastion" };
    return runFinishAll(entry);
  },

  /* ---------------- Treasury ---------------- */
  async deposit({ entryId, actorId, amount }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    if (record.presence !== "present" && !user.isGM) return { ok: false, reason: t("Notify.AwayUseDispatch") };
    const actor = actorFor(record, actorId, user);
    const want = Math.max(0, Math.floor(Number(amount) || 0));
    if (!(await takeGold(actor, want))) return { ok: false, reason: t("Notify.NotEnoughGold") };
    await patchRecord(entry, { treasury: (record.treasury ?? 0) + want });
    return { ok: true };
  },

  /** Pays out the accumulated dividend, split evenly between the owners' characters. */
  async claimDividend({ entryId }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    const total = Math.floor(record.dividends ?? 0);
    const owners = ownerActors(record);
    if (!total || !owners.length) return { ok: false, reason: t("Notify.NoDividend") };
    const each = Math.floor(total / owners.length);
    for (const a of owners) await giveGold(a, each);
    const rest = total - each * owners.length;
    await patchRecord(entry, { dividends: 0, treasury: (record.treasury ?? 0) + rest });
    await ChatMessage.create({ content: `<div class="dxpb-card"><h3>${record.name}</h3><p>${t("Chat.Dividend", { each: gp(each),
      names: owners.map(a => a.name).join(", ") })}</p></div>` });
    return { ok: true, each };
  },

  async hire({ entryId, guards, servants }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    const { stats } = statsFor(record);
    const changes = {};
    if (guards !== undefined) {
      // Buildings set how many can be hired; people already there (e.g. from the founding) are never dismissed by the cap.
      const cap = Math.max(stats.fx.guardsCap ?? 0, record.garrison?.guards ?? 0);
      changes["garrison.guards"] = Math.max(0, Math.min(cap, Math.floor(Number(guards) || 0)));
    }
    if (servants !== undefined) {
      const cap = Math.max(stats.fx.servantsCap ?? 0, record.garrison?.servants ?? 0);
      changes["garrison.servants"] = Math.max(0, Math.min(cap, Math.floor(Number(servants) || 0)));
    }
    await patchRecord(entry, changes);
    return { ok: true };
  },

  /* ---------------- Presence and orders ---------------- */
  async setPresence({ entryId, presence }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    if (!["present", "away"].includes(presence)) return { ok: false };
    const changes = { presence };
    // Dispatches still on the road when the owners come home are superseded.
    if (presence === "present") {
      for (const d of Object.values(record.dispatches ?? {})) if (d.status === "transit") changes[`dispatches.${d.id}.status`] = "superseded";
    }
    await patchRecord(entry, changes);
    return { ok: true };
  },

  async chooseMaintain({ entryId, on = true }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    await patchRecord(entry, { maintainOrder: !!on, maintainChosen: !!on });
    return { ok: true };
  },

  async setStanding({ entryId, orders }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    const { stats } = statsFor(record);
    if (!stats.flags.standingOrders) return { ok: false, reason: t("Notify.NeedSteward") };
    if (record.presence !== "present" && !user.isGM) return { ok: false, reason: t("Notify.AwayUseDispatch") };
    await patchRecord(entry, { standingOrders: (orders ?? []).slice(0, 10) });
    return { ok: true };
  },

  /** Sends a dispatch. data: { method, actorId, orders, gold, distance, slotLevel } */
  async sendDispatch({ entryId, method, actorId, orders = [], gold = 0, distance, slotLevel }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    const { stats } = statsFor(record);
    const dist = distance ?? partyDistance(record) ?? 0;
    const strict = setting("strictDispatch");
    const q = quoteDispatch(method, stats, rules(), record, { distance: dist, slotLevel, orders: orderCount(orders), strict, siege: !!record.siege });
    if (!q.ok) return q;
    const m = DISPATCH_METHODS[method];
    if (m.oncePerDay) {
      const day = Math.floor(bastionNow(record) / SECONDS_PER_DAY);
      if (Object.values(record.dispatches ?? {}).some(d => d.method === method && Math.floor((d.sentAt ?? -1e9) / SECONDS_PER_DAY) === day)) {
        return { ok: false, reason: t("Notify.OncePerDay") };
      }
    }
    const actor = actorFor(record, actorId, user);
    const carry = q.gold === true ? Math.max(0, Math.floor(Number(gold) || 0)) : 0;
    if (!(await takeGold(actor, q.cost + carry))) return { ok: false, reason: t("Notify.NotEnoughGold") };
    let days = q.days;
    if (q.waitDice) days += rollDice(q.waitDice);
    const id = randomId();
    // On the Bastion's clock: the game clock, or with the long-rest clock its last turn plus a day per rest since.
    const sentAt = bastionNow(record);
    const dispatch = { id, method, from: actor.id, fromName: actor.name, orders, gold: carry, distance: dist, sentAt,
      arrivesAt: sentAt + (q.instant ? 0 : days * SECONDS_PER_DAY), status: "transit", risk: q.risk, cost: q.cost, reply: q.reply };
    // Risk is rolled now, out of the players' sight; the GM sees it on the dispatch card.
    if (q.risk > 0 && Math.random() * 100 < q.risk) {
      dispatch.status = Math.random() < 0.5 ? "lost" : "intercepted";
      await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
        content: `<div class="dxpb-card"><h3>${record.name}</h3><p>${t(`Chat.Dispatch.${dispatch.status}`, { from: actor.name,
          method: m.label })}</p>${orders.length ? `<ul>${orders.map(o => `<li>${escapeHTML(describeOrder(o))}</li>`).join("")}</ul>` : ""}${carry ? `<p>${gp(carry)}</p>` : ""}</div>` });
    }
    await patchRecord(entry, { [`dispatches.${id}`]: dispatch });
    if (q.instant && dispatch.status === "transit") {
      await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
        content: `<div class="dxpb-card"><h3>${record.name}</h3><p>${t("Chat.Dispatch.instant", { from: actor.name, method: m.label })}</p></div>` });
    }
    Hooks.callAll(`${MODULE_ID}.dispatchSent`, entry, dispatch);
    return { ok: true, dispatchId: id, arrivesAt: dispatch.arrivesAt, instant: q.instant };
  },

  /** GM: marks a dispatch lost or intercepted, or back in transit. */
  async setDispatchStatus({ entryId, dispatchId, status }, user) {
    gmOnly(user);
    const { entry } = load(entryId);
    await patchRecord(entry, { [`dispatches.${dispatchId}.status`]: status });
    return { ok: true };
  },

  /* ---------------- Turns, sieges, events ---------------- */
  async advanceTurn({ entryId, turns = 1 }, user) {
    gmOnly(user);
    const ids = entryId ? [entryId] : game.journal.filter(j => getRecord(j)).map(j => j.id);
    const reports = [];
    for (let i = 0; i < Math.max(1, Math.min(52, turns)); i++) {
      for (const id of ids) reports.push(await runTurn(getEntry(id)));
    }
    return { ok: true, reports };
  },

  /**
   * The long-rest clock: a character finished a long rest (sent by the client where the rest happened). Every Bastion
   * whose party the character belongs to counts it. The resting player (or a GM) may report it.
   */
  async longRest({ actorUuid }, user) {
    const actor = actorUuid ? fromUuidSync(actorUuid) : null;
    if (!actor) return { ok: false, reason: "No such actor" };
    if (!user.isGM && !actor.testUserPermission(user, "OWNER")) return { ok: false, reason: t("Notify.NotYours") };
    const results = [];
    for (const entry of game.journal.filter(j => getRecord(j))) {
      if (!ownerActors(getRecord(entry)).some(a => a.uuid === actor.uuid)) continue;
      results.push({ entryId: entry.id, ...(await runRest(entry, actor.uuid)) });
    }
    return { ok: true, results };
  },

  /** GM: count a long rest by hand (the party rested without the system's rest, or between sessions). */
  async countRest({ entryId }, user) {
    gmOnly(user);
    const entry = getEntry(entryId);
    if (!getRecord(entry)) return { ok: false, reason: "No such Bastion" };
    return { ok: true, ...(await runRest(entry, null, { force: true })) };
  },

  async startSiege({ entryId, forceKey, force }, user) {
    gmOnly(user);
    const { entry, record } = load(entryId);
    const f = force ?? FORCES[forceKey];
    if (!f) return { ok: false, reason: "Unknown force" };
    const { stats } = statsFor(record);
    const est = holdout(stats, f, rules());
    await patchRecord(entry, { siege: { force: f, forceKey: forceKey ?? null, startedAt: now(), day: 0, integrity: stats.wall.integrity,
      food: stats.food.stock, estimate: est.days === Infinity ? null : est.days, reason: est.reason } });
    Hooks.callAll(`${MODULE_ID}.siegeStarted`, entry, f);
    return { ok: true, estimate: est };
  },

  async siegeDay({ entryId }, user) {
    gmOnly(user);
    return runSiegeDay(getEntry(entryId));
  },

  async endSiege({ entryId, outcome = "lifted" }, user) {
    gmOnly(user);
    const { entry, record } = load(entryId);
    if (!record.siege) return { ok: false };
    await patchRecord(entry, { siege: null, food: Math.floor(record.siege.food ?? record.food) });
    Hooks.callAll(`${MODULE_ID}.siegeEnded`, entry, record.siege.force, outcome);
    return { ok: true };
  },

  async resolveEvent({ entryId, eventId, choice, count }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    return resolveEventChoice(entry, record, eventId, choice, { count, user });
  },

  /* ---------------- Merchants ---------------- */
  async buy({ entryId, index, actorId, payFrom }, user) {
    const { entry, record } = load(entryId);
    ownerOnly(record, user);
    const m = record.merchant;
    const ware = m?.stock?.[index];
    if (!ware || ware.sold) return { ok: false, reason: t("Notify.SoldOut") };
    const actor = actorFor(record, actorId, user);
    const changes = {};
    if (payFrom === "treasury") {
      if ((record.treasury ?? 0) < ware.price) return { ok: false, reason: t("Notify.TreasuryShort") };
      changes.treasury = record.treasury - ware.price;
    } else {
      if (record.presence !== "present" && !user.isGM) return { ok: false, reason: t("Notify.AwayUseDispatch") };
      if (!(await takeGold(actor, ware.price))) return { ok: false, reason: t("Notify.NotEnoughGold") };
    }
    const item = ware.uuid ? await fromUuid(ware.uuid) : null;
    if (item) {
      const data = item.toObject();
      delete data._id;
      if (record.presence === "present") await actor.createEmbeddedDocuments("Item", [data]);
      else changes.vault = [...(record.vault ?? []), { name: item.name, uuid: ware.uuid, for: actor.id }];
    }
    changes[`merchant.stock`] = m.stock.map((w, i) => (i === index ? { ...w, sold: true, buyer: actor.name } : w));
    await patchRecord(entry, changes);
    return { ok: true };
  }
};

/** Short text of one order, for cards and logs. */
export function describeOrder(o) {
  switch (o?.type) {
    case "facility": return `${o.facilityName ?? o.facility}: ${o.order}${o.detail ? ` (${o.detail})` : ""}`;
    case "maintain": return "Maintain";
    case "payment": return `Pay ${o.gp} GP from the treasury into ${o.projectLabel ?? "a project"}`;
    case "standing": return "New standing orders";
    case "signal": return `Signal: ${o.signal}`;
    case "note": return o.text;
    default: return "";
  }
}
