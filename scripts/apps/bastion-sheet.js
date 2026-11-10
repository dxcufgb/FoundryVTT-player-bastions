import { MODULE_ID, TEMPLATE_PATH, t, gp, coins, daysText, workText, clockMode, rules, catalog, formatGameTime, now, escapeHTML, setting, SECONDS_PER_DAY, whenText, dueText } from "../util.js";
import { restsToTurn } from "../core/rests.js";
import { crewStatus, projectTeams, queueOrder } from "../core/crews.js";
import { getEntry, getRecord, canAct, ownerActors } from "../store.js";
import { statsFor } from "../context.js";
import { request } from "../socket.js";
import { GROUPS, SIZES, SIZE_LABELS, ENLARGE } from "../data/catalog.js";
import { TERRAINS, SITES, bastionImage } from "../data/location.js";
import { STRUCTURES } from "../data/structures.js";
import { FORCES, QUALITY, ENGINES, DISPATCH_METHODS, BEACON_SIGNALS } from "../data/tables.js";
import { prerequisites } from "../core/catalog.js";
import { quote, planProject, GROUNDS_PROJECT } from "../core/projects.js";
import { footprintOf, extendGroundsBase, groundsInfo } from "../core/grounds.js";
import { SIZE_FOOTPRINT } from "../data/grounds.js";
import { holdout } from "../core/siege.js";
import { syncLayout } from "../core/layout.js";
import { buildMap, viewMap, mapScene } from "../map.js";
import { quoteDispatch, orderCount } from "../core/dispatch.js";
import { partyDistance } from "../marker.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const TABS = ["overview", "stats", "defense", "facilities", "projects", "dispatches", "trade", "history"];
const STAT_KEYS = ["accessibility", "concealment", "security", "prosperity", "renown", "comfort"];

/**
 * The Bastion page: one window per Bastion with eight tabs. Players see their own Bastion; the GM sees all.
 * Re-renders when the Bastion's journal changes (main.js hook). Drafts (dispatch being written, siege calculator)
 * live on the app instance so a re-render keeps them.
 */
/** "days" or "long rests", for lists of work days. */
function workUnit() {
  return clockMode() === "rests" ? t("LongRests") : t("Days");
}

export class BastionSheet extends HandlebarsApplicationMixin(ApplicationV2) {
  static instances = new Map();

  static open(entryId, { tab } = {}) {
    let app = this.instances.get(entryId);
    if (!app) {
      app = new this({ entryId });
      this.instances.set(entryId, app);
    }
    if (tab) app.tab = tab;
    app.render({ force: true });
    return app;
  }

  static refresh(entryId) {
    const app = this.instances.get(entryId);
    if (app?.rendered) app.render();
  }

  constructor(options = {}) {
    super(options);
    this.entryId = options.entryId;
    this.tab = "overview";
    this.calc = { troops: 150, quality: "soldiers", monsterCR: 0, monsterCount: 0, casterLevel: 0, casterCount: 0, engine: "light" };
    this.draft = { method: "envoy", orders: {}, maintain: false, payments: [], note: "", gold: 0, distance: null, slotLevel: 2, signal: "" };
    this.catalogFilter = "";
  }

