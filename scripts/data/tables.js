/**
 * Dispatch methods, preset assault forces, merchant tiers, visitors and the fallback Bastion events table.
 * All original wording; DMG text is never copied here.
 */

/**
 * speed: miles per day (null = instant, "night" = arrives the next night). capacity: orders per dispatch (Infinity = no limit).
 * risk: base % lost. requires: a feature id or check the Bastion must have, or "spell"/"item" (the sender's word).
 * flying: ignores the route factor. gold: can carry gold. reply: "full" | "short" | "none". magic: counts under strict DMG rules.
 */
export const DISPATCH_METHODS = {
  envoy: { label: "Envoy (rider or runner)", speed: 24, capacity: Infinity, cost: { perDay: 2 }, risk: 0, dangerRisk: true,
    gold: true, reply: "full", magic: false, note: "A hireling, or one hired in a settlement. 40 mi a day mounted (Coach House), 60 by relay (Coach House + Waystation)." },
  letter: { label: "Letter by post or caravan", speed: 18, wait: "1d4", capacity: 3, cost: { flat: 1 }, risk: 5, dangerRisk: true,
    gold: "credit", reply: "full", magic: false, requires: "access3", note: "The party must be in a settlement; the Bastion needs Accessibility 3+." },
  bird: { label: "Messenger bird", speed: 100, capacity: 1, cost: { flat: 5 }, risk: 10, gold: false, reply: "none", flying: true,
    magic: false, requires: "rookery", note: "A homing bird from the Rookery, carried by the party. Only flies home." },
  familiar: { label: "Familiar courier", speed: 48, capacity: 3, cost: {}, risk: 5, gold: false, reply: "full", flying: true,
    magic: true, requires: "spell", note: "Find Familiar in a flying form carries a written note and flies back." },
  animalMessenger: { label: "Animal Messenger (2nd level, ritual)", speed: 50, capacity: 2, cost: {}, risk: 5, gold: false,
    reply: "none", flying: true, magic: true, requires: "spell", rangePerSlot: true,
    note: "50 miles per 24 hours of duration; +48 hours per slot level above 2nd." },
  sending: { label: "Sending (3rd level)", speed: null, capacity: 2, cost: {}, risk: 0, gold: false, reply: "short", magic: true,
    requires: "spell", note: "Instant. 25 words: two orders and a one-line reply from the Steward." },
  sendingStones: { label: "Sending Stones", speed: null, capacity: 2, cost: {}, risk: 0, gold: false, reply: "short", magic: true,
    requires: "sendingStation", oncePerDay: true, note: "Instant, once a day; one stone stays at the Bastion." },
  dream: { label: "Dream (5th level)", speed: "night", capacity: Infinity, cost: {}, risk: 0, gold: false, reply: "none", magic: true,
    requires: "spell", note: "Arrives the next night, while a hireling sleeps." },
  beacon: { label: "Beacon chain", speed: null, capacity: 1, cost: {}, risk: 0, gold: false, reply: "short", magic: true,
    requires: "beacon", presetOnly: true, note: "Preset signals only." },
  scrying: { label: "Scrying Pool (look only)", speed: null, capacity: 0, cost: {}, risk: 0, gold: false, reply: "full", magic: true,
    requires: "scrying", lookOnly: true, note: "See the Bastion as it is now. No orders." }
};

export const BEACON_SIGNALS = {
  maintain: "Maintain",
  closeGates: "Close the gates",
  muster: "Muster guards",
  arrival: "Prepare for our arrival",
  evacuate: "Evacuate"
};

/** Attacker quality multipliers. */
export const QUALITY = { rabble: 0.5, militia: 0.75, soldiers: 1, veterans: 1.5, elite: 2 };

/** Siege engines: Integrity damage per day. */
export const ENGINES = { none: 0, light: 10, heavy: 25, magical: 50, heavyMagical: 75 };

/**
 * Preset forces. strength = troops x quality + monsters (CR x 4 each) + casters (level x 2 each).
 * engine: key of ENGINES. magical damage is cut by Wards.
 */
export const FORCES = {
  bandits: { label: "Bandit gang: 25 rabble", troops: 25, quality: "rabble", engine: "none" },
  raiders: { label: "Raiders: 60 militia", troops: 60, quality: "militia", engine: "light" },
  warband: { label: "Warband: 150 soldiers", troops: 150, quality: "soldiers", engine: "light" },
  giants: { label: "Giant raid: 8 hill giants (CR 5)", troops: 0, quality: "soldiers", monsters: [{ cr: 5, count: 8 }], engine: "heavy" },
  dragon: { label: "Dragon: 1 adult (CR 17)", troops: 0, quality: "soldiers", monsters: [{ cr: 17, count: 1 }], engine: "magical" },
  company: { label: "Mercenary company: 300 veterans", troops: 300, quality: "veterans", engine: "heavy" },
  army: { label: "Army: 2,000 soldiers + 4 mages (level 7)", troops: 2000, quality: "soldiers", casters: [{ level: 7, count: 4 }],
    engine: "heavyMagical" }
};

