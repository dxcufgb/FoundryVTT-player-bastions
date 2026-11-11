/**
 * One change at a time per Bastion, on the GM who runs them: every action on a Bastion (socket.js runAction) and every
 * turn, long rest, siege day and finish (turn-runner.js) waits for the one before it. A turn reads the record, works on
 * a copy and writes it back, so a hire, a route or a payment made in between would otherwise be written over.
 * Not reentrant: code holding the lock calls the unlocked work, never another locked entry point. Characters' coins
 * have their own lock (withActorLock), taken inside a Bastion's.
 */
const chains = new Map();

/** Runs fn after every earlier call with the same key has settled. A falsy key runs at once. */
export function withLock(key, fn) {
  if (!key) return fn();
  const run = (chains.get(key) ?? Promise.resolve()).then(() => fn());
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

/** One change at a time to one Bastion. */
export const withBastionLock = (entryId, fn) => withLock(entryId ? `bastion:${entryId}` : null, fn);

/**
 * One coin change at a time to one character: two Bastions (each under its own lock) can share an owner, and paying or
 * refunding reads the purse and writes it back.
 */
export const withActorLock = (actor, fn) => withLock(actor?.id ? `actor:${actor.id}` : null, fn);
