/**
 * Bastion grounds: how big the walled area is, and how much of it each building takes. Pure data.
 *
 * A Bastion's grounds are a square of `side` × `side` 5-ft squares inside its outer wall. Only part of that area can
 * hold buildings (rules.groundsUsablePct; the rest is yards, lanes and the space behind the wall). Every expansion
 * has a footprint in squares; things that sit outside the walls (fields, roads, mines, moats, the walls themselves)
 * take none. When the grounds are full, nothing more can be built or enlarged until the grounds are extended.
 */

/** The grounds sizes, smallest first. */
export const GROUNDS = [
  { key: "plot", label: "Plot", side: 16 },
  { key: "compound", label: "Compound", side: 24 },
  { key: "holding", label: "Holding", side: 32 },
  { key: "fortress", label: "Fortress", side: 44 },
  { key: "citadel", label: "Citadel", side: 60 }
];

/** Room footprints by size: the DMG's facility spaces (Cramped 4, Roomy 16, Vast 36 squares). */
export const SIZE_FOOTPRINT = { cramped: 4, roomy: 16, vast: 36 };

/**
 * Footprint in squares per expansion id:
 *   "sized"   uses SIZE_FOOTPRINT by the feature's size
 *   number    squares per building (× count for "each" entries)
 *   [a, b, c] squares by tier, for buildings that grow when upgraded
 *   0         outside the walls or part of the wall: takes no room inside
 * A GM catalog override can set `footprint` on an expansion; that wins over this table.
 */
export const FOOTPRINTS = {
  // Rooms (DMG sizes)
  bedroom: "sized", "dining-room": "sized", parlor: "sized", courtyard: "sized", kitchen: "sized", storage: "sized",
  // Fortifications: the walls run along the edge of the grounds; ditches, moats and outer gates lie outside them
  wall: 0, "spike-barricade": 0, palisade: 0, "stone-wall": 0, "reinforce-wall": 0, "wall-walk": 0,
  gatehouse: 9, barbican: 0, portcullis: 0, drawbridge: 0, "arrow-slits": 0,
  watchtower: 4, "dry-ditch": 0, "wet-moat": 0, ballista: 4, postern: 1, "lesser-wards": 0, "greater-wards": 0,
  // Supplies
  granary: "sized", well: 1, "deep-well": 1, cistern: 9, smokehouse: 9, "kitchen-garden": [16, 25, 36], orchard: [36, 49, 64], greenhouse: [25, 36, 49],
  fields: 0, livestock: 0, fishery: 0, "highland-herds": 0, "mushroom-cellars": 0, "hunters-guild": 0, mill: 0, "hunting-lodge": 0, "workers-lodge": 16,
  // Access and travel: all of it is out on the route, except the coach house
  "clear-trail": 0, "build-road": 0, "pave-road": 0, "timber-bridge": 0, "stone-bridge": 0, pier: 0, harbor: 0,
  waystation: 0, "coach-house": 16, "hidden-approach": 0,
  // Trade and income
  "market-square": [36, 49, 64], inn: 25, brewery: [16, 16, 16, 25, 25, 25, 36, 36, 36, 49], "craftsmens-row": 36, warehouse: 25, "merchant-charter": 0,
  tollgate: 0, "lumber-camp": 0, quarry: 0, mine: 0, "trading-company": 16, "trading-post": 16, strongroom: 4,
  // Staff and prestige
  "servants-quarters": 16, bathhouse: 16, chapel: 16, infirmary: 16, "training-yard": 36, "garrison-hall": [36, 49, 64, 100],
  "great-hall": 64, "guest-wing": 25, "stewards-office": 4, "pleasure-gardens": 36,
  // Communication and arcane
  rookery: 4, "beacon-tower": 0, "sending-station": 4, "scrying-pool": 9, "arcane-lanterns": 0
};

/**
 * Expansions that are wall layers: extending the grounds lengthens each of them to the new perimeter (the wall at
 * every tier it has). Ditches and moats are dug out to the new line too (OUTER_WORKS). The old separate layers stay
 * listed for saves that haven't been folded yet.
 */
export const WALL_LAYERS = ["wall", "spike-barricade", "palisade", "stone-wall", "reinforce-wall", "wall-walk"];
export const OUTER_WORKS = ["dry-ditch", "wet-moat"];
