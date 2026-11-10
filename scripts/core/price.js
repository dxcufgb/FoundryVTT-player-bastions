/** Price models for projects (pure). */

/**
 * Price presets: a base price (per room, per square of wall, per mile) becomes scale × price^power, rounded to 5 GP
 * (1 GP under 100) and never dearer than the DMG's. Cheap work keeps its price; dear work comes down more:
 * "fair" (the default) takes 12% off a Cramped room and 23% off a 7,500 GP hall, "thrifty" 19% and 39%.
 * Each preset also sets the price of hiring a building crew and its upkeep.
 */
export const BUILD_PRICES = {
  dmg: { scale: 1, power: 1, crewHireCost: 50, crewUpkeep: 10 },
  fair: { scale: 1.2, power: 0.95, crewHireCost: 40, crewUpkeep: 8 },
  thrifty: { scale: 1.5, power: 0.9, crewHireCost: 25, crewUpkeep: 5 }
};

/** A base price at the given price model (see BUILD_PRICES). */
export function priceGp(gp, price) {
  const c = Number(gp) || 0;
  if (c <= 0) return 0;
  const scale = Number(price?.scale) || 1;
  const power = Number(price?.power) || 1;
  if (scale === 1 && power === 1) return c;
  const v = scale * Math.pow(c, power);
  const r = v < 100 ? Math.round(v) : Math.round(v / 5) * 5;
  return Math.min(c, Math.max(1, r));
}

export const samePrice = (a, b) => (Number(a?.scale) || 1) === (Number(b?.scale) || 1) && (Number(a?.power) || 1) === (Number(b?.power) || 1);
