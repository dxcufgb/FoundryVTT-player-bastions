/**
 * The Bastion Codex: the module's compendium of reference pages, one per building and one per kind of inhabitant.
 * Pure (no Foundry globals), shared by the module and the pack builder (codex/build-pack.mjs), so both know every
 * page's id without loading the pack.
 */

export const CODEX_PACK = "codex";

/** The Codex journals: facilities by section, inhabitants by kind. */
export const CODEX_JOURNALS = [
  { key: "rooms", kind: "facility", folder: "facilities", name: "Living quarters" },
  { key: "fortifications", kind: "facility", folder: "facilities", name: "Fortifications" },
  { key: "supplies", kind: "facility", folder: "facilities", name: "Food and water" },
  { key: "access", kind: "facility", folder: "facilities", name: "Access and travel" },
  { key: "trade", kind: "facility", folder: "facilities", name: "Trade and crafting" },
  { key: "staff", kind: "facility", folder: "facilities", name: "Staff and prestige" },
  { key: "arcane", kind: "facility", folder: "facilities", name: "Communication and arcane" },
  { key: "defenders", kind: "inhabitant", folder: "inhabitants", name: "Defenders" },
  { key: "household", kind: "inhabitant", folder: "inhabitants", name: "Staff and household" },
  { key: "visitors", kind: "inhabitant", folder: "inhabitants", name: "Visitors" }
];

export const CODEX_FOLDERS = { facilities: "Facilities", inhabitants: "Inhabitants" };

/** The inhabitants: key → journal and name. Visitors are one generic page per kind of visit. */
export const INHABITANTS = {
  guards: { journal: "defenders", name: "Guards" },
  mercenaries: { journal: "defenders", name: "Mercenaries" },
  "facility-defenders": { journal: "defenders", name: "Facility defenders" },
  lieutenants: { journal: "defenders", name: "War Room lieutenants" },
  "engine-crews": { journal: "defenders", name: "Engine crews" },
  servants: { journal: "household", name: "Servants" },
  hirelings: { journal: "household", name: "Hirelings" },
  "building-crews": { journal: "household", name: "Building crews" },
  refugees: { journal: "household", name: "Refugees" },
  merchants: { journal: "visitors", name: "Merchants" },
  guests: { journal: "visitors", name: "Guests" },
  visitors: { journal: "visitors", name: "Travellers" }
};

/** The page types the module registers (module.json documentTypes). */
export const PAGE_TYPES = { facility: "dxcufgbs-player-bastions.facility", inhabitant: "dxcufgbs-player-bastions.inhabitant" };

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A stable 16-character document id for a key (FNV-1a based; the same in Node and the browser). */
export function codexId(key) {
  let out = "";
  let h = 0x811c9dc5;
  for (let round = 0; out.length < 16; round++) {
    for (const ch of `${round}:${key}`) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    let x = h;
    for (let i = 0; i < 4 && out.length < 16; i++) {
      out += ALPHABET[x % ALPHABET.length];
      x = Math.floor(x / ALPHABET.length);
    }
  }
  return out;
}

export const journalId = key => codexId(`journal:${key}`);
export const pageId = ref => codexId(`page:${ref}`);
export const folderId = key => codexId(`folder:${key}`);

/** The Codex journal of a building (by its catalog group) or an inhabitant. */
export function codexJournalOf(kind, ref, group = null) {
  if (kind === "inhabitant") return INHABITANTS[ref]?.journal ?? null;
  return CODEX_JOURNALS.some(j => j.key === group && j.kind === "facility") ? group : null;
}

/** The page's UUID in the module's Codex pack, or null when it has no page. */
export function codexUuid(moduleId, kind, ref, group = null) {
  const journal = codexJournalOf(kind, ref, group);
  if (!journal || !ref) return null;
  return `Compendium.${moduleId}.${CODEX_PACK}.JournalEntry.${journalId(journal)}.JournalEntryPage.${pageId(ref)}`;
}

/** A Codex picture in the module's assets: the 9:16 painting, or its 256 px square icon. */
export function codexArt(moduleId, ref, icon = false) {
  return ref ? `modules/${moduleId}/assets/codex/${icon ? "icons/" : ""}${ref}.webp` : "";
}
