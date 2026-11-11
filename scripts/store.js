import { MODULE_ID, t, escapeHTML } from "./util.js";

/**
 * Bastion records live in the module flags of one JournalEntry per Bastion, in a "Bastions" journal folder:
 *   flags.dxcufgbs-player-bastions.record = the record (see core/record.js)
 * Owners' players get Observer on the journal (they read it); every write is made by the responsible GM, as a dot-path
 * update of the changed keys, so two writes to different keys never clobber each other.
 */
export const FLAG = "record";

export function isBastionEntry(entry) {
  return !!entry?.getFlag?.(MODULE_ID, FLAG);
}

export function allBastions() {
  return game.journal.filter(j => isBastionEntry(j));
}

export function getRecord(entry) {
  return entry?.getFlag(MODULE_ID, FLAG) ?? null;
}

export function getEntry(id) {
  return game.journal.get(id) ?? null;
}

/** The Bastion this actor belongs to (as an owner or the group). */
export function bastionForActor(actor, { except = null } = {}) {
  if (!actor) return null;
  return allBastions().find(j => {
    if (except && j.id === except) return false;
    const r = getRecord(j);
    if (r.groupUuid === actor.uuid || (r.ownerUuids ?? []).includes(actor.uuid)) return true;
    // The party's members own it too.
    return ownerActors(r).some(a => a.uuid === actor.uuid);
  }) ?? null;
}

async function folder() {
  const name = t("FolderName");
  let f = game.folders.find(x => x.type === "JournalEntry" && x.getFlag(MODULE_ID, "folder"));
  if (!f) f = await Folder.create({ name, type: "JournalEntry", color: "#6b4f2a", flags: { [MODULE_ID]: { folder: true } } });
  return f;
}

/** Observer ownership for every non-GM user who owns one of the Bastion's actors. */
export function ownershipFor(record) {
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  const actors = ownerActors(record, { includeGroup: true });
  for (const user of game.users) {
    if (user.isGM) continue;
    if (actors.some(a => a.testUserPermission(user, "OWNER"))) ownership[user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  }
  return ownership;
}

/** The owners' actors (group members + listed owners). */
export function ownerActors(record, { includeGroup = false } = {}) {
  const out = new Map();
  const group = record?.groupUuid ? fromUuidSync(record.groupUuid) : null;
  if (group && includeGroup) out.set(group.uuid, group);
  for (const m of group?.system?.members ?? []) {
    const a = m.actor ?? m;
    if (a?.uuid) out.set(a.uuid, a);
  }
  for (const uuid of record?.ownerUuids ?? []) {
    const a = fromUuidSync(uuid);
    if (a) out.set(a.uuid, a);
  }
  return [...out.values()].filter(a => includeGroup || a.type === "character");
}

/** Whether this user may act for the Bastion as a player (owns one of its actors). */
export function canAct(record, user = game.user) {
  if (user.isGM) return true;
  return ownerActors(record, { includeGroup: true }).some(a => a.testUserPermission(user, "OWNER"));
}

export async function createBastionEntry(record) {
  const f = await folder();
  const entry = await JournalEntry.create({
    name: record.name,
    folder: f.id,
    ownership: ownershipFor(record),
    flags: { [MODULE_ID]: { [FLAG]: record } },
    pages: [{
      name: record.name,
      type: "text",
      text: { content: `<p>${escapeHTML(record.description)}</p>` }
    }]
  });
  return entry;
}

/**
 * Writes changed keys of a record. `changes` is a flat object of dot paths relative to the record
 * (e.g. { "projects.abc.state": "building", treasury: 120 }); a value of undefined deletes the key.
 */
export async function patchRecord(entry, changes) {
  const update = {};
  for (const [path, value] of Object.entries(changes)) {
    const base = `flags.${MODULE_ID}.${FLAG}`;
    if (value === undefined) {
      const parts = path.split(".");
      const last = parts.pop();
      update[`${base}${parts.length ? "." + parts.join(".") : ""}.-=${last}`] = null;
    } else update[`${base}.${path}`] = value;
  }
  return entry.update(update);
}

/** Replaces whole top-level keys of the record (for turn results). */
export async function writeRecordKeys(entry, record, keys) {
  const changes = {};
  for (const k of keys) changes[k] = record[k];
  // Objects that lost keys need those keys removed explicitly.
  const old = getRecord(entry) ?? {};
  for (const k of keys) {
    if (old[k] && typeof old[k] === "object" && !Array.isArray(old[k]) && record[k] && typeof record[k] === "object") {
      for (const sub of Object.keys(old[k])) if (!(sub in record[k])) changes[`${k}.-=${sub}`] = null;
    }
  }
  const update = {};
  for (const [path, value] of Object.entries(changes)) {
    if (path.includes(".-=")) update[`flags.${MODULE_ID}.${FLAG}.${path}`] = null;
    else update[`flags.${MODULE_ID}.${FLAG}.${path}`] = value;
  }
  return entry.update(update);
}
