import { tradeSettlements, closeRouteQuest } from "./trade.js";
import { MODULE_ID, rules, catalog, randomId, now, setting, t, gp, escapeHTML, formatGameTime, SECONDS_PER_DAY, clockMode } from "./util.js";
import { getRecord, patchRecord, writeRecordKeys, ownerActors } from "./store.js";
import { statsFor } from "./context.js";
import { advanceTurn, workDays, finishProject, finishAllProjects } from "./core/turn.js";
import { countRest } from "./core/rests.js";
import { assignCrews } from "./core/crews.js";
import { siegeDay } from "./core/siege.js";
import { rollBastionEvent, restoreDisabled } from "./events.js";
import { fillStock } from "./merchant.js";
import { describeOrder, giveGold } from "./actions.js";
import { withBastionLock } from "./lock.js";

/** Bastions whose turn is being run right now, so the system's own turn summary message isn't processed twice. */
export const running = new Set();

const KEYS = ["dispatches", "projects", "features", "treasury", "unpaidUpkeep", "dividends", "food", "hungry", "merchant",
  "standingOrders", "maintainOrder", "maintainChosen", "neglect", "turn", "history", "grounds", "layout", "rests", "people", "garrison", "tradeRoutes"];

/* One at a time per Bastion with its actions (lock.js). */
export function runTurn(entry, opts) { return withBastionLock(entry?.id, () => runTurnNow(entry, opts)); }
export function runRest(entry, actorUuid, opts) { return withBastionLock(entry?.id, () => runRestNow(entry, actorUuid, opts)); }
export function runFinish(entry, projectId) { return withBastionLock(entry?.id, () => runFinishNow(entry, projectId)); }
export function runSiegeDay(entry) { return withBastionLock(entry?.id, () => runSiegeDayNow(entry)); }

/** When a Bastion's next turn is due, in game seconds. */
export function turnDueTime(record) {
  const last = record.turn?.lastTime ?? now();
  return last + rules().turnDays * SECONDS_PER_DAY;
}

/** Runs one Bastion turn for a Bastion journal entry (responsible GM only). Returns the report. */
async function runTurnNow(entry, { systemAdvance = true } = {}) {
  if (!entry || !game.user.isGM) return null;
  running.add(entry.id);
  try {
    const record = getRecord(entry);
    const { stats, ctx } = statsFor(record);
    const toRestore = [...(record.disabledByModule ?? [])];
    const days = rules().turnDays;
    const restClock = clockMode() === "rests";
    // A turn happens at its due time (a turn length after the last one): a turn run by hand ahead of the clock still
    // covers its whole week (a dispatch arriving mid-week is delivered), and catching up after a long rest runs each
    // missed week at its own time.
    const turnTime = turnDueTime(record);
    const { record: next, report } = advanceTurn(record, {
      stats, rules: rules(), catalog: catalog(), now: turnTime, days, rng: Math.random, newId: randomId,
      partyLevel: ctx.partyLevel, payAsYouBuild: !!setting("payAsYouBuild"), standingRule: setting("standingOrders") !== false,
      skipProjects: restClock, settlements: tradeSettlements(record)
    });
    // With the long-rest clock the building work moved on with each rest; the turn starts the next count of rests.
    if (restClock) next.rests = { ...(next.rests ?? {}), sinceTurn: 0 };
    await writeRecordKeys(entry, next, KEYS);

    // Rooms finished: add the dnd5e basic facility to an owner's sheet; enlarged rooms grow there too.
    for (const c of report.completed) await syncRoom(entry, c);
    await payRefunds(report.refunds);

    // A new merchant: roll the stock from compendium items.
    if (report.merchant) {
      const stock = await fillStock(report.merchant, stats);
      await patchRecord(entry, { "merchant.stock": stock });
      Hooks.callAll(`${MODULE_ID}.merchantArrived`, entry, { ...report.merchant, stock });
    }
    if (report.visitor && report.visitor.key !== "nobody") Hooks.callAll(`${MODULE_ID}.visitorArrived`, entry, report.visitor);

    // Trade routes: a settlement's new request; offers nobody came to sign lapse (their quest fails).
    if (report.tradeRequest) Hooks.callAll(`${MODULE_ID}.tradeRouteRequested`, entry, report.tradeRequest);
    for (const r of report.tradeLapsed ?? []) {
      await closeRouteQuest(r, "failed");
      Hooks.callAll(`${MODULE_ID}.tradeRouteEnded`, entry, { ...r, ended: "lapsed" });
    }

    // The system's own facility advance (orders progress, crafted items, trade gold), with its own summary cards.
    const bastion = globalThis.dnd5e?.bastion;
    if (systemAdvance && bastion) {
      for (const actor of ownerActors(next)) {
        if (actor.itemTypes?.facility?.length) await bastion.advanceAllFacilities(actor, { duration: days });
      }
    }

    // Neglect: the hirelings leave every special facility until the owners return and give orders.
    if (report.neglected) {
      for (const actor of ownerActors(next)) for (const f of actor.itemTypes?.facility ?? []) {
        if (f.system.type?.value === "special" && !f.system.disabled) await f.update({ "system.disabled": true });
      }
    }

    // Maintain: a DMG Bastion event.
    let event = null;
    if (report.rollEvent) {
      const fresh = getRecord(entry);
      const s2 = statsFor(fresh);
      event = await rollBastionEvent(entry, fresh, s2.stats, s2.ctx, { twice: !!fresh.innerPeace, at: turnTime });
      if (fresh.innerPeace) await patchRecord(entry, { innerPeace: false });
    }

    // Facilities this module idled last turn come back now.
    const restored = await restoreDisabled(entry, toRestore);
    if (restored.length) report.lines.push(t("Chat.Restored", { names: restored.join(", ") }));

    await postSummary(entry, getRecord(entry), report, event);
    Hooks.callAll(`${MODULE_ID}.postTurn`, { entryId: entry.id, report, event });
    return report;
  } finally {
    running.delete(entry.id);
  }
}

