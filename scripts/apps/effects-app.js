import { MODULE_ID, t } from "../util.js";
import { getEntry, getRecord } from "../store.js";
import { request } from "../socket.js";
import { EFFECT_PRESETS, MODES, DEFAULT_EFFECT_IMG, resolveChange } from "../core/effects.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** The choices of a preset (damage types, movement types, conditions) from the system's config, as [{ value, label }]. */
function choicesOf(name) {
  const list = globalThis.CONFIG?.DND5E?.[name] ?? {};
  return Object.entries(list).map(([value, v]) => ({ value, label: game.i18n.localize(typeof v === "string" ? v : v?.label ?? value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** One change in words, e.g. "AC +1", "Resistance: Fire". */
export function describeChange(row) {
  const preset = EFFECT_PRESETS[row?.type];
  if (!preset) return "";
  const c = resolveChange(row);
  if (!c) return "";
  if (row.type === "custom") return `${c.key} ${Object.keys(MODES).find(k => MODES[k] === c.mode)?.toLowerCase() ?? ""} ${c.value}`;
  const choice = preset.choices ? choicesOf(preset.choices).find(x => x.value === row.choice)?.label ?? row.choice : "";
  return t(`Effects.Says.${row.type}`, { value: c.value, choice });
}

/**
 * GM menu: the effects a Bastion has on the owner characters inside it. A list of the Bastion's effects (switch on or
 * off, edit, remove) and an editor for one (name, icon, description, changes picked from presets or written as
 * custom data paths). The changes apply as Active Effects on every owner character marked as inside.
 */
export class BastionEffectsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instances = new Map();

  static open(entryId) {
    if (!game.user.isGM) return null;
    let app = this.instances.get(entryId);
    if (!app) {
      app = new this({ entryId, id: `dxpb-effects-${entryId}` });
      this.instances.set(entryId, app);
    }
    app.render({ force: true });
    return app;
  }

  static refresh(entryId) {
    const app = this.instances.get(entryId);
    if (app?.rendered && !app.draft) app.render();
  }

  constructor(options = {}) {
    super(options);
    this.entryId = options.entryId;
    /** The effect being edited, or null for the list. */
    this.draft = null;
  }

  static DEFAULT_OPTIONS = {
    classes: ["dxpb", "dxpb-effects"],
    tag: "div",
    window: { title: "DXPB.Effects.Title", icon: "fa-solid fa-wand-magic-sparkles", resizable: true },
    position: { width: 620, height: "auto" },
    actions: {
      effectAdd: BastionEffectsApp.#onAdd,
      effectEdit: BastionEffectsApp.#onEdit,
      effectRemove: BastionEffectsApp.#onRemove,
      effectToggle: BastionEffectsApp.#onToggle,
      changeAdd: BastionEffectsApp.#onChangeAdd,
      changeRemove: BastionEffectsApp.#onChangeRemove,
      effectSave: BastionEffectsApp.#onSave,
      effectCancel: BastionEffectsApp.#onCancel,
      pickImg: BastionEffectsApp.#onPickImg
    }
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/bastion-effects.hbs` } };

  get title() {
    const r = getRecord(getEntry(this.entryId));
    return r ? `${t("Effects.Title")}: ${r.name}` : t("Effects.Title");
  }

  _onClose(options) {
    super._onClose(options);
    if (BastionEffectsApp.instances.get(this.entryId) === this) BastionEffectsApp.instances.delete(this.entryId);
  }

  async _prepareContext() {
    const record = getRecord(getEntry(this.entryId));
    if (!record) return { missing: true };
    const presetOptions = sel => Object.keys(EFFECT_PRESETS).map(k => ({ value: k, label: t(`Effects.Type.${k}`), sel: k === sel }));
    const modeOptions = sel => Object.entries(MODES).map(([k, v]) => ({ value: v, label: k.toLowerCase(), sel: v === Number(sel) }));
    const c = { draft: null };
    if (this.draft) {
      c.draft = {
        ...this.draft,
        changes: this.draft.changes.map((row, i) => {
          const preset = EFFECT_PRESETS[row.type] ?? EFFECT_PRESETS.custom;
          return { ...row, index: i, types: presetOptions(row.type), custom: row.type === "custom",
            choices: preset.choices ? choicesOf(preset.choices).map(x => ({ ...x, sel: x.value === row.choice })) : null,
            hasValue: row.type === "custom" || !!preset.value, modes: modeOptions(row.mode ?? MODES.ADD) };
        })
      };
    } else {
      c.effects = Object.values(record.effects ?? {}).sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map(e => ({ ...e, summary: (e.changes ?? []).map(describeChange).filter(Boolean).join(" · ") }));
    }
    return c;
  }

  /** Reads the editor's fields into the draft (before a re-render, so nothing typed is lost). */
  #readForm() {
    if (!this.draft) return;
    const root = this.element;
    const val = sel => root.querySelector(sel)?.value ?? "";
    this.draft.name = val("[data-field=name]");
    this.draft.img = val("[data-field=img]");
    this.draft.description = val("[data-field=description]");
    this.draft.changes = [...root.querySelectorAll("[data-change]")].map(li => {
      const get = f => li.querySelector(`[data-cfield=${f}]`)?.value;
      const row = { type: get("type") || "custom" };
      const preset = EFFECT_PRESETS[row.type] ?? EFFECT_PRESETS.custom;
      if (preset.choices) row.choice = get("choice") ?? "";
      row.value = get("value") ?? "";
      if (row.type === "custom") { row.key = get("key") ?? ""; row.mode = Number(get("mode") ?? MODES.ADD); }
      return row;
    });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // A new kind of change shows its own fields (choices, value): keep what was typed, then draw again.
    for (const sel of this.element.querySelectorAll("[data-cfield=type]")) {
      sel.addEventListener("change", () => {
        this.#readForm();
        const i = Number(sel.closest("[data-change]").dataset.change);
        const row = this.draft.changes[i];
        const preset = EFFECT_PRESETS[row.type];
        row.value = preset?.value ?? "";
        row.choice = "";
        this.render();
      });
    }
  }

  static #onAdd() {
    this.draft = { id: null, name: "", img: DEFAULT_EFFECT_IMG, description: "", disabled: false,
      changes: [{ type: "ac", value: EFFECT_PRESETS.ac.value }] };
    this.render();
  }

  static #onEdit(event, target) {
    const e = getRecord(getEntry(this.entryId))?.effects?.[target.closest("[data-effect]").dataset.effect];
    if (!e) return;
    this.draft = foundry.utils.deepClone(e);
    if (!this.draft.changes?.length) this.draft.changes = [{ type: "ac", value: EFFECT_PRESETS.ac.value }];
    this.render();
  }

  static async #onRemove(event, target) {
    const effectId = target.closest("[data-effect]").dataset.effect;
    const ok = await DialogV2.confirm({ window: { title: t("Effects.Remove") }, content: `<p>${t("Effects.RemoveConfirm")}</p>` });
    if (ok) await BastionEffectsApp.#run("removeBastionEffect", { entryId: this.entryId, effectId });
  }

  static async #onToggle(event, target) {
    const effectId = target.closest("[data-effect]").dataset.effect;
    const e = getRecord(getEntry(this.entryId))?.effects?.[effectId];
    if (e) await BastionEffectsApp.#run("toggleBastionEffect", { entryId: this.entryId, effectId, disabled: !e.disabled });
  }

  static #onChangeAdd() {
    this.#readForm();
    this.draft.changes.push({ type: "resistance", choice: "" });
    this.render();
  }

  static #onChangeRemove(event, target) {
    this.#readForm();
    this.draft.changes.splice(Number(target.closest("[data-change]").dataset.change), 1);
    this.render();
  }

  static async #onPickImg() {
    this.#readForm();
    const FP = foundry.applications.apps.FilePicker.implementation;
    new FP({ type: "image", current: this.draft.img, callback: path => { this.draft.img = path; this.render(); } }).render(true);
  }

  static async #onSave() {
    this.#readForm();
    const res = await BastionEffectsApp.#run("saveBastionEffect", { entryId: this.entryId, effect: this.draft });
    if (res?.ok) { this.draft = null; this.render(); }
  }

  static #onCancel() {
    this.draft = null;
    this.render();
  }

  static async #run(action, data) {
    const res = await request(action, data);
    if (res && res.ok === false && res.reason) ui.notifications.warn(res.reason === "noGM" ? t("Notify.NoGM") : res.reason);
    return res;
  }
}
