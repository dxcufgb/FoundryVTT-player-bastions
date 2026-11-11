import { MODULE_ID, t, catalog, escapeHTML } from "../util.js";
import { bastionForActor, getEntry, getRecord } from "../store.js";
import { GROUPS, SIZE_LABELS } from "../data/catalog.js";
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
    try { decorateSystemSections(this); } catch (err) { console.warn(`${MODULE_ID} | Bastion tab`, err); }
  }

  /** Opens one of the page's sub-tabs. */
  go(tab) {
    this.tab = tab;
    return this.render();
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

const GROUP_ICONS = { rooms: "fa-bed", fortifications: "fa-chess-rook", supplies: "fa-wheat-awn", access: "fa-road", trade: "fa-coins",
  staff: "fa-crown", arcane: "fa-wand-sparkles" };
const GUARD_IMG = "systems/dnd5e/tokens/humanoid/Guard.webp";
const BUILD_ICON = "systems/dnd5e/icons/svg/facilities/build.svg";
const MAX_GUARD_ICONS = 12;

/** One facility card in the system's own markup (character-bastion.hbs), for a building of this module's Bastion. */
function facilityCard({ name, subtitle, icon, building = false, damaged = false, progress = null, fid = "" }) {
  const li = document.createElement("li");
  li.className = `facility dxpb-virtual ${building ? "building" : ""} ${damaged ? "damaged" : ""}`;
  if (fid) li.dataset.dxpbFeature = fid;
  const pct = progress?.max ? Math.round(100 * Math.min(1, progress.value / progress.max)) : 0;
  li.innerHTML = `${progress?.max ? `<div class="facility-progress meter progress" role="meter" aria-valuemin="0"
      aria-valuenow="${pct}" aria-valuetext="${progress.value}" aria-valuemax="${progress.max}" style="--bar-percentage: ${pct}%">
      <div class="label"><span class="value">${progress.value}</span><span class="separator">&sol;</span><span class="max">${progress.max}</span></div>
    </div>` : ""}
    <div class="facility-header">
      <div class="name-stacked rollable"><span class="title">${escapeHTML(name)}</span><span class="subtitle">${escapeHTML(subtitle)}</span></div>
      <div class="slots">${building ? `<div class="slot order-slot"><dnd5e-icon src="${BUILD_ICON}"></dnd5e-icon></div>`
        : `<div class="slot dxpb-group-slot"><i class="fa-solid ${icon}" inert></i></div>`}</div>
    </div>`;
  return li;
}

/**
 * Puts this module's Bastion into the system's own sections of the tab, the way the system shows its facilities:
 * built rooms (not already a facility item on this character) under Basic Facilities, every other building under
 * Special Facilities, buildings under construction greyed with their progress, and the hired guards in the
 * defenders' roster. The system's "add facility" and "Build facility" slots open the Projects page instead of the
 * compendium browser. Clicking one of these opens the page that handles it. Redone after every render.
 */
function decorateSystemSections(panel) {
  const tab = panel.host;
  const record = getRecord(getEntry(panel.entryId));
  if (!tab || !record) return;
  tab.querySelectorAll(".dxpb-virtual").forEach(n => n.remove());
  tab.querySelectorAll(".dxpb-hidden-by-bastion").forEach(n => n.classList.remove("dxpb-hidden-by-bastion"));
  const C = catalog();
  const actor = game.actors.get(panel.actorId);
  const asItems = new Set((actor?.itemTypes?.facility ?? []).map(i => i.getFlag(MODULE_ID, "featureId")).filter(Boolean));
  const cards = { basic: [], special: [] };
  const describe = (e, f) => {
    const parts = [GROUPS[e.group] ?? ""];
    if (f?.size) parts.push(SIZE_LABELS[f.size] ?? f.size);
    if (e.tiers) parts.push(e.tiers[(f?.tier ?? 1) - 1]?.label ?? "");
    else if (f?.count > 1 && e.unit !== "flat") parts.push(e.unit === "mile" ? t("SheetTab.Miles", { n: f.count }) : `× ${f.count}`);
    return parts.filter(Boolean).join(" · ");
  };
  for (const [fid, f] of Object.entries(record.features ?? {})) {
    const e = C.get(f?.id);
    if (!e || e.legacy) continue;
    const room = e.group === "rooms";
    if (room && asItems.has(fid)) continue;
    cards[room ? "basic" : "special"].push(facilityCard({ name: e.name, subtitle: describe(e, f), icon: GROUP_ICONS[e.group] ?? "fa-chess-rook",
      damaged: !!f.damaged, fid }));
  }
  for (const p of Object.values(record.projects ?? {})) {
    if (p?.kind !== "build" || !["building", "paused"].includes(p.state)) continue;
    const e = C.get(p.expansionId);
    if (!e) continue;
    cards[e.group === "rooms" ? "basic" : "special"].push(facilityCard({ name: e.name, subtitle: t(`State.${p.state}`), building: true,
      progress: { value: Math.floor(p.progress ?? 0), max: p.days ?? 0 } }));
  }
  for (const type of ["basic", "special"]) {
    const ul = tab.querySelector(`:scope > .contents .facilities.${type} ul`);
    if (!ul) continue;
    const before = ul.querySelector(":scope > .facility.empty");
    for (const card of cards[type]) {
      card.addEventListener("click", event => { event.stopPropagation(); panel.go("projects"); });
      ul.insertBefore(card, before);
    }
  }
  // Hired guards stand with the defenders.
  const guards = Math.max(0, Math.floor(Number(record.garrison?.guards) || 0));
  const roster = tab.querySelector(":scope > .contents .roster ul");
  if (roster && guards) {
    roster.querySelector(":scope > li.empty")?.classList.add("dxpb-hidden-by-bastion");
    const label = t("SheetTab.Guard");
    for (let i = 0; i < Math.min(guards, MAX_GUARD_ICONS); i++) {
      const li = document.createElement("li");
      li.className = "defender dxpb-virtual dxpb-guard";
      li.dataset.tooltip = label;
      li.innerHTML = `<img src="${GUARD_IMG}" alt="${escapeHTML(label)}">`;
      roster.append(li);
    }
    if (guards > MAX_GUARD_ICONS) {
      const more = document.createElement("li");
      more.className = "defender dxpb-virtual dxpb-guard dxpb-guard-more";
      more.dataset.tooltip = t("SheetTab.Guards", { n: guards });
      more.textContent = `+${guards - MAX_GUARD_ICONS}`;
      roster.append(more);
    }
    roster.querySelectorAll(".dxpb-guard").forEach(li => li.addEventListener("click", event => {
      event.stopPropagation();
      panel.go("defense");
    }));
  }
  // "Add facility" / "Build facility": plan it on the Projects page.
  tab.querySelectorAll(':scope > .contents [data-action="findItem"]').forEach(slot => {
    if (slot.dataset.dxpbHooked) return;
    slot.dataset.dxpbHooked = "1";
    slot.dataset.tooltip = t("SheetTab.PlanHere");
    slot.addEventListener("click", event => {
      event.stopPropagation();
      event.preventDefault();
      panel.go("projects");
    });
  });
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
