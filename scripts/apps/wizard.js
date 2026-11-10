import { MODULE_ID, TEMPLATE_PATH, t, gp, daysText, rules, catalog, randomId } from "../util.js";
import { MAP_GROUNDS, TERRAIN_GROUND } from "../data/map-style.js";
import { GROUNDS } from "../data/grounds.js";
import { fittingGroundsIndex, groundsIndex, groundsInfo } from "../core/grounds.js";
import { getEntry, getRecord } from "../store.js";
import { request } from "../socket.js";
import { createRecord } from "../core/record.js";
import { computeStats } from "../core/stats.js";
import { holdout } from "../core/siege.js";
import {
  TERRAINS, SITES, SETTLEMENT_SIZES, ROADS, WATERWAYS, WATER_ON_SITE, CLIMATES, LANDS, RESOURCES, DANGERS, VISIBILITY, POLITICAL,
  defaultLocation, terrainImage, siteImage
} from "../data/location.js";
import { STRUCTURES, ACQUISITIONS, FIRST_BUILDINGS, firstBuilding } from "../data/structures.js";
import { FORCES } from "../data/tables.js";
import { GROUPS, SIZES, SIZE_LABELS } from "../data/catalog.js";
import { systemContext } from "../context.js";
import { pickPoint, settlementsNear, sceneDistance } from "../marker.js";
import { BastionSheet } from "./bastion-sheet.js";

/** A ground texture's picture, for the battle map ground tiles. */
const groundImage = k => `modules/${MODULE_ID}/assets/map/tex/${k}.webp`;

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const STEPS = ["owners", "map", "location", "structure", "build", "review"];

/**
 * The GM's founding wizard (also used to edit an existing Bastion's name, owners, map marker and location).
 * Every answer updates a live preview of the stats and the siege table.
 */
