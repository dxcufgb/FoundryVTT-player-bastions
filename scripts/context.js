import { ownerActors } from "./store.js";
import { rules, catalog } from "./util.js";
import { computeStats } from "./core/stats.js";

/**
 * Reads what the stats need from the dnd5e system's own Bastion data on the owners' actors:
 * DMG defenders and hirelings on facility items, a stocked Armory, War Room lieutenants, a Teleportation Circle.
 */
export function systemContext(record) {
  const ctx = { dmgDefenders: 0, dmgHirelings: 0, armoryStocked: false, lieutenants: 0, teleportCircle: false, ownersPresent: 0,
    partyLevel: 0, facilities: [] };
  const actors = ownerActors(record);
  let levels = 0;
  for (const actor of actors) {
    levels += actor.system?.details?.level ?? 0;
    for (const f of actor.itemTypes?.facility ?? []) {
      const sys = f.system;
      ctx.facilities.push({ uuid: f.uuid, id: f.id, actorId: actor.id, actorName: actor.name, name: f.name, type: sys.type?.value,
        subtype: sys.type?.subtype, order: sys.order, progress: sys.progress, disabled: sys.disabled, size: sys.size });
      if (sys.disabled) continue;
      if (sys.type?.value === "special") {
        ctx.dmgDefenders += sys.defenders?.value?.length ?? 0;
        ctx.dmgHirelings += sys.hirelings?.value?.length ?? 0;
        if (sys.type?.subtype === "armory" && sys.trade?.stock?.stocked) ctx.armoryStocked = true;
        if (sys.type?.subtype === "warRoom") ctx.lieutenants += sys.hirelings?.value?.length ?? 0;
        if (sys.type?.subtype === "teleportationCircle") ctx.teleportCircle = true;
      }
    }
  }
  ctx.partyLevel = actors.length ? Math.round(levels / actors.length) : 5;
  ctx.ownersPresent = record.presence === "present" ? actors.length : 0;
  ctx.ownerCount = actors.length;
  return ctx;
}

/** Stats for a record with the live system context. */
export function statsFor(record, extraCtx = {}) {
  const ctx = { ...systemContext(record), ...extraCtx };
  return { stats: computeStats(record, { rules: rules(), catalog: catalog(), ctx }), ctx };
}
