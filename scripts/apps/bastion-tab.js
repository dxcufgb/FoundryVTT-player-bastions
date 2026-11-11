import { MODULE_ID, t } from "../util.js";
import { bastionForActor, getRecord } from "../store.js";
import { request } from "../socket.js";
import { BastionSheet } from "./bastion-sheet.js";

/**
 * The Bastion inside the dnd5e character sheet's own Bastion tab, as if it were part of the system.
 *
 * The system's tab keeps its name field, its defenders, its basic and special facilities and its description; this
 * module adds a row of sub-tabs under the name (Overview, Stats, Defense, Facilities, Projects, Dispatches, Trade,
 * History). "Facilities" shows the system's own sections (plus the other owners' facilities); every other sub-tab
 * shows this module's page for it, the same one the Bastion window shows.
 *
 * The panel is a frameless BastionSheet that lives in the tab: its element is moved back in whenever the sheet
 * re-renders the tab, so drafts and the chosen sub-tab survive. Its clicks, changes and key presses stay inside it
 * (the character sheet is a form that submits on change), and its inputs belong to no form.
 */
export class BastionTabPanel extends BastionSheet {
  /** sheet app id -> panel */
  static panels = new Map();

  static DEFAULT_OPTIONS = {
    id: "dxpb-tab-{id}",
    classes: ["dxpb", "dxpb-embedded"],
    window: { frame: false, positioned: false }
  };

  static PARTS = { body: { template: BastionSheet.PARTS.body.template } };

  constructor({ entryId, actorId, sheet } = {}) {
    super({ entryId });
    this.embedded = true;
    this.actorId = actorId;
    this.sheet = sheet;
    this.host = null;
    BastionSheet.embeddedPanels.add(this);
  }

  /** Every panel showing this Bastion. */
  static forEntry(entryId) {
    return [...this.panels.values()].filter(p => p.entryId === entryId);
  }

  /** Puts the panel's element into the tab, right under the system's name field. */
  #place(element) {
    if (!this.host || !element) return;
    const name = this.host.querySelector(":scope > .name");
    if (name) name.after(element);
    else this.host.prepend(element);
    this.#syncHost();
  }

  /** Classes on the system's tab: which sub-tab is open decides which of the system's sections show. */
  #syncHost() {
    if (!this.host) return;
    this.host.classList.add("dxpb-has-bastion");
    this.host.classList.toggle("dxpb-sub-facilities", this.tab === "facilities");
  }

  _insertElement(element) {
    this.#place(element);
  }

  /**
   * Moves the panel into a (new) tab element after the character sheet re-rendered it, at the scroll position the
   * reader had (the sheet restores it before the page is back, when the tab is still short).
   */
  attach(host) {
    const fresh = host !== this.host;
    this.host = host;
    if (fresh) host.addEventListener("scroll", () => { this.scrollTop = host.scrollTop; }, { passive: true });
    if (this.element && this.rendered) {
      if (!host.contains(this.element)) {
        this.#place(this.element);
        if (this.scrollTop) host.scrollTop = this.scrollTop;
      } else this.#syncHost();
      return;
    }
    this.render({ force: true });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const el = this.element;
    // The character sheet is a form that submits on change and has its own click actions: keep ours to ourselves.
    // Other clicks (content links in descriptions and history) go on to Foundry as usual.
    el.addEventListener("click", event => { if (event.target.closest("[data-action]")) event.stopPropagation(); });
    for (const type of ["change", "input", "submit"]) el.addEventListener(type, event => event.stopPropagation());
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Inputs of the panel belong to no form, so the character sheet neither submits nor reads them.
    this.element.querySelectorAll("input, select, textarea, button").forEach(c => c.setAttribute("form", "dxpb-none"));
    this.#syncHost();
  }

  _onClose(options) {
    super._onClose(options);
    for (const [key, panel] of BastionTabPanel.panels) if (panel === this) BastionTabPanel.panels.delete(key);
    this.host?.classList.remove("dxpb-has-bastion", "dxpb-sub-facilities");
  }
}

/** Which character sheet class to extend, once dnd5e is ready. */
function characterSheetClass() {
  return globalThis.dnd5e?.applications?.actor?.CharacterActorSheet
    ?? CONFIG.Actor.sheetClasses?.character?.["dnd5e.CharacterActorSheet"]?.cls ?? null;
}

