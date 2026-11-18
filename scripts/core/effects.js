/**
 * Bastion effects: benefits the GM gives a Bastion (resistances, speed, AC…) that apply, as Active Effects, to each
 * owner character marked as inside it. Pure (no Foundry globals): the Foundry side is scripts/bastion-effects.js.
 *
 * record.effects.<id> = { id, name, img, description, disabled, changes: [{ type, choice, value, key, mode }] }
 * record.inside.<actorId> = true | false (a character's own mark; unmarked characters follow record.presence).
 */

/** Active Effect change modes (CONST.ACTIVE_EFFECT_MODES). */
export const MODES = { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 };

export const DEFAULT_EFFECT_IMG = "icons/svg/castle.svg";

/**
 * The kinds of change the GM's menu offers. `key` is the dnd5e data path (a function of the choice where there is
 * one), `choices` names the CONFIG.DND5E list the choice comes from, `formula` fields get a signed bonus ("+1").
 */
export const EFFECT_PRESETS = {
  ac: { key: "system.attributes.ac.bonus", mode: MODES.ADD, formula: true, value: "1" },
  speed: { key: c => `system.attributes.movement.${c || "walk"}`, mode: MODES.ADD, choices: "movementTypes", value: "10" },
  resistance: { key: "system.traits.dr.value", mode: MODES.ADD, choices: "damageTypes" },
  immunity: { key: "system.traits.di.value", mode: MODES.ADD, choices: "damageTypes" },
  conditionImmunity: { key: "system.traits.ci.value", mode: MODES.ADD, choices: "conditionTypes" },
  hp: { key: "system.attributes.hp.bonuses.overall", mode: MODES.ADD, formula: true, value: "5" },
  initiative: { key: "system.attributes.init.bonus", mode: MODES.ADD, formula: true, value: "1" },
  save: { key: "system.bonuses.abilities.save", mode: MODES.ADD, formula: true, value: "1" },
  check: { key: "system.bonuses.abilities.check", mode: MODES.ADD, formula: true, value: "1" },
  skill: { key: "system.bonuses.abilities.skill", mode: MODES.ADD, formula: true, value: "1" },
  spellDC: { key: "system.bonuses.spell.dc", mode: MODES.ADD, formula: true, value: "1" },
  custom: { key: null, mode: MODES.ADD, value: "" }
};

/** Whether a character counts as inside the Bastion: its own mark, else the Bastion's presence. */
export function isInside(record, actorId) {
  const mark = record?.inside?.[actorId];
  if (typeof mark === "boolean") return mark;
  return record?.presence === "present";
}

/** A signed bonus for a formula field: "2" → "+2", "-1" stays, "1d4" → "+1d4". */
function signed(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return /^[+-]/.test(v) ? v : `+${v}`;
}

/** One stored change row → a Foundry change { key, mode, value }, or null when it is incomplete. */
export function resolveChange(row) {
  const preset = EFFECT_PRESETS[row?.type];
  if (!preset) return null;
  if (row.type === "custom") {
    const key = String(row.key ?? "").trim();
    const mode = Number(row.mode);
    if (!key || !Object.values(MODES).includes(mode)) return null;
    return { key, mode, value: String(row.value ?? "") };
  }
  const key = typeof preset.key === "function" ? preset.key(row.choice) : preset.key;
  let value;
  if (preset.choices && !preset.value) value = String(row.choice ?? "").trim();
  else value = preset.formula ? signed(row.value) : String(row.value ?? "").trim();
  if (!value) return null;
  return { key, mode: preset.mode, value };
}

/** Cleans what the GM's editor sends: known kinds only, short strings, no empty rows. */
export function cleanEffect(data, id) {
  const str = (v, max) => String(v ?? "").slice(0, max);
  const changes = (Array.isArray(data?.changes) ? data.changes : []).slice(0, 20)
    .filter(r => EFFECT_PRESETS[r?.type])
    .map(r => {
      const out = { type: r.type, value: str(r.value, 200) };
      if (EFFECT_PRESETS[r.type].choices) out.choice = str(r.choice, 64);
      if (r.type === "custom") {
        out.key = str(r.key, 200).trim();
        // Mode 0 (CUSTOM) is a real mode: only a value that isn't a mode falls back to ADD.
        const mode = Number(r.mode);
        out.mode = Object.values(MODES).includes(mode) ? mode : MODES.ADD;
      }
      return out;
    })
    .filter(r => resolveChange(r));
  return {
    id,
    name: str(data?.name, 120).trim() || "Bastion effect",
    img: str(data?.img, 400).trim() || DEFAULT_EFFECT_IMG,
    description: str(data?.description, 4000),
    disabled: !!data?.disabled,
    changes
  };
}

/** The Bastion's effects that are switched on, in name order. */
export function activeEffects(record) {
  return Object.values(record?.effects ?? {}).filter(e => e && !e.disabled)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** A short stamp of what an applied effect holds, so a changed Bastion effect is updated on the actors. */
export function effectStamp(effect, bastionName = "") {
  return JSON.stringify([effect.name, effect.img, effect.description, bastionName, (effect.changes ?? []).map(resolveChange)]);
}

/**
 * The Active Effect data for one Bastion effect on a character. `flag` is the module's flag scope.
 * Not transferred, no duration: it stays while the character is inside.
 */
export function effectData(effect, { entryId, origin = null, bastionName = "", scope }) {
  return {
    name: effect.name,
    img: effect.img || DEFAULT_EFFECT_IMG,
    description: effect.description ?? "",
    origin,
    disabled: false,
    transfer: false,
    changes: (effect.changes ?? []).map(resolveChange).filter(Boolean),
    flags: { [scope]: { bastionEffect: { entryId, effectId: effect.id, stamp: effectStamp(effect, bastionName) } } }
  };
}

/**
 * What to do on one actor. desired: [{ entryId, effectId, stamp, data }]; existing: the actor's applied Bastion
 * effects [{ id, entryId, effectId, stamp }]. Returns { create: [data], update: [{ _id, ...data }], remove: [id] }.
 * A duplicate of a wanted effect is removed.
 */
export function planActorEffects(desired, existing) {
  const want = new Map(desired.map(d => [`${d.entryId}/${d.effectId}`, d]));
  const seen = new Set();
  const out = { create: [], update: [], remove: [] };
  for (const e of existing) {
    const k = `${e.entryId}/${e.effectId}`;
    const d = want.get(k);
    if (!d || seen.has(k)) { out.remove.push(e.id); continue; }
    seen.add(k);
    if (e.stamp !== d.stamp) out.update.push({ _id: e.id, ...d.data });
  }
  for (const [k, d] of want) if (!seen.has(k)) out.create.push(d.data);
  return out;
}
