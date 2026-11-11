import { MODULE_ID, t, gp, daysText } from "../util.js";
import { GROUPS, SIZE_LABELS, ENLARGE } from "../data/catalog.js";
import { ROADS } from "../data/location.js";
import { MERCHANT_TIERS, DISPATCH_METHODS } from "../data/tables.js";
import { SECTIONS, sectionOfExpansion, sectionOfFacility, specialSlots, canTakeFacility } from "../core/sections.js";
import { planProject, quote } from "../core/projects.js";
import { featureEffects } from "../core/catalog.js";
import { footprintOf } from "../core/grounds.js";
import { codexUuid, codexArt } from "../core/codex.js";
import { averageFormula } from "../core/stats.js";
import { methodAvailable } from "../core/dispatch.js";
import { ownerActors } from "../store.js";

/**
 * The Facilities page (Bastion window and character sheet alike): the defenders by kind, then one section per kind of
 * building with a summary of what the Bastion has, its current limit and the buildings as cards: this module's
 * buildings and the dnd5e facilities on every owner's sheet. A card shows a double arrow when the building can be
 * upgraded (a wall tier, a bigger room, the next road step, a revenue tier, a facility that can be enlarged).
 */

export const SECTION_ICONS = { rooms: "fa-bed", fortifications: "fa-chess-rook", supplies: "fa-wheat-awn", access: "fa-road",
  trade: "fa-coins", staff: "fa-crown", arcane: "fa-wand-sparkles" };
const roadRank = e => ROADS[e?.effects?.roadTier]?.rank ?? 0;
const miles = record => Math.ceil(record.location?.settlement?.distance || 1);
const shortLabel = label => String(label ?? "").replace(/\s*\(.*\)\s*$/, "");


/**
 * The stat columns of each section: what a building adds to (or takes from) the Bastion. `get(fx, exp, f, ctx)` reads
 * the building's effects at its size, tier and count (featureEffects); `kind` says how a value and the total show:
 * "num" (summed), "pct" (summed, %), "gp" (summed, gold), "mult" (multiplied, ×), "text" (no total).
 */
const num = v => (typeof v === "number" && v !== 0 ? v : null);
export const SECTION_COLUMNS = {
  rooms: [
    { key: "beds", kind: "num", get: fx => num(fx.housing) },
    { key: "comfort", kind: "num", get: fx => num(fx.comfort) },
    { key: "feeds", kind: "num", get: fx => num(fx.kitchen) },
    { key: "squares", kind: "num", get: (fx, exp, f) => num(footprintOf(exp, f)) }
  ],
  fortifications: [
    { key: "defense", kind: "mult", get: (fx, exp, f, c) => fx.wall ? (c.R.walls?.[fx.wall]?.mult ?? null)
      : fx.defenseMult ?? (fx.defensePct ? 1 + fx.defensePct / 100 : null) },
    { key: "garrison", kind: "num", get: fx => num(fx.garrison) },
    { key: "integrity", kind: "num", get: (fx, exp, f, c) => num((fx.wall ? c.R.walls?.[fx.wall]?.integrity ?? 0 : 0) + (fx.integrity ?? 0)) },
    { key: "security", kind: "num", get: fx => num(fx.security) }
  ],
  supplies: [
    { key: "food", kind: "num", get: fx => num((fx.foodPerDay ?? 0) + (fx.foodOutside ?? 0)) },
    { key: "stores", kind: "num", get: fx => num(fx.foodStock) },
    { key: "water", kind: "text", get: fx => fx.waterUnlimited ? "∞" : num(fx.cistern) },
    { key: "income", kind: "gp", get: fx => num(fx.income) }
  ],
  access: [
    { key: "access", kind: "num", get: fx => num(fx.accessibility) },
    { key: "concealment", kind: "num", get: fx => num(fx.concealment) },
    { key: "merchants", kind: "pct", get: fx => num(fx.merchant) },
    { key: "income", kind: "gp", get: fx => num(fx.income) }
  ],
  trade: [
    { key: "income", kind: "gp", get: (fx, exp, f, c) => num((fx.income ?? 0) + (fx.tollPerAccess ? fx.tollPerAccess * c.stats.accessibility : 0)
      + (fx.incomeDice ? averageFormula(fx.incomeDice) : 0)) },
    { key: "merchants", kind: "pct", get: fx => num(fx.merchant) },
    { key: "renown", kind: "num", get: fx => num(fx.renown) }
  ],
  staff: [
    { key: "renown", kind: "num", get: fx => num(fx.renown) },
    { key: "comfort", kind: "num", get: fx => num(fx.comfort) },
    { key: "beds", kind: "num", get: fx => num(fx.housing) },
    { key: "crews", kind: "num", get: fx => num(fx.crews) }
  ],
  arcane: [
    { key: "security", kind: "num", get: fx => num(fx.security) },
    { key: "wards", kind: "pct", get: fx => num(fx.wards) },
    { key: "concealment", kind: "num", get: fx => num(fx.concealment) }
  ]
};
/** Every section ends with the upkeep. */
const UPKEEP_COLUMN = { key: "upkeep", kind: "gp", get: fx => num(fx.upkeep) };
const DEFENDER_COLUMNS = ["count", "garrison", "upkeep", "food"];