export class FoundingWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.entryId = options.entryId ?? null;
    this.step = 0;
    const record = this.entryId ? getRecord(getEntry(this.entryId)) : null;
    const group = game.actors.find(a => a.type === "group");
    this.answers = record ? {
      name: record.name, description: record.description, groupUuid: record.groupUuid, ownerUuids: [...(record.ownerUuids ?? [])],
      location: foundry.utils.deepClone(record.location), structure: { ...record.structure }, included: [], food: record.food,
      treasury: record.treasury, guards: record.garrison?.guards ?? 0, servants: record.garrison?.servants ?? 0,
      marker: record.marker ? { ...record.marker } : null, image: record.image ?? null, mapGround: record.mapGround ?? null
    } : {
      name: "", description: "", groupUuid: group?.uuid ?? null, ownerUuids: [], location: defaultLocation(),
      structure: { type: "keep", acquisition: "reward" }, included: [], food: 2000, treasury: 0, guards: 0, servants: 0, marker: null,
      image: null, mapGround: null, first: null
    };
    if (!this.answers.marker) {
      const scene = defaultMapScene();
      if (scene) this.answers.marker = { sceneUuid: scene.uuid, x: null, y: null };
    }
  }

  static DEFAULT_OPTIONS = {
    id: "dxpb-wizard",
    classes: ["dxpb", "dxpb-wizard"],
    tag: "form",
    window: { title: "DXPB.Wizard.Title", icon: "fa-solid fa-chess-rook", resizable: true },
    position: { width: 900, height: 780 },
    form: { handler: FoundingWizard.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      next: FoundingWizard.#onNext,
      back: FoundingWizard.#onBack,
      step: FoundingWizard.#onStep,
      pick: FoundingWizard.#onPick,
      settlement: FoundingWizard.#onSettlement,
      addIncluded: FoundingWizard.#onAddIncluded,
      removeIncluded: FoundingWizard.#onRemoveIncluded,
      finish: FoundingWizard.#onFinish,
      picture: FoundingWizard.#onPicture,
      customPicture: FoundingWizard.#onCustomPicture
    }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/wizard.hbs`, scrollable: [".dxpb-wizard-main"] } };

  get title() {
    return this.entryId ? t("Wizard.EditTitle") : t("Wizard.Title");
  }

  previewRecord() {
    // Editing: start from the real Bastion (its built features, projects and stock) and apply only the edited answers.
    const real = this.entryId ? getRecord(getEntry(this.entryId)) : null;
    if (real) {
      const r = foundry.utils.deepClone(real);
      r.name = this.answers.name;
      r.location = foundry.utils.deepClone(this.answers.location);
      r.garrison = { ...(r.garrison ?? {}), guards: this.answers.guards, servants: this.answers.servants };
      r.mapGround = this.answers.mapGround ?? null;
      return r;
    }
    return createRecord(this.answers, { newId: randomId, now: 0, catalog: catalog(), rules: rules() });
  }

  async _prepareContext() {
    const a = this.answers;
    const rec = this.previewRecord();
    const stats = computeStats(rec, { rules: rules(), catalog: catalog(), ctx: this.entryId ? systemContext(rec) : {} });
    const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => ({ k, label: v.label, sel: k === sel }));
    const scene = a.marker?.sceneUuid ? fromUuidSync(a.marker.sceneUuid) : null;
    const point = a.marker && a.marker.x !== null ? { x: a.marker.x, y: a.marker.y } : null;
    const C = catalog();
    return {
      editing: !!this.entryId,
      step: this.step, stepKey: STEPS[this.step], last: this.step === STEPS.length - 1, first: this.step === 0,
      steps: STEPS.map((k, i) => ({ i, label: t(`Wizard.Step.${k}`), active: i === this.step, done: i < this.step })),
      a,
      groups: game.actors.filter(x => x.type === "group").map(g => ({ uuid: g.uuid, name: g.name, sel: g.uuid === a.groupUuid,
        members: (g.system?.members ?? []).map(m => (m.actor ?? m)?.name).filter(Boolean).join(", ") })),
      characters: game.actors.filter(x => x.type === "character").map(c => ({ uuid: c.uuid, key: c.uuid.replaceAll(".", "|"), name: c.name, sel: a.ownerUuids.includes(c.uuid) })),
      scenes: game.scenes.map(s => ({ uuid: s.uuid, name: s.navName || s.name, sel: s.uuid === a.marker?.sceneUuid })),
      sceneName: scene?.name ?? "", markerSet: !!point, markerX: Math.round(point?.x ?? 0), markerY: Math.round(point?.y ?? 0),
      units: scene?.grid?.units ?? "",
      settlements: point && scene ? settlementsNear(scene, point).slice(0, 12) : [],
      terrains: opts(TERRAINS, a.location.terrain), sites: opts(SITES, a.location.site),
      sizes: opts(SETTLEMENT_SIZES, a.location.settlement?.size), roads: opts(ROADS, a.location.road),
      waterways: opts(WATERWAYS, a.location.waterway), waters: opts(WATER_ON_SITE, a.location.waterOnSite),
      climates: opts(CLIMATES, a.location.climate), lands: opts(LANDS, a.location.land), dangers: opts(DANGERS, a.location.danger),
      visibilities: opts(VISIBILITY, a.location.visibility), politicals: opts(POLITICAL, a.location.political),
      resources: Object.entries(RESOURCES).map(([k, v]) => ({ k, label: v.label, sel: (a.location.resources ?? []).includes(k) })),
      structures: Object.entries(STRUCTURES).map(([k, s]) => ({ k, label: s.label, sel: k === a.structure.type,
        summary: s.summary ?? "",
        upkeep: gp(s.upkeep) })),
      acquisitions: opts(ACQUISITIONS, a.structure.acquisition),
      // The one building the Bastion is founded with: the structure suggests one, the GM can pick another.
      firstBuildings: Object.entries(FIRST_BUILDINGS).map(([k, b]) => ({ k, label: b.label, summary: b.summary,
        suggested: STRUCTURES[a.structure.type]?.first === k,
        sel: (a.first ?? STRUCTURES[a.structure.type]?.first) === k })),
      // The battle map's ground: by terrain (and structure) unless the GM picks one, whatever the other answers.
      mapGrounds: [{ k: "", label: t("Wizard.MapGroundAuto", { ground: t(`MapGround.${a.structure.type === "cave" ? "cave"
        : (TERRAIN_GROUND[a.location.terrain] ?? "grass")}`) }), img: groundImage(a.structure.type === "cave" ? "cave"
        : (TERRAIN_GROUND[a.location.terrain] ?? "grass")), sel: !a.mapGround },
        ...Object.keys(MAP_GROUNDS).map(k => ({ k, label: t(`MapGround.${k}`), img: groundImage(k), sel: a.mapGround === k }))],
      catalogOptions: [...C.values()].filter(e => !e.legacy).map(e => ({ id: e.id, name: `${GROUPS[e.group]}: ${e.name}`, sel: e.id === this.pending?.id }))
        .sort((x, y) => x.name.localeCompare(y.name)),
      sizeOptions: SIZES.map(s => ({ k: s, label: SIZE_LABELS[s], sel: s === (this.pending?.size ?? "roomy") })),
      pendingCount: this.pending?.count ?? 1,
      // Grounds: the smallest that holds the structure and first build, or any bigger size.
      groundsOptions: [{ k: "", label: t("Wizard.GroundsAuto", { size: GROUNDS[fittingGroundsIndex(stats.grounds.used, rules(),
        groundsIndex(STRUCTURES[a.structure.type]?.grounds ?? "plot"))].label }), sel: !a.grounds },
        ...GROUNDS.map((g, i) => ({ k: g.key, label: t("GroundsSize", { label: g.label, side: g.side }), sel: a.grounds === g.key,
          disabled: groundsInfo(i, rules()).usable < stats.grounds.used }))],
      included: a.included.map((f, i) => ({ i, name: C.get(f.id)?.name ?? f.id, size: f.size ? SIZE_LABELS[f.size] : "", count: f.count ?? "" })),
      terrainImg: terrainImage(a.location.terrain), siteImg: siteImage(a.location.site),
      // The picture: the terrain's by default (follows the terrain answer), the site's, or any image the GM picks.
      pictureImg: a.image || terrainImage(a.location.terrain),
      pictures: [
        { src: "", img: terrainImage(a.location.terrain), label: t("Wizard.PictureTerrain"), sel: !a.image },
        { src: siteImage(a.location.site), img: siteImage(a.location.site), label: t("Wizard.PictureSite"), sel: a.image === siteImage(a.location.site) }
      ],
      customPicture: a.image && ![siteImage(a.location.site)].includes(a.image),
      preview: {
        accessibility: stats.accessibility, concealment: stats.concealment, security: stats.security, renown: stats.renown,
        comfort: stats.comfort, prosperity: stats.prosperity, housing: stats.housing, population: stats.population,
        walled: stats.defense.walled, integrity: stats.wall.integrity, wall: t(`Wall.${stats.wall.type}`),
        food: daysText(stats.food.siegeDays), water: stats.water.unlimited ? t("Unlimited") : daysText(stats.water.days),
        income: gp(stats.economy.incomeAverage), upkeep: gp(stats.economy.upkeep), net: gp(stats.economy.net),
        merchant: stats.merchant.chance, travel: daysText(stats.travel.days),
        grounds: `${t("GroundsSize", { label: stats.grounds.label, side: stats.grounds.side })} · ${stats.grounds.used} / ${stats.grounds.usable} ${t("Sq")}`,
        siege: ["bandits", "raiders", "warband"].map(k => {
          const h = holdout(stats, FORCES[k], rules());
          return { label: FORCES[k].label, days: Number.isFinite(h.days) ? h.days : "∞" };
        })
      }
    };
  }

  /** Form changes update the answers (submitOnChange). */
  static async #onSubmit(event, form, formData) {
    const d = foundry.utils.expandObject(formData.object);
    const a = this.answers;
    if (d.name !== undefined) a.name = d.name;
    if (d.description !== undefined) a.description = d.description;
    if (d.groupUuid !== undefined) a.groupUuid = d.groupUuid || null;
    if (d.owners !== undefined) a.ownerUuids = Object.entries(d.owners).filter(([, v]) => v).map(([k]) => k.replaceAll("|", "."));
    if (d.sceneUuid !== undefined && d.sceneUuid !== a.marker?.sceneUuid) a.marker = { sceneUuid: d.sceneUuid, x: null, y: null };
    if (d.loc) {
      const l = a.location;
      for (const k of ["terrain", "site", "road", "waterway", "waterOnSite", "climate", "land", "danger", "visibility", "political"]) {
        if (d.loc[k] !== undefined) l[k] = d.loc[k];
      }
      if (d.loc.settlementName !== undefined) l.settlement.name = d.loc.settlementName;
      if (d.loc.settlementSize !== undefined) l.settlement.size = d.loc.settlementSize;
      if (d.loc.settlementDistance !== undefined) l.settlement.distance = Math.max(0, Number(d.loc.settlementDistance) || 0);
      if (d.loc.res) l.resources = Object.entries(d.loc.res).filter(([, v]) => v).map(([k]) => k);
    }
    // The first building follows the structure's suggestion until the GM picks one; a pick stays when the structure
    // changes. (The whole form comes in on every change, so only a different radio than the one shown is a pick.)
    if (d.structureType && d.structureType !== a.structure.type) a.structure.type = d.structureType;
    else if (d.first && d.first !== (a.first ?? STRUCTURES[a.structure.type]?.first)) a.first = d.first;
    if (d.acquisition) a.structure.acquisition = d.acquisition;
    for (const k of ["food", "treasury", "guards", "servants"]) if (d[k] !== undefined) a[k] = Math.max(0, Number(d[k]) || 0);
    if (d.grounds !== undefined) a.grounds = d.grounds || null;
    if (d.mapGround !== undefined) a.mapGround = d.mapGround || null;
    // Keep the "add to the first build" picks across the re-render that every change triggers.
    if (d.newIncluded !== undefined) {
      this.pending = { id: d.newIncluded, size: d.newIncludedSize || "roomy", count: Math.max(1, Number(d.newIncludedCount) || 1) };
    }
    this.render();
  }

  static #onNext() { this.step = Math.min(STEPS.length - 1, this.step + 1); this.render(); }
  static #onBack() { this.step = Math.max(0, this.step - 1); this.render(); }
  static #onStep(event, target) { this.step = Number(target.dataset.step) || 0; this.render(); }

  static async #onPick() {
    const uuid = this.answers.marker?.sceneUuid;
    const scene = uuid ? await fromUuid(uuid) : null;
    if (!scene) return ui.notifications.warn(t("Wizard.PickScene"));
    if (canvas.scene?.id !== scene.id) await scene.view();
    // Get every open Bastion window out of the way while the GM clicks the map.
    const open = [...foundry.applications.instances.values()]
      .filter(app => app.rendered && !app.minimized && app.options.classes?.includes("dxpb"));
    for (const app of open) await app.minimize();
    const point = await pickPoint();
    for (const app of open) await app.maximize();
    if (!point) return;
    this.answers.marker = { sceneUuid: scene.uuid, x: point.x, y: point.y };
    const near = settlementsNear(scene, point)[0];
    if (near && !this.answers.location.settlement.name) {
      this.answers.location.settlement.name = near.name;
      this.answers.location.settlement.distance = near.distance;
    }
    this.render();
  }

  static #onSettlement(event, target) {
    const scene = fromUuidSync(this.answers.marker?.sceneUuid);
    const note = scene?.notes.get(target.dataset.id);
    if (!note) return;
    this.answers.location.settlement.name = note.text || note.entry?.name || "";
    this.answers.location.settlement.distance = sceneDistance(scene, this.answers.marker, note) ?? 0;
    this.render();
  }

  static #onAddIncluded() {
    const root = this.element;
    const id = root.querySelector("[name=newIncluded]")?.value;
    if (!id) return;
    const exp = catalog().get(id);
    const f = { id };
    if (exp?.unit === "sized") f.size = root.querySelector("[name=newIncludedSize]")?.value || "roomy";
    if (["square", "mile", "each"].includes(exp?.unit)) f.count = Math.max(1, Number(root.querySelector("[name=newIncludedCount]")?.value) || 1);
    this.answers.included.push(f);
    this.pending = null;
    this.render();
  }

  static #onPicture(event, target) {
    this.answers.image = target.dataset.src || null;
    this.render();
  }

  static #onCustomPicture() {
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({ type: "image", current: this.answers.image ?? "", callback: path => {
      this.answers.image = path || null;
      this.render();
    } }).browse();
  }

  static #onRemoveIncluded(event, target) {
    this.answers.included.splice(Number(target.dataset.i), 1);
    this.render();
  }

  static async #onFinish() {
    const a = this.answers;
    if (!a.name.trim()) return ui.notifications.warn(t("Wizard.NeedName"));
    if (this.entryId) {
      const changes = { name: a.name, description: a.description, groupUuid: a.groupUuid, ownerUuids: a.ownerUuids, location: a.location,
        image: a.image ?? null, mapGround: a.mapGround ?? null };
      await request("updateRecord", { entryId: this.entryId, changes });
      if (a.marker?.x !== null && a.marker?.x !== undefined) {
        const old = getRecord(getEntry(this.entryId)).marker;
        if (!old || old.x !== a.marker.x || old.y !== a.marker.y || old.sceneUuid !== a.marker.sceneUuid) {
          await request("moveMarker", { entryId: this.entryId, ...a.marker });
        }
      }
      await getEntry(this.entryId)?.update({ name: a.name });
      this.close();
      BastionSheet.open(this.entryId);
      return;
    }
    const answers = foundry.utils.deepClone(a);
    if (answers.marker?.x === null || answers.marker?.x === undefined) answers.marker = null;
    const res = await request("found", { answers });
    if (res?.ok) {
      ui.notifications.info(t("Wizard.Founded", { name: a.name }));
      this.close();
      BastionSheet.open(res.entryId);
    } else ui.notifications.error(res?.reason ?? "Failed");
  }
}

/** The world map to put Bastions on: a scene named Faerûn (any spelling), else the active scene. */
export function defaultMapScene() {
  const norm = s => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return game.scenes.find(s => norm(s.name) === "faerun") ?? game.scenes.find(s => norm(s.name).includes("faerun")) ?? game.scenes.active ?? null;
}

export const WIZARD_FLAG = MODULE_ID;
