import { MODULE_ID, rules, catalog, t } from "./util.js";
import { noteError } from "./debug-recorder.js";
import { getRecord, patchRecord } from "./store.js";
import { statsFor } from "./context.js";
import { mapPlan } from "./core/mapplan.js";
import { renderMap } from "./map-render.js";
import { TEXTURES, PROPS } from "./data/map-style.js";

/**
 * The Bastion battle map: one scene per Bastion, drawn from its layout. The GM builds it from the Bastion page; once
 * it exists it is redrawn whenever a turn finishes a building or a siege knocks a hole in the wall.
 *
 * The picture is painted on the GM's client (map-render.js), uploaded to worlds/<world>/bastions/, and set as the
 * scene background. Walls and doors are Foundry walls flagged as ours, replaced on every rebuild; anything the GM adds
 * by hand (tokens, lights, extra walls, notes) is left alone.
 */

const GRID = 100;
const ART = `modules/${MODULE_ID}/assets/map`;
const MAX_IMAGE = 4096;
const imageCache = new Map();

function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(src, p);
  return p;
}

/** Loads every texture and prop the module ships (missing files come back null and get a stand-in). */
async function loadAssets() {
  const tex = {};
  const prop = {};
  await Promise.all([
    ...TEXTURES.map(async n => { tex[n] = await loadImage(`${ART}/tex/${n}.webp`); }),
    ...PROPS.map(async n => { prop[n] = await loadImage(`${ART}/props/${n}.webp`); })
  ]);
  return { tex: n => tex[n] ?? null, prop: n => prop[n] ?? null };
}

/** The plan for a Bastion as it stands now. */
export function planFor(record) {
  const { stats } = statsFor(record);
  return mapPlan(record, catalog(), rules(), stats);
}

/** Paints the plan into a canvas and returns a WebP Blob. */
export async function paint(plan) {
  const px = Math.min(GRID, Math.floor(MAX_IMAGE / plan.total));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = plan.total * px;
  const ctx = canvas.getContext("2d");
  renderMap(ctx, plan, await loadAssets(), px);
  const blob = await new Promise(res => canvas.toBlob(res, "image/webp", 0.88));
  canvas.width = canvas.height = 0;
  return { blob, px };
}

async function upload(blob, name) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const dir = `worlds/${game.world.id}/bastions`;
  try { await FP.createDirectory("data", dir, {}); } catch { /* already there */ }
  const file = new File([blob], name, { type: "image/webp" });
  const res = await FP.upload("data", dir, file, {}, { notify: false });
  if (!res?.path) throw new Error("Upload failed");
  return res.path;
}

/** The Foundry wall documents for a plan, in scene pixels. */
export function wallData(plan) {
  const S = v => (v + plan.offset) * GRID;
  const sense = CONST.WALL_SENSE_TYPES.NORMAL;
  return plan.walls.map(w => ({
    c: [S(w.x0), S(w.y0), S(w.x1), S(w.y1)],
    move: CONST.WALL_MOVEMENT_TYPES.NORMAL, sight: sense, light: sense, sound: sense,
    door: w.door === 2 ? CONST.WALL_DOOR_TYPES.SECRET : w.door ? CONST.WALL_DOOR_TYPES.DOOR : CONST.WALL_DOOR_TYPES.NONE,
    flags: { [MODULE_ID]: { generated: true } }
  }));
}

/** Foundry ambient lights for the plan's fires and torches (they show when the scene is dark). */
export function lightData(plan) {
  const S = v => (v + plan.offset) * GRID;
  return plan.lights.map(L => ({
    x: S(L.x), y: S(L.y),
    // Only lit once the scene gets dark: the painted map already shows the glow by day.
    config: { bright: L.bright, dim: L.dim, color: L.color, alpha: 0.45, darkness: { min: 0.25, max: 1 },
      animation: { type: "torch", speed: 2, intensity: 3 } },
    flags: { [MODULE_ID]: { generated: true } }
  }));
}

/**
 * The Scene folder every Bastion battle map goes in ("Bastions"; ours by flag, so a renamed folder is still found).
 * GM only; created on first use.
 */
export async function mapFolder() {
  let f = game.folders.find(x => x.type === "Scene" && x.getFlag(MODULE_ID, "mapFolder"))
    ?? game.folders.find(x => x.type === "Scene" && !x.folder && x.name === t("FolderName"));
  if (!f) f = await Folder.create({ name: t("FolderName"), type: "Scene", color: "#6b4f2a", flags: { [MODULE_ID]: { mapFolder: true } } });
  return f;
}

/** Files the Bastions' existing battle maps that sit outside any folder into the Bastions folder. Responsible GM, ready. */
export async function fileMaps() {
  const loose = (game.scenes ?? []).filter(s => s.getFlag(MODULE_ID, "entryId") && !s.folder);
  if (!loose.length) return 0;
  const folder = await mapFolder();
  await Scene.updateDocuments(loose.map(s => ({ _id: s.id, folder: folder.id })));
  return loose.length;
}

/** The Bastion's battle-map scene, if it has one. */
export function mapScene(record) {
  const uuid = record?.map?.sceneUuid;
  return uuid ? fromUuidSync(uuid) : null;
}