/** A value as the column shows it. */
function fmtValue(kind, v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v !== "number") return String(v);
  if (kind === "mult") return `×${Math.round(v * 100) / 100}`;
  if (kind === "pct") return `${v > 0 ? "+" : ""}${v}%`;
  if (kind === "gp") return gp(Math.round(v));
  return `${v > 0 && kind === "num" ? "" : ""}${Math.round(v * 10) / 10}`;
}

/** The total of a column over its rows. */
function totalOf(kind, values) {
  const nums = values.filter(v => typeof v === "number");
  if (!nums.length || kind === "text") return "";
  if (kind === "mult") return fmtValue(kind, nums.reduce((a, b) => a * b, 1));
  return fmtValue(kind, nums.reduce((a, b) => a + b, 0));
}

/** The system's advancement table for special facilities. */
function slotTable() {
  return CONFIG.DND5E?.facilities?.advancement?.special ?? {};
}

/** A plain description of a character for canTakeFacility. */
function who(actor) {
  return { level: actor.system?.details?.level ?? 0, facilities: (actor.itemTypes?.facility ?? []).map(i => ({
    type: i.system.type?.value, subtype: i.system.type?.subtype, name: i.name, free: !!i.system.free })) };
}

/** Why a character can't take a special facility, in words. */
export function takeReason(check, level) {
  if (check.ok) return "";
  if (check.reason === "level") return t("Fac.Need.Level", { level });
  if (check.reason === "have") return t("Fac.Need.Have");
  return t("Fac.Need.Slots", { used: check.used, max: check.max });
}

/** What a portrait list of defender actors looks like (world actors; unknown ones are skipped). */
function portraits(uuids) {
  const out = [];
  for (const uuid of uuids) {
    let doc = null;
    try { doc = fromUuidSync(uuid); } catch { doc = null; }
    if (doc) out.push({ uuid, name: doc.name, img: doc.img ?? doc.prototypeToken?.texture?.src });
  }
  return out;
}