/**
 * The system shows its Bastion tab from level 5 with its Bastion rules on. A character that owns one of this module's
 * Bastions gets the tab whatever its level and whatever that setting says.
 */
function showTabForOwners() {
  const Sheet = characterSheetClass();
  const proto = Sheet?.prototype;
  if (!proto || typeof proto._prepareTabsContext !== "function" || proto._prepareTabsContext.dxpbWrapped) return;
  const original = proto._prepareTabsContext;
  const wrapped = async function (context, options) {
    const wanted = options?.isFirstRender ? this.options?.tab : this.tabGroups?.primary;
    const result = await original.call(this, context, options);
    try {
      const tabs = result?.tabs;
      if (!Array.isArray(tabs) || !tabs.length || tabs.some(x => x.tab === "bastion")) return result;
      if (!bastionForActor(this.actor)) return result;
      const def = this.constructor.TABS?.find(x => x.tab === "bastion");
      if (!def) return result;
      const tab = foundry.utils.deepClone(def);
      // In the system's own order.
      const order = this.constructor.TABS.map(x => x.tab);
      const at = tabs.findIndex(x => order.indexOf(x.tab) > order.indexOf("bastion"));
      tabs.splice(at < 0 ? tabs.length : at, 0, tab);
      if (wanted === "bastion") {
        for (const x of tabs) x.active = false;
        tab.active = true;
        this.tabGroups.primary = "bastion";
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | could not show the Bastion tab`, err);
    }
    return result;
  };
  wrapped.dxpbWrapped = true;
  proto._prepareTabsContext = wrapped;
}

/** The system's name field shows this module's Bastion name; the GM renames the Bastion there. */
function syncNameField(tab, entry) {
  const record = getRecord(entry);
  const input = tab.querySelector(":scope > .name input[name='system.bastion.name']");
  const div = tab.querySelector(":scope > .name .document-name:not(input)");
  if (div) div.textContent = record.name;
  if (!input) return;
  input.value = record.name;
  input.setAttribute("form", "dxpb-none");
  if (!game.user.isGM) {
    input.readOnly = true;
    input.dataset.tooltip = t("TabNameHint");
    return;
  }
  if (input.dataset.dxpbName) return;
  input.dataset.dxpbName = "1";
  input.addEventListener("change", async event => {
    event.stopPropagation();
    const name = input.value.trim();
    if (!name || name === getRecord(entry).name) return;
    const res = await request("updateRecord", { entryId: entry.id, changes: { name } });
    if (res?.ok === false && res.reason) ui.notifications.warn(res.reason);
  });
}

/** Wires the panel into dnd5e's character sheets. Called at setup. */
export function registerBastionTab() {
  showTabForOwners();
  Hooks.on("renderCharacterActorSheet", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const actor = app.document ?? app.actor;
    const entry = bastionForActor(actor);
    const tab = root?.querySelector(".tab[data-tab=bastion]");
    let panel = BastionTabPanel.panels.get(app.id);
    if (!entry || !tab) {
      if (panel) panel.close();
      return;
    }
    if (panel && panel.entryId !== entry.id) {
      panel.close();
      panel = null;
    }
    if (!panel) {
      panel = new BastionTabPanel({ entryId: entry.id, actorId: actor.id, sheet: app });
      BastionTabPanel.panels.set(app.id, panel);
    }
    syncNameField(tab, entry);
    panel.attach(tab);
  });
  Hooks.on("closeCharacterActorSheet", app => {
    const panel = BastionTabPanel.panels.get(app.id);
    BastionTabPanel.panels.delete(app.id);
    panel?.close();
  });
}

/**
 * The system's Bastion name of every owner follows this module's Bastion name (GM, on ready and on changes), so the
 * name reads the same wherever the system shows it.
 */
export async function syncBastionNames(entry) {
  const record = getRecord(entry);
  if (!record?.name) return;
  const { ownerActors } = await import("../store.js");
  for (const actor of ownerActors(record)) {
    if (actor.type !== "character" || !actor.system?.bastion) continue;
    if (bastionForActor(actor)?.id !== entry.id) continue;
    if (actor.system.bastion.name === record.name) continue;
    await actor.update({ "system.bastion.name": record.name });
  }
}
