/**
 * The expansion catalog. Pure data, editable by the GM through world-setting overrides (see core/catalog.js).
 *
 * unit:  "flat"   one-off building, cost/days as given
 *        "sized"  Cramped / Roomy / Vast, cost and days are arrays of three
 *        "square" per 5-ft square of wall (count chosen when planned)
 *        "mile"   per mile of road (count chosen when planned)
 *        "each"   several of the same (count chosen, up to max)
 * tiers: buildings that can be upgraded; tier 1 is the first build, later tiers are upgrade projects.
 *        Each tier's effects ADD to the earlier tiers' effects. For "square" entries (the wall) a tier's cost and
 *        days are per square, times the wall's length; a tier's `material` replaces the expansion's.
 * legacy: kept only so old Bastions still read; can't be planned (folded into another expansion's tiers).
 * once:   a ring round the grounds that is built only once (the wall, the spike barricade).
 * requires: { features: [ids, all needed], anyFeature: [ids, one needed], check: [named checks, see core/catalog.js] }
 * effects: stat deltas (see core/stats.js for every key). For "sized" entries a value can be an array of three.
 * room:  the dnd5e basic facility subtype created on the owners' sheet when the room is finished.
 * material: "stone" | "timber" | "magic" for resource discounts.
 * dmg: true when the price is the DMG's own (rooms, enlarging, stone walls); the rest is this module's design.
 */

const SIZED_COST = [500, 1000, 3000];
const SIZED_DAYS = [20, 45, 125];

export const GROUPS = {
  rooms: "Rooms",
  fortifications: "Fortifications",
  supplies: "Supplies and infrastructure",
  access: "Access and travel",
  trade: "Trade and income",
  staff: "Staff and prestige",
  arcane: "Communication and arcane"
};

