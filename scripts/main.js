/**
 * Dxcufgb's Player Bastions: the party's Bastion as a place on the map, built on the dnd5e system's own Bastion.
 *
 * Public API: game.modules.get("dxcufgbs-player-bastions").api (documented in the wiki's API page)
 *   openDashboard(), openBastion(entryId), openWizard()
 *   getBastion(entryOrIdOrActor) → { entry, record, stats, ctx }
 *   siegeHoldout(entryId, forceKeyOrForce) → { days, reason, ... }
 *   act(action, data) → runs a GM action (players are relayed over the socket): found, planProject, removeProject,
 *     fundProject, queueProject, hireCrews, construction, deposit, claimDividend, hire, setPresence, chooseMaintain, setStanding, sendDispatch,
 *     setDispatchStatus, advanceTurn, longRest, countRest, finishProject, finishAllProjects, startSiege, siegeDay, endSiege, resolveEvent, buy, moveMarker, updateRecord, deleteBastion ({entryId, confirm: "DELETE"})
 *   buildMap(entryId) → draws or redraws the Bastion's battle-map scene (GM); viewMap(entryId); mapPlan(entryId) → geometry
 *   forceEvent(entryId, key) → applies one Bastion event (GM)
 *   runSelfTests() → runs the module's tests (Quench when active, else the built-in runner)
 *   core: the pure engine (computeStats, holdout, quote, quoteDispatch, advanceTurn, catalog data)
 * Hooks (all with the Bastion's JournalEntry first): dxcufgbs-player-bastions.founded, .projectStateChanged, .dispatchSent,
 *   .eventRolled, .eventResolved, .merchantArrived, .visitorArrived, .siegeStarted, .siegeDay, .siegeEnded,
 *   .mapBuilt (entry, scene, plan), .mapLookChanged ({entryId}), .postTurn ({entryId, report, event}),
 *   .restCounted ({entryId, counted, rests, completed, layoutChanged, turnDue}) with the long-rest clock,
 *   .bastionDeleted ({entryId, name}) just before a Bastion is deleted,
 *   .projectFinished ({entryId, projectId (null for Finish all), completed, layoutChanged}) when the GM finishes projects at once.
 */
import { MODULE_ID, t, isResponsibleGM, clearCaches, rules, setting, SECONDS_PER_DAY, escapeHTML, clockMode, catalog } from "./util.js";
import { registerSocket, request } from "./socket.js";
import { registerDebugRecorder, crumb } from "./debug-recorder.js";
import { debugSnapshot } from "./debug-snapshot.js";
import { ACTIONS } from "./actions.js";
import { allBastions, getEntry, getRecord, bastionForActor, isBastionEntry, ownerActors, canAct } from "./store.js";
import { statsFor } from "./context.js";
import { BastionSheet } from "./apps/bastion-sheet.js";
import { registerBastionTab, syncBastionNames } from "./apps/bastion-tab.js";
import { FoundingWizard } from "./apps/wizard.js";
import { BastionDashboard } from "./apps/dashboard.js";
import { RulesConfig, SelfTestMenu } from "./apps/settings-apps.js";
import { runTurn, running } from "./turn-runner.js";
import { buildMap, viewMap, planFor, registerMapHooks } from "./map.js";
import { applyEvent } from "./events.js";
import { holdout } from "./core/siege.js";
import { FORCES, EVENTS } from "./data/tables.js";
import * as engine from "./core/index.js";
import { registerQuench, runSelfTests } from "./tests/quench.js";
import { registerSystemRulesSetting, postSystemRulesNotice, bindSystemRulesCard } from "./system-rules.js";
import { registerCodex } from "./apps/codex-page.js";

