/**
 * Headless runner for the engine tests (no Foundry needed): `node tests/run-node.mjs`.
 * The same tests run inside Foundry through Quench (batch "dxcufgbs-player-bastions.core").
 */
import nodeAssert from "node:assert/strict";
import { registerCoreTests } from "../scripts/tests/core-tests.js";

const assert = {
  equal: (a, b, m) => nodeAssert.equal(a, b, m),
  strictEqual: (a, b, m) => nodeAssert.strictEqual(a, b, m),
  deepEqual: (a, b, m) => nodeAssert.deepStrictEqual(a, b, m),
  ok: (v, m) => nodeAssert.ok(v, m),
  isTrue: (v, m) => nodeAssert.equal(v, true, m),
  isFalse: (v, m) => nodeAssert.equal(v, false, m),
  closeTo: (a, b, d, m) => nodeAssert.ok(Math.abs(a - b) <= d, m ?? `${a} not within ${d} of ${b}`),
  include: (h, n, m) => nodeAssert.ok(h.includes(n), m)
};
const tests = [];
const stack = [];
registerCoreTests({
  describe: (name, fn) => { stack.push(name); fn(); stack.pop(); },
  it: (name, fn) => tests.push({ name: [...stack, name].join(" › "), fn }),
  assert
});
let pass = 0;
const fails = [];
for (const t of tests) {
  try { await t.fn(); pass++; } catch (err) { fails.push({ name: t.name, err }); }
}
for (const f of fails) console.log(`✗ ${f.name}\n    ${f.err.message}`);
console.log(`${pass} passed, ${fails.length} failed, ${tests.length} total`);
process.exit(fails.length ? 1 : 0);