  static DEFAULT_OPTIONS = {
    id: "dxpb-bastion-{id}",
    classes: ["dxpb", "dxpb-sheet"],
    tag: "div",
    window: { title: "DXPB.Title", icon: "fa-solid fa-chess-rook", resizable: true },
    position: { width: 860, height: 760 },
    actions: {
      // Not "tab": ApplicationV2 reserves that action for its own tab groups.
      dxpbTab: BastionSheet.#onTab,
      presence: BastionSheet.#onPresence,
      maintain: BastionSheet.#onMaintain,
      deposit: BastionSheet.#onDeposit,
      dividend: BastionSheet.#onDividend,
      advance: BastionSheet.#onAdvance,
      countRest: BastionSheet.#onCountRest,
      plan: BastionSheet.#onPlan,
      extendGrounds: BastionSheet.#onExtendGrounds,
      buildMap: BastionSheet.#onBuildMap,
      viewMap: BastionSheet.#onViewMap,
      featureProject: BastionSheet.#onFeatureProject,
      fund: BastionSheet.#onFund,
      removeProject: BastionSheet.#onRemoveProject,
      construction: BastionSheet.#onConstruction,
      finishProject: BastionSheet.#onFinishProject,
      finishAllProjects: BastionSheet.#onFinishAll,
      deleteBastion: BastionSheet.#onDeleteBastion,
      viewWare: BastionSheet.#onViewWare,
      hire: BastionSheet.#onHire,
      hireCrew: BastionSheet.#onHireCrew,
      queueProject: BastionSheet.#onQueueProject,
      siegeStart: BastionSheet.#onSiegeStart,
      siegeDay: BastionSheet.#onSiegeDay,
      siegeEnd: BastionSheet.#onSiegeEnd,
      openFacility: BastionSheet.#onOpenFacility,
      send: BastionSheet.#onSend,
      standing: BastionSheet.#onStanding,
      buy: BastionSheet.#onBuy,
      openMap: BastionSheet.#onOpenMap,
      editBastion: BastionSheet.#onEdit,
      dispatchStatus: BastionSheet.#onDispatchStatus
    }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/bastion-sheet.hbs`, scrollable: [".dxpb-tab-body"] } };

  get title() {
    const r = getRecord(getEntry(this.entryId));
    return r ? `${t("Title")}: ${r.name}` : t("Title");
  }

  _onClose(options) {
    super._onClose(options);
    BastionSheet.instances.delete(this.entryId);
  }

  /* ---------------------------------------------------------------- */

  async _prepareContext() {
    const entry = getEntry(this.entryId);
    const record = getRecord(entry);
    if (!record) return { missing: true };
    const { stats, ctx } = statsFor(record);
    const R = rules();
    const C = catalog();
    const isGM = game.user.isGM;
    const mine = canAct(record);
    const myActors = ownerActors(record).filter(a => isGM || a.isOwner);
    const present = record.presence === "present";

    const c = {
      entryId: this.entryId, isGM, mine, present, tab: this.tab, tabs: TABS.map(k => ({ key: k, label: t(`Tab.${k}`), active: k === this.tab })),
      record, name: record.name, description: record.description,
      image: bastionImage(record), terrain: TERRAINS[record.location?.terrain]?.label ?? "", site: SITES[record.location?.site]?.label ?? "",
      structure: STRUCTURES[record.structure?.type]?.label ?? "",
      treasury: gp(record.treasury), dividends: record.dividends ?? 0, dividendsText: gp(record.dividends),
      nextTurn: formatGameTime((record.turn?.lastTime ?? 0) + R.turnDays * SECONDS_PER_DAY),
      restClock: clockMode() === "rests", restsToTurn: restsToTurn(record.rests, R.turnDays), restCount: record.rests?.count ?? 0,
      lastTurn: record.turn?.number ?? 0,
      owners: ownerActors(record).map(a => ({ name: a.name, img: a.img })),
      myActors: myActors.map(a => ({ id: a.id, name: a.name, gp: a.system?.currency?.gp ?? 0 })),
      siege: record.siege, maintainOrder: record.maintainOrder,
      neglect: record.neglect ?? 0, neglectWarn: (record.neglect ?? 0) >= Math.max(1, ctx.partyLevel - 1),
      pendingEvents: Object.values(record.events ?? {}).filter(e => e.state === "pending").map(e => ({ label: e.label, summary: e.summary })),
      vault: (record.vault ?? []).map(v => ({ name: v.name, gp: v.gp ? gp(v.gp) : "" })),
      marker: !!record.marker
    };

    /* Stats */
    c.statCards = STAT_KEYS.map(k => ({
      key: k, label: t(`Stat.${k}`), value: stats[k], pct: stats[k] * 10,
      tangible: tangible(k, stats, record, R),
      breakdown: (stats.breakdown[k] ?? []).map(b => `${b.source}: ${b.value > 0 ? "+" : ""}${b.value}`).join(" · ")
    }));
    c.numbers = [
      { label: t("Num.Population"), value: stats.population, note: t("Num.PopulationNote", stats.people) },
      { label: t("Num.Housing"), value: stats.housing, note: stats.housing && stats.population > stats.housing ? t("Num.Crowded") : t("Num.Beds", { n: Math.max(0, stats.housing - stats.population) }) },
      { label: t("Num.Food"), value: `${Math.round(stats.food.stock)} / ${stats.food.cap}`, note: Number.isFinite(stats.food.peaceDays)
        ? t("Num.FoodNote", { peace: daysText(stats.food.peaceDays), siege: daysText(stats.food.siegeDays), net: stats.food.peaceNet })
        : t("Num.FoodNoteGrowing", { siege: daysText(stats.food.siegeDays), net: stats.food.peaceNet }) },
      { label: t("Num.Water"), value: stats.water.unlimited ? t("Unlimited") : daysText(stats.water.days), note: stats.water.unlimited ? t("Num.WellInside") : t("Num.WaterNote") },
      { label: t("Num.Income"), value: gp(stats.economy.incomeAverage), note: t("Num.IncomeNote", { tax: gp(stats.economy.tax) }) },
      { label: t("Num.Upkeep"), value: gp(stats.economy.upkeep), note: t("Num.UpkeepNote") },
      { label: t("Num.Net"), value: gp(stats.economy.net), note: stats.economy.net >= 0 ? t("Num.Dividend", { gold: gp(stats.economy.dividend),
        pct: record.dividendPct ?? R.dividendPct }) : t("Num.Losing"), good: stats.economy.net >= 0 },
      { label: t("Num.Merchants"), value: `${stats.merchant.chance}%`, note: t("Num.MerchantNote", { tier: stats.merchant.tier.label }) },
      { label: t("Num.Travel"), value: daysText(stats.travel.days), note: t("Num.TravelNote", { miles: stats.travel.distance,
        name: record.location?.settlement?.name || t("Settlement"), road: stats.travel.roadTier }) },
      { label: t("Num.Grounds"), value: t("GroundsSize", { label: stats.grounds.label, side: stats.grounds.side }),
        note: t("Num.GroundsNote", { free: stats.grounds.free, usable: stats.grounds.usable, perimeter: stats.grounds.perimeter }),
        good: stats.grounds.free > 0 },
      { label: t("Num.Crews"), value: stats.crews, note: t("Num.CrewsNote") },
      { label: t("Num.Wards"), value: `${stats.wards}%`, note: t("Num.WardsNote") }
    ];

    /* Defense */
    c.defense = {
      garrison: stats.garrison, walled: stats.defense.walled, breached: stats.defense.breached,
      wall: t(`Wall.${stats.wall.type}`), enclosed: stats.wall.enclosed, integrity: stats.wall.integrity,
      guards: record.garrison?.guards ?? 0, servants: record.garrison?.servants ?? 0, mercenaries: record.garrison?.mercenaries ?? 0,
      guardsCap: Math.max(stats.fx.guardsCap ?? 0, record.garrison?.guards ?? 0),
      servantsCap: Math.max(stats.fx.servantsCap ?? 0, record.garrison?.servants ?? 0), dmgDefenders: ctx.dmgDefenders, armory: ctx.armoryStocked
    };
    c.siegeRows = Object.entries(FORCES).map(([key, f]) => {
      const h = holdout(stats, f, R);
      return { key, label: f.label, strength: Math.round(h.strength), breach: Number.isFinite(h.breachDay) ? h.breachDay : "—",
        days: Number.isFinite(h.days) ? h.days : "∞", reason: t(`Reason.${h.reason}`), bad: h.days <= 7 };
    });
    const custom = this.customForce();
    const ch = holdout(stats, custom, R);
    c.calc = { ...this.calc, qualities: Object.keys(QUALITY).map(k => ({ k, label: t(`Quality.${k}`), sel: k === this.calc.quality })),
      engines: Object.keys(ENGINES).map(k => ({ k, label: t(`Engine.${k}`), sel: k === this.calc.engine })),
      strength: Math.round(ch.strength), days: daysText(ch.days), reason: t(`Reason.${ch.reason}`),
      breach: Number.isFinite(ch.breachDay) ? ch.breachDay : "—" };
    if (record.siege) c.siegeState = { day: record.siege.day ?? 0, integrity: Math.round(record.siege.integrity ?? 0),
      food: Math.round(record.siege.food ?? 0), estimate: record.siege.estimate ?? "∞", fallen: record.siege.fallen ? t(`Reason.${record.siege.fallen}`) : null,
      force: record.siege.force?.label ?? t("Siege.Custom") };

    /* Facilities (dnd5e) */
    c.facilities = ctx.facilities.map(f => ({ ...f, typeLabel: f.type === "special" ? t("Facility.Special") : t("Facility.Basic"),
      progressText: f.progress?.max ? `${f.progress.order}: ${f.progress.value}/${f.progress.max} ${t("Days")}` : "",
      orderLabel: f.order ? game.i18n.localize(`DND5E.FACILITY.Orders.${f.order}.inf`) : "" }));

    /* Projects */
    const crew = crewStatus(record, stats);
    // Started first (building, then paused), then the party's queue in its order, then the planned ones closest to
    // done: least gold left, then least work left.
    const queue = queueOrder(record.projects);
    const queueNo = new Map(queue.map((p, i) => [p.id, i + 1]));
    const startedRank = p => (p.state === "building" ? 0 : p.state === "paused" ? 1 : p.state === "queued" ? 2 : 3);
    const goldLeft = p => Math.max(0, (p.cost ?? 0) - (p.funded ?? 0));
    const workLeft = p => Math.max(0, (p.days ?? 0) - (p.progress ?? 0));
    const projects = Object.values(record.projects ?? {}).filter(p => p.state !== "cancelled" && p.state !== "complete")
      .sort((a, b) => startedRank(a) - startedRank(b) || (queueNo.get(a.id) ?? 0) - (queueNo.get(b.id) ?? 0)
        || goldLeft(a) - goldLeft(b) || workLeft(a) - workLeft(b) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
    c.projects = projects.map(p => ({ ...p,
      stateLabel: p.state === "queued" ? t("BuildQueue.Place", { n: queueNo.get(p.id) }) : t(`State.${p.state}`),
      inQueue: p.state === "queued", queueFirst: queueNo.get(p.id) === 1, queueLast: queueNo.get(p.id) === queue.length,
      canAddQueue: p.state === "planned", queueRow: p.state === "planned" || p.state === "queued", costText: gp(p.cost), fundedText: gp(p.funded),
      fundPct: p.cost ? Math.round(100 * p.funded / p.cost) : 100, progressPct: p.days ? Math.round(100 * p.progress / p.days) : 0,
      remaining: Math.max(0, p.cost - p.funded), daysText: workText(p.days), finish: p.state === "building" ? this.#finishText(record, p) : "",
      canStart: ["planned", "queued", "paused"].includes(p.state), canPause: p.state === "building", canQueue: p.state === "planned",
      canResume: p.state === "paused", mineOrGM: isGM || p.createdBy === game.user.id,
      teams: projectTeams(p), teamsText: t("Crews.OnProject", { n: projectTeams(p) }),
      waiting: p.state === "queued" ? (!setting("payAsYouBuild") && (p.funded ?? 0) < (p.cost ?? 0) ? t("Crews.WaitFunds") : t("Crews.WaitCrew")) : "",
      // 1 crew up to every crew the Bastion has (and the house-rule cap); a running project can only take free crews.
      crews: Array.from({ length: Math.max(projectTeams(p), Math.min(crew.total, 1 + R.maxExtraCrews)) }, (_, i) => i).map(n => ({ n,
        label: t("Crews.Option", { n: n + 1 }), sel: n === (p.extraCrews ?? 0),
        disabled: p.state === "building" && n + 1 > crew.free + projectTeams(p) })) }));
    // Building crews: how many the Bastion has and how many are at work.
    c.crew = { ...crew, icons: Array.from({ length: Math.max(crew.total, crew.used) }, (_, i) => ({ busy: i < crew.used, over: i >= crew.total })),
      text: t("Crews.Status", { used: crew.used, total: crew.total, free: crew.free }),
      parts: t("Crews.Parts", { hired: crew.hired, lodge: crew.lodge }),
      hireCost: gp(R.crewHireCost ?? 0), upkeep: gp(R.crewUpkeep ?? 0), canHire: crew.hired < R.maxHiredCrews, canDismiss: crew.hired > 0 && crew.total - 1 >= crew.used,
      queued: projects.filter(p => p.state === "queued").length };
    // Totals for the column headers: gold paid in of the total, and work done of the total.
    c.projectTotals = {
      funding: `${gp(projects.reduce((n, p) => n + (p.funded ?? 0), 0))} / ${gp(projects.reduce((n, p) => n + (p.cost ?? 0), 0))}`,
      build: `${projects.reduce((n, p) => n + (p.progress ?? 0), 0)} / ${projects.reduce((n, p) => n + (p.days ?? 0), 0)} ${workUnit()}`
    };
    c.done = Object.values(record.projects ?? {}).filter(p => p.state === "complete").slice(-10).reverse()
      .map(p => ({ label: p.label, when: whenText(p.completedAt ?? 0) }));
    /* Grounds: room inside the walls */
    const g = stats.grounds;
    const growing = Object.values(record.projects ?? {}).find(p => p.kind === "grounds" && !["complete", "cancelled"].includes(p.state));
    let extend = null;
    if (g.next && !growing) {
      const base = extendGroundsBase(record, C, R);
      const q = base.ok ? quote(record, GROUNDS_PROJECT, { kind: "grounds", groundsBase: base }, stats, R) : null;
      if (q?.ok) extend = { to: t("GroundsSize", { label: base.to.label, side: base.to.side }), cost: gp(q.cost), days: workText(q.days),
        gain: base.to.usable - g.usable };
    }
    c.grounds = { ...g, size: t("GroundsSize", { label: g.label, side: g.side }),
      usedPct: g.usable ? Math.min(100, Math.round(100 * g.used / g.usable)) : 100,
      reservedPct: g.usable ? Math.min(100, Math.round(100 * g.reserved / g.usable)) : 0,
      full: g.free <= 0, extend, growing: growing?.label ?? "", largest: !g.next };
    c.map = { exists: !!mapScene(record), waiting: syncLayout(record, C, R).unplaced.map(u => C.get(u.id)?.name ?? u.id).join(", ") };
    const filter = this.catalogFilter.toLowerCase();
    c.catalogFilter = this.catalogFilter;
    // What one of every building the Bastion doesn't have yet would take: the smallest size of a room, one of each, a
    // wall all the way round (as a palisade), a road to the settlement. Today's prices and times, one crew, one by one.
    {
      const have = new Set(Object.values(record.features ?? {}).map(f => f?.id));
      const groups = Object.entries(GROUPS).map(([g, label]) => {
        let gold = 0, work = 0, n = 0;
        for (const e of C.values()) {
          if (e.group !== g || e.legacy || have.has(e.id)) continue;
          const count = e.unit === "square" ? stats.grounds.perimeter : e.unit === "mile" ? Math.ceil(record.location?.settlement?.distance || 1) : 1;
          const q = quote(record, e, { size: "cramped", count }, stats, R);
          if (!q.ok) continue;
          gold += q.cost;
          work += q.days;
          n++;
        }
        return { label, n, gold: gp(gold), work: `${work} ${workUnit()}`, rawGold: gold, rawWork: work };
      }).filter(x => x.n);
      const gold = groups.reduce((a, x) => a + x.rawGold, 0), work = groups.reduce((a, x) => a + x.rawWork, 0);
      c.everything = { n: groups.reduce((a, x) => a + x.n, 0), gold: gp(gold), work: `${work} ${workUnit()}`, groups };
    }
    c.catalog = Object.entries(GROUPS).map(([g, label]) => ({
      label,
      // Only what can be planned right now (the same checks as planning it: prerequisites, room, once-only, planned).
      items: [...C.values()].filter(e => e.group === g && !e.legacy && (!filter || e.name.toLowerCase().includes(filter))
        && planProject(record, C, stats, R, { expansionId: e.id, size: "cramped",
          count: e.unit === "square" ? stats.grounds.perimeter : e.unit === "mile" ? Math.ceil(record.location?.settlement?.distance || 1) : 1 },
          { id: "probe", now: 0 }).ok).map(e => {
        const pre = prerequisites(record, e, C, stats);
        const q = quote(record, e, { size: "cramped", count: 1 }, stats, R);
        // Room it needs (the smallest size for rooms); locked when even that doesn't fit.
        const fp = footprintOf(e, { size: "cramped", count: 1, tier: 1 });
        const space = e.unit === "sized" ? `${SIZES.map(s => (e.footprint ?? SIZE_FOOTPRINT[s])).join(" / ")} ${t("Sq")}`
          : fp ? `${fp} ${t("Sq")}${e.unit === "each" ? ` ${t("Unit.each")}` : ""}` : t("OutsideWalls");
        if (pre.ok && fp > g.free) pre.missing.push(t("NoRoom", { need: fp, free: g.free }));
        pre.ok = pre.missing.length === 0;
        const unit = e.unit === "square" ? t("Unit.square") : e.unit === "mile" ? t("Unit.mile") : e.unit === "each" ? t("Unit.each") : "";
        const sized = e.unit === "sized";
        const sizedQ = sized ? SIZES.map(sz => quote(record, e, { size: sz, count: 1 }, stats, R)) : [];
        const sizedDays = sizedQ.map(x => x.days);
        return { id: e.id, name: e.name, summary: e.summary ?? "", ok: pre.ok, missing: pre.missing.join(", "), dmg: !!e.dmg, space,
          cost: sized ? sizedQ.map(x => (x.cost ?? 0).toLocaleString()).join(" / ") + " GP" : `${gp(q.cost)}${unit ? ` ${unit}` : ""}`,
          days: sized ? `${sizedDays.join(" / ")} ${workUnit()}` : `${workText(q.days)}${unit ? ` ${unit}` : ""}`,
          upkeep: e.upkeep ? gp(e.upkeep) : "", tiers: (e.tiers ?? []).map(x => x.label).join(" → "),
          perks: perksText(e) };
      })
    })).filter(g => g.items.length);
    c.features = Object.entries(record.features ?? {}).map(([fid, f]) => {
      const e = C.get(f.id);
      if (!e) return null;
      const nextTier = e.tiers?.[(f.tier ?? 1)];
      // A building with a project planned or under way (enlarge, upgrade, repair) shows that instead of the buttons.
      const open = Object.values(record.projects ?? {}).find(p => p.featureId === fid && !["complete", "cancelled"].includes(p.state));
      return { fid, name: e.name, busy: open ? t(`Busy.${open.kind}`, { state: t(`State.${open.state}`) }) : "", size: f.size ? SIZE_LABELS[f.size] : "", count: f.count && e.unit !== "flat" ? f.count : "",
        squares: footprintOf(e, f),
        tier: e.tiers ? e.tiers[(f.tier ?? 1) - 1]?.label : "", damaged: !!f.damaged,
        canUpgrade: !!nextTier && !open, canRepair: !!f.damaged && !open,
        upgradeLabel: nextTier ? `${nextTier.label} (${gp(quote(record, e, { kind: "upgrade", featureId: fid }, stats, R).cost ?? nextTier.cost)})` : "",
        canEnlarge: e.unit === "sized" && !!ENLARGE[f.size] && !open, group: GROUPS[e.group] };
    }).filter(Boolean).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

    /* Dispatches */
    const dist = this.draft.distance ?? partyDistance(record);
    const draftOrders = this.draftOrders(record, ctx);
    c.dispatch = {
      distance: dist ?? "", distanceKnown: dist !== null && dist !== undefined, away: !present,
      methods: Object.entries(DISPATCH_METHODS).map(([k, m]) => {
        const q = quoteDispatch(k, stats, R, record, { distance: dist ?? 0, slotLevel: this.draft.slotLevel, orders: orderCount(draftOrders),
          strict: !!setting("strictDispatch"), siege: !!record.siege });
        return { k, label: m.label, sel: k === this.draft.method, ok: q.ok, reason: q.reason ?? "", note: m.note,
          time: q.ok ? (q.instant ? t("Instant") : q.waitDice ? `${q.days} + ${q.waitDice} ${t("Days")}` : daysText(q.days)) : "",
          cost: q.ok ? gp(q.cost) : "", risk: q.ok ? `${q.risk}%` : "", capacity: q.ok ? (Number.isFinite(q.capacity) ? q.capacity : "∞") : "" };
      }),
      method: this.draft.method,
      facilityOrders: ctx.facilities.filter(f => f.type === "special").map(f => ({ uuid: f.uuid, name: f.name, order: f.order,
        orderLabel: f.order ? game.i18n.localize(`DND5E.FACILITY.Orders.${f.order}.inf`) : "", checked: !!this.draft.orders[f.uuid],
        detail: this.draft.orders[f.uuid]?.detail ?? "" })),
      maintain: this.draft.maintain, note: this.draft.note, gold: this.draft.gold, slotLevel: this.draft.slotLevel,
      projects: projects.filter(p => p.funded < p.cost).map(p => ({ id: p.id, label: p.label, remaining: p.cost - p.funded,
        amount: this.draft.payments.find(x => x.projectId === p.id)?.gp ?? "" })),
      signals: Object.entries(BEACON_SIGNALS).map(([k, label]) => ({ k, label, sel: k === this.draft.signal })),
      count: orderCount(draftOrders),
      list: Object.values(record.dispatches ?? {}).sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0)).slice(0, 30).map(d => ({
        ...d, methodLabel: DISPATCH_METHODS[d.method]?.label ?? d.method, statusLabel: t(`Dispatch.${d.status}`),
        sent: whenText(d.sentAt ?? 0), arrives: d.status === "transit" ? dueText(d.arrivesAt ?? 0, record) : whenText(d.arrivesAt ?? 0), ordersText: (d.orders ?? []).length,
        transit: d.status === "transit" })),
      standing: (record.standingOrders ?? []).map(o => o.facilityName ? `${o.facilityName}: ${o.order}` : (o.text ?? "")).join("; "),
      canStanding: !!stats.flags.standingOrders
    };

    /* Trade */
    c.merchant = record.merchant ? { ...record.merchant, leaves: dueText(record.merchant.leavesAt ?? 0, record),
      stock: (record.merchant.stock ?? []).map((w, i) => ({ ...w, i, priceText: coins(w.price) })) } : null;

    /* History */
    c.history = (record.history ?? []).slice(0, 30).map(h => ({ ...h, when: whenText(h.time ?? 0), mode: t(`Mode.${h.mode}`),
      incomeText: gp(h.income), upkeepText: gp(h.upkeep), treasuryText: gp(h.treasury) }));
    c.events = Object.values(record.events ?? {}).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 20)
      .map(e => ({ label: e.label, when: whenText(e.at ?? 0), summary: e.summary, outcome: e.outcome ?? "", state: t(`State.${e.state}`) }));
    return c;
  }

  customForce() {
    const c = this.calc;
    return { troops: Number(c.troops) || 0, quality: c.quality, engine: c.engine,
      monsters: c.monsterCount ? [{ cr: Number(c.monsterCR) || 0, count: Number(c.monsterCount) || 0 }] : [],
      casters: c.casterCount ? [{ level: Number(c.casterLevel) || 0, count: Number(c.casterCount) || 0 }] : [], label: t("Siege.Custom") };
  }

  draftOrders(record, ctx) {
    const orders = [];
    if (this.draft.maintain) orders.push({ type: "maintain" });
    for (const [uuid, o] of Object.entries(this.draft.orders)) {
      const f = ctx.facilities.find(x => x.uuid === uuid);
      if (f) orders.push({ type: "facility", facility: uuid, facilityUuid: uuid, facilityName: f.name, order: f.order, detail: o.detail ?? "" });
    }
    for (const p of this.draft.payments) if (p.gp > 0) orders.push({ type: "payment", projectId: p.projectId, gp: p.gp,
      projectLabel: record.projects?.[p.projectId]?.label });
    if (this.draft.signal) orders.push({ type: "signal", signal: this.draft.signal });
    if (this.draft.note) orders.push({ type: "note", text: this.draft.note });
    return orders;
  }

  /**
   * Re-render after a change without losing the field the user moved to. A change fires as focus leaves a field,
   * so wait a tick for the new field to get focus, remember it, render, and focus it again.
   */
  #renderKeepFocus() {
    setTimeout(async () => {
      const a = document.activeElement;
      let sel = null;
      let caret = null;
      if (a && this.element?.contains(a) && a !== this.element) {
        const css = v => CSS.escape(v);
        if (a.name) sel = `[name="${css(a.name)}"]`;
        else if (a.dataset.draft) {
          sel = `[data-draft="${css(a.dataset.draft)}"]`
            + (a.dataset.uuid ? `[data-uuid="${css(a.dataset.uuid)}"]` : "")
            + (a.dataset.project ? `[data-project="${css(a.dataset.project)}"]` : "")
            + (a.type === "radio" ? `[value="${css(a.value)}"]` : "");
        } else if (a.dataset.calc) sel = `[data-calc="${css(a.dataset.calc)}"]`;
        try { caret = a.selectionStart; } catch { caret = null; }
      }
      await this.render();
      if (!sel) return;
      const el = this.element?.querySelector(sel);
      if (!el) return;
      el.focus();
      try { if (caret !== null && caret !== undefined) el.setSelectionRange(caret, caret); } catch { /* not a text field */ }
    }, 0);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    // Live inputs: calculator, dispatch draft, catalog filter.
    html.querySelectorAll("[data-calc]").forEach(el => el.addEventListener("change", () => {
      this.calc[el.dataset.calc] = el.value;
      this.#renderKeepFocus();
    }));
    html.querySelectorAll("[data-draft]").forEach(el => el.addEventListener("change", () => {
      const key = el.dataset.draft;
      if (key === "order") {
        if (el.checked) this.draft.orders[el.dataset.uuid] = { detail: "" };
        else delete this.draft.orders[el.dataset.uuid];
      } else if (key === "orderDetail") {
        if (this.draft.orders[el.dataset.uuid]) this.draft.orders[el.dataset.uuid].detail = el.value;
      } else if (key === "payment") {
        const v = Math.max(0, Math.floor(Number(el.value) || 0));
        this.draft.payments = this.draft.payments.filter(p => p.projectId !== el.dataset.project);
        if (v) this.draft.payments.push({ projectId: el.dataset.project, gp: v });
      } else if (key === "maintain") this.draft.maintain = el.checked;
      else if (key === "distance") this.draft.distance = el.value === "" ? null : Number(el.value);
      else if (["gold", "slotLevel"].includes(key)) this.draft[key] = Number(el.value) || 0;
      else this.draft[key] = el.value;
      // Free text changes nothing on the page: don't re-render, so typing in the next field isn't lost.
      if (["orderDetail", "note", "gold"].includes(key)) return;
      this.#renderKeepFocus();
    }));
    const filter = html.querySelector("[data-catalog-filter]");
    filter?.addEventListener("input", foundry.utils.debounce(() => {
      this.catalogFilter = filter.value;
      this.render().then(() => {
        const f = this.element.querySelector("[data-catalog-filter]");
        if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
      });
    }, 300));
  }

  /* ---------------------------------------------------------------- */

  static async #run(action, data) {
    const res = await request(action, data);
    if (res && res.ok === false && res.reason) ui.notifications.warn(res.reason === "noGM" ? t("Notify.NoGM") : res.reason);
    return res;
  }

  /** When a running project will be done: after N more long rests, or the date of the turn that finishes it. */
  #finishText(record, p) {
    const left = Math.max(0, (p.days ?? 0) - (p.progress ?? 0));
    if (clockMode() === "rests") return left <= 1 ? t("FinishesRest") : t("FinishesRests", { n: left });
    // Work moves on a turn at a time, so it is done at the turn that covers the last day.
    const span = rules().turnDays;
    const due = (record.turn?.lastTime ?? now()) + span * SECONDS_PER_DAY;
    return t("Finishes", { when: formatGameTime(due + (Math.max(1, Math.ceil(left / span)) - 1) * span * SECONDS_PER_DAY) });
  }

  static #onCountRest() {
    return BastionSheet.#run("countRest", { entryId: this.entryId });
  }

  static #onTab(event, target) {
    this.tab = target.dataset.tab;
    this.render();
  }

  static #onPresence(event, target) {
    return BastionSheet.#run("setPresence", { entryId: this.entryId, presence: target.dataset.value });
  }

  static #onMaintain(event, target) {
    return BastionSheet.#run("chooseMaintain", { entryId: this.entryId, on: target.dataset.value !== "off" });
  }

  static async #onDeposit(event, target) {
    const form = target.closest("[data-group]");
    const actorId = form.querySelector("[name=actor]")?.value;
    const amount = form.querySelector("[name=amount]")?.value;
    return BastionSheet.#run("deposit", { entryId: this.entryId, actorId, amount });
  }

  static #onDividend() {
    return BastionSheet.#run("claimDividend", { entryId: this.entryId });
  }

  static async #onAdvance(event, target) {
    const turns = Number(target.dataset.turns) || 1;
    const ok = await DialogV2.confirm({ window: { title: t("Advance.Title") }, content: `<p>${t("Advance.Confirm", { n: turns })}</p>` });
    if (ok) await BastionSheet.#run("advanceTurn", { entryId: this.entryId, turns });
  }

  static async #onPlan(event, target) {
    const exp = catalog().get(target.dataset.id);
    if (!exp) return;
    const record = getRecord(getEntry(this.entryId));
    const { stats } = statsFor(record);
    const fields = [];
    if (exp.unit === "sized") fields.push(`<label>${t("Plan.Size")}<select name="size">${SIZES.map(s => `<option value="${s}" ${footprintOf(exp, { size: s }) > stats.grounds.free ? "disabled" : ""}>${SIZE_LABELS[s]} (${gp(quote(record, exp, { size: s, count: 1 }, stats, rules()).cost)}, ${workText(quote(record, exp, { size: s, count: 1 }, stats, rules()).days)}, ${footprintOf(exp, { size: s })} ${t("Sq")})</option>`).join("")}</select></label>`);
    if (["square", "mile", "each"].includes(exp.unit)) {
      // A wall goes all the way round the grounds by default.
      const def = exp.unit === "mile" ? Math.ceil(record.location?.settlement?.distance || 1) : exp.unit === "square" ? stats.grounds.perimeter : 1;
      fields.push(`<label>${t(`Plan.Count.${exp.unit}`)}<input type="number" name="count" min="1" ${exp.max ? `max="${exp.max}"` : ""} value="${def}"></label>`);
    }
    if (exp.effects?.wall) fields.push(`<label class="dxpb-check"><input type="checkbox" name="enclosed" checked> ${t("Plan.Enclosed")}</label>`);
    fields.push(`<label class="dxpb-check"><input type="checkbox" name="rush"> ${t("Plan.Rush")}</label>`);
    const q = quote(record, exp, { size: "cramped", count: 1 }, stats, rules());
    const content = `<div class="dxpb-plan"><p><strong>${escapeHTML(exp.name)}</strong>: ${escapeHTML(exp.summary ?? "")}</p>
      <p class="dxpb-muted">${perksText(exp)}</p>${fields.join("")}<p class="dxpb-muted">${t("Plan.Hint", { cost: gp(q.cost), days: workText(q.days) })}</p>
      <p class="dxpb-muted"><i class="fa-solid fa-ruler-combined"></i> ${t("Plan.Room", { free: stats.grounds.free, perimeter: stats.grounds.perimeter })}</p></div>`;
    const result = await DialogV2.prompt({
      window: { title: t("Plan.Title") }, content,
      ok: { label: t("Plan.Add"), callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object }
    }).catch(() => null);
    if (!result) return;
    await BastionSheet.#run("planProject", { entryId: this.entryId, opts: { expansionId: exp.id, size: result.size, count: result.count,
      rush: !!result.rush, enclosed: exp.effects?.wall ? !!result.enclosed : true } });
  }

  static async #onBuildMap(event, target) {
    if (!game.user.isGM) return;
    target.disabled = true;
    const icon = target.querySelector("i");
    icon?.classList.add("fa-spin");
    try { await buildMap(getEntry(this.entryId)); }
    catch (err) { console.error(err); ui.notifications.error(t("Map.Failed", { error: err.message })); }
    finally { target.disabled = false; icon?.classList.remove("fa-spin"); }
  }

  static async #onViewMap() {
    await viewMap(getRecord(getEntry(this.entryId)));
  }

  static async #onExtendGrounds() {
    await BastionSheet.#run("planProject", { entryId: this.entryId, opts: { kind: "grounds" } });
  }

  static async #onFeatureProject(event, target) {
    await BastionSheet.#run("planProject", { entryId: this.entryId, opts: { kind: target.dataset.kind, featureId: target.dataset.fid } });
  }

  static async #onFund(event, target) {
    const row = target.closest("[data-project]");
    const amount = row.querySelector("[name=fundAmount]")?.value;
    const from = row.querySelector("[name=fundFrom]")?.value;
    return BastionSheet.#run("fundProject", { entryId: this.entryId, projectId: row.dataset.project, amount,
      actorId: from === "treasury" ? null : from, from: from === "treasury" ? "treasury" : "actor" });
  }

  static #onRemoveProject(event, target) {
    return BastionSheet.#run("removeProject", { entryId: this.entryId, projectId: target.closest("[data-project]").dataset.project });
  }

  static #onConstruction(event, target) {
    const row = target.closest("[data-project]");
    const op = target.dataset.op;
    // "crews" sets the extra crews from the row's picker; every other op is a state change.
    if (op === "crews") {
      const crews = row.querySelector("[name=crews]");
      return BastionSheet.#run("construction", { entryId: this.entryId, projectId: row.dataset.project, extraCrews: Number(crews?.value) || 0 });
    }
    return BastionSheet.#run("construction", { entryId: this.entryId, projectId: row.dataset.project, action: op || undefined });
  }

  static async #onFinishProject(event, target) {
    const row = target.closest("[data-project]");
    const p = getRecord(getEntry(this.entryId))?.projects?.[row.dataset.project];
    if (!p) return;
    const ok = await DialogV2.confirm({ window: { title: t("FinishNow") },
      content: `<p>${t("FinishNowConfirm", { label: escapeHTML(p.label) })}</p>` });
    if (!ok) return;
    return BastionSheet.#run("finishProject", { entryId: this.entryId, projectId: p.id });
  }

  static async #onFinishAll() {
    const open = Object.values(getRecord(getEntry(this.entryId))?.projects ?? {}).filter(p => !["complete", "cancelled"].includes(p.state));
    if (!open.length) return;
    const ok = await DialogV2.confirm({ window: { title: t("FinishAll") },
      content: `<p>${t("FinishAllConfirm", { n: open.length })}</p>` });
    if (!ok) return;
    return BastionSheet.#run("finishAllProjects", { entryId: this.entryId });
  }

  /** Opens a ware's item page (from its compendium) so players can read it before buying. */
  static async #onViewWare(event, target) {
    const uuid = target.dataset.uuid;
    let item = null;
    try { item = uuid ? await fromUuid(uuid) : null; } catch { item = null; }
    if (!item?.sheet) return ui.notifications.warn(t("Notify.WareMissing"));
    if (!item.testUserPermission(game.user, "LIMITED") && !game.user.isGM) return ui.notifications.warn(t("Notify.WareHidden"));
    return item.sheet.render(true);
  }

  /** GM: delete the Bastion for good, after typing DELETE. */
  static async #onDeleteBastion() {
    const record = getRecord(getEntry(this.entryId));
    if (!record || !game.user.isGM) return;
    const typed = await DialogV2.wait({
      window: { title: t("Delete.Title", { name: record.name }), icon: "fa-solid fa-triangle-exclamation" },
      classes: ["dxpb-delete-dialog"],
      content: `<p class="dxpb-warn"><strong>${t("Delete.Warning", { name: escapeHTML(record.name) })}</strong></p>
        <p>${t("Delete.What")}</p>
        <p>${t("Delete.TypePrompt")}</p>
        <input type="text" name="confirm" autocomplete="off" spellcheck="false" placeholder="DELETE">`,
      buttons: [
        { action: "delete", label: t("Delete.Button"), icon: "fa-solid fa-trash", class: "dxpb-danger",
          callback: (event, button) => button.form.elements.confirm.value },
        { action: "cancel", label: t("Delete.Cancel"), icon: "fa-solid fa-xmark", default: true, callback: () => null }
      ],
      render: (event, dialog) => {
        const el = dialog.element ?? dialog;
        const input = el.querySelector("input[name=confirm]");
        const del = el.querySelector("button[data-action=delete]");
        const check = () => { del.disabled = input.value !== "DELETE"; };
        input.addEventListener("input", check);
        check();
        input.focus();
      },
      rejectClose: false
    });
    if (typed !== "DELETE") return;
    const res = await BastionSheet.#run("deleteBastion", { entryId: this.entryId, confirm: typed });
    if (res?.ok !== false) {
      ui.notifications.info(t("Delete.Done", { name: record.name }));
      await this.close();
    }
    return res;
  }

  static #onHire(event, target) {
    const box = target.closest("[data-group]");
    return BastionSheet.#run("hire", { entryId: this.entryId, guards: box.querySelector("[name=guards]")?.value,
      servants: box.querySelector("[name=servants]")?.value });
  }

  /** The party's build queue: add, remove, up, down (data-op) for the project on this row. */
  static #onQueueProject(event, target) {
    const row = target.closest("[data-project]");
    return BastionSheet.#run("queueProject", { entryId: this.entryId, projectId: row.dataset.project, op: target.dataset.op });
  }

  /** Hires (data-delta 1) or dismisses (-1) a building crew, paid from the picker next to the button. */
  static #onHireCrew(event, target) {
    const box = target.closest("[data-group=crews]");
    const record = getRecord(getEntry(this.entryId));
    const from = box?.querySelector("[name=crewFrom]")?.value ?? "treasury";
    const actor = !["treasury", "free"].includes(from);
    return BastionSheet.#run("hireCrews", { entryId: this.entryId, crews: (record?.garrison?.crews ?? 0) + Number(target.dataset.delta || 0),
      from: actor ? "actor" : from, actorId: actor ? from : undefined });
  }

  static #onSiegeStart(event, target) {
    const key = target.dataset.force;
    return BastionSheet.#run("startSiege", { entryId: this.entryId, forceKey: key === "custom" ? undefined : key,
      force: key === "custom" ? this.customForce() : undefined });
  }

  static #onSiegeDay() {
    return BastionSheet.#run("siegeDay", { entryId: this.entryId });
  }

  static #onSiegeEnd() {
    return BastionSheet.#run("endSiege", { entryId: this.entryId });
  }

  static async #onOpenFacility(event, target) {
    const item = await fromUuid(target.dataset.uuid);
    item?.sheet?.render(true);
  }

  static async #onSend(event, target) {
    const record = getRecord(getEntry(this.entryId));
    const { ctx } = statsFor(record);
    const actorId = this.element.querySelector("[name=dispatchActor]")?.value;
    const orders = this.draftOrders(record, ctx);
    const res = await BastionSheet.#run("sendDispatch", { entryId: this.entryId, method: this.draft.method, actorId, orders,
      gold: this.draft.gold, distance: this.draft.distance ?? undefined, slotLevel: this.draft.slotLevel });
    if (res?.ok) {
      ui.notifications.info(res.instant ? t("Notify.SentInstant") : t("Notify.Sent", { when: dueText(res.arrivesAt, getRecord(getEntry(this.entryId))) }));
      this.draft = { ...this.draft, orders: {}, maintain: false, payments: [], note: "", gold: 0, signal: "" };
      this.render();
    }
  }

  static async #onStanding() {
    const record = getRecord(getEntry(this.entryId));
    const { ctx } = statsFor(record);
    const orders = Object.entries(this.draft.orders).map(([uuid, o]) => {
      const f = ctx.facilities.find(x => x.uuid === uuid);
      return f ? { facility: uuid, facilityName: f.name, order: f.order, detail: o.detail ?? "" } : null;
    }).filter(Boolean);
    if (this.draft.note) orders.push({ text: this.draft.note });
    const res = await BastionSheet.#run("setStanding", { entryId: this.entryId, orders });
    if (res?.ok) ui.notifications.info(t("Notify.StandingSet"));
  }

  static #onBuy(event, target) {
    const row = target.closest("[data-ware]");
    const actorId = this.element.querySelector("[name=buyActor]")?.value;
    const payFrom = this.element.querySelector("[name=buyFrom]")?.value;
    return BastionSheet.#run("buy", { entryId: this.entryId, index: Number(row.dataset.ware), actorId, payFrom });
  }

  static async #onOpenMap() {
    const record = getRecord(getEntry(this.entryId));
    const scene = record.marker?.sceneUuid ? await fromUuid(record.marker.sceneUuid) : null;
    if (!scene) return ui.notifications.warn(t("Notify.NoMarker"));
    if (!scene.testUserPermission(game.user, "LIMITED") && !game.user.isGM) return ui.notifications.warn(t("Notify.NoMapAccess"));
    await scene.view();
    canvas.animatePan({ x: record.marker.x, y: record.marker.y, scale: 1 });
  }

  static async #onEdit() {
    const { FoundingWizard } = await import("./wizard.js");
    new FoundingWizard({ entryId: this.entryId }).render({ force: true });
  }

  static #onDispatchStatus(event, target) {
    return BastionSheet.#run("setDispatchStatus", { entryId: this.entryId, dispatchId: target.dataset.id, status: target.dataset.status });
  }
}

/** What a score means in numbers, for its card. */
function tangible(key, stats, record, R) {
  switch (key) {
    case "accessibility": return t("Tangible.accessibility", { days: daysText(stats.travel.days), chance: stats.merchant.chance, mult: stats.materialFactor });
    case "concealment": return t("Tangible.concealment", { pct: stats.concealment * 10 });
    case "security": return t("Tangible.security", { rerolls: Math.max(0, stats.security - 5) });
    case "prosperity": return t("Tangible.prosperity", { income: gp(stats.economy.incomeAverage), tier: stats.merchant.tier.label });
    case "renown": return t("Tangible.renown", { pct: stats.renown * R.merchantPerRenown });
    case "comfort": return t("Tangible.comfort", { pct: stats.comfort * 10 });
    default: return "";
  }
}

/** A one-line list of an expansion's perks. */
export function perksText(e) {
  const src = e.tiers ? e.tiers[0].effects : e.effects;
  const parts = [];
  for (const [k, v] of Object.entries(src ?? {})) {
    const val = Array.isArray(v) ? v.join("/") : v;
    if (typeof val === "boolean") parts.push(game.i18n.has?.(`DXPB.Perk.${k}`) ? t(`Perk.${k}`) : k);
    else parts.push(game.i18n.has?.(`DXPB.Perk.${k}`) ? t(`Perk.${k}`, { v: val }) : `${k} ${val}`);
  }
  if (e.upkeep) parts.push(t("Perk.upkeep", { v: e.upkeep }));
  return parts.join(" · ");
}
