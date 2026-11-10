/**
 * Location questions of the founding wizard and what each answer does to the Bastion's stats.
 * Pure data: no Foundry globals, so the Node test runner can import it too.
 *
 * Effect keys (all optional): accessibility, concealment, renown, security (score deltas), siteMult (siege site multiplier),
 * buildTime (multiplier on build days), buildCost (multiplier on cost), speed (travel speed factor on the road),
 * dispatchRisk (+% risk), merchant (+% merchant chance), farm (farm output multiplier), food (food per day), wardCost.
 */

export const TERRAINS = {
  plains: { label: "Plains", effects: {} },
  forest: { label: "Forest", effects: { accessibility: -1, concealment: 2 } },
  hills: { label: "Hills", effects: {} },
  mountains: { label: "Mountains", effects: { accessibility: -2, buildTime: 1.25 } },
  swamp: { label: "Swamp", effects: { accessibility: -2 } },
  desert: { label: "Desert", effects: { accessibility: -2 } },
  coast: { label: "Coast", effects: {} },
  arctic: { label: "Arctic", effects: { accessibility: -2, buildTime: 1.25 } },
  underground: { label: "Underground", effects: { accessibility: -3, concealment: 2 } },
  urban: { label: "Urban", effects: { concealment: -3 } }
};

export const SITES = {
  flat: { label: "Flat ground", effects: { siteMult: 1.0 } },
  hilltop: { label: "Hilltop", effects: { siteMult: 1.2, concealment: -1 } },
  cliff: { label: "Cliff or island", effects: { siteMult: 1.4, concealment: -1 } },
  fastness: { label: "Mountain fastness", effects: { siteMult: 1.5 } }
};

export const SETTLEMENT_SIZES = {
  hamlet: { label: "Hamlet", accessibility: 0 },
  village: { label: "Village", accessibility: 1 },
  town: { label: "Town", accessibility: 2 },
  city: { label: "City", accessibility: 3 },
  metropolis: { label: "Metropolis", accessibility: 3 }
};

/** Accessibility from the distance to the nearest settlement (miles). */
export function distanceAccessibility(miles) {
  const d = Number(miles) || 0;
  if (d <= 5) return 3;
  if (d <= 20) return 2;
  if (d <= 50) return 1;
  return 0;
}

/** Road tiers in order; projects can upgrade the tier. */
export const ROADS = {
  none: { label: "None", rank: 0, accessibility: 0, speed: 0.5, concealment: 0 },
  trail: { label: "Trail", rank: 1, accessibility: 1, speed: 0.75, concealment: -1 },
  road: { label: "Road", rank: 2, accessibility: 3, speed: 1.0, concealment: -2 },
  highway: { label: "Highway", rank: 3, accessibility: 4, speed: 1.25, concealment: -3 }
};

export const WATERWAYS = {
  none: { label: "None", accessibility: 0 },
  stream: { label: "Stream", accessibility: 0 },
  river: { label: "River", accessibility: 1 },
  lake: { label: "Lake", accessibility: 1 },
  coast: { label: "Coast", accessibility: 2 }
};

export const WATER_ON_SITE = {
  none: { label: "None" },
  spring: { label: "Spring" },
  table: { label: "High water table" },
  rock: { label: "Solid rock" }
};

export const CLIMATES = {
  temperate: { label: "Temperate", effects: {} },
  cold: { label: "Cold", effects: { buildTime: 1.15 } },
  hot: { label: "Hot", effects: {} },
  arid: { label: "Arid", effects: { farm: 0.5 } }
};

export const LANDS = {
  fertile: { label: "Fertile", farm: 1.0 },
  poor: { label: "Poor", farm: 0.5 },
  barren: { label: "Barren", farm: 0 }
};

export const RESOURCES = {
  timber: { label: "Timber" },
  stone: { label: "Stone" },
  ore: { label: "Ore" },
  gems: { label: "Gems" },
  game: { label: "Game", effects: { food: 10 } },
  herbs: { label: "Herbs" },
  magic: { label: "A magical site", effects: { wardCost: 0.75 } }
};

export const DANGERS = {
  safe: { label: "Safe", effects: { dispatchRisk: 0, merchant: 0, buildCost: 1.0 } },
  frontier: { label: "Frontier", effects: { dispatchRisk: 5, merchant: 0, buildCost: 1.0 } },
  wild: { label: "Wild", effects: { dispatchRisk: 10, merchant: -10, buildCost: 1.1 } },
  hostile: { label: "Hostile", effects: { dispatchRisk: 20, merchant: -20, buildCost: 1.2 } }
};

export const VISIBILITY = {
  prominent: { label: "Prominent", effects: { concealment: -2, renown: 1 } },
  ordinary: { label: "Ordinary", effects: {} },
  hidden: { label: "Hidden", effects: { concealment: 2, renown: -1 } }
};

export const POLITICAL = {
  grant: { label: "Crown or lord's grant", effects: { security: 1, tax: 0.1 } },
  freehold: { label: "Own freehold", effects: {} },
  unclaimed: { label: "Unclaimed", effects: {} },
  contested: { label: "Contested", effects: { contested: true } }
};

/** A complete default location, used by the wizard and by tests. */
export function defaultLocation() {
  return {
    terrain: "plains",
    site: "flat",
    settlement: { name: "", size: "village", distance: 20 },
    road: "trail",
    waterway: "none",
    waterOnSite: "table",
    climate: "temperate",
    land: "fertile",
    resources: [],
    danger: "frontier",
    visibility: "ordinary",
    political: "freehold"
  };
}

/** The ten terrain images and four site images shipped in assets/. */
export function terrainImage(terrain) {
  return `modules/dxcufgbs-player-bastions/assets/terrains/${TERRAINS[terrain] ? terrain : "plains"}.webp`;
}

export function siteImage(site) {
  return `modules/dxcufgbs-player-bastions/assets/sites/${SITES[site] ? site : "flat"}.webp`;
}

/** A Bastion's picture: the one the GM chose, else its terrain's. */
export function bastionImage(record) {
  return record?.image || terrainImage(record?.location?.terrain);
}
