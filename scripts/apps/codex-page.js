import { MODULE_ID, TEMPLATE_PATH, t, gp, rules, catalog, workText } from "../util.js";
import { GROUPS, SIZES, SIZE_LABELS } from "../data/catalog.js";
import { priceGp } from "../core/price.js";
import { paceDays } from "../core/projects.js";
import { footprintOf } from "../core/grounds.js";
import { CODEX_JOURNALS, INHABITANTS, PAGE_TYPES, codexUuid } from "../core/codex.js";
import { perksText, tierLine } from "./bastion-sheet.js";

/**
 * The Bastion Codex: the module's own journal page types, "Facility" and "Inhabitant" (module.json documentTypes),
 * one page per building of the catalog and per kind of inhabitant, in the module's Codex compendium. A page keeps its
 * picture, icon and description; its Contributions table is read live from the catalog and the house rules, so it
 * never goes stale.
 */

const { HTMLField, StringField, FilePathField } = foundry.data.fields;

export class CodexPageData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      /** The catalog id of a building, or the key of an inhabitant (core/codex.js INHABITANTS). */
      ref: new StringField({ required: true, blank: true, initial: "" }),
      /** The Codex journal (section) it belongs to. */
      category: new StringField({ required: true, blank: true, initial: "" }),
      image: new FilePathField({ categories: ["IMAGE"], blank: true, initial: "" }),
      icon: new FilePathField({ categories: ["IMAGE"], blank: true, initial: "" }),
      description: new HTMLField({ required: true, blank: true, initial: "" })
    };
  }
}

const sheets = foundry.applications.sheets.journal;

export class CodexPageSheet extends sheets.JournalEntryPageHandlebarsSheet {
  static DEFAULT_OPTIONS = {
    classes: ["dxpb-codex-page"],
    window: { icon: "fa-solid fa-chess-rook" }
  };

  static EDIT_PARTS = {
    header: super.EDIT_PARTS.header,
    content: { template: `${TEMPLATE_PATH}/codex-page-edit.hbs`, classes: ["standard-form"] },
    footer: super.EDIT_PARTS.footer
  };

  static VIEW_PARTS = {
    content: { template: `${TEMPLATE_PATH}/codex-page.hbs`, root: true }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const page = this.page;
    const sys = page.system;
    context.codex = {
      name: page.name,
      image: sys.image,
      icon: sys.icon || sys.image,
      category: CODEX_JOURNALS.find(j => j.key === sys.category)?.name ?? "",
      kindLabel: page.type === PAGE_TYPES.inhabitant ? t("Codex.Inhabitant") : t("Codex.Facility"),
      description: await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.description ?? "", {
        relativeTo: page, secrets: page.isOwner }),
      rows: codexRows(page.type, sys.ref)
    };
    context.fields = sys.schema.fields;
    context.source = sys._source;
    return context;
  }
}