/**
 * The long-rest clock: a member of the Bastion's party finished a long rest (responsible GM). Rests of different
 * members close together count once (see core/rests.js). A counted rest is one work day on every running project.
 * Returns { counted, rests, completed, layoutChanged, turnDue }.
 */
async function runRestNow(entry, actorUuid, { force = false } = {}) {
  if (!entry || !game.user.isGM) return null;
  const record = getRecord(entry);
  if (!record) return null;
  const { counted, rests } = countRest(record.rests, actorUuid ?? "gm", Date.now(), { force });
  if (!counted) {
    await patchRecord(entry, { rests });
    return { counted: false, rests };
  }
  const next = structuredClone(record);
  next.rests = rests;
  const done = workDays(next, 1, { rules: rules(), catalog: catalog(), now: now(), newId: randomId,
    payAsYouBuild: !!setting("payAsYouBuild"), crews: statsFor(next).stats.crews });
  await writeRecordKeys(entry, next, ["rests", "projects", "features", "grounds", "layout", "treasury"]);
  for (const c of done.completed) await syncRoom(entry, c);
  await payRefunds(done.refunds);
  // Only the lines that aren't already a finished / started row (a Hidden Approach ended, a cancelled project).
  const extra = done.lines.filter(l => !/^(Finished|Started|Waiting for a crew):/.test(l));
  if (done.completed.length || done.started.length || extra.length) {
    const fresh = getRecord(entry);
    const users = ownerActors(fresh, { includeGroup: true })
      .flatMap(a => game.users.filter(u => !u.isGM && a.testUserPermission(u, "OWNER")).map(u => u.id));
    await ChatMessage.create({
      content: `<div class="dxpb-card dxpb-turn"><h3><i class="fa-solid fa-chess-rook"></i> ${escapeHTML(fresh.name)}</h3>
        <p class="dxpb-muted">${t("Chat.RestTitle", { n: rests.count })}</p>
        <ul>${done.completed.map(c => `<li>${escapeHTML(t("Chat.Finished", { label: c.label }))}</li>`).join("")}
        ${done.started.map(c => `<li>${escapeHTML(t("Chat.Started", { label: c.label }))}</li>`).join("")}
        ${extra.map(l => `<li>${escapeHTML(l)}</li>`).join("")}</ul></div>`,
      whisper: [...new Set([...users, ...ChatMessage.getWhisperRecipients("GM").map(u => u.id)])],
      flags: { [MODULE_ID]: { rest: { entryId: entry.id, count: rests.count } } }
    });
  }
  const result = { counted: true, rests, completed: done.completed, layoutChanged: done.layoutChanged,
    turnDue: rests.sinceTurn >= rules().turnDays };
  Hooks.callAll(`${MODULE_ID}.restCounted`, { entryId: entry.id, ...result });
  return result;
}

