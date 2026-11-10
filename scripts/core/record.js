import { STRUCTURES, ACQUISITIONS, firstBuilding } from "../data/structures.js";
import { defaultLocation } from "../data/location.js";
import { DEFAULT_RULES } from "../data/rules.js";
import { buildCatalog } from "./catalog.js";
import { GROUNDS, WALL_LAYERS } from "../data/grounds.js";
import { spaceUsed, fittingGroundsIndex, groundsIndex, groundsInfo } from "./grounds.js";
import { syncLayout } from "./layout.js";

/**
 * Builds a new Bastion record from the founding wizard's answers. Pure.
 * answers: { name, description, groupUuid, ownerUuids, location, structure: { type, acquisition },
 *   first: the one first building (a FIRST_BUILDINGS key or {id, size, count}; else the structure's suggestion),
 *   included: [{id, size, count, tier}] (the rest of the first build),
 *   food, treasury, guards, servants, hirelings, marker: { sceneUuid, x, y }, grounds?: key (else the smallest that fits) }
 * opts.catalog / opts.rules: the world's catalog and rules (defaults when left out, e.g. in tests).
 */
export function createRecord(answers, { newId, now = 0, catalog, rules } = {}) {
  const structure = STRUCTURES[answers.structure?.type] ?? STRUCTURES.keep;
  const acquisition = ACQUISITIONS[answers.structure?.acquisition] ?? ACQUISITIONS.reward;
  const features = {};
  const structureFeatureIds = [];
  const add = (f, fromStructure) => {
    const id = newId();
    const feature = { id: f.id, tier: f.tier ?? 1, builtAt: now };
    if (f.size) feature.size = f.size;
    if (f.count) feature.count = f.count;
    if (f.enclosed === false) feature.enclosed = false;
    if (fromStructure && acquisition.damaged && !["bedroom", "kitchen"].includes(f.id)) feature.damaged = true;
    features[id] = feature;
    if (fromStructure) structureFeatureIds.push(id);
  };
  // The one building the Bastion is founded with (captured or rebuilt: damaged unless it's where they sleep).
  add(firstBuilding(answers), true);
  for (const f of answers.included ?? []) add(f, false);
  const record = {
    version: 1,
    name: String(answers.name ?? "").trim() || "Bastion",
    description: String(answers.description ?? ""),
    groupUuid: answers.groupUuid ?? null,
    ownerUuids: [...(answers.ownerUuids ?? [])],
    location: { ...defaultLocation(), ...(answers.location ?? {}) },
    structure: { type: answers.structure?.type ?? "keep", acquisition: answers.structure?.acquisition ?? "reward" },
    noFields: !!structure.effects?.noFields,
    structureWallLost: false,
    marker: answers.marker ?? null,
    image: answers.image || null,
    // The battle map's ground when the GM picked one (grass, dirt, mud, sand, snow, cobble, cave); else by terrain.
    mapGround: answers.mapGround || null,
    grounds: null,
    layout: {},
    features,
    projects: {},
    dispatches: {},
    standingOrders: [],
    treasury: Math.max(0, Number(answers.treasury) || 0),
    food: Math.max(0, Number(answers.food) || 0),
    garrison: {
      guards: Math.max(0, Number(answers.guards) || 0),
      servants: Math.max(0, Number(answers.servants) || 0),
      hirelings: Math.max(0, Number(answers.hirelings) || 0),
      mercenaries: 0
    },
    people: { guests: 0, refugees: 0 },
    presence: "present",
    maintainOrder: false,
    maintainChosen: false,
    neglect: 0,
    dividendPct: null,
    dividends: 0,
    renownBonus: 0,
    merchant: null,
    siege: null,
    overrides: {},
    turn: { number: 0, lastTime: now },
    history: [],
    createdAt: now
  };
  // Grounds: the size the GM chose, else the smallest that holds the structure and the first build (never smaller
  // than the structure's own).
  const cat = catalog ?? buildCatalog();
  const used = spaceUsed(record, cat);
  const minimum = groundsIndex(structure.grounds ?? "plot");
  const fits = fittingGroundsIndex(used, rules ?? DEFAULT_RULES, minimum);
  const chosen = answers.grounds ? GROUNDS.findIndex(g => g.key === answers.grounds) : -1;
  const index = Math.max(fits, chosen);
  record.grounds = GROUNDS[index].key;
  // A wall the Bastion starts with goes all the way round its grounds.
  const perimeter = groundsInfo(index, rules ?? DEFAULT_RULES).perimeter;
  for (const f of Object.values(record.features)) {
    if (WALL_LAYERS.includes(f.id) && f.enclosed !== false) f.count = perimeter;
  }
  void structureFeatureIds;
  record.layout = syncLayout(record, cat, rules ?? DEFAULT_RULES).layout;
  return record;
}
