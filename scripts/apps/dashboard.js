import { TEMPLATE_PATH, t, gp, rules, whenText } from "../util.js";
import { allBastions, getRecord, canAct } from "../store.js";
import { statsFor } from "../context.js";
import { holdout } from "../core/siege.js";
import { FORCES } from "../data/tables.js";
import { request } from "../socket.js";
import { BastionSheet } from "./bastion-sheet.js";
import { FoundingWizard } from "./wizard.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Every Bastion the user can see in one table; the GM's control room. */
export class BastionDashboard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dxpb-dashboard",
    classes: ["dxpb", "dxpb-dashboard"],
    window: { title: "DXPB.Dashboard.Title", icon: "fa-solid fa-chess-rook", resizable: true },
    position: { width: 900, height: 520 },
    actions: {
      open: BastionDashboard.#onOpen,
      found: BastionDashboard.#onFound,
      advanceAll: BastionDashboard.#onAdvanceAll,
      benchmark: BastionDashboard.#onBenchmark
    }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/dashboard.hbs` } };

  benchmark = "warband";

  async _prepareContext() {
    const R = rules();
    const rows = allBastions().filter(e => game.user.isGM || canAct(getRecord(e))).map(e => {
      const r = getRecord(e);
      const { stats } = statsFor(r);
      const h = holdout(stats, FORCES[this.benchmark], R);
      const projects = Object.values(r.projects ?? {});
      return {
        id: e.id, name: r.name, presence: t(r.presence === "present" ? "PresenceHome" : "PresenceAway"),
        holdout: Number.isFinite(h.days) ? h.days : "∞", treasury: gp(r.treasury), net: gp(stats.economy.net), good: stats.economy.net >= 0,
        building: projects.filter(p => p.state === "building").length, planned: projects.filter(p => ["planned", "queued"].includes(p.state)).length,
        transit: Object.values(r.dispatches ?? {}).filter(d => d.status === "transit").length,
        events: Object.values(r.events ?? {}).filter(x => x.state === "pending").length,
        turn: r.turn?.number ?? 0, last: whenText(r.turn?.lastTime ?? 0), siege: !!r.siege
      };
    });
    return { rows, isGM: game.user.isGM, forces: Object.entries(FORCES).map(([k, f]) => ({ k, label: f.label, sel: k === this.benchmark })) };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("[name=benchmark]")?.addEventListener("change", ev => {
      this.benchmark = ev.target.value;
      this.render();
    });
  }

  static #onOpen(event, target) {
    BastionSheet.open(target.closest("[data-id]").dataset.id);
  }

  static #onFound() {
    new FoundingWizard().render({ force: true });
  }

  static async #onAdvanceAll(event, target) {
    const turns = Number(this.element.querySelector("[name=turns]")?.value) || 1;
    const ok = await DialogV2.confirm({ window: { title: t("Advance.Title") }, content: `<p>${t("Advance.ConfirmAll", { n: turns })}</p>` });
    if (!ok) return;
    await request("advanceTurn", { turns });
    this.render();
  }

  static #onBenchmark() {}
}