/** GM: finish one project now (rooms join an owner's sheet and the battle map like any finished building). */
async function runFinishNow(entry, projectId) {
  if (!entry || !game.user.isGM) return { ok: false };
  const record = getRecord(entry);
  if (!record) return { ok: false };
  const all = projectId === null;
  const before = Object.fromEntries(Object.values(record.projects ?? {}).map(p => [p.id, p.state]));
  const next = structuredClone(record);
  const opts = { rules: rules(), catalog: catalog(), now: now(), newId: randomId };
  const res = all ? finishAllProjects(next, opts) : finishProject(next, projectId, opts);
  if (!res.ok) return res;
  // The crews it freed (and any a finished Workers' Lodge brings) pick up queued projects.
  const crewed = assignCrews(next.projects, statsFor(next).stats.crews, { payAsYouBuild: !!setting("payAsYouBuild"), now: now() });
  next.projects = crewed.projects;
  await writeRecordKeys(entry, next, ["projects", "features", "grounds", "layout", "treasury"]);
  for (const c of res.completed) await syncRoom(entry, c);
  await payRefunds(res.refunds);
  const fresh = getRecord(entry);
  for (const c of res.completed) {
    const p = fresh.projects[c.projectId];
    Hooks.callAll(`${MODULE_ID}.projectStateChanged`, entry, p, before[c.projectId], p.state);
  }
  for (const c of res.cancelled ?? []) Hooks.callAll(`${MODULE_ID}.projectStateChanged`, entry, fresh.projects[c.projectId], before[c.projectId], "cancelled");
  // One hook (and one map redraw) for the lot.
  Hooks.callAll(`${MODULE_ID}.projectFinished`, { entryId: entry.id, projectId: all ? null : projectId, completed: res.completed,
    layoutChanged: res.layoutChanged });
  return { ok: true, completed: res.completed, layoutChanged: res.layoutChanged };
}

/** GM: finish every open project at once. */
export function runFinishAll(entry) {
  return runFinish(entry, null);
}

/** Pays characters back for projects a finished road cancelled ({ actorId: gp }, core cancelHiddenApproach). */
async function payRefunds(refunds) {
  for (const [id, gold] of Object.entries(refunds ?? {})) await giveGold(game.actors.get(id), gold);
}

/** Creates or updates the dnd5e basic facility item for a finished room project. */
async function syncRoom(entry, completed) {
  const record = getRecord(entry);
  const exp = catalog().get(completed.expansionId);
  if (!exp?.room || !completed.featureId) return;
  const feature = record.features?.[completed.featureId];
  if (!feature) return;
  if (completed.kind === "build") {
    const owners = ownerActors(record);
    if (!owners.length) return;
    const owner = owners.reduce((a, b) => ((a.itemTypes.facility?.length ?? 0) <= (b.itemTypes.facility?.length ?? 0) ? a : b));
    const size = feature.size ?? "roomy";
    const [item] = await owner.createEmbeddedDocuments("Item", [{
      name: `${exp.name} (${record.name})`,
      type: "facility",
      img: "systems/dnd5e/icons/svg/facilities/build.svg",
      system: { type: { value: "basic", subtype: exp.room }, size, building: { built: true, size }, free: false },
      flags: { [MODULE_ID]: { entryId: entry.id, featureId: completed.featureId } }
    }]);
    if (item) await patchRecord(entry, { [`features.${completed.featureId}.systemItem`]: item.uuid });
  } else if (completed.kind === "enlarge" && feature.systemItem) {
    const item = await fromUuid(feature.systemItem);
    await item?.update({ "system.size": feature.size, "system.building.size": feature.size });
  }
}