function registerSettings() {
  game.settings.register(MODULE_ID, "rules", { scope: "world", config: false, type: Object, default: {}, onChange: () => { clearCaches(); repaceAll(); refreshAll(); } });
  game.settings.register(MODULE_ID, "catalog", { scope: "world", config: false, type: Object, default: {}, onChange: () => { clearCaches(); refreshAll(); } });
  game.settings.registerMenu(MODULE_ID, "rulesMenu", {
    name: "DXPB.Settings.Rules.Name", label: "DXPB.Settings.Rules.Label", hint: "DXPB.Settings.Rules.Hint",
    icon: "fa-solid fa-scale-balanced", type: RulesConfig, restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "selfTest", {
    name: "DXPB.Settings.SelfTest.Name", label: "DXPB.Settings.SelfTest.Label", hint: "DXPB.Settings.SelfTest.Hint",
    icon: "fa-solid fa-vial-circle-check", type: SelfTestMenu, restricted: true
  });
  game.settings.register(MODULE_ID, "strictDispatch", {
    name: "DXPB.Settings.Strict.Name", hint: "DXPB.Settings.Strict.Hint", scope: "world", config: true, type: Boolean, default: false,
    onChange: refreshAll
  });
  game.settings.register(MODULE_ID, "standingOrders", {
    name: "DXPB.Settings.Standing.Name", hint: "DXPB.Settings.Standing.Hint", scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "payAsYouBuild", {
    name: "DXPB.Settings.PayAsYouBuild.Name", hint: "DXPB.Settings.PayAsYouBuild.Hint", scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "buildPace", {
    name: "DXPB.Settings.BuildPace.Name", hint: "DXPB.Settings.BuildPace.Hint", scope: "world", config: true, type: String, default: "adventure",
    choices: { adventure: "DXPB.Settings.BuildPace.Adventure", campaign: "DXPB.Settings.BuildPace.Campaign", dmg: "DXPB.Settings.BuildPace.Dmg" },
    onChange: () => { clearCaches(); repaceAll(); refreshAll(); }
  });
  game.settings.register(MODULE_ID, "buildPrice", {
    name: "DXPB.Settings.BuildPrice.Name", hint: "DXPB.Settings.BuildPrice.Hint", scope: "world", config: true, type: String, default: "fair",
    choices: { fair: "DXPB.Settings.BuildPrice.Fair", thrifty: "DXPB.Settings.BuildPrice.Thrifty", dmg: "DXPB.Settings.BuildPrice.Dmg" },
    onChange: () => { clearCaches(); repaceAll(); refreshAll(); }
  });
  game.settings.register(MODULE_ID, "clock", {
    name: "DXPB.Settings.Clock.Name", hint: "DXPB.Settings.Clock.Hint", scope: "world", config: true, type: String, default: "auto",
    choices: { auto: "DXPB.Settings.Clock.Auto", calendar: "DXPB.Settings.Clock.Calendar", rests: "DXPB.Settings.Clock.Rests" },
    onChange: refreshAll
  });
  game.settings.register(MODULE_ID, "timePrompt", {
    name: "DXPB.Settings.TimePrompt.Name", hint: "DXPB.Settings.TimePrompt.Hint", scope: "world", config: true, type: String, default: "prompt",
    choices: { off: "DXPB.Settings.TimePrompt.Off", prompt: "DXPB.Settings.TimePrompt.Prompt", auto: "DXPB.Settings.TimePrompt.Auto" }
  });
  game.settings.register(MODULE_ID, "processSystemTurns", {
    name: "DXPB.Settings.SystemTurns.Name", hint: "DXPB.Settings.SystemTurns.Hint", scope: "world", config: true, type: Boolean, default: true
  });
  registerSystemRulesSetting();
}

function refreshAll() {
  for (const app of BastionSheet.instances.values()) if (app.rendered) app.render();
  refreshDashboards();
}

/* ---------------- Entry points in the UI ---------------- */

/** The Bastions control group's canvas layer: it draws nothing, it only lets the group be the active control. */
const BASTION_LAYER = "dxpbBastions";
function registerBastionLayer() {
  const InteractionLayer = foundry.canvas?.layers?.InteractionLayer ?? globalThis.InteractionLayer;
  class BastionLayer extends InteractionLayer {
    static get layerOptions() {
      return foundry.utils.mergeObject(super.layerOptions, { name: BASTION_LAYER, zIndex: 0 });
    }
  }
  CONFIG.Canvas.layers[BASTION_LAYER] = { layerClass: BastionLayer, group: "interface" };
}


function registerUI() {
  // The GM's scene-control group of its own, right after the Journal Notes group: the Bastion list and founding a new
  // one. Players find their Bastion in their character sheet's Bastion tab (apps/bastion-tab.js). It has its own (empty) canvas layer: a group on the token layer would hand
  // the controls straight back to the Token group when that layer activates.
  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user.isGM) return;
    const after = controls.notes?.order ?? Math.max(0, ...Object.values(controls).map(c => c?.order ?? 0));
    for (const c of Object.values(controls)) if (c && c.order > after) c.order++;
    controls.dxpbBastions = {
      name: "dxpbBastions", title: "DXPB.Controls.Group", icon: "fa-solid fa-chess-rook", order: after + 1, layer: BASTION_LAYER,
      visible: true, activeTool: "bastions",
      onChange: (event, active) => { if (active) canvas?.[BASTION_LAYER]?.activate(); },
      tools: {
        bastions: { name: "bastions", title: "DXPB.Controls.Group", icon: "fa-solid fa-chess-rook", order: 1 },
        list: { name: "list", title: "DXPB.Dashboard.Title", icon: "fa-solid fa-list", order: 2, button: true,
          onChange: () => new BastionDashboard().render({ force: true }) },
        found: { name: "found", title: "DXPB.Controls.Found", icon: "fa-solid fa-flag", order: 3, button: true,
          onChange: () => new FoundingWizard().render({ force: true }) }
      }
    };
  });

  // Clicking the Bastion's map marker opens the Bastion page instead of the journal.
  Hooks.on("activateNote", (note) => {
    const id = note.document?.getFlag(MODULE_ID, "bastion");
    if (!id || !getEntry(id)) return;
    BastionSheet.open(id);
    return false;
  });

  // The journal of a Bastion opens the Bastion page instead, before its own sheet draws anything (no flash of a
  // second window): a forced first render of any journal sheet on a Bastion's entry is cancelled in _canRender.
  const DocSheet = foundry.applications.api.DocumentSheetV2;
  const canRender = DocSheet?.prototype?._canRender;
  if (canRender && !canRender.dxpbWrapped) {
    const wrapped = function (options) {
      const doc = this.document;
      if (options?.force && !this.rendered && doc?.documentName === "JournalEntry" && isBastionEntry(doc)) {
        BastionSheet.open(doc.id);
        return false;
      }
      return canRender.call(this, options);
    };
    wrapped.dxpbWrapped = true;
    DocSheet.prototype._canRender = wrapped;
  }
  // A journal sheet that draws anyway (its class skips the check above): close it and open the Bastion page.
  Hooks.on("renderJournalEntrySheet", (app) => {
    if (!isBastionEntry(app.document)) return;
    const id = app.document.id;
    app.close();
    BastionSheet.open(id);
  });

  // Character sheets show the Bastion in the system's own Bastion tab (apps/bastion-tab.js). The party's group sheet
  // has no such tab: a rook in its window header opens the Bastion page.
  Hooks.on("renderGroupActorSheet", (app, html) => {
    const actor = app.document ?? app.actor;
    const entry = bastionForActor(actor);
    if (!entry) return;
    const root = html instanceof HTMLElement ? html : html[0];
    const header = root.closest(".application")?.querySelector(".window-header") ?? root.querySelector(".window-header");
    if (!header || header.querySelector(".dxpb-open-bastion")) return;
    const label = t("OpenBastion", { name: getRecord(entry).name });
    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "header-control icon fa-solid fa-chess-rook dxpb-open-bastion";
    icon.dataset.tooltip = label;
    icon.setAttribute("aria-label", label);
    icon.addEventListener("click", () => BastionSheet.open(entry.id));
    const first = header.querySelector(".header-control");
    if (first) first.before(icon); else header.append(icon);
  });

  // A "Bastions" button in the journal sidebar.
  Hooks.on("renderJournalDirectory", (app, html) => {
    if (!game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : html[0];
    if (root.querySelector(".dxpb-dir-button")) return;
    const header = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
    if (!header) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dxpb-dir-button";
    btn.innerHTML = `<i class="fa-solid fa-chess-rook"></i> ${t("Dashboard.Short")}`;
    btn.addEventListener("click", () => new BastionDashboard().render({ force: true }));
    header.append(btn);
  });

  // Chat card buttons: event decisions, dividends, executing orders that arrived by dispatch.
  Hooks.on("renderChatMessageHTML", (message, html) => {
    bindSystemRulesCard(message, html);
    html.querySelectorAll("[data-dxpb-event]").forEach(btn => btn.addEventListener("click", async () => {
      let count;
      if (btn.dataset.count) {
        count = await foundry.applications.api.DialogV2.prompt({
          window: { title: t("Event.SendDefenders") },
          content: `<label>${t("Event.HowMany")}<input type="number" name="n" min="1" value="1" autofocus></label>`,
          ok: { callback: (ev, b) => Number(b.form.elements.n.value) || 1 }
        }).catch(() => null);
        if (!count) return;
      }
      const res = await request("resolveEvent", { entryId: btn.dataset.entry, eventId: btn.dataset.eventId, choice: btn.dataset.dxpbEvent, count });
      if (res?.ok === false && res.reason) ui.notifications.warn(res.reason);
      else html.querySelectorAll("[data-dxpb-event]").forEach(b => (b.disabled = true));
    }));
    html.querySelectorAll("[data-dxpb-dividend]").forEach(btn => btn.addEventListener("click", async () => {
      const res = await request("claimDividend", { entryId: btn.dataset.dxpbDividend });
      if (res?.ok === false && res.reason) ui.notifications.warn(res.reason);
    }));
    html.querySelectorAll("[data-dxpb-exec]").forEach(btn => btn.addEventListener("click", async () => {
      if (!game.user.isGM) return;
      const item = await fromUuid(btn.dataset.dxpbExec);
      const activity = item?.system?.activities?.find(a => a.type === "order");
      if (activity) await activity.use();
      else item?.sheet?.render(true);
    }));
  });
}

/* ---------------- Time and the system's own Bastion turn ---------------- */

const prompted = new Set();
function registerTime() {
  Hooks.on("updateWorldTime", async (worldTime) => {
    // With the long-rest clock the turns come from long rests, not the game clock.
    if (!isResponsibleGM() || clockMode() === "rests") return;
    const mode = setting("timePrompt");
    if (mode === "off") return;
    const span = rules().turnDays * SECONDS_PER_DAY;
    const due = allBastions().filter(e => worldTime - (getRecord(e).turn?.lastTime ?? 0) >= span);
    if (!due.length) return;
    // Each due Bastion runs every missed turn, one week at a time (at most a year of them at once).
    const catchUp = async (e) => {
      for (let i = 0; i < 52 && worldTime - (getRecord(e).turn?.lastTime ?? 0) >= span; i++) await runTurn(e);
    };
    if (mode === "auto") {
      for (const e of due) await catchUp(e);
      return;
    }
    const key = due.map(e => `${e.id}:${getRecord(e).turn?.number ?? 0}`).join(",");
    if (prompted.has(key)) return;
    prompted.add(key);
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("Advance.DueTitle") },
      content: `<p>${t("Advance.Due", { names: due.map(e => escapeHTML(getRecord(e).name)).join(", ") })}</p>`
    });
    if (ok) for (const e of due) await catchUp(e);
  });

  // The long-rest clock: a character finished a long rest on this client; the GM counts it for the party's Bastions.
  Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
    if (clockMode() !== "rests" || actor?.type !== "character") return;
    const long = result?.type === "long" || result?.longRest === true || config?.type === "long";
    if (!long || !bastionForActor(actor)) return;
    request("longRest", { actorUuid: actor.uuid });
  });
  // Enough long rests for a turn: run it, ask, or leave it (the "When time passes" setting).
  const askedRests = new Set();
  Hooks.on(`${MODULE_ID}.restCounted`, async ({ entryId, turnDue, rests }) => {
    if (!turnDue || !game.user.isGM) return;
    const entry = getEntry(entryId);
    const mode = setting("timePrompt");
    if (!entry || mode === "off") return;
    if (mode === "auto") return void await runTurn(entry);
    const key = `${entryId}:${rests?.count}`;
    if (askedRests.has(key)) return;
    askedRests.add(key);
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("Advance.DueTitle") },
      content: `<p>${t("Advance.DueRests", { names: escapeHTML(getRecord(entry).name) })}</p>`
    });
    if (ok) await runTurn(entry);
  });

  // The GM pressed the system's own Bastion Turn button: run this module's part of the turn once per Bastion.
  const recent = new Map();
  Hooks.on("createChatMessage", async (message) => {
    if (!isResponsibleGM() || !setting("processSystemTurns")) return;
    if (!message.getFlag("dnd5e", "bastion") || message.getFlag("dnd5e", "bastion")?.deaths !== undefined) return;
    const actor = message.speakerActor ?? game.actors.get(message.speaker?.actor);
    const entry = bastionForActor(actor);
    if (!entry || running.has(entry.id)) return;
    const last = recent.get(entry.id) ?? 0;
    if (Date.now() - last < 10000) return;
    recent.set(entry.id, Date.now());
    await runTurn(entry, { systemAdvance: false });
  });
}

