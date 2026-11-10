/**
 * Base structures a Bastion can be founded as: what kind of place it is. A structure brings no buildings of its own:
 * the GM picks ONE first building (FIRST_BUILDINGS, `first` is the suggestion) and adds anything else in the wizard's
 * First build step. `effects` are extra stat deltas of the structure itself. No structure comes with a wall round its
 * grounds (only the cave keeps `wall`: its rock is the cave itself). `upkeep` is gold per Bastion turn to keep the
 * place running; income from expansions offsets it. `grounds` is the smallest grounds it starts on.
 */
export const STRUCTURES = {
  farmstead: { label: "Farmstead", summary: "A working farm on open land.", first: "house", effects: { housing: 0 }, upkeep: 2 },
  manor: { label: "Manor house", summary: "A country house: Renown +1.", first: "large-house", effects: { renown: 1 }, upkeep: 5 },
  tower: { label: "Fortified tower", summary: "Room for 20 more in the garrison.", first: "tower", effects: { garrisonCap: 20 }, upkeep: 5 },
  keep: { label: "Keep", summary: "A stronghold's seat, ready to grow.", first: "hall", effects: {}, upkeep: 10 },
  castle: { label: "Small castle", summary: "Starts on a Compound (24 × 24 squares).", first: "hall", grounds: "compound", effects: {}, upkeep: 20 },
  temple: { label: "Temple compound", summary: "Renown +2, Comfort +1.", first: "chapel", effects: { renown: 2, comfort: 1 }, upkeep: 5 },
  townhouse: { label: "Townhouse or guildhall", summary: "In town: Accessibility +3, Security +1; rooms cost x1.25.", first: "house",
    effects: { accessibility: 3, security: 1, roomCost: 1.25 }, upkeep: 8 },
  cave: { label: "Cave or underground hall", summary: "Hidden in the rock: Concealment +3, no fields; the rock is its wall.", first: "house",
    wall: { type: "rock", enclosed: true }, effects: { concealment: 3, noFields: true }, upkeep: 3 }
};

/** The one building a Bastion is founded with: the GM picks one in the Structure step. */
export const FIRST_BUILDINGS = {
  cottage: { label: "Cottage", feature: { id: "bedroom", size: "cramped" }, summary: "A Cramped bedroom." },
  house: { label: "House", feature: { id: "bedroom", size: "roomy" }, summary: "A Roomy bedroom." },
  "large-house": { label: "Large house", feature: { id: "bedroom", size: "vast" }, summary: "A Vast bedroom." },
  hall: { label: "Hall", feature: { id: "dining-room", size: "vast" }, summary: "A Vast dining hall." },
  tower: { label: "Tower", feature: { id: "watchtower", count: 1 }, summary: "A watchtower in the middle of the grounds." },
  chapel: { label: "Chapel", feature: { id: "chapel" }, summary: "Comfort +1, Renown +1." }
};

/** The first building's feature: the GM's pick (a FIRST_BUILDINGS key, or a feature object), else the structure's. */
export function firstBuilding(answers) {
  const pick = answers?.first;
  if (pick && typeof pick === "object") return pick;
  const st = STRUCTURES[answers?.structure?.type] ?? STRUCTURES.keep;
  return (FIRST_BUILDINGS[pick] ?? FIRST_BUILDINGS[st.first] ?? FIRST_BUILDINGS.house).feature;
}

/** How the Bastion came to the party. Captured and rebuilt places start damaged (repairs at half cost). */
export const ACQUISITIONS = {
  reward: { label: "Reward", damaged: false },
  built: { label: "Built", damaged: false },
  captured: { label: "Captured", damaged: true },
  rebuilt: { label: "Rebuilt ruin", damaged: true }
};