export const EXPANSIONS = [
  /* ---------------- Rooms (DMG basic facilities) ---------------- */
  { id: "bedroom", group: "rooms", name: "Bedroom", unit: "sized", dmg: true, cost: SIZED_COST, days: SIZED_DAYS, room: "bedroom",
    effects: { housing: [4, 12, 30] }, summary: "Beds for the household and staff." },
  { id: "dining-room", group: "rooms", name: "Dining Room", unit: "sized", dmg: true, cost: SIZED_COST, days: SIZED_DAYS, room: "diningRoom",
    effects: { comfort: [0, 1, 2] }, summary: "Shared meals lift spirits." },
  { id: "parlor", group: "rooms", name: "Parlor", unit: "sized", dmg: true, cost: SIZED_COST, days: SIZED_DAYS, room: "parlor",
    effects: { renown: [0, 1, 2] }, summary: "A place to receive guests of standing." },
  { id: "courtyard", group: "rooms", name: "Courtyard", unit: "sized", dmg: true, cost: SIZED_COST, days: SIZED_DAYS, room: "courtyard",
    effects: { courtyard: [1, 2, 3] }, summary: "Open ground inside the walls; Roomy or larger fits a Training Yard." },
  { id: "kitchen", group: "rooms", name: "Kitchen", unit: "sized", dmg: true, cost: SIZED_COST, days: SIZED_DAYS, room: "kitchen",
    effects: { kitchen: [30, 80, 200] }, summary: "Feeds the people living here; needed for an Inn or Great Hall." },
  { id: "storage", group: "rooms", name: "Storage", unit: "sized", dmg: true, cost: SIZED_COST, days: SIZED_DAYS, room: "storage",
    effects: { foodStock: [1000, 4000, 9000] }, summary: "Room for food and goods." },

  /* ---------------- Fortifications ---------------- */
  { id: "wall", group: "fortifications", name: "Wall", unit: "square", once: true, cost: 50, days: 2, material: "timber",
    effects: { wall: "palisade" },
    tiers: [
      { label: "Palisade", cost: 50, days: 2, material: "timber", effects: { wall: "palisade" } },
      { label: "Stone wall", cost: 250, days: 10, material: "stone", effects: { wall: "stone" } },
      { label: "Reinforced stone wall", cost: 125, days: 4, material: "stone", effects: { wall: "reinforced" } },
      { label: "Wall walk and crenellations", cost: 25, days: 1, material: "stone", effects: { defenseMult: 1.05, wallWalk: true } }
    ],
    summary: "A wall all round the grounds, built as a timber palisade (closed all round: garrison x2, Integrity 40) and upgraded in place: a 20 ft stone wall (x4, Integrity 120, DMG attacks roll 2 fewer dice), reinforced (x5, Integrity 200), then a wall walk with crenellations (defense x1.05). Each step is priced per square along the whole wall." },
  { id: "spike-barricade", group: "fortifications", name: "Spike Barricade", unit: "square", once: true, cost: 15, days: 1,
    material: "timber", requires: { features: ["wall"] }, effects: { defenseMult: 1.05, lightCut: 10 },
    summary: "Sharpened stakes along the foot of the wall, outside it and inside any ditch or moat: defense x1.05, light engines -10 %. Lengthened with the wall when the grounds grow." },
  // Old separate wall projects: existing Bastions fold them into the Wall's tiers (see foldLegacyWalls).
  { id: "palisade", group: "fortifications", name: "Palisade", unit: "square", cost: 50, days: 2, material: "timber",
    legacy: true, effects: { wall: "palisade" }, summary: "Now the Wall's first step." },
  { id: "stone-wall", group: "fortifications", name: "Stone Wall", unit: "square", dmg: true, cost: 250, days: 10, material: "stone",
    legacy: true, effects: { wall: "stone" }, summary: "Now a Wall upgrade." },
  { id: "reinforce-wall", group: "fortifications", name: "Reinforce Stone Wall", unit: "square", cost: 125, days: 4, material: "stone",
    legacy: true, effects: { wall: "reinforced" }, summary: "Now a Wall upgrade." },
  { id: "wall-walk", group: "fortifications", name: "Wall Walk and Crenellations", unit: "square", cost: 25, days: 1,
    legacy: true, effects: { defenseMult: 1.05, wallWalk: true }, summary: "Now a Wall upgrade." },
  { id: "gatehouse", group: "fortifications", name: "Gatehouse", unit: "flat", cost: 2500, days: 60, material: "stone",
    requires: { check: ["anyWall"] }, effects: { defenseMult: 1.15, integrity: 30, security: 1 }, summary: "A fortified gate." },
  { id: "barbican", group: "fortifications", name: "Barbican", unit: "flat", cost: 4400, days: 90, material: "stone",
    requires: { features: ["gatehouse"] }, effects: { defenseMult: 1.1, integrity: 20 }, summary: "An outer gate in front of the gatehouse." },
  { id: "portcullis", group: "fortifications", name: "Portcullis and Murder Holes", unit: "flat", cost: 750, days: 20,
    requires: { features: ["gatehouse"] }, effects: { defenseMult: 1.1 }, summary: "Iron gates and holes to drop things through." },
  { id: "drawbridge", group: "fortifications", name: "Drawbridge", unit: "flat", cost: 1000, days: 20,
    requires: { features: ["gatehouse"], anyFeature: ["dry-ditch", "wet-moat"] }, effects: { lightCut: 25 },
    summary: "Rams can't reach the gate: light engine damage -25 %." },
  { id: "arrow-slits", group: "fortifications", name: "Arrow Slits and Hoardings", unit: "flat", cost: 500, days: 14,
    requires: { check: ["anyWall"] }, effects: { defenseMult: 1.1 }, summary: "Defenders shoot from cover." },
  { id: "watchtower", group: "fortifications", name: "Watchtower", unit: "each", max: 4, cost: 1250, days: 45, material: "stone",
    effects: { defensePct: 5, integrity: 5, security: 1, concealment: -1 }, summary: "Sees trouble coming; defense +5 % each." },
  { id: "dry-ditch", group: "fortifications", name: "Dry Ditch", unit: "flat", cost: 1900, days: 60,
    effects: { defenseMult: 1.1, noSapping: true }, summary: "A deep ditch around the walls." },
  { id: "wet-moat", group: "fortifications", name: "Wet Moat", unit: "flat", cost: 5000, days: 120,
    requires: { check: ["moatWater"] }, effects: { defenseMult: 1.2, lightHalve: true, noSapping: true },
    summary: "Water all round: defense x1.2, light engines do half damage." },
  { id: "ballista", group: "fortifications", name: "Ballista Emplacement", unit: "each", max: 4, cost: 950, days: 14, upkeep: 1,
    requires: { check: ["anyWall"] }, effects: { engineCut: 10, garrison: 2 }, summary: "Engine damage -10 % each, Garrison +2 each." },
  { id: "postern", group: "fortifications", name: "Postern Tunnel", unit: "flat", cost: 1500, days: 40,
    effects: { siegeFood: 1.5, postern: true }, summary: "A secret way in and out: siege food x1.5, envoys get through a siege." },
  { id: "lesser-wards", group: "fortifications", name: "Lesser Wards", unit: "flat", cost: 3100, days: 21, material: "magic",
    effects: { wards: 25, security: 1 }, summary: "Glyphs and alarms: magical siege damage -25 %." },
  { id: "greater-wards", group: "fortifications", name: "Greater Wards", unit: "flat", cost: 18750, days: 60, material: "magic",
    requires: { features: ["lesser-wards"] }, effects: { wards: 25, security: 1, noScrying: true },
    summary: "Magical damage -50 % in total; no scrying or teleporting in or out." },

  /* ---------------- Supplies and infrastructure ---------------- */
  { id: "granary", group: "supplies", name: "Granary", unit: "sized", cost: [625, 1250, 3750], days: SIZED_DAYS, room: "storage",
    effects: { foodStock: [2000, 6000, 15000] }, summary: "Stores grain for lean times and sieges." },
  { id: "well", group: "supplies", name: "Well", unit: "flat", cost: 500, days: 15,
    requires: { check: ["wellSite"] }, effects: { waterUnlimited: true }, summary: "Unlimited water inside the walls." },
  { id: "deep-well", group: "supplies", name: "Deep Well", unit: "flat", cost: 1900, days: 45,
    requires: { check: ["rockSite"] }, effects: { waterUnlimited: true }, summary: "Bored through rock: unlimited water." },
  { id: "cistern", group: "supplies", name: "Cistern", unit: "flat", cost: 1000, days: 30,
    effects: { cistern: 3000 }, summary: "3,000 person-days of water for a siege." },
  { id: "smokehouse", group: "supplies", name: "Smokehouse and Salt Store", unit: "flat", cost: 375, days: 10,
    effects: { foodStockPct: 25 }, summary: "Food keeps longer: food stock capacity +25 %." },
  { id: "kitchen-garden", group: "supplies", name: "Kitchen Garden", unit: "flat", cost: 500, days: 30,
    requires: { check: ["notUnderground"] }, effects: { foodPerDay: 15 }, summary: "Vegetables inside the walls: +15 food a day." },
  { id: "orchard", group: "supplies", name: "Orchard", unit: "flat", cost: 1250, days: 180,
    requires: { check: ["farmland"] }, effects: { foodOutside: 25, comfort: 1, income: 5 }, summary: "Fruit trees: +25 food a day, +5 GP a turn." },
  { id: "fields", group: "supplies", name: "Fields and Tenant Farms", unit: "flat", cost: 2500, days: 90,
    requires: { check: ["farmland"] }, effects: { foodOutside: 100, income: 15 },
    tiers: [
      { label: "Tenant farms", cost: 2500, days: 90, effects: { foodOutside: 100, income: 15 } },
      { label: "Estate farms", cost: 3750, days: 60, effects: { foodOutside: 50, income: 15 } },
      { label: "Great estate", cost: 6250, days: 90, effects: { foodOutside: 100, income: 25 } }
    ],
    summary: "Farmland worked by tenants. Upgrades grow food and rent." },
  { id: "livestock", group: "supplies", name: "Livestock Pens", unit: "flat", cost: 750, days: 20,
    effects: { foodOutside: 20, income: 8 }, summary: "+20 food a day and animals to sell." },
  { id: "mill", group: "supplies", name: "Mill", unit: "flat", cost: 1900, days: 60,
    requires: { features: ["fields"], check: ["millSite"] }, effects: { farmMult: 1.5, income: 15 }, summary: "Field output x1.5, +15 GP a turn." },
  { id: "hunting-lodge", group: "supplies", name: "Hunting Lodge", unit: "flat", cost: 875, days: 25,
    requires: { check: ["game"] }, effects: { foodOutside: 20, renown: 1 }, summary: "+20 food a day, Renown +1." },
  { id: "workers-lodge", group: "supplies", name: "Workers' Lodge", unit: "flat", cost: 1500, days: 45,
    effects: { crews: 1, housing: 10 }, summary: "Houses a permanent building crew: +1 building crew, no upkeep." },

  /* ---------------- Access and travel ---------------- */
  { id: "clear-trail", group: "access", name: "Clear a Trail", unit: "mile", cost: 60, days: 1,
    requires: { check: ["roadBelowTrail"] }, effects: { roadTier: "trail" }, summary: "A trail to the nearest settlement (whole route)." },
  { id: "build-road", group: "access", name: "Build a Road", unit: "mile", cost: 250, days: 3,
    requires: { check: ["roadTrail"] }, effects: { roadTier: "road" }, summary: "A proper road to the nearest settlement." },
  { id: "pave-road", group: "access", name: "Pave the Road", unit: "mile", cost: 750, days: 6, material: "stone",
    requires: { check: ["roadRoad"] }, effects: { roadTier: "highway" }, summary: "A paved highway." },
  { id: "timber-bridge", group: "access", name: "Timber Bridge", unit: "flat", cost: 1900, days: 30, material: "timber",
    requires: { check: ["riverRoute"] }, effects: { accessibility: 1 }, summary: "Accessibility +1." },
  { id: "stone-bridge", group: "access", name: "Stone Bridge", unit: "flat", cost: 6250, days: 90, material: "stone",
    requires: { features: ["timber-bridge"] }, effects: { accessibility: 1 }, summary: "Accessibility +1 more." },
  { id: "pier", group: "access", name: "Pier", unit: "flat", cost: 1900, days: 45,
    requires: { check: ["pierWater"] }, effects: { accessibility: 2, merchant: 5 }, summary: "Boats can land: Accessibility +2." },
  { id: "harbor", group: "access", name: "Harbor", unit: "flat", cost: 10000, days: 180, upkeep: 5,
    requires: { features: ["pier"], check: ["harborWater"] }, effects: { accessibility: 2, exotic: true, income: 20, incomeAccess: true },
    tiers: [
      { label: "Harbor", cost: 10000, days: 180, effects: { accessibility: 2, exotic: true, income: 20, incomeAccess: true } },
      { label: "Trading port", cost: 15000, days: 180, effects: { income: 60, merchantTier: 1 } }
    ],
    summary: "Sea or river trade. Exotic traders, income that grows with Accessibility." },
  { id: "waystation", group: "access", name: "Waystation", unit: "flat", cost: 1250, days: 40, upkeep: 2,
    requires: { check: ["roadRoad"] }, effects: { accessibility: 1, renown: 1, relay: true, income: 5 }, summary: "Relay riders, Accessibility +1." },
  { id: "coach-house", group: "access", name: "Coach House and Remounts", unit: "flat", cost: 1000, days: 20, upkeep: 1,
    effects: { mountedEnvoys: true }, summary: "Envoys ride at 40 miles a day (60 with a Waystation)." },
  { id: "hidden-approach", group: "access", name: "Hidden Approach", unit: "flat", cost: 1900, days: 30,
    effects: { concealment: 3, accessibility: -1 }, summary: "Harder to find: Concealment +3, Accessibility -1." },

  /* ---------------- Trade and income ---------------- */
  { id: "market-square", group: "trade", name: "Market Square", unit: "flat", cost: 3100, days: 60,
    requires: { check: ["access3"] }, effects: { merchant: 15, income: 20, incomeAccess: true },
    tiers: [
      { label: "Market square", cost: 3100, days: 60, effects: { merchant: 15, income: 20, incomeAccess: true } },
      { label: "Market hall", cost: 4400, days: 60, effects: { merchant: 5, income: 25 } },
      { label: "Market town", cost: 7500, days: 90, effects: { merchant: 5, income: 40, merchantTier: 1 } }
    ],
    summary: "Stalls and fees. Each upgrade brings more traders and rent." },
  { id: "inn", group: "trade", name: "Inn", unit: "flat", cost: 3750, days: 90,
    requires: { features: ["kitchen"], check: ["access3"] }, effects: { incomeDice: "2d6*5", visitors: 10, renown: 1, rumors: true },
    tiers: [
      { label: "Inn", cost: 3750, days: 90, effects: { incomeDice: "2d6*5", visitors: 10, renown: 1, rumors: true } },
      { label: "Coaching inn", cost: 5000, days: 90, effects: { income: 25 } },
      { label: "Grand hostelry", cost: 8750, days: 120, effects: { income: 50, renown: 1 } }
    ],
    summary: "Travellers pay for beds and ale, and bring a rumor every turn." },
  { id: "brewery", group: "trade", name: "Brewery", unit: "flat", cost: 1500, days: 40,
    effects: { income: 10, innMult: 1.5, comfort: 1 }, summary: "+10 GP a turn, Inn income x1.5." },
  { id: "craftsmens-row", group: "trade", name: "Craftsmen's Row", unit: "flat", cost: 2500, days: 60,
    requires: { features: ["market-square"] }, effects: { income: 25, craftedSale: 10 },
    tiers: [
      { label: "Craftsmen's row", cost: 2500, days: 60, effects: { income: 25, craftedSale: 10 } },
      { label: "Guild street", cost: 4400, days: 60, effects: { income: 35 } },
      { label: "Artisans' quarter", cost: 7500, days: 90, effects: { income: 60, craftedSale: 10 } }
    ],
    summary: "Workshops for rent; crafted goods sell for more." },
  { id: "warehouse", group: "trade", name: "Warehouse", unit: "flat", cost: 1250, days: 45,
    effects: { merchantStock: 1.5 }, summary: "Merchant stock x1.5." },
  { id: "merchant-charter", group: "trade", name: "Merchant Charter", unit: "flat", cost: 1250, days: 14,
    requires: { features: ["market-square"] }, effects: { merchantTier: 1 }, summary: "Better traders come: merchant tier +1." },
  { id: "tollgate", group: "trade", name: "Tollgate", unit: "flat", cost: 625, days: 10,
    requires: { check: ["roadRoad", "access4"] }, effects: { tollPerAccess: 5, renown: -1 }, summary: "+5 GP a turn per Accessibility point." },
  { id: "lumber-camp", group: "trade", name: "Lumber Camp", unit: "flat", cost: 1000, days: 30,
    requires: { check: ["timber"] }, effects: { income: 5, timberDiscount: 0.8, palisadeTime: 0.5 },
    tiers: [
      { label: "Lumber camp", cost: 1000, days: 30, effects: { income: 5, timberDiscount: 0.8, palisadeTime: 0.5 } },
      { label: "Sawmill", cost: 2500, days: 45, effects: { income: 15 } }
    ],
    summary: "Timber projects cost x0.8; the sawmill sells planks." },
  { id: "quarry", group: "trade", name: "Quarry", unit: "flat", cost: 3750, days: 90,
    requires: { check: ["stone"] }, effects: { income: 10, stoneDiscount: 0.8 },
    tiers: [
      { label: "Quarry", cost: 3750, days: 90, effects: { income: 10, stoneDiscount: 0.8 } },
      { label: "Stoneworks", cost: 6250, days: 90, effects: { income: 30 } }
    ],
    summary: "Stone projects cost x0.8; cut stone sells." },
  { id: "mine", group: "trade", name: "Mine", unit: "flat", cost: 7500, days: 150, upkeep: 5,
    requires: { check: ["ore"] }, effects: { incomeDice: "3d6*10", concealment: -1 },
    tiers: [
      { label: "Mine", cost: 7500, days: 150, effects: { incomeDice: "3d6*10", concealment: -1 } },
      { label: "Deep mine", cost: 12500, days: 150, effects: { incomeDice: "3d6*10" } },
      { label: "Mining company", cost: 20000, days: 200, effects: { incomeDice: "4d6*10", upkeep: 5 } }
    ],
    summary: "Ore or gems (gems pay double). Big income, some risk." },
  { id: "trading-company", group: "trade", name: "Trading Company", unit: "flat", cost: 10000, days: 120,
    requires: { features: ["market-square"], check: ["marketTier2", "access5"] }, effects: { income: 60, incomeAccess: true, merchantTier: 1 },
    tiers: [
      { label: "Trading company", cost: 10000, days: 120, effects: { income: 60, incomeAccess: true, merchantTier: 1 } },
      { label: "Regional trading house", cost: 20000, days: 180, effects: { income: 120 } },
      { label: "Merchant princedom", cost: 40000, days: 240, effects: { income: 250, renown: 2 } }
    ],
    summary: "Caravans of your own. The late-game income that pays the party." },
  { id: "strongroom", group: "trade", name: "Strongroom", unit: "flat", cost: 2500, days: 45,
    effects: { security: 2, strongroom: true }, summary: "Treasury safe from theft; letters of credit for remote payments." },

  /* ---------------- Staff and prestige ---------------- */
  { id: "servants-quarters", group: "staff", name: "Servants' Quarters", unit: "flat", cost: 1250, days: 45, room: "bedroom",
    effects: { housing: 12, comfort: 1, servantsCap: 12 }, summary: "Housing +12; hire servants (1 GP a turn each)." },
  { id: "bathhouse", group: "staff", name: "Bathhouse", unit: "flat", cost: 1500, days: 40,
    requires: { check: ["anyWater"] }, effects: { comfort: 2, bathhouse: true }, summary: "Comfort +2; a Long Rest here removes 1 extra Exhaustion level." },
  { id: "chapel", group: "staff", name: "Chapel", unit: "flat", cost: 1000, days: 30,
    effects: { comfort: 1, renown: 1, defenseMult: 1.05 }, summary: "Comfort +1, Renown +1, defense x1.05." },
  { id: "infirmary", group: "staff", name: "Infirmary", unit: "flat", cost: 1100, days: 30,
    effects: { comfort: 1, infirmary: true }, summary: "Half the defenders killed in an attack survive wounded." },
  { id: "training-yard", group: "staff", name: "Training Yard", unit: "flat", cost: 1500, days: 30,
    requires: { check: ["courtyardRoomy"] }, effects: { defenderMult: 1.25 }, summary: "Defenders count x1.25." },
  { id: "garrison-hall", group: "staff", name: "Garrison Hall", unit: "flat", cost: 2500, days: 60,
    effects: { guardsCap: 20, housing: 20 }, summary: "Hire up to 20 guards (7 GP a turn each)." },
  { id: "great-hall", group: "staff", name: "Great Hall", unit: "flat", cost: 3750, days: 125,
    requires: { features: ["kitchen"] }, effects: { renown: 2, feasts: true }, summary: "Renown +2; hold feasts." },
  { id: "guest-wing", group: "staff", name: "Guest Wing", unit: "flat", cost: 1900, days: 45,
    effects: { renown: 1, housing: 8, visitorPay: 1.5 }, summary: "Guests and refugees housed; visitors pay x1.5." },
  { id: "stewards-office", group: "staff", name: "Steward's Office", unit: "flat", cost: 1250, days: 30,
    effects: { standingOrders: true }, summary: "Standing orders run while you are away; weekly reports." },
  { id: "pleasure-gardens", group: "staff", name: "Pleasure Gardens and Statuary", unit: "flat", cost: 1900, days: 60,
    effects: { comfort: 1, renown: 1, concealment: -1 }, summary: "Comfort +1, Renown +1." },

  /* ---------------- Communication and arcane ---------------- */
  { id: "rookery", group: "arcane", name: "Rookery", unit: "flat", cost: 500, days: 15,
    effects: { rookery: true }, summary: "Messenger birds (5 GP each) fly orders home." },
  { id: "beacon-tower", group: "arcane", name: "Beacon Tower", unit: "each", max: 6, cost: 375, days: 7, upkeep: 1,
    effects: { beacon: true }, summary: "Instant preset signals; the first gives Security +1." },
  { id: "sending-station", group: "arcane", name: "Sending Stone Station", unit: "flat", cost: 625, days: 7,
    effects: { sendingStation: true }, summary: "Daily instant dispatch and reply (needs a pair of Sending Stones)." },
  { id: "scrying-pool", group: "arcane", name: "Scrying Pool", unit: "flat", cost: 7500, days: 60, material: "magic",
    effects: { scrying: true }, summary: "See the Bastion as it is, once a day." },
  { id: "arcane-lanterns", group: "arcane", name: "Arcane Lanterns", unit: "flat", cost: 1000, days: 14,
    effects: { security: 1 }, summary: "Security +1; night attacks lose surprise." }
];

/** Upgrading a room one size up (DMG). */
export const ENLARGE = {
  cramped: { to: "roomy", cost: 500, days: 25 },
  roomy: { to: "vast", cost: 2000, days: 80 }
};

export const SIZES = ["cramped", "roomy", "vast"];
export const SIZE_LABELS = { cramped: "Cramped", roomy: "Roomy", vast: "Vast" };
