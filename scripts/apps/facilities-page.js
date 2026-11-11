import { MODULE_ID, t, gp, daysText } from "../util.js";
import { GROUPS, SIZE_LABELS, ENLARGE } from "../data/catalog.js";
import { ROADS } from "../data/location.js";
import { MERCHANT_TIERS, DISPATCH_METHODS } from "../data/tables.js";
import { SECTIONS, sectionOfExpansion, sectionOfFacility, specialSlots, canTakeFacility } from "../core/sections.js";
import { planProject, quote } from "../core/projects.js";
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
const GUARD_IMG = "systems/dnd5e/tokens/humanoid/Guard.webp";
const roadRank = e => ROADS[e?.effects?.roadTier]?.rank ?? 0;
const miles = record => Math.ceil(record.location?.settlement?.distance || 1);
/** An image path for a CSS url() in a style attribute: from the server root, not the stylesheet's folder. */
const cssUrl = img => (!img ? "" : /^([a-z]+:|\/)/i.test(img) ? img : (foundry.utils.getRoute?.(img) ?? `/${img}`));
const shortLabel = label => String(label ?? "").replace(/\s*\(.*\)\s*$/, "");

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
  const rows = [
    { key: "guards", img: GUARD_IMG, label: t("Fac.Def.guards"), count: guards,
      cap: guardsCap ? String(guardsCap) : "", note: guardsCap ? t("Fac.Def.guardsNote", { upkeep: gp(R.guardUpkeep ?? 0) }) : t("Fac.Def.guardsNone"),
      tab: "defense", always: true },
    { key: "mercenaries", icon: "fa-sack-dollar", label: t("Fac.Def.mercenaries"), count: mercs, note: t("Fac.Def.mercenariesNote"), always: true },
    { key: "system", icon: "fa-shield", label: t("Fac.Def.system"), count: ctx.dmgDefenders ?? 0, cap: defendersMax ? String(defendersMax) : "",
      note: ctx.armoryStocked ? t("Fac.Def.systemArmory") : t("Fac.Def.systemNote"), portraits: portraits(defenderUuids) },
    { key: "lieutenants", icon: "fa-chess-knight", label: t("Fac.Def.lieutenants"), count: ctx.lieutenants ?? 0,
      cap: warRooms.length ? String(warRooms.reduce((n, f) => n + (f.hirelingsMax ?? 0), 0)) : "", note: t("Fac.Def.lieutenantsNote"),
      portraits: portraits(warRooms.flatMap(f => f.hirelings ?? [])), show: warRooms.length > 0 },
    { key: "engines", icon: "fa-crosshairs", label: t("Fac.Def.engines"), count: fx.garrison ?? 0, note: t("Fac.Def.enginesNote") }
  ];
  page.defenders = {
    summary: t("Fac.Def.Summary", { garrison: stats.garrison, walled: stats.defense.walled, breached: stats.defense.breached }),
    rows: rows.filter(r => r.always || r.show || r.count > 0 || r.cap)
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
    else if (f.count > 1 && e.unit !== "flat") parts.push(e.unit === "mile" ? t("SheetTab.Miles", { n: f.count }) : `× ${f.count}`);
    if (item && owners.length > 1) parts.push(item.actorName);
    if (f.damaged) parts.push(t("Damaged"));
    if (open) parts.push(t(`Busy.${open.kind}`, { state: t(`State.${open.state}`) }));
    let upgrade = null;
    if (!open && !f.damaged) {
      const next = e.tiers?.[f.tier ?? 1];
      if (next) {
        const q = quote(record, e, { kind: "upgrade", featureId: fid }, stats, R);
        upgrade = { action: "featureProject", kind: "upgrade", tip: t("Fac.Up.Tier", { to: next.label, cost: gp(q.cost ?? next.cost) }) };
      } else if (e.unit === "sized" && ENLARGE[f.size]) {
        upgrade = { action: "featureProject", kind: "enlarge", tip: t("Fac.Up.Enlarge", { to: SIZE_LABELS[ENLARGE[f.size].to] }) };
      } else if (e.effects?.roadTier) {
        const step = [...C.values()].find(x => !x.legacy && roadRank(x) === roadRank(e) + 1);
        if (step && planProject(record, C, stats, R, { expansionId: step.id, count: miles(record) }, { id: "probe", now: 0 }).ok) {
          upgrade = { action: "plan", id: step.id, tip: t("Fac.Up.Road", { name: step.name }) };
        }
      }
    }
    if (upgrade && !mine) upgrade.action = "";
    // The road reads as what it is now (a trail, a road, a highway), not as the last step built.
    const title = e.effects?.roadTier ? ROADS[e.effects.roadTier]?.label ?? e.name : e.name;
    cards[sectionOfExpansion(e)].push({ name: title, subtitle: parts.filter(Boolean).join(" · "), icon: SECTION_ICONS[sectionOfExpansion(e)],
      img: item?.img && !item.img.includes("/facilities/build.svg") ? cssUrl(item.img) : "", fid, damaged: !!f.damaged, upgrade,
      repair: mine && f.damaged && !open, open: { action: "dxpbTab", tab: "projects" }, sort: title });
  }
  // New buildings under way: greyed, with their progress.
  for (const p of Object.values(record.projects ?? {})) {
    if (p?.kind !== "build" || !["building", "paused"].includes(p.state)) continue;
    const e = C.get(p.expansionId);
    if (!e) continue;
    const pct = p.days ? Math.round(100 * Math.min(1, (p.progress ?? 0) / p.days)) : 0;
    cards[sectionOfExpansion(e)].push({ name: e.name, building: true, icon: "fa-person-digging",
      subtitle: `${t(`State.${p.state}`)} · ${Math.floor(p.progress ?? 0)} / ${p.days ?? 0}`, progress: { pct },
      open: { action: "dxpbTab", tab: "projects" }, sort: `~${e.name}` });
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
    cards[section].push({ name: f.name, subtitle: parts.join(" · "), img: cssUrl(f.img), uuid: f.uuid, damaged: !!f.disabled, system: true,
      icon: f.type === "special" ? "fa-building-columns" : "fa-chess-rook", orderIcon: running ? orders[order]?.icon ?? "" : "",
      progress: running ? { pct: Math.round(100 * Math.min(1, (f.progress.value ?? 0) / f.progress.max)) } : null,
      use: canUse && f.type === "special" && !f.disabled ? t("Fac.Use") : "", upgrade,
      open: { action: "openFacility" }, sort: f.name });
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
  page.sections = SECTIONS.map(key => ({
    key, label: t(`Fac.Section.${key}`), icon: SECTION_ICONS[key], group: GROUPS[key],
    summary: summaries[key].summary.filter(Boolean), limit: summaries[key].limit,
    count: cards[key].filter(c => !c.building).length,
    cards: cards[key].sort((a, b) => String(a.sort).localeCompare(String(b.sort)))
  }));
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