/* ---------------- Hooks ---------------- */

function onInit() {
  registerSettings();
  // Optional: Dxcufgb's Debug Recorder gets a snapshot of the module's state (no names or text; see debug-snapshot.js).
  registerDebugRecorder({ snapshot: debugSnapshot });
  registerDebugCrumbs();
  registerBastionLayer();
  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/bastion-sheet.hbs`,
    `modules/${MODULE_ID}/templates/wizard.hbs`,
    `modules/${MODULE_ID}/templates/dashboard.hbs`
  ]);
  foundry.applications.handlebars.loadTemplates({ dxpbQueueButtons: `modules/${MODULE_ID}/templates/queue-buttons.hbs`,
    dxpbFacilityCard: `modules/${MODULE_ID}/templates/facility-card.hbs` });
  registerUI();
  if (game.system?.id === "dnd5e") registerBastionTab();
  // The Bastion Codex: the module's own journal page types for its compendium.
  try { registerCodex(); } catch (err) { console.error(`${MODULE_ID} | Bastion Codex`, err); }
  registerTime();
  const mod = game.modules.get(MODULE_ID);
  const api = {
    openDashboard: () => new BastionDashboard().render({ force: true }),
    openBastion: (entryId, opts) => BastionSheet.open(entryId, opts),
    openWizard: (opts) => new FoundingWizard(opts).render({ force: true }),
    getBastion(ref) {
      const entry = typeof ref === "string" ? getEntry(ref) : (ref?.documentName === "Actor" ? bastionForActor(ref) : ref);
      const record = getRecord(entry);
      if (!record) return null;
      return { entry, record, ...statsFor(record) };
    },
    allBastions: () => allBastions(),
    /** Builds or redraws the Bastion's battle-map scene (GM). */
    buildMap: (entryId) => buildMap(getEntry(entryId)),
    viewMap: (entryId) => viewMap(getRecord(getEntry(entryId))),
    /** The map as geometry, in squares (see core/mapplan.js). */
    mapPlan: (entryId) => planFor(getRecord(getEntry(entryId))),
    siegeHoldout(entryId, force) {
      const record = getRecord(getEntry(entryId));
      const { stats } = statsFor(record);
      return holdout(stats, typeof force === "string" ? FORCES[force] : force, rules());
    },
    act: (action, data) => request(action, data),
    async forceEvent(entryId, key) {
      if (!game.user.isGM) return null;
      const entry = getEntry(entryId);
      const record = getRecord(entry);
      const { stats, ctx } = statsFor(record);
      const base = EVENTS.find(e => e.key === key) ?? EVENTS[0];
      return applyEvent(entry, record, stats, ctx, { key: base.key, label: base.label, text: base.text, roll: null, source: "API" });
    },
    runTurn: (entryId, opts) => runTurn(getEntry(entryId), opts),
    runSelfTests: () => runSelfTests(),
    ownerActors: (entryId) => ownerActors(getRecord(getEntry(entryId))),
    core: engine
  };
  if (mod) mod.api = api;
  globalThis.DxcufgbsPlayerBastions = api;
}

function onReady() {
  registerDebugRecorder({ snapshot: debugSnapshot });
  registerSocket(ACTIONS);
  registerMapHooks();
  // The system's own Bastion rules can be off in a world: the GMs get one chat card offering to turn them on.
  postSystemRulesNotice().catch(err => console.warn(`${MODULE_ID} | system Bastion rules notice`, err));
  repaceAll();
  if (isResponsibleGM()) for (const entry of allBastions()) syncBastionNames(entry);
}

/**
 * Breadcrumbs for Dxcufgb's Debug Recorder at the module's own events (only while the GM records). Counts, booleans
 * and own ids only: the hooks' journal entries go in as their document id, never their name.
 */
function registerDebugCrumbs() {
  const id = e => e?.id ?? (typeof e === "string" ? e : null);
  const on = (name, fn) => Hooks.on(`${MODULE_ID}.${name}`, (...args) => crumb(name, () => fn(...args)));
  on("founded", entry => ({ docId: id(entry) }));
  on("projectStateChanged", (entry, p, from, to) => ({ docId: id(entry), kind: p?.kind ?? null, from: from ?? null, to: to ?? null }));
  on("postTurn", ({ entryId, report } = {}) => ({ docId: entryId, completed: report?.completed?.length ?? 0,
    started: report?.started?.length ?? 0, requeued: report?.requeued?.length ?? 0, layoutChanged: !!report?.layoutChanged }));
  on("restCounted", ({ entryId, counted, rests, completed, layoutChanged, turnDue } = {}) => ({ docId: entryId, counted: !!counted,
    rests: Number(rests?.sinceTurn ?? rests) || 0, completed: completed?.length ?? 0, layoutChanged: !!layoutChanged, turnDue: !!turnDue }));
  on("projectFinished", ({ entryId, projectId, completed, layoutChanged } = {}) => ({ docId: entryId, all: projectId === null,
    completed: completed?.length ?? 0, layoutChanged: !!layoutChanged }));
  on("mapBuilt", (entry, scene, plan) => ({ docId: id(entry), sceneId: scene?.id ?? null, walls: plan?.walls?.length ?? 0,
    breaches: plan?.breaches?.length ?? 0 }));
  on("dispatchSent", entry => ({ docId: id(entry) }));
  on("eventRolled", entry => ({ docId: id(entry) }));
  on("eventResolved", entry => ({ docId: id(entry) }));
  on("siegeStarted", entry => ({ docId: id(entry) }));
  on("siegeEnded", entry => ({ docId: id(entry) }));
  on("bastionDeleted", ({ entryId } = {}) => ({ docId: entryId }));
  Hooks.once("ready", () => crumb("module.ready", { responsibleGM: isResponsibleGM(), bastions: allBastions().length, clock: clockMode() }));
}

/**
 * Unfinished projects follow the build pace: re-time any planned at another pace. Old saves also get their separate
 * "Reinforce Stone Wall" and "Wall Walk" folded into the Stone Wall's tiers. Responsible GM.
 */
async function repaceAll() {
  if (!isResponsibleGM()) return;
  const { patchRecord, writeRecordKeys } = await import("./store.js");
  for (const entry of allBastions()) {
    const record = getRecord(entry);
    const fold = engine.foldLegacyWalls(record.features, record.projects);
    if (fold.changed) await writeRecordKeys(entry, { ...record, features: fold.features, projects: fold.projects }, ["features", "projects"]);
    const { projects, changed } = engine.repaceProjects(getRecord(entry).projects, rules().pace);
    if (changed) await patchRecord(entry, { projects });
    await repriceBastion(entry);
  }
}

/**
 * Re-prices a Bastion's planned and queued projects for the current price model (projects already under way keep the
 * price they were started at). Gold already paid beyond the new price goes into the Bastion's treasury.
 */
async function repriceBastion(entry) {
  const { patchRecord } = await import("./store.js");
  const record = getRecord(entry);
  const R = rules();
  const { stats } = statsFor(record);
  const changes = {};
  let surplus = 0;
  for (const p of Object.values(record.projects ?? {})) {
    if (!["planned", "queued"].includes(p.state)) continue;
    if (engine.samePrice(p.price ?? { scale: 1, power: 1 }, R.price)) continue;
    const grounds = p.kind === "grounds";
    const exp = grounds ? engine.GROUNDS_PROJECT : catalog().get(p.expansionId);
    if (!exp) continue;
    const q = engine.quote(record, exp, { kind: p.kind, size: p.size, count: p.count, featureId: p.featureId, rush: p.rush,
      extraCrews: p.extraCrews, groundsBase: grounds ? engine.extendGroundsBase(record, catalog(), R) : undefined }, stats, R);
    if (!q.ok) continue;
    const funded = Math.min(p.funded ?? 0, q.cost);
    surplus += (p.funded ?? 0) - funded;
    changes[`projects.${p.id}`] = { ...p, cost: q.cost, funded, price: q.price };
  }
  if (!Object.keys(changes).length) return;
  if (surplus > 0) changes.treasury = (record.treasury ?? 0) + surplus;
  await patchRecord(entry, changes);
}

Hooks.once("init", onInit);
Hooks.once("ready", onReady);

/** Redraws every open Bastion list (on every client: these hooks run wherever the change arrives). */
function refreshDashboards() {
  for (const app of foundry.applications.instances.values()) if (app instanceof BastionDashboard && app.rendered) app.render();
}

/**
 * Open character sheets show or drop the Bastion tab (and its page) when a Bastion is founded, deleted or changes
 * owners.
 */
function refreshCharacterSheets() {
  for (const app of foundry.applications.instances.values()) {
    if (app.rendered && app.document?.documentName === "Actor" && app.document.type === "character") app.render();
  }
}

Hooks.on("updateJournalEntry", (entry, changes) => {
  if (!isBastionEntry(entry)) return;
  BastionSheet.refresh(entry.id);
  refreshDashboards();
  const flat = foundry.utils.flattenObject(changes?.flags?.[MODULE_ID] ?? {});
  if (Object.keys(flat).some(k => /(^|\.)(ownerUuids|groupUuid)(\.|$)/.test(k) || k === "record")) refreshCharacterSheets();
  // The system's Bastion name on the owners' sheets follows the Bastion's name.
  if (isResponsibleGM()) syncBastionNames(entry);
});

// A Bastion founded or deleted (by anyone) shows up in or leaves the Bastion list at once; a deleted one's sheet closes.
Hooks.on("createJournalEntry", (entry) => {
  if (!isBastionEntry(entry)) return;
  refreshDashboards();
  refreshCharacterSheets();
  if (isResponsibleGM()) syncBastionNames(entry);
});
Hooks.on("deleteJournalEntry", (entry) => {
  if (!isBastionEntry(entry)) return;
  const sheet = BastionSheet.instances.get(entry.id);
  BastionSheet.instances.delete(entry.id);
  if (sheet?.rendered) sheet.close();
  for (const panel of [...BastionSheet.embeddedPanels]) if (panel.entryId === entry.id) panel.close();
  refreshDashboards();
  refreshCharacterSheets();
});

// Facility and actor changes (defenders, hirelings, gold) change the stats too.
for (const hook of ["updateItem", "createItem", "deleteItem", "updateActor"]) {
  Hooks.on(hook, (doc) => {
    const actor = doc.documentName === "Item" ? doc.parent : doc;
    if (!actor) return;
    const entry = bastionForActor(actor);
    if (entry) BastionSheet.refresh(entry.id);
  });
}

Hooks.on("quenchReady", (quench) => registerQuench(quench));

/**
 * Late boot: when this file is imported into a running world where the module isn't registered yet (a new module
 * folder the server hasn't scanned, e.g. while developing), run the init and ready steps now, and load the
 * language file, stylesheet and Quench batches by hand. A normally installed module never takes this path.
 */
if (globalThis.game?.ready && !game.modules.get(MODULE_ID)?.active) {
  (async () => {
    try {
      const lang = await fetch(`modules/${MODULE_ID}/lang/en.json`).then(r => r.json());
      foundry.utils.mergeObject(game.i18n.translations, lang);
    } catch (err) { console.error(`${MODULE_ID} | late boot: language file`, err); }
    if (!document.querySelector(`link[data-dxpb]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `modules/${MODULE_ID}/styles/player-bastions.css`;
      link.dataset.dxpb = "1";
      document.head.append(link);
    }
    // A module the server hasn't registered yet has no flag scope; allow ours for this page only.
    const db = CONFIG.DatabaseBackend;
    if (db?.getFlagScopes && !db.getFlagScopes().includes(MODULE_ID)) {
      const original = db.getFlagScopes.bind(db);
      db.getFlagScopes = () => {
        const scopes = original();
        return scopes.includes(MODULE_ID) ? scopes : [...scopes, MODULE_ID];
      };
    }
    onInit();
    onReady();
    if (globalThis.quench) registerQuench(globalThis.quench);
    ui.controls?.render?.({ reset: true });
    console.log(`${MODULE_ID} | late boot done`);
  })();
}
