/**
 * One change at a time per Bastion, on the GM who runs them: every action on a Bastion (socket.js runAction) and every
 * turn, long rest, siege day and finish (turn-runner.js) waits for the one before it. A turn reads the record, works on
 * a copy and writes it back, so a hire, a route or a payment made in between would otherwise be written over.
 * Not reentrant: code holding the lock calls the unlocked work, never another locked entry point.
 */
const chains = new Map();

export function withBastionLock(entryId, fn) {
  if (!entryId) return fn();
  const run = (chains.get(entryId) ?? Promise.resolve()).then(() => fn());
  const tail = run.catch(() => {});
  chains.set(entryId, tail);
  tail.then(() => { if (chains.get(entryId) === tail) chains.delete(entryId); });
  return run;
}
