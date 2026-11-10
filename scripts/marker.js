import { MODULE_ID, MARKER_ICON, t } from "./util.js";

/**
 * The Bastion's map marker: a Note on a map scene, linked to the Bastion's journal, with the rook icon.
 * Distances are measured on that scene in its own units (the Faerûn map uses miles).
 */
export async function placeMarker(entry, record, { sceneUuid, x, y }) {
  const scene = await fromUuid(sceneUuid);
  if (!scene) throw new Error("Scene not found");
  const old = record.marker?.noteId && record.marker?.sceneUuid ? await fromUuid(`${record.marker.sceneUuid}.Note.${record.marker.noteId}`) : null;
  if (old) await old.delete();
  const size = Math.max(40, Math.round((scene.grid?.size ?? 100) * 1.1));
  const [note] = await scene.createEmbeddedDocuments("Note", [{
    entryId: entry.id,
    x: Math.round(x), y: Math.round(y),
    texture: { src: MARKER_ICON, tint: "#ffffff" },
    iconSize: size,
    text: record.name,
    fontSize: 32,
    textAnchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
    global: true,
    flags: { [MODULE_ID]: { bastion: entry.id } }
  }]);
  return { sceneUuid: scene.uuid, noteId: note.id, x: note.x, y: note.y };
}

/** Distance in the scene's units between two points (straight line). */
export function sceneDistance(scene, a, b) {
  if (!scene || !a || !b) return null;
  const px = Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
  const size = scene.grid?.size || 100;
  const per = scene.grid?.distance || 1;
  return Math.round((px / size) * per * 10) / 10;
}

/** Map notes on the scene that could be settlements: [{ id, name, x, y, distance }] sorted by distance from (x, y). */
export function settlementsNear(scene, point) {
  if (!scene) return [];
  return scene.notes.contents
    .filter(n => !n.getFlag(MODULE_ID, "bastion"))
    .map(n => ({ id: n.id, name: n.text || n.entry?.name || t("Unnamed"), x: n.x, y: n.y,
      distance: sceneDistance(scene, point, n) }))
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Where the party is, for dispatch distances: the party's Group actor token on the Bastion's map scene, or the GM's
 * party pin (record.partyPin). Returns { x, y, source } or null.
 */
export function partyPosition(record) {
  const scene = record.marker?.sceneUuid ? fromUuidSync(record.marker.sceneUuid) : null;
  if (!scene) return null;
  const group = record.groupUuid ? fromUuidSync(record.groupUuid) : null;
  const token = group ? scene.tokens.find(tk => tk.actorId === group.id) : null;
  if (token) return { x: token.x + (token.width * scene.grid.size) / 2, y: token.y + (token.height * scene.grid.size) / 2, source: "token" };
  if (record.partyPin) return { ...record.partyPin, source: "pin" };
  return null;
}

/** Miles from the party to the Bastion, or null when unknown. */
export function partyDistance(record) {
  const scene = record.marker?.sceneUuid ? fromUuidSync(record.marker.sceneUuid) : null;
  const pos = partyPosition(record);
  if (!scene || !pos || !record.marker) return null;
  return sceneDistance(scene, pos, record.marker);
}

/**
 * Lets the GM click a point on the currently viewed scene. Resolves to { sceneUuid, x, y } or null (Escape / right-click).
 */
export function pickPoint() {
  return new Promise((resolve) => {
    if (!canvas?.ready) return resolve(null);
    ui.notifications.info(t("Wizard.ClickMap"));
    const view = canvas.app.view;
    const finish = (value) => {
      view.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.classList.remove("dxpb-picking");
      resolve(value);
    };
    const onDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button !== 0) return finish(null);
      const pos = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
      finish({ sceneUuid: canvas.scene.uuid, x: pos.x, y: pos.y });
    };
    const onKey = (event) => { if (event.key === "Escape") finish(null); };
    document.body.classList.add("dxpb-picking");
    view.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  });
}
