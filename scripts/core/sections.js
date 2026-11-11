/**
 * The Facilities page: which section each building and each dnd5e facility belongs to, and whether a character can
 * take one more of the system's special facilities. Pure: no Foundry globals.
 */

/** The page's sections, in order; the keys are the catalog's groups. */
export const SECTIONS = ["rooms", "fortifications", "supplies", "access", "trade", "staff", "arcane"];

/** The dnd5e special facilities (CONFIG.DND5E.facilities.types.special.subtypes) by section. */
export const SYSTEM_SECTION = {
  armory: "fortifications", barrack: "fortifications", warRoom: "fortifications",
  garden: "supplies", greenhouse: "supplies", storehouse: "supplies", menagerie: "supplies",
  stable: "access", teleportationCircle: "access",
  gamingHall: "trade", guildhall: "trade", pub: "trade", smithy: "trade", workshop: "trade",
  trainingArea: "staff", trophyRoom: "staff", reliquary: "staff", sacristy: "staff", sanctuary: "staff",
  meditationChamber: "staff", theater: "staff",
  arcaneStudy: "arcane", archive: "arcane", library: "arcane", laboratory: "arcane", observatory: "arcane",
  sanctum: "arcane", demiplane: "arcane", scriptorium: "arcane"
};

/** Section of one of this module's expansions: its catalog group. */
export function sectionOfExpansion(exp) {
  return SECTIONS.includes(exp?.group) ? exp.group : "staff";
}

/** Section of a dnd5e facility ({ type, subtype }): basic ones are rooms, special ones by kind (unknown kinds: staff). */
export function sectionOfFacility(f) {
  if (f?.type !== "special") return "rooms";
  return SYSTEM_SECTION[f.subtype] ?? "staff";
}

/** How many special facilities a character of this level may have (CONFIG.DND5E.facilities.advancement.special). */
export function specialSlots(level, advancement = {}) {
  let max = 0;
  for (const [lvl, n] of Object.entries(advancement ?? {})) if (Number(lvl) <= (Number(level) || 0)) max = Math.max(max, Number(n) || 0);
  return max;
}

/**
 * Whether a character can take a special facility.
 * @param {{level:number, facilities:{type:string, subtype:string, name:string, free?:boolean}[]}} who
 * @param {{level?:number, subtype?:string, name:string, free?:boolean}} item  a free facility takes no slot
 * @returns {{ok:boolean, reason?:"level"|"slots"|"have", used:number, max:number}}
 */
export function canTakeFacility(who, item, advancement = {}) {
  const special = (who?.facilities ?? []).filter(f => f.type === "special");
  const used = special.filter(f => !f.free).length;
  const max = specialSlots(who?.level, advancement);
  const base = { used, max };
  if ((Number(item?.level) || 0) > (Number(who?.level) || 0)) return { ok: false, reason: "level", ...base };
  const same = f => (item.subtype && f.subtype === item.subtype) || f.name === item.name;
  if (special.some(same)) return { ok: false, reason: "have", ...base };
  if (!item.free && used >= max) return { ok: false, reason: "slots", ...base };
  return { ok: true, ...base };
}

/**
 * One row per kind of building: buildings of the same kind (three watchtowers, two kitchens) share a row with their
 * number (`many`), their stats added up, and the subtitles that differ joined. The row acts on one of them: a damaged
 * one first (repair), else one that can be upgraded. Buildings under way keep their own rows.
 */
export function mergeSameKind(cards, columns, format = v => v) {
  const out = [];
  const byKey = new Map();
  for (const card of cards) {
    if (!card.group || card.building) { out.push(card); continue; }
    const list = byKey.get(card.group);
    if (list) list.push(card);
    else { const l = [card]; byKey.set(card.group, l); out.push(l); }
  }
  return out.map(x => {
    if (!Array.isArray(x)) return x;
    if (x.length === 1) return x[0];
    const rep = x.find(c => c.repair || c.damaged) ?? x.find(c => c.upgrade) ?? x[0];
    const raw = columns.map((c, i) => {
      const vals = x.map(card => card.raw?.[i]);
      if (["num", "gp", "pct"].includes(c.kind) && vals.some(v => typeof v === "number")) {
        return vals.reduce((n, v) => n + (typeof v === "number" ? v : 0), 0);
      }
      return vals.find(v => v !== null && v !== undefined && v !== "") ?? null;
    });
    const subtitles = [...new Set(x.map(c => c.subtitle).filter(Boolean))];
    return { ...rep, many: x.length, raw, cells: raw.map((v, i) => ({ value: format(columns[i].kind, v) })),
      subtitle: subtitles.length === 1 ? subtitles[0] : subtitles.join(" / "),
      damaged: x.some(c => c.damaged) };
  });
}
