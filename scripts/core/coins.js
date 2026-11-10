/**
 * Pays a sum in copper from a coin purse: small coins first, then one larger coin broken for change (given back in
 * GP, SP and CP). The system's own currency manager can't make change, so a character with only gold couldn't pay
 * 2 SP. Returns the new purse, or null when there isn't enough money.
 */
export function payFromPurse(currency, copper) {
  const VALUES = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
  const order = ["cp", "sp", "ep", "gp", "pp"];
  const purse = Object.fromEntries(order.map(k => [k, Math.max(0, Math.floor(Number(currency[k]) || 0))]));
  const total = order.reduce((n, k) => n + purse[k] * VALUES[k], 0);
  if (total < copper) return null;
  let rest = copper;
  for (const k of order) {
    const use = Math.min(purse[k], Math.floor(rest / VALUES[k]));
    purse[k] -= use;
    rest -= use * VALUES[k];
  }
  if (rest > 0) {
    const k = order.find(d => purse[d] > 0 && VALUES[d] >= rest);
    if (!k) return null;
    purse[k] -= 1;
    let change = VALUES[k] - rest;
    for (const d of ["gp", "sp", "cp"]) {
      const n = Math.floor(change / VALUES[d]);
      purse[d] += n;
      change -= n * VALUES[d];
    }
  }
  return purse;
}