/** The live numbers for a page: what the building costs and gives, what the inhabitants cost and add. */
export function codexRows(type, ref) {
  const R = rules();
  const rows = [];
  const add = (key, value) => { if (value !== "" && value !== null && value !== undefined) rows.push({ label: t(`Codex.Row.${key}`), value }); };
  if (type === PAGE_TYPES.facility || type === "facility") {
    const e = catalog().get(ref);
    if (!e) return rows;
    add("group", GROUPS[e.group] ?? "");
    const per = e.unit === "square" ? t("Unit.square") : e.unit === "mile" ? t("Unit.mile") : e.unit === "each" ? t("Unit.each") : "";
    if (e.unit === "sized") {
      add("cost", SIZES.map((s, i) => `${SIZE_LABELS[s]} ${gp(priceGp(e.cost?.[i] ?? 0, R.price))}`).join(" · "));
      add("time", SIZES.map((s, i) => `${SIZE_LABELS[s]} ${workText(paceDays(e.days?.[i] ?? 0, R.pace))}`).join(" · "));
      add("room", SIZES.map(s => `${SIZE_LABELS[s]} ${footprintOf(e, { size: s })} ${t("Sq")}`).join(" · "));
    } else {
      add("cost", `${gp(priceGp(e.cost ?? 0, R.price))}${per ? ` ${per}` : ""}`);
      add("time", `${workText(paceDays(e.days ?? 0, R.pace))}${per ? ` ${per}` : ""}`);
      const fp = footprintOf(e, { count: 1, tier: 1 });
      add("room", fp ? `${fp} ${t("Sq")}${e.unit === "each" ? ` ${t("Unit.each")}` : ""}` : t("OutsideWalls"));
    }
    // Upkeep: the building's own, and its workers' wages (rules.workerWage each a turn).
    const workers = Number((e.tiers ? e.tiers[0].effects : e.effects)?.workers) || 0;
    add("upkeep", [e.upkeep ? t("Codex.PerTurn", { v: gp(e.upkeep) }) : "",
      workers ? t("Codex.Wages", { n: workers, v: gp(workers * (R.workerWage ?? 0)), each: gp(R.workerWage ?? 0) }) : ""].filter(Boolean).join(" + "));
    add("effects", perksText(e));
    if (e.tiers) add("tiers", tierLine(e.tiers));
    const needs = [...(e.requires?.features ?? []).map(id => catalog().get(id)?.name ?? id),
      ...(e.requires?.anyFeature?.length ? [e.requires.anyFeature.map(id => catalog().get(id)?.name ?? id).join(t("Codex.Or"))] : [])];
    if (needs.length) add("needs", needs.join(", "));
    if (e.once || e.unit === "flat") add("limit", t("Codex.OnlyOne"));
    else if (e.unit === "each" && e.max) add("limit", t("Codex.UpTo", { n: e.max }));
    return rows;
  }
  const people = {
    guards: () => { add("upkeep", t("Codex.PerTurnEach", { v: gp(R.guardUpkeep) })); add("garrison", t("Codex.GarrisonEach", { n: 1 })); add("limit", t("Codex.GuardsLimit")); },
    mercenaries: () => { add("garrison", t("Codex.GarrisonEach", { n: 1 })); add("limit", t("Codex.MercsLimit")); },
    "facility-defenders": () => { add("garrison", t("Codex.GarrisonEach", { n: 1 })); add("bonus", t("Codex.ArmoryBonus", { x: R.armoryMult })); },
    lieutenants: () => add("limit", t("Codex.LieutenantsLimit")),
    "engine-crews": () => add("garrison", t("Codex.EngineCrews", { n: 2 })),
    servants: () => { add("upkeep", t("Codex.PerTurnEach", { v: gp(R.servantUpkeep) })); add("limit", t("Codex.ServantsLimit")); },
    hirelings: () => add("limit", t("Codex.HirelingsLimit")),
    "building-crews": () => { add("hire", gp(R.crewHireCost ?? 0)); add("upkeep", t("Codex.PerTurnEach", { v: gp(R.crewUpkeep ?? 0) }));
      add("limit", t("Codex.CrewsLimit", { n: R.maxHiredCrews ?? 0 })); },
    refugees: () => add("limit", t("Codex.RefugeesLimit")),
    merchants: () => add("chance", t("Codex.MerchantChance", { a: R.merchantPerAccess, r: R.merchantPerRenown, cap: R.merchantCap })),
    guests: () => add("limit", t("Codex.GuestsLimit")),
    visitors: () => add("limit", t("Codex.VisitorsLimit")),
    caravans: () => {
      add("income", t("Codex.RouteIncome", { v: gp(R.tradeIncome ?? 25) }));
      add("food", t("Codex.RouteFood", { n: R.tradeFood ?? 30, pct: Math.round(100 * (R.tradeFoodPrice ?? 0.6)) }));
      add("setup", t("Codex.RouteSetup", { n: R.tradeSetupTurns ?? 6 }));
      add("risk", t("Codex.RouteRaid", { safe: R.tradeRaid?.safe ?? 0, frontier: R.tradeRaid?.frontier ?? 0, wild: R.tradeRaid?.wild ?? 0, hostile: R.tradeRaid?.hostile ?? 0 }));
      add("limit", t("Codex.RouteLimit"));
    }
  };
  people[ref]?.();
  if (INHABITANTS[ref] && !["merchants", "guests", "visitors", "lieutenants", "caravans"].includes(ref)) {
    add("food", t("Codex.FoodEach", { n: R.foodPerPerson }));
  }
  return rows;
}

/** Registers the page types' data models and sheet (init). */
export function registerCodex() {
  for (const type of Object.values(PAGE_TYPES)) CONFIG.JournalEntryPage.dataModels[type] = CodexPageData;
  const Config = foundry.applications.apps?.DocumentSheetConfig ?? DocumentSheetConfig;
  Config.registerSheet(JournalEntryPage, MODULE_ID, CodexPageSheet, {
    types: Object.values(PAGE_TYPES), makeDefault: true, label: "DXPB.Codex.Sheet"
  });
}

/** The Codex page UUID of a building or an inhabitant, or null. */
export function codexPageUuid(kind, ref) {
  const group = kind === "facility" ? catalog().get(ref)?.group ?? null : null;
  return codexUuid(MODULE_ID, kind, ref, group);
}

/** Opens a Codex page in its journal. Returns false when the page doesn't exist (a homebrew building, say). */
export async function openCodex(uuid) {
  if (!uuid) return false;
  let page = null;
  try { page = await fromUuid(uuid); } catch { page = null; }
  if (!page) return false;
  await page.parent.sheet.render({ force: true, pageId: page.id });
  return true;
}