/** The context for the Facilities tab. */
export function facilitiesPage({ record, stats, ctx, C, R, mine, actorId = null }) {
  const page = {};
  const owners = ownerActors(record).filter(a => a.type === "character");

  /* ----- Top line: room on the grounds, special facility slots per owner ----- */
  const g = stats.grounds;
  page.grounds = t("Fac.Grounds", { used: g.used + (g.reserved ?? 0), usable: g.usable, free: Math.max(0, g.free) });
  page.slots = owners.map(a => {
    const w = who(a);
    const used = w.facilities.filter(f => f.type === "special" && !f.free).length;
    return { text: t("Fac.Slots", { name: a.name, used, max: specialSlots(w.level, slotTable()) }), mine: a.id === actorId };
  });

  /* ----- Defenders ----- */
  const fx = stats.fx ?? {};
  const guards = record.garrison?.guards ?? 0;
  const mercs = record.garrison?.mercenaries ?? 0;
  const guardsCap = Math.max(fx.guardsCap ?? 0, guards);
  const live = ctx.facilities.filter(f => f.type === "special" && !f.disabled);
  const defenderUuids = live.flatMap(f => f.defenders ?? []);
  const defendersMax = live.reduce((n, f) => n + (f.defendersMax ?? 0), 0);
  const warRooms = live.filter(f => f.subtype === "warRoom");
  const codex = (kind, ref) => codexUuid(MODULE_ID, kind, ref, kind === "facility" ? C.get(ref)?.group ?? null : null);
  const defenderMult = (fx.defenderMult ?? 1) * (ctx.armoryStocked ? (R.armoryMult ?? 1) : 1);
  const foodOf = n => (n ? n * (R.foodPerPerson ?? 1) : null);
  const rows = [
    { key: "guards", codex: "guards", label: t("Fac.Def.guards"), count: guards,
      cap: guardsCap ? String(guardsCap) : "", note: guardsCap ? t("Fac.Def.guardsNote", { upkeep: gp(R.guardUpkeep ?? 0) }) : t("Fac.Def.guardsNone"),
      tab: "defense", always: true, stats: { count: guards, garrison: guards || null, upkeep: guards ? guards * (R.guardUpkeep ?? 0) : null, food: foodOf(guards) } },
    { key: "mercenaries", codex: "mercenaries", icon: "fa-sack-dollar", label: t("Fac.Def.mercenaries"), count: mercs, note: t("Fac.Def.mercenariesNote"), always: true,
      stats: { count: mercs, garrison: mercs || null, upkeep: null, food: foodOf(mercs) } },
    { key: "system", codex: "facility-defenders", icon: "fa-shield", label: t("Fac.Def.system"), count: ctx.dmgDefenders ?? 0, cap: defendersMax ? String(defendersMax) : "",
      note: ctx.armoryStocked ? t("Fac.Def.systemArmory") : t("Fac.Def.systemNote"), portraits: portraits(defenderUuids),
      stats: { count: ctx.dmgDefenders ?? 0, garrison: ctx.dmgDefenders ? Math.round(ctx.dmgDefenders * defenderMult * 100) / 100 : null, upkeep: null, food: foodOf(ctx.dmgDefenders) } },
    { key: "lieutenants", codex: "lieutenants", icon: "fa-chess-knight", label: t("Fac.Def.lieutenants"), count: ctx.lieutenants ?? 0,
      cap: warRooms.length ? String(warRooms.reduce((n, f) => n + (f.hirelingsMax ?? 0), 0)) : "", note: t("Fac.Def.lieutenantsNote"),
      portraits: portraits(warRooms.flatMap(f => f.hirelings ?? [])), show: warRooms.length > 0,
      stats: { count: ctx.lieutenants ?? 0, garrison: null, upkeep: null, food: null } },
    { key: "engines", codex: "engine-crews", icon: "fa-crosshairs", label: t("Fac.Def.engines"), count: fx.garrison ?? 0, note: t("Fac.Def.enginesNote"),
      stats: { count: fx.garrison ?? 0, garrison: fx.garrison || null, upkeep: null, food: null } }
  ].filter(r => r.always || r.show || r.count > 0 || r.cap);
  const defColumns = DEFENDER_COLUMNS.map(key => ({ key, label: t(`Fac.Col.${key}`),
    kind: key === "upkeep" ? "gp" : "num" }));
  for (const r of rows) {
    r.img = codexArt(MODULE_ID, r.codex, true);
    r.codex = codex("inhabitant", r.codex);
    r.cells = defColumns.map(c => ({ value: c.key === "count" ? `${r.count}${r.cap ? ` / ${r.cap}` : ""}` : fmtValue(c.kind, r.stats[c.key]) }));
  }
  page.defenders = {
    summary: t("Fac.Def.Summary", { garrison: stats.garrison, walled: stats.defense.walled, breached: stats.defense.breached }),
    columns: defColumns, cols: defColumns.length, rows,
    totals: defColumns.map(c => ({ value: c.key === "count" ? String(rows.reduce((n, r) => n + (Number(r.count) || 0), 0))
      : totalOf(c.kind, rows.map(r => r.stats[c.key])) }))
  };

  /* ----- Cards ----- */
  const cards = Object.fromEntries(SECTIONS.map(s => [s, []]));
  const openOn = fid => Object.values(record.projects ?? {}).find(p => p.featureId === fid && !["complete", "cancelled"].includes(p.state));
  let road = null;
  for (const [fid, f] of Object.entries(record.features ?? {})) {
    if (roadRank(C.get(f?.id)) > roadRank(C.get(road?.[1]?.id))) road = [fid, f];
  }
  const shownItems = new Set();
  for (const [fid, f] of Object.entries(record.features ?? {})) {
    const e = C.get(f?.id);
    if (!e || e.legacy) continue;
    if (e.effects?.roadTier && fid !== road?.[0]) continue;
    const open = openOn(fid);
    // The dnd5e basic facility this room made on an owner's sheet is this card: don't show it twice.
    const item = ctx.facilities.find(x => x.featureId === fid);
    if (item) shownItems.add(item.uuid);
    const parts = [];
    if (f.size) parts.push(SIZE_LABELS[f.size] ?? f.size);
    if (e.tiers) parts.push(e.tiers[(f.tier ?? 1) - 1]?.label ?? "");
    else if (f.count > 1 && e.unit === "mile") parts.push(t("SheetTab.Miles", { n: f.count }));
    else if (f.count > 1 && e.unit === "square") parts.push(t("Fac.Squares", { n: f.count }));
    else if (f.count > 1 && e.unit === "each") parts.push(`× ${f.count}`);
    if (item && owners.length > 1) parts.push(item.actorName);
    if (f.damaged) parts.push(t("Damaged"));
    if (open) parts.push(t(`Busy.${open.kind}`, { state: t(`State.${open.state}`) }));
    // The double arrow opens the Projects page at this building, where the upgrade is planned.
    let upgrade = null;
    if (!open && !f.damaged) {
      const next = e.tiers?.[f.tier ?? 1];
      if (next) {
        const q = quote(record, e, { kind: "upgrade", featureId: fid }, stats, R);
        upgrade = { tip: t("Fac.Up.Tier", { to: next.label, cost: gp(q.cost ?? next.cost) }) };
      } else if (e.unit === "sized" && ENLARGE[f.size]) {
        upgrade = { tip: t("Fac.Up.Enlarge", { to: SIZE_LABELS[ENLARGE[f.size].to] }) };
      } else if (e.effects?.roadTier) {
        const step = [...C.values()].find(x => !x.legacy && roadRank(x) === roadRank(e) + 1);
        if (step && planProject(record, C, stats, R, { expansionId: step.id, count: miles(record) }, { id: "probe", now: 0 }).ok) {
          upgrade = { tip: t("Fac.Up.Road", { name: step.name }), id: step.id };
        }
      }
    }
    if (upgrade) upgrade.action = "upgradeAt";
    const fxv = featureEffects(e, f);
    // The road reads as what it is now (a trail, a road, a highway), not as the last step built.
    const title = e.effects?.roadTier ? ROADS[e.effects.roadTier]?.label ?? e.name : e.name;
    cards[sectionOfExpansion(e)].push({ name: title, subtitle: parts.filter(Boolean).join(" · "), icon: SECTION_ICONS[sectionOfExpansion(e)],
      img: codexArt(MODULE_ID, e.id, true), fid, damaged: !!f.damaged, upgrade,
      repair: mine && f.damaged && !open, count: e.unit === "each" && f.count > 1 ? f.count : 0,
      codex: codex("facility", e.id), fx: fxv, exp: e, feature: f,
      open: { action: "openCodex", tip: t("Codex.Open") }, sort: title });
  }
  // New buildings under way: greyed, with their progress.
  for (const p of Object.values(record.projects ?? {})) {
    if (p?.kind !== "build" || !["building", "paused"].includes(p.state)) continue;
    const e = C.get(p.expansionId);
    if (!e) continue;
    const pct = p.days ? Math.round(100 * Math.min(1, (p.progress ?? 0) / p.days)) : 0;
    cards[sectionOfExpansion(e)].push({ name: e.name, building: true, icon: "fa-person-digging", img: codexArt(MODULE_ID, e.id, true),
      subtitle: `${t(`State.${p.state}`)} · ${Math.floor(p.progress ?? 0)} / ${p.days ?? 0}`, progress: { pct },
      codex: codex("facility", e.id), open: { action: "openCodex", tip: t("Codex.Open") }, sort: `~${e.name}` });
  }
  // The dnd5e facilities on the owners' sheets.
  const orders = CONFIG.DND5E?.facilities?.orders ?? {};
  for (const f of ctx.facilities) {
    if (shownItems.has(f.uuid)) continue;
    const section = sectionOfFacility(f);
    const doc = fromUuidSync(f.uuid);
    const canUse = !!doc?.isOwner;
    const order = f.progress?.order || "";
    const running = order && (f.progress?.max ?? 0) > 0;
    const parts = [f.type === "special" ? t("Facility.Special") : t("Facility.Basic")];
    if (f.size) parts.push(CONFIG.DND5E?.facilities?.sizes?.[f.size]?.label ?? SIZE_LABELS[f.size] ?? f.size);
    if (!actorId || f.actorId !== actorId) parts.push(f.actorName);
    if (f.disabled) parts.push(t("Disabled"));
    if (running) parts.push(`${game.i18n.localize(orders[order]?.label ?? order)} ${f.progress.value ?? 0} / ${f.progress.max}`);
    const upgrade = f.enlargeable && f.size !== "vast" && !running
      ? { action: canUse ? "useFacility" : "", tip: t("Fac.Up.Order") } : null;
    cards[section].push({ name: f.name, subtitle: parts.join(" · "), img: f.img, uuid: f.uuid, damaged: !!f.disabled, system: true,
      icon: f.type === "special" ? "fa-building-columns" : "fa-chess-rook", orderIcon: running ? orders[order]?.icon ?? "" : "",
      orderLabel: running ? game.i18n.localize(orders[order]?.label ?? order) : "",
      progress: running ? { pct: Math.round(100 * Math.min(1, (f.progress.value ?? 0) / f.progress.max)) } : null,
      use: canUse && f.type === "special" && !f.disabled ? t("Fac.Use") : "", upgrade,
      open: { action: "openFacility", tip: t("Fac.OpenFacility") }, sort: f.name });
  }

  /* ----- Sections: summary and limit ----- */
  const wallFeature = Object.entries(record.features ?? {}).find(([, x]) => x?.id === "wall");
  const wallExp = wallFeature ? C.get(wallFeature[1].id) : null;
  const wallNext = wallExp?.tiers?.[wallFeature[1].tier ?? 1];
  const towerMax = (R.towerPctMax ?? 4) * 5;
  const tier = stats.travel.roadTier;
  const nextRoad = [...C.values()].find(x => !x.legacy && roadRank(x) === (ROADS[tier]?.rank ?? 0) + 1);
  const maxTier = stats.merchant.exotic ? MERCHANT_TIERS.length - 1 : MERCHANT_TIERS.length - 2;
  const ways = Object.keys(DISPATCH_METHODS).filter(k => methodAvailable(k, stats).ok).map(k => shortLabel(DISPATCH_METHODS[k].label));
  const servantsCap = Math.max(fx.servantsCap ?? 0, record.garrison?.servants ?? 0);
  const food = stats.food;
  const net = food.peaceNet;
  const summaries = {
    rooms: {
      summary: [t("Fac.Sum.rooms", { pop: stats.population, housing: stats.housing, comfort: stats.comfort }),
        servantsCap ? t("Fac.Sum.servants", { n: record.garrison?.servants ?? 0, cap: servantsCap }) : ""],
      limit: stats.population > stats.housing ? t("Fac.Lim.crowded", { n: stats.population - stats.housing })
        : t("Fac.Lim.beds", { n: stats.housing - stats.population })
    },
    fortifications: {
      summary: [t("Fac.Sum.wall", { wall: t(`Wall.${stats.wall.type}`), integrity: stats.wall.integrity }),
        t("Fac.Sum.towers", { n: stats.defense.towers, wards: stats.wards })],
      limit: [wallFeature ? (wallNext ? t("Fac.Lim.wallNext", { to: wallNext.label }) : t("Fac.Lim.wallTop")) : t("Fac.Lim.noWall"),
        t("Fac.Lim.towers", { pct: Math.min(stats.defense.towers, R.towerPctMax ?? 4) * 5, max: towerMax })].join(" · ")
    },
    supplies: {
      summary: [t("Fac.Sum.food", { stock: Math.round(food.stock), cap: food.cap, net: net >= 0 ? `+${net}` : `${net}` }),
        t("Fac.Sum.lasts", { peace: Number.isFinite(food.peaceDays) ? daysText(food.peaceDays) : t("Unlimited"),
          siege: Number.isFinite(food.siegeDays) ? daysText(food.siegeDays) : t("Unlimited") }),
        t("Fac.Sum.water", { water: stats.water.unlimited ? t("Unlimited") : daysText(stats.water.days) })],
      limit: t("Fac.Lim.stores", { cap: food.cap })
    },
    access: {
      summary: [t("Fac.Sum.road", { road: ROADS[tier]?.label ?? tier, miles: stats.travel.distance, days: daysText(stats.travel.days),
        place: record.location?.settlement?.name || t("Settlement") }), t("Fac.Sum.access", { n: stats.accessibility })],
      limit: nextRoad ? t("Fac.Lim.roadNext", { name: nextRoad.name }) : t("Fac.Lim.roadTop")
    },
    trade: {
      summary: [t("Fac.Sum.money", { income: gp(stats.economy.incomeAverage), upkeep: gp(stats.economy.upkeep), net: gp(stats.economy.net) }),
        t("Fac.Sum.merchants", { chance: stats.merchant.chance, tier: stats.merchant.tier.label })],
      limit: t("Fac.Lim.merchants", { tier: MERCHANT_TIERS[maxTier]?.label ?? "" })
    },
    staff: {
      summary: [t("Fac.Sum.staff", { renown: stats.renown, comfort: stats.comfort, crews: stats.crews })],
      limit: t("Fac.Lim.crews", { hired: record.garrison?.crews ?? 0, max: R.maxHiredCrews ?? 0 })
    },
    arcane: {
      summary: [t("Fac.Sum.arcane", { wards: stats.wards }), t("Fac.Sum.ways", { ways: ways.join(", ") || "—" })],
      limit: t("Fac.Lim.ways", { n: ways.length, max: Object.keys(DISPATCH_METHODS).length })
    }
  };
  const colCtx = { R, stats };
  page.sections = SECTIONS.map(key => {
    const columns = [...(SECTION_COLUMNS[key] ?? []), UPKEEP_COLUMN];
    const list = cards[key].sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
    for (const card of list) {
      const raw = columns.map(c => (card.fx ? c.get(card.fx, card.exp, card.feature, colCtx) : null));
      card.raw = raw;
      card.cells = raw.map((v, i) => ({ value: fmtValue(columns[i].kind, v) }));
      delete card.fx; delete card.exp; delete card.feature;
    }
    const built = list.filter(c => !c.building);
    return {
      key, label: t(`Fac.Section.${key}`), icon: SECTION_ICONS[key], group: GROUPS[key],
      summary: summaries[key].summary.filter(Boolean), limit: summaries[key].limit,
      count: built.length, cards: list,
      columns: columns.map(c => ({ key: c.key, label: t(`Fac.Col.${c.key}`) })), cols: columns.length,
      totals: columns.map((c, i) => ({ value: totalOf(c.kind, built.map(card => card.raw?.[i])) }))
    };
  });
  return page;
}

