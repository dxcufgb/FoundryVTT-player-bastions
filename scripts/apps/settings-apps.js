import { MODULE_ID, t, clearCaches, rules, catalog } from "../util.js";
import { DEFAULT_RULES } from "../data/rules.js";
import { EXPANSIONS } from "../data/catalog.js";
import { runSelfTests } from "../tests/quench.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The JSON files the house-rules window offers to download. */
export function rulesFiles() {
  const byId = list => Object.fromEntries(list.map(e => [e.id, e]));
  return {
    "default-rules": { name: "player-bastions-default-rules.json", data: DEFAULT_RULES },
    "rules-in-use": { name: "player-bastions-rules-in-use.json", data: rules() },
    "rules-overrides": { name: "player-bastions-house-rules.json", data: game.settings.get(MODULE_ID, "rules") ?? {} },
    "default-catalog": { name: "player-bastions-default-catalog.json", data: byId(EXPANSIONS) },
    "catalog-in-use": { name: "player-bastions-catalog-in-use.json", data: byId([...catalog().values()]) },
    "catalog-overrides": { name: "player-bastions-catalog-overrides.json", data: game.settings.get(MODULE_ID, "catalog") ?? {} }
  };
}

/**
 * GM menu: house rules and catalog overrides as JSON (only the keys you change). The defaults and what's in use
 * (with the Build pace and Prices settings applied) can be read in the window or downloaded as JSON files, and a
 * JSON file can be loaded into either box.
 */
export class RulesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dxpb-rules",
    tag: "form",
    classes: ["dxpb", "dxpb-rules"],
    window: { title: "DXPB.Settings.Rules.Name", icon: "fa-solid fa-scale-balanced", resizable: true },
    position: { width: 760, height: 720 },
    form: { handler: RulesConfig.#onSubmit, closeOnSubmit: true },
    actions: { download: RulesConfig.#onDownload, loadFile: RulesConfig.#onLoadFile }
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/rules.hbs`, scrollable: [".dxpb-rules-body"] } };

  async _prepareContext() {
    const json = v => JSON.stringify(v, null, 2);
    const files = rulesFiles();
    return {
      rules: json(files["rules-overrides"].data),
      catalog: json(files["catalog-overrides"].data),
      defaults: json(files["default-rules"].data),
      inUse: json(files["rules-in-use"].data),
      defaultCatalog: json(files["default-catalog"].data),
      catalogIds: EXPANSIONS.filter(e => !e.legacy).map(e => e.id).join(", ")
    };
  }

  /** Downloads one of the JSON files (data-file: a key of rulesFiles()). */
  static #onDownload(event, target) {
    const file = rulesFiles()[target.dataset.file];
    if (!file) return;
    foundry.utils.saveDataToFile(JSON.stringify(file.data, null, 2), "application/json", file.name);
  }

  /** Loads a JSON file from the computer into the rules or catalog box (data-target), after checking it parses. */
  static #onLoadFile(event, target) {
    const box = this.element.querySelector(`textarea[name="${target.dataset.target}"]`);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        JSON.parse(text);
      } catch (err) {
        ui.notifications.error(t("Settings.Rules.BadJSON", { error: err.message }));
        return;
      }
      box.value = text;
      ui.notifications.info(t("Settings.Rules.Loaded", { name: file.name }));
    });
    input.click();
  }

  static async #onSubmit(event, form, formData) {
    try {
      const rules = JSON.parse(formData.object.rules || "{}");
      const catalog = JSON.parse(formData.object.catalog || "{}");
      await game.settings.set(MODULE_ID, "rules", rules);
      await game.settings.set(MODULE_ID, "catalog", catalog);
      clearCaches();
      ui.notifications.info(t("Settings.Rules.Saved"));
    } catch (err) {
      ui.notifications.error(t("Settings.Rules.BadJSON", { error: err.message }));
      throw err;
    }
  }
}

/** GM menu button that runs the self-tests. */
export class SelfTestMenu extends ApplicationV2 {
  async render() {
    runSelfTests();
    return this;
  }
}
