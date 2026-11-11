/**
 * How the Bastion map is dressed: ground textures by terrain, floors and furnishings by building. Pure data.
 *
 * Texture names refer to assets/map/tex/<name>.webp (tileable, each tile covers TILE_SQUARES squares); prop names to
 * assets/map/props/<name>.webp (top-down, transparent background). The renderer draws a plain stand-in for anything
 * whose file is missing, so the map still works without the art.
 */

export const TILE_SQUARES = 4;

/** Textures whose tile covers a different number of squares (big slabs look wrong at 20 ft). */
export const TILE_OVERRIDE = { flagstone: 2 };

/**
 * How the wall textures are laid along the outer wall, as a crop of the source image (fractions) and how many
 * squares one crop spans along the wall. The crop's top edge faces outward (wallstone has its merlons there).
 */
export const WALL_BANDS = {
  wallstone: { crop: [0, 0, 1, 0.62], along: 2 },
  palisade: { crop: [0, 0, 1, 1 / 6], along: 6 }
};

/** The middle of the wall texture (dressed blocks, no merlons), for tower tops and gatehouses. */
export const BLOCK_CROP = { wallstone: [0, 0.2, 1, 0.6] };

export const TEXTURES = ["grass", "dirt", "sand", "snow", "cave", "rock", "cobble", "mud", "planks", "flagstone", "wallstone",
  "palisade", "water", "tilled", "rubble"];

export const PROPS = ["bed", "table", "bookshelf", "fireplace", "cauldron", "barrels", "crates", "forge", "altar",
  "weaponrack", "dummy", "stall", "well", "tree", "hay", "cart", "bathtub", "desk", "throne", "chest", "statue",
  "fountain", "bunks", "alchemy",
  // Dressing: ground details, rugs, light sources and trees.
  "bush", "rocks", "grass", "flowers", "leaves", "debris", "rug", "ruground", "brazier", "torch", "oak", "pine", "puddle",
  // Roofs of the wall towers.
  "towertop", "squaretop"];

/** How thick the outer wall is drawn (squares): wider than its 1-square ring, so it reads as a curtain wall. */
export const OUTER_WALL_WIDTH = 1.4;

/** Props that give off light: the map paints a warm glow and the scene gets an ambient light there. */
export const LIGHT_PROPS = {
  fireplace: { bright: 10, dim: 25, color: "#ff9a3c" },
  forge: { bright: 10, dim: 25, color: "#ff7a2a" },
  cauldron: { bright: 5, dim: 15, color: "#ff9a3c" },
  brazier: { bright: 10, dim: 30, color: "#ffa64a" },
  torch: { bright: 10, dim: 20, color: "#ffa64a" }
};

/** Rugs laid in the middle of rooms, under the furniture. */
export const FLOOR_RUGS = {
  bedroom: "ruground", parlor: "rug", "dining-room": "rug", "great-hall": "rug", "guest-wing": "rug", inn: "rug",
  "stewards-office": "ruground", chapel: "rug"
};

/**
 * Ground dressing by terrain: what grows or lies about outside the walls (and, more sparsely, inside them).
 * trees: [kind, weight]; trees per 10 squares of map edge. decals: [kind, weight]; decals per 10 squares of open ground.
 */
export const DRESSING = {
  plains: { trees: [["oak", 3], ["bush", 2]], treeDensity: 2.2, decals: [["grass", 4], ["flowers", 3], ["rocks", 1], ["bush", 1]], density: 1.3 },
  forest: { trees: [["oak", 4], ["pine", 2], ["bush", 2]], treeDensity: 4, decals: [["grass", 3], ["leaves", 4], ["rocks", 1], ["bush", 2]], density: 1.8 },
  hills: { trees: [["oak", 2], ["bush", 3]], treeDensity: 1.8, decals: [["grass", 3], ["rocks", 3], ["flowers", 1], ["bush", 1]], density: 1.3 },
  coast: { trees: [["bush", 3], ["pine", 1]], treeDensity: 1.2, decals: [["grass", 3], ["rocks", 3], ["puddle", 1]], density: 1.1 },
  mountains: { trees: [["pine", 3], ["bush", 1]], treeDensity: 1.6, decals: [["rocks", 5], ["grass", 2]], density: 1.4 },
  swamp: { trees: [["oak", 2], ["bush", 3]], treeDensity: 2.4, decals: [["puddle", 4], ["grass", 4], ["leaves", 1]], density: 1.8 },
  desert: { trees: [["bush", 1]], treeDensity: 0.4, decals: [["rocks", 4]], density: 0.6 },
  arctic: { trees: [["pine", 2]], treeDensity: 1, decals: [["rocks", 3]], density: 0.6 },
  underground: { trees: [], treeDensity: 0, decals: [["rocks", 5], ["puddle", 2], ["debris", 1]], density: 1.2 },
  urban: { trees: [["oak", 1]], treeDensity: 0.4, decals: [["debris", 3], ["puddle", 2], ["leaves", 2]], density: 0.9 }
};