/**
 * The dnd5e special facilities defined in this world (world items and Item compendiums), for the Projects catalog:
 * each with the owners that can take it now. Basic facilities aren't listed: the Bastion's rooms are those.
 */
export async function systemFacilityCatalog({ record, isGM, actorId = null, filter = "" }) {
  const found = new Map();
  const add = (uuid, name, img, sys) => {
    if (sys?.type?.value !== "special") return;
    const key = `${sys.type.subtype ?? ""}|${name}`;
    if (!found.has(key)) found.set(key, { uuid, name, img, level: Number(sys.level) || 0, subtype: sys.type.subtype ?? "" });
  };
  for (const i of game.items ?? []) if (i.type === "facility") add(i.uuid, i.name, i.img, i.system);
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item" || pack.visible === false) continue;
    // The index Foundry loaded at start has every entry's type: only packs with facilities are asked for more fields.
    if (!pack.index?.some?.(e => e.type === "facility")) continue;
    try {
      const index = await pack.getIndex({ fields: ["system.type", "system.level"] });
      for (const e of index) if (e.type === "facility") add(e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, e.name, e.img, e.system);
    } catch (err) {
      console.warn(`${MODULE_ID} | facility index of ${pack.collection}`, err);
    }
  }
  const owners = ownerActors(record).filter(a => a.type === "character" && (isGM || a.isOwner))
    .sort((a, b) => (b.id === actorId) - (a.id === actorId));
  const text = filter.toLowerCase();
  return [...found.values()].filter(x => !text || x.name.toLowerCase().includes(text)).map(x => {
    const checks = owners.map(a => ({ a, check: canTakeFacility(who(a), x, slotTable()) }));
    const able = checks.filter(c => c.check.ok).map(c => ({ id: c.a.id, name: c.a.name }));
    const why = checks.length ? takeReason(checks[0].check, x.level) : t("Fac.Need.Owner");
    return { ...x, system: true, section: sectionOfFacility({ type: "special", subtype: x.subtype }), owners: able,
      ok: able.length > 0, missing: able.length ? "" : why, summary: t("Fac.SysSummary", { level: x.level }) };
  }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