/**
 * Builds or updates the Bastion's battle map. GM only. Stores the layout (so placements stay fixed) and
 * record.map = { sceneUuid, version, total }. Returns the scene.
 */
export async function buildMap(entry, { notify = true } = {}) {
  if (!game.user.isGM || !entry) return null;
  const record = getRecord(entry);
  const plan = planFor(record);
  const version = (record.map?.version ?? 0) + 1;
  const { blob } = await paint(plan);
  const slug = (record.name || "bastion").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bastion";
  const src = await upload(blob, `${slug}-${entry.id}-${version}.webp`);
  const size = plan.total * GRID;
  const data = {
    width: size, height: size, padding: 0,
    background: { src },
    grid: { size: GRID, type: CONST.GRID_TYPES.SQUARE, distance: 5, units: "ft" },
    initial: { x: size / 2, y: size / 2, scale: 0.5 }
  };
  let scene = mapScene(record);
  if (scene) await scene.update(data);
  else {
    const folder = await mapFolder();
    scene = await Scene.create({
      name: t("Map.SceneName", { name: record.name }), folder: folder.id, navigation: false, tokenVision: true,
      fog: { exploration: false }, environment: { darknessLevel: 0 },
      flags: { [MODULE_ID]: { entryId: entry.id } }, ...data
    });
  }
  const old = scene.walls.filter(w => w.getFlag(MODULE_ID, "generated")).map(w => w.id);
  if (old.length) await scene.deleteEmbeddedDocuments("Wall", old);
  await scene.createEmbeddedDocuments("Wall", wallData(plan));
  const oldLights = scene.lights.filter(l => l.getFlag(MODULE_ID, "generated")).map(l => l.id);
  if (oldLights.length) await scene.deleteEmbeddedDocuments("AmbientLight", oldLights);
  await scene.createEmbeddedDocuments("AmbientLight", lightData(plan));
  await patchRecord(entry, {
    layout: plan.layout.layout,
    map: { sceneUuid: scene.uuid, version, total: plan.total, breaches: plan.breaches.length, builtAt: Date.now() }
  });
  if (notify) {
    const waiting = plan.layout.unplaced.length;
    ui.notifications.info(t(waiting ? "Map.BuiltWaiting" : "Map.Built", { name: record.name, n: waiting }));
  }
  Hooks.callAll(`${MODULE_ID}.mapBuilt`, entry, scene, plan);
  return scene;
}

/** Redraws the map if the Bastion has one (after a turn or a siege day). Never throws. */
export async function refreshMap(entry) {
  try {
    if (!game.user.isGM || !mapScene(getRecord(entry))) return null;
    return await buildMap(entry, { notify: false });
  } catch (err) {
    console.error(`${MODULE_ID} | Could not redraw the Bastion map`, err);
    noteError("map.refresh");
    return null;
  }
}

/** Opens (views) the Bastion's map scene. */
export async function viewMap(record) {
  const scene = mapScene(record);
  if (scene) await scene.view();
  return scene;
}

/**
 * Redraws soon, once: several finishes in a row (a turn, then its hook, Finish all) make one redraw after the one
 * running, never two at once. Resolves when the map is up to date.
 */
const refreshing = new Map();
export function queueMapRefresh(entry) {
  if (!entry) return Promise.resolve(null);
  const state = refreshing.get(entry.id);
  if (state) { state.again = true; return state.done; }
  const next = { again: false };
  next.done = (async () => {
    let scene;
    do { next.again = false; scene = await refreshMap(entry); } while (next.again);
    refreshing.delete(entry.id);
    return scene;
  })();
  refreshing.set(entry.id, next);
  return next.done;
}

/**
 * Redraws a Bastion's map whenever a project finishes (on a turn, a long rest or the GM's Finish now / Finish all),
 * when buildings were placed, when its look changes and when the breaches in its wall change. GM only.
 */
export function registerMapHooks() {
  const byId = id => game.journal.get(id);
  Hooks.on(`${MODULE_ID}.postTurn`, ({ entryId, report }) => {
    if (report?.layoutChanged || report?.completed?.length) queueMapRefresh(byId(entryId));
  });
  Hooks.on(`${MODULE_ID}.restCounted`, ({ entryId, layoutChanged, completed }) => {
    if (layoutChanged || completed?.length) queueMapRefresh(byId(entryId));
  });
  Hooks.on(`${MODULE_ID}.mapLookChanged`, ({ entryId }) => queueMapRefresh(byId(entryId)));
  Hooks.on(`${MODULE_ID}.projectFinished`, ({ entryId }) => queueMapRefresh(byId(entryId)));
  const breachCheck = entry => {
    const record = getRecord(entry);
    if (!record?.map) return;
    if (planFor(record).breaches.length !== (record.map.breaches ?? 0)) refreshMap(entry);
  };
  Hooks.on(`${MODULE_ID}.siegeDay`, entry => breachCheck(entry));
  Hooks.on(`${MODULE_ID}.siegeEnded`, entry => breachCheck(entry));
}