/** Inside the walls: lighter wear. */
export const BAILEY_DECALS = [["grass", 3], ["leaves", 2], ["puddle", 1], ["debris", 2], ["rocks", 1]];

/** Second ground mixed into the first in soft patches, so open ground isn't one flat repeat. */
export const GROUND_MIX = {
  grass: "dirt", dirt: "grass", mud: "grass", cave: "rubble", cobble: "dirt"
};

/** Stand-in colours when a texture file is missing: [base, speckle]. */
export const TEXTURE_COLORS = {
  grass: ["#5f7d3a", "#6e8f44"], dirt: ["#7a6142", "#8a7050"], sand: ["#cdb27a", "#d9c08c"], snow: ["#dfe7ee", "#c9d5e0"],
  cave: ["#4a4a4c", "#58585b"], rock: ["#b9b2a4", "#c9c2b3"], cobble: ["#77746e", "#8a867f"], mud: ["#4c5130", "#5a5f38"], planks: ["#8a6440", "#9b7249"],
  flagstone: ["#9a9285", "#a89f92"], wallstone: ["#6d6a66", "#827e78"], palisade: ["#6b4a2b", "#7d5733"],
  water: ["#2f5d6b", "#3b6f7e"], tilled: ["#4a3624", "#5d7a35"], rubble: ["#77716a", "#5c5650"]
};

/** Stand-in colours for props: fill colour. */
export const PROP_COLORS = {
  bed: "#a8835a", table: "#7b5534", bookshelf: "#5c3d22", fireplace: "#5a5652", cauldron: "#2b2b2b", barrels: "#80592f",
  crates: "#9a7444", forge: "#7a3b26", altar: "#d8d2c4", weaponrack: "#6b5136", dummy: "#c9a45c", stall: "#b5463b",
  well: "#77736d", tree: "#3f6b2c", hay: "#d8b44a", cart: "#7d5a35", bathtub: "#8b6a43", desk: "#6e4b2c", throne: "#8c2f2f",
  chest: "#7a5226", statue: "#b9b6b0", fountain: "#6e8fa0", bunks: "#7b6a55", alchemy: "#5e4a7a"
};

/** Ground outside the walls, by terrain. */
export const TERRAIN_GROUND = {
  plains: "grass", forest: "grass", hills: "grass", coast: "grass", mountains: "dirt", swamp: "mud", desert: "sand",
  arctic: "snow", underground: "cave", urban: "cobble"
};

/**
 * Grounds the GM can pick for the battle map whatever the terrain ("Battle map ground" in the wizard), and the
 * terrain whose trees, rocks and the like dress each one.
 */
export const MAP_GROUNDS = {
  grass: "plains", dirt: "mountains", mud: "swamp", sand: "desert", snow: "arctic", cobble: "urban", cave: "underground",
  rock: "mountains"
};

/** Open ground inside the walls, by terrain (the bailey). */
export const BAILEY_GROUND = {
  plains: "grass", forest: "grass", hills: "grass", coast: "grass", mountains: "dirt", swamp: "mud", desert: "sand",
  arctic: "snow", underground: "cave", urban: "cobble"
};

/** Floor of each building or yard. Anything not listed: flagstone for buildings, the bailey ground for yards. */
export const FLOORS = {
  bedroom: "planks", "dining-room": "planks", parlor: "planks", courtyard: "cobble", kitchen: "flagstone", storage: "flagstone",
  granary: "planks", cistern: "flagstone", smokehouse: "flagstone", "kitchen-garden": "tilled", orchard: "grass", greenhouse: "tilled",
  "workers-lodge": "planks", "coach-house": "dirt", "market-square": "cobble", inn: "planks", brewery: "planks",
  "craftsmens-row": "flagstone", warehouse: "planks", "trading-company": "planks", "trading-post": "planks", strongroom: "flagstone",
  "servants-quarters": "planks", bathhouse: "flagstone", chapel: "flagstone", infirmary: "planks", "training-yard": "dirt",
  "garrison-hall": "planks", "great-hall": "flagstone", "guest-wing": "planks", "stewards-office": "planks",
  "pleasure-gardens": "grass", rookery: "planks", "sending-station": "flagstone", "scrying-pool": "flagstone",
  well: "cobble", "deep-well": "cobble"
};

/**
 * What stands in each building: [prop, size in squares, how many per 16 squares of floor (at least one)].
 * Bigger props are placed first, against the walls, keeping the door and the middle clear.
 */