async function postSummary(entry, record, report, event) {
  const modeText = t(`Mode.${report.mode}`);
  const facilityOrders = report.facilityOrders.map(o => `<li>${escapeHTML(describeOrder(o))}
    ${o.facilityUuid ? `<button type="button" data-dxpb-exec="${o.facilityUuid}">${t("Chat.Execute")}</button>` : ""}</li>`).join("");
  const lines = report.lines.map(l => `<li>${escapeHTML(l)}</li>`).join("");
  const content = `<div class="dxpb-card dxpb-turn">
    <h3><i class="fa-solid fa-chess-rook"></i> ${escapeHTML(record.name)}: ${t("Chat.TurnTitle", { n: report.turn })}</h3>
    <p class="dxpb-muted">${clockMode() === "rests" ? "" : `${escapeHTML(formatGameTime(record.turn?.lastTime ?? 0))} · `}${modeText}</p>
    <table class="dxpb-ledger">
      <tr><td>${t("Chat.Income")}</td><td>${gp(report.income)}</td></tr>
      <tr><td>${t("Chat.Upkeep")}</td><td>−${gp(report.upkeep)}</td></tr>
      ${report.tax ? `<tr><td>${t("Chat.Tax")}</td><td>−${gp(report.tax)}</td></tr>` : ""}
      ${report.foodCost ? `<tr><td>${t("Chat.FoodBought")}</td><td>−${gp(report.foodCost)}</td></tr>` : ""}
      ${report.merchantGold ? `<tr><td>${t("Chat.MerchantGold")}</td><td>+${gp(report.merchantGold)}</td></tr>` : ""}
      ${report.dividend ? `<tr><td>${t("Chat.DividendShare")}</td><td>${gp(report.dividend)}</td></tr>` : ""}
      <tr><th>${t("Chat.Treasury")}</th><th>${gp(record.treasury)}</th></tr>
      <tr><td>${t("Chat.Food")}</td><td>${report.foodDelta >= 0 ? "+" : ""}${report.foodDelta}</td></tr>
    </table>
    ${lines ? `<ul>${lines}</ul>` : ""}
    ${facilityOrders ? `<p><strong>${t("Chat.OrdersArrived")}</strong></p><ul>${facilityOrders}</ul>` : ""}
    ${event ? `<p><strong>${t("Chat.Event")}:</strong> ${escapeHTML(event.label)}</p>` : ""}
    ${(record.dividends ?? 0) > 0 ? `<div class="dxpb-buttons"><button type="button" data-dxpb-dividend="${entry.id}"><i class="fa-solid fa-coins"></i> ${t("Chat.ClaimDividend", { gold: gp(record.dividends) })}</button></div>` : ""}
  </div>`;
  const users = ownerActors(record, { includeGroup: true })
    .flatMap(a => game.users.filter(u => !u.isGM && a.testUserPermission(u, "OWNER")).map(u => u.id));
  await ChatMessage.create({ content, whisper: [...new Set([...users, ...ChatMessage.getWhisperRecipients("GM").map(u => u.id)])],
    flags: { [MODULE_ID]: { turn: { entryId: entry.id, turn: report.turn } } } });
}

/** One day of a live siege (GM button). */
async function runSiegeDayNow(entry) {
  const record = getRecord(entry);
  if (!record?.siege) return { ok: false };
  const { stats } = statsFor(record);
  const next = siegeDay(record.siege, stats, record.siege.force, rules());
  await patchRecord(entry, { siege: { ...record.siege, ...next } });
  if (next.fallen) {
    await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
      content: `<div class="dxpb-card"><h3>${escapeHTML(record.name)}</h3><p>${t(`Siege.Fallen.${next.fallen}`, { day: next.day })}</p></div>` });
  }
  Hooks.callAll(`${MODULE_ID}.siegeDay`, entry, next);
  return { ok: true, state: next };
}
