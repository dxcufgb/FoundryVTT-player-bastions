/**
 * The long-rest clock: with no calendar module, each long rest the party takes is one day at the Bastion. Building
 * work moves on a day per long rest, and the Bastion turn (income, upkeep, food, events) comes every `turnDays` rests.
 * Pure: no Foundry.
 *
 * record.rests = { count, sinceTurn, batchAt, batch: [actor uuids] }
 *
 * A party's members each finish their own long rest, a few seconds or minutes apart (a group rest asks every player),
 * so the rests of different members within REST_BATCH_MS of the first count as one. The same character resting again
 * is always a new rest.
 */
export const REST_BATCH_MS = 30 * 60 * 1000;

/**
 * Counts one member's long rest. Returns { counted, rests } (a new rests object). `force` always counts (the GM's
 * "a long rest passed" button).
 */
export function countRest(restsIn, actorUuid, nowMs, { force = false } = {}) {
  const rests = { count: 0, sinceTurn: 0, batchAt: null, batch: [], ...(restsIn ?? {}) };
  const sameBatch = !force && rests.batchAt !== null && nowMs - rests.batchAt < REST_BATCH_MS && !rests.batch.includes(actorUuid);
  if (sameBatch) return { counted: false, rests: { ...rests, batch: [...rests.batch, actorUuid] } };
  return {
    counted: true,
    rests: { count: rests.count + 1, sinceTurn: rests.sinceTurn + 1, batchAt: nowMs, batch: [actorUuid] }
  };
}

/** Long rests left before a project with `remaining` work days is done (one work day per rest). */
export function restsLeft(project) {
  return Math.max(0, (project?.days ?? 0) - (project?.progress ?? 0));
}

/** Long rests until the next Bastion turn. */
export function restsToTurn(rests, turnDays) {
  return Math.max(0, turnDays - (rests?.sinceTurn ?? 0));
}
