import { MODULE_ID, isResponsibleGM } from "./util.js";
import { allBastions, getRecord, ownerActors } from "./store.js";
import { activeEffects, effectData, effectStamp, isInside, planActorEffects } from "./core/effects.js";
import { noteError } from "./debug-recorder.js";

/**
 * Bastion effects on the characters (see core/effects.js): every owner character inside a Bastion carries one Active
 * Effect per effect the GM switched on there, flagged `flags.<module>.bastionEffect`; a character outside carries
 * none. The responsible GM keeps the actors in step after any change to a Bastion, its owners or a group's members.
 */

/** The applied Bastion effects on an actor. */
function appliedOn(actor) {
  return actor.effects.filter(e => e.getFlag(MODULE_ID, "bastionEffect")).map(e => {
    const f = e.getFlag(MODULE_ID, "bastionEffect");
    return { id: e.id, entryId: f.entryId, effectId: f.effectId, stamp: f.stamp };
  });
}

/** What every character should carry: actorId → [{ entryId, effectId, stamp, data }]. */
function desiredByActor() {
  const out = new Map();
  for (const entry of allBastions()) {
    const record = getRecord(entry);
    const effects = activeEffects(record);
    if (!effects.length) continue;
    for (const actor of ownerActors(record)) {
      if (!isInside(record, actor.id)) continue;
      const list = out.get(actor.id) ?? [];
      for (const effect of effects) {
        list.push({ entryId: entry.id, effectId: effect.id, stamp: effectStamp(effect, record.name),
          data: effectData(effect, { entryId: entry.id, origin: entry.uuid, bastionName: record.name, scope: MODULE_ID }) });
      }
      out.set(actor.id, list);
    }
  }
  return out;
}

let running = null;
let again = false;

/** Brings every character's Bastion effects in step (responsible GM). One run at a time; a call during a run runs once more after. */
export async function syncBastionEffects() {
  if (!isResponsibleGM()) return;
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      const desired = desiredByActor();
      for (const actor of game.actors) {
        if (actor.type !== "character") continue;
        const existing = appliedOn(actor);
        const want = desired.get(actor.id) ?? [];
        if (!existing.length && !want.length) continue;
        const plan = planActorEffects(want, existing);
        try {
          if (plan.remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", plan.remove);
          if (plan.update.length) await actor.updateEmbeddedDocuments("ActiveEffect", plan.update);
          if (plan.create.length) await actor.createEmbeddedDocuments("ActiveEffect", plan.create);
        } catch (err) {
          console.error(`${MODULE_ID} | Could not update Bastion effects on an actor`, err);
          noteError("effects.sync");
        }
      }
    } while (again);
  })();
  try { await running; } finally { running = null; }
}

const debounced = foundry.utils.debounce(() => syncBastionEffects(), 200);

/** Asks for a sync soon (several changes in a row make one). */
export function queueEffectsSync() {
  if (isResponsibleGM()) debounced();
}