/** Merchant tiers by score (Accessibility + Prosperity + tier bonuses). */
export const MERCHANT_TIERS = [
  { key: "peddler", label: "Peddler", min: 0, budget: 200, rarities: ["mundane"], stay: "1" },
  { key: "caravan", label: "Caravan", min: 6, budget: 1000, rarities: ["mundane", "common"], stay: "1d4+1" },
  { key: "company", label: "Merchant company", min: 10, budget: 5000, rarities: ["mundane", "common", "uncommon"], stay: "1d4+2" },
  { key: "exotic", label: "Exotic trader", min: 14, budget: 15000, rarities: ["mundane", "common", "uncommon", "rare"], stay: "1d6+2",
    needsExotic: true }
];

/** Visitors rolled every turn, weighted by stats (see core/visitors.js). */
/**
 * Trade-route goods. "coin" routes pay gold each turn, "food" routes deliver food every day (not in a siege).
 * weight: how often a settlement offers them.
 */
export const TRADE_GOODS = {
  grain: { label: "Grain", kind: "food", mult: 1, weight: 3 },
  livestock: { label: "Livestock and salt meat", kind: "food", mult: 1.2, weight: 2 },
  timber: { label: "Timber", kind: "coin", mult: 0.8, weight: 2 },
  cloth: { label: "Wool and cloth", kind: "coin", mult: 1, weight: 3 },
  wine: { label: "Wine and ale", kind: "coin", mult: 1.2, weight: 2 },
  ore: { label: "Ore and metalwork", kind: "coin", mult: 1.3, weight: 1 },
  spices: { label: "Spices and silk", kind: "coin", mult: 1.8, weight: 1 }
};

export const VISITORS = {
  nobody: { label: "Nobody of note", text: "A quiet week." },
  recruits: { label: "Recruits", text: "Would-be guards ask for work: up to 1d4 can be hired." },
  pilgrims: { label: "Pilgrims", text: "Pilgrims stop to pray and leave a donation." },
  adventurers: { label: "Adventurers", text: "A band of adventurers brings a rumor and asks about work." },
  refugees: { label: "Refugees", text: "Families fleeing trouble ask for shelter." },
  taxman: { label: "Tax collector", text: "The lord's collector arrives for the grant's share." },
  envoy: { label: "Envoy from a lord", text: "A noble's envoy arrives with a favor to ask or offer." },
  spy: { label: "Spy", text: "A stranger asked a lot of questions about the walls and the guards." }
};

/**
 * Fallback Bastion events table (used when no "Bastion Events" roll table is found). d100 ranges as in the DMG,
 * short original wording.
 */
export const EVENTS = [
  { min: 1, max: 50, key: "allIsWell", label: "All is well", text: "Nothing of note happens." },
  { min: 51, max: 55, key: "attack", label: "Attack", text: "A hostile force attacks the Bastion." },
  { min: 56, max: 58, key: "criminal", label: "Criminal hireling", text: "One of the hirelings is wanted by the law." },
  { min: 59, max: 63, key: "opportunity", label: "Extraordinary opportunity", text: "A chance to host something important, for a price." },
  { min: 64, max: 72, key: "visitors", label: "Friendly visitors", text: "Visitors pay to use one of the facilities." },
  { min: 73, max: 76, key: "guest", label: "Guest", text: "Someone comes to stay for a while." },
  { min: 77, max: 79, key: "lostHirelings", label: "Lost hirelings", text: "The staff of one facility walk out." },
  { min: 80, max: 83, key: "discovery", label: "Magical discovery", text: "The staff turn up an Uncommon potion or scroll." },
  { min: 84, max: 91, key: "refugees", label: "Refugees", text: "Refugees arrive and offer to pay for shelter." },
  { min: 92, max: 98, key: "aid", label: "Request for aid", text: "A local leader asks for the Bastion's defenders." },
  { min: 99, max: 100, key: "treasure", label: "Treasure", text: "The Bastion comes into some treasure." }
];

export const GUESTS = {
  1: { key: "renowned", label: "A renowned guest", text: "Stays 7 days and leaves a letter of recommendation." },
  2: { key: "sanctuary", label: "A sanctuary seeker", text: "Stays 7 days and pays 1d6 x 100 GP." },
  3: { key: "mercenary", label: "A mercenary", text: "Joins as an extra defender until dismissed or killed." },
  4: { key: "monster", label: "A friendly monster", text: "Will defend the Bastion in the next attack, with no losses." }
};

export const TREASURE = [
  { min: 1, max: 40, label: "Art object (25 GP)", gp: 25 },
  { min: 41, max: 63, label: "Art object (250 GP)", gp: 250 },
  { min: 64, max: 73, label: "Art object (750 GP)", gp: 750 },
  { min: 74, max: 75, label: "Art object (2,500 GP)", gp: 2500 },
  { min: 76, max: 90, label: "Common magic item", rarity: "common" },
  { min: 91, max: 98, label: "Uncommon magic item", rarity: "uncommon" },
  { min: 99, max: 100, label: "Rare magic item", rarity: "rare" }
];