export const FURNISH = {
  bedroom: [["bed", 2, 1], ["chest", 1, 0.5], ["fireplace", 2, 0.3], ["desk", 2, 0.25]],
  "dining-room": [["table", 3, 0.5], ["fireplace", 2, 0.25], ["barrels", 1, 0.3]],
  parlor: [["fireplace", 2, 0.4], ["bookshelf", 2, 0.6], ["desk", 2, 0.3], ["statue", 1, 0.15]],
  kitchen: [["cauldron", 2, 0.4], ["table", 2, 0.3], ["barrels", 1, 0.6], ["crates", 1, 0.4]],
  storage: [["crates", 2, 0.6], ["barrels", 2, 0.6], ["chest", 1, 0.25]],
  granary: [["hay", 2, 0.8], ["crates", 2, 0.4], ["barrels", 1, 0.4]],
  smokehouse: [["fireplace", 2, 0.4], ["barrels", 1, 0.6], ["crates", 1, 0.4]],
  cistern: [["well", 2, 0.5], ["barrels", 1, 0.5]],
  "workers-lodge": [["bunks", 2, 0.8], ["table", 2, 0.25], ["fireplace", 2, 0.2]],
  "coach-house": [["cart", 2, 0.6], ["hay", 2, 0.4], ["barrels", 1, 0.3]],
  inn: [["table", 2, 0.6], ["fireplace", 2, 0.2], ["barrels", 1, 0.5], ["bed", 2, 0.4]],
  brewery: [["barrels", 2, 1], ["cauldron", 2, 0.4], ["crates", 1, 0.3]],
  "craftsmens-row": [["forge", 3, 0.25], ["alchemy", 2, 0.25], ["crates", 1, 0.5], ["weaponrack", 2, 0.25]],
  warehouse: [["crates", 2, 1], ["barrels", 2, 0.6], ["cart", 2, 0.15]],
  "trading-company": [["desk", 2, 0.5], ["chest", 1, 0.5], ["crates", 2, 0.5], ["bookshelf", 2, 0.3]],
  strongroom: [["chest", 1, 2]],
  "trading-post": [["crates", 2, 0.8], ["cart", 2, 0.3], ["desk", 2, 0.25], ["barrels", 1, 0.4]],
  "servants-quarters": [["bunks", 2, 0.8], ["chest", 1, 0.3], ["fireplace", 2, 0.15]],
  bathhouse: [["bathtub", 2, 0.6], ["barrels", 1, 0.3], ["fireplace", 2, 0.15]],
  chapel: [["altar", 2, 0.35], ["statue", 1, 0.4], ["brazier", 1, 0.3]],
  infirmary: [["bed", 2, 0.8], ["alchemy", 2, 0.25], ["chest", 1, 0.25]],
  "garrison-hall": [["bunks", 2, 0.6], ["weaponrack", 2, 0.4], ["table", 3, 0.15], ["brazier", 1, 0.1]],
  "great-hall": [["throne", 2, 0.06], ["table", 3, 0.25], ["fireplace", 2, 0.12], ["brazier", 1, 0.1], ["statue", 1, 0.06]],
  "guest-wing": [["bed", 2, 0.6], ["bathtub", 2, 0.15], ["desk", 2, 0.15], ["chest", 1, 0.2]],
  "stewards-office": [["desk", 2, 1], ["bookshelf", 2, 1]],
  rookery: [["hay", 2, 0.6], ["crates", 1, 0.5]],
  "sending-station": [["altar", 2, 0.6], ["desk", 2, 0.4]],
  "scrying-pool": [["fountain", 2, 0.5], ["bookshelf", 2, 0.4], ["brazier", 1, 0.3]],
  well: [["well", 1, 1]],
  "deep-well": [["well", 1, 1]],
  greenhouse: [["flowers", 1, 1.2], ["bush", 1, 0.8], ["brazier", 1, 0.2], ["barrels", 1, 0.2]]
};

/** Open ground has its own patterns (see map-render.js yardProps). */
export const YARD_PROPS = {
  courtyard: "centre-well", "kitchen-garden": "corner-hay", orchard: "tree-grid", "training-yard": "dummies",
  "pleasure-gardens": "garden", "market-square": "market"
};

/** Worn paths inside the walls, from each door to the gate road, by bailey ground. */
export const PATH_GROUND = { grass: "dirt", mud: "dirt", dirt: "cobble", sand: "dirt", snow: "dirt", cave: "rubble", rock: "dirt", cobble: "dirt" };

/** Groups of clutter stood along the inside of the wall. */
export const WALL_CLUTTER = [
  [["barrels", 1], ["crates", 1]],
  [["hay", 2]],
  [["cart", 2], ["barrels", 1]],
  [["crates", 1], ["crates", 1], ["barrels", 1]],
  [["weaponrack", 2]],
  [["brazier", 1]]
];
