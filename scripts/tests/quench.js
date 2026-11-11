import { MODULE_ID, t, rules, catalog, now, escapeHTML, formatGameTime } from "../util.js";
import { registerCoreTests } from "./core-tests.js";
import { ACTIONS } from "../actions.js";
import { getEntry, getRecord, allBastions, ownerActors, ownershipFor, canAct } from "../store.js";
import { statsFor, systemContext } from "../context.js";
import { runTurn } from "../turn-runner.js";
import { applyEvent } from "../events.js";
import { fillStock } from "../merchant.js";
import { EVENTS, FORCES } from "../data/tables.js";
import { BastionSheet } from "../apps/bastion-sheet.js";
import { FoundingWizard, defaultMapScene } from "../apps/wizard.js";
import { BastionDashboard } from "../apps/dashboard.js";
import { sceneDistance, settlementsNear } from "../marker.js";
import { computeStats } from "../core/stats.js";
import { buildMap, planFor, wallData, lightData, mapScene } from "../map.js";

/**
 * Self-verification. Two Quench batches:
 *   dxcufgbs-player-bastions.core         the pure engine (same tests as `node tests/run-node.mjs`)
 *   dxcufgbs-player-bastions.integration  the module inside Foundry: founding with a map marker, stats from the dnd5e
 *                                         facilities, projects to completion, dispatches, every Bastion event, merchants,
 *                                         sieges, dividends, permissions and every window. GM only; cleans up after itself.
 * Without Quench, runSelfTests() runs the core batch with a small built-in runner and shows the result.
 */
export function registerQuench(quench) {
  quench.registerBatch(`${MODULE_ID}.core`, (context) => {
    registerCoreTests({ describe: context.describe, it: context.it, assert: context.assert });
  }, { displayName: "Player Bastions: engine" });

  quench.registerBatch(`${MODULE_ID}.integration`, (context) => {
    const { describe, it, assert, before, after } = context;
    const made = { actors: [], scenes: [], entries: [], users: [] };
    let entryId;
    let group;
    let hero;
    let ally;
    let scene;
    const PREFIX = "DXPB Test";
    // The tests set the clock themselves (most run on the game clock) and put the GM's settings back afterwards.
    const saved = {};

    describe("Player Bastions inside Foundry", function () {
      this.timeout(120000);

      before(async () => {
        if (!game.user.isGM) throw new Error("Run as GM");
        for (const k of ["clock", "timePrompt", "buildPrice"]) saved[k] = game.settings.get(MODULE_ID, k);
        await game.settings.set(MODULE_ID, "clock", "calendar");
        // The tests' gold sums are the DMG's; one test switches the prices itself.
        await game.settings.set(MODULE_ID, "buildPrice", "dmg");
        scene = defaultMapScene();
        if (!scene || !/fa[eê]r[uû]n/i.test(scene.name.normalize("NFD").replace(/[̀-ͯ]/g, ""))) {
          scene = await Scene.create({ name: `${PREFIX} Map`, width: 4000, height: 3000, grid: { type: 0, size: 54, distance: 25, units: "mi" } });
          made.scenes.push(scene.id);
        }
        hero = await Actor.create({ name: `${PREFIX} Hero`, type: "character" });
        ally = await Actor.create({ name: `${PREFIX} Ally`, type: "character" });
        const def1 = await Actor.create({ name: `${PREFIX} Defender 1`, type: "npc" });
        const def2 = await Actor.create({ name: `${PREFIX} Defender 2`, type: "npc" });
        const hire = await Actor.create({ name: `${PREFIX} Hireling`, type: "npc" });
        made.actors.push(hero.id, ally.id, def1.id, def2.id, hire.id);
        group = await Actor.create({ name: `${PREFIX} Party`, type: "group", system: { members: [{ actor: hero.id }, { actor: ally.id }] } });
        made.actors.push(group.id);
        await hero.createEmbeddedDocuments("Item", [{
          name: `${PREFIX} Barrack`, type: "facility",
          system: { type: { value: "special", subtype: "barrack" }, order: "recruit", size: "roomy",
            defenders: { value: [def1.uuid, def2.uuid], max: 12 }, hirelings: { value: [hire.uuid], max: 1 } }
        }]);
        await hero.update({ "system.currency.gp": 5000 });
        await ally.update({ "system.currency.gp": 5000 });
      });

      after(async () => {
        for (const [k, v] of Object.entries(saved)) await game.settings.set(MODULE_ID, k, v);
        for (const app of [...BastionSheet.instances.values()]) await app.close();
        for (const app of foundry.applications.instances.values()) {
          if (app instanceof FoundingWizard || app instanceof BastionDashboard) await app.close();
        }
        for (const id of made.entries) {
          const r = getRecord(getEntry(id));
          if (r) await ACTIONS.deleteBastion({ entryId: id, confirm: "DELETE" }, game.user);
        }
        for (const id of made.actors) await game.actors.get(id)?.delete();
        for (const id of made.scenes) await game.scenes.get(id)?.delete();
        const msgs = game.messages.filter(m => m.getFlag(MODULE_ID, "turn")?.entryId && made.entries.includes(m.getFlag(MODULE_ID, "turn").entryId)
          || m.getFlag(MODULE_ID, "event")?.entryId && made.entries.includes(m.getFlag(MODULE_ID, "event").entryId));
        if (msgs.length) await ChatMessage.deleteDocuments(msgs.map(m => m.id));
      });

      it("founds a Bastion with a map marker on the world map", async () => {
        const res = await ACTIONS.found({ answers: {
          name: `${PREFIX} Keep`, description: "Test", groupUuid: group.uuid, ownerUuids: [],
          location: { terrain: "hills", site: "hilltop", settlement: { name: "Town", size: "village", distance: 20 }, road: "trail",
            waterway: "river", waterOnSite: "table", climate: "temperate", land: "fertile", resources: ["stone", "timber"],
            danger: "frontier", visibility: "ordinary", political: "freehold" },
          // A keep founded with a Vast bedroom; its other rooms, a wall up to stone and a gatehouse came as the first build.
          structure: { type: "keep", acquisition: "reward" }, first: "large-house",
          included: [{ id: "kitchen", size: "roomy" }, { id: "storage", size: "roomy" }, { id: "dining-room", size: "roomy" }, { id: "well" },
            { id: "wall", tier: 2, count: 40 }, { id: "gatehouse" }, { id: "watchtower", count: 2 }],
          food: 3000, treasury: 20000, guards: 20, servants: 4,
          marker: { sceneUuid: scene.uuid, x: 1000, y: 1000 }
        } }, game.user);
        assert.isTrue(res.ok);
        entryId = res.entryId;
        made.entries.push(entryId);
        const record = getRecord(getEntry(entryId));
        assert.equal(record.name, `${PREFIX} Keep`);
        assert.ok(record.marker?.noteId, "has a note");
        const note = scene.notes.get(record.marker.noteId);
        assert.ok(note, "the note is on the scene");
        assert.include(note.texture.src, "bastion-marker.svg");
        assert.equal(note.getFlag(MODULE_ID, "bastion"), entryId);
        assert.ok(Object.values(record.features).some(f => f.id === "gatehouse"), "the keep came with a gatehouse");
      });

      it("owners are the party's members; their players get Observer", () => {
        const record = getRecord(getEntry(entryId));
        const owners = ownerActors(record).map(a => a.id).sort();
        assert.deepEqual(owners, [hero.id, ally.id].sort());
        const own = ownershipFor(record);
        assert.equal(own.default, CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE);
        assert.isTrue(canAct(record, game.user), "the GM can act");
      });

      it("a party member's character sheet shows the Bastion in the system's own Bastion tab, like official content", async () => {
        const { bastionForActor } = await import("../store.js");
        const { BastionTabPanel } = await import("../apps/bastion-tab.js");
        assert.equal(bastionForActor(hero)?.id, entryId, "a member of the group owns it");
        assert.equal(bastionForActor(group)?.id, entryId, "the group owns it");
        const sheet = hero.sheet;
        await sheet.render({ force: true });
        const el = () => sheet.element;
        const tab = () => el()?.querySelector(".tab[data-tab=bastion]");
        const panel = () => tab()?.querySelector(".dxpb-embedded");
        for (let i = 0; i < 60 && !panel()?.querySelector(".dxpb-tabs"); i++) await new Promise(r => setTimeout(r, 50));
        try {
          // The tab is there whatever the character's level or the system's Bastion setting.
          assert.ok(el().querySelector('[data-tab="bastion"][data-action="tab"], nav [data-tab="bastion"]'), "the Bastion tab in the sheet's tab list");
          assert.ok(tab(), "the system's Bastion tab");
          assert.ok(panel(), "the Bastion page inside it");
          assert.notOk(el().querySelector(".window-header .dxpb-open-bastion"), "no extra button in the window header");
          assert.equal(getComputedStyle(tab().querySelector(":scope > .contents")).display, "none", "the Facilities page replaces the system's lists");
          const record = getRecord(getEntry(entryId));
          const nameInput = tab().querySelector(":scope > .name input");
          const shown = nameInput ? nameInput.value : tab().querySelector(":scope > .name .document-name")?.textContent;
          assert.equal(shown, record.name, "the name field shows the Bastion's name");
          const subTabs = [...panel().querySelectorAll(".dxpb-tabs .dxpb-tab")].map(a => a.dataset.tab);
          assert.sameMembers(subTabs, ["overview", "stats", "defense", "facilities", "projects", "dispatches", "trade", "history"]);
          // Our clicks and changes stay ours: the character isn't updated and the sheet isn't submitted.
          let updates = 0;
          // The system Bastion name the GM keeps in step with the Bastion's (syncBastionNames) may land late, and other
          // modules write their own flags on a new character: neither is the page.
          const hook = Hooks.on("updateActor", (a, changes) => {
            const keys = Object.keys(foundry.utils.flattenObject(changes ?? {})).filter(k => !k.startsWith("_") && k !== "system.bastion.name"
              && !(k.startsWith("flags.") && !k.startsWith(`flags.${MODULE_ID}.`)));
            if (a.id === hero.id && keys.length) { updates++; console.warn("dxpb test: hero updated", keys); }
          });
          const go = async key => {
            panel().querySelector(`.dxpb-tabs [data-tab="${key}"]`).click();
            for (let i = 0; i < 40 && !panel()?.querySelector(`.dxpb-tab.active[data-tab="${key}"]`); i++) await new Promise(r => setTimeout(r, 50));
          };
          await go("projects");
          assert.ok(panel().querySelector(".dxpb-crews"), "the Projects page with its building crews");
          const select = panel().querySelector("select");
          if (select) {
            assert.equal(select.getAttribute("form"), "dxpb-none", "the page's inputs belong to no form");
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
          await new Promise(r => setTimeout(r, 400));
          Hooks.off("updateActor", hook);
          assert.equal(updates, 0, "nothing on the page updates the character");
          await go("facilities");
          assert.notEqual(getComputedStyle(tab().querySelector(":scope > .description")).display, "none", "the system's description under the page");
          await checkFacilitiesPage(() => BastionTabPanel.panels.get(sheet.id), () => go("facilities"));
          // A re-render of the sheet keeps the page and its sub-tab.
          const before = BastionTabPanel.panels.get(sheet.id);
          await sheet.render();
          for (let i = 0; i < 40 && !panel(); i++) await new Promise(r => setTimeout(r, 50));
          assert.equal(BastionTabPanel.panels.get(sheet.id), before, "the same page");
          assert.ok(panel()?.querySelector('.dxpb-tab.active[data-tab="facilities"]'), "on the same sub-tab");
          // The pop-out opens the full window.
          await go("stats");
          panel().querySelector("[data-action=popOut]").click();
          for (let i = 0; i < 40 && !BastionSheet.instances.get(entryId)?.rendered; i++) await new Promise(r => setTimeout(r, 50));
          assert.ok(BastionSheet.instances.get(entryId)?.rendered, "the Bastion window");
          assert.equal(BastionSheet.instances.get(entryId).tab, "stats");
          await BastionSheet.instances.get(entryId).close();
        } finally {
          await sheet.close();
        }
        assert.notOk(BastionTabPanel.panels.get(sheet.id), "the page goes with the sheet");
        assert.equal(hero.system.bastion.name, getRecord(getEntry(entryId)).name, "the owners' system Bastion name follows the Bastion");
      });

      /**
       * The Facilities page, in the window or a character sheet: the defenders by kind, a section per kind of building
       * with a summary and a limit, the Bastion's buildings and the owners' dnd5e facilities as cards, upgrade arrows,
       * and a section's Plan button opening the catalog on that section only. `reopen` comes back to the page.
       */
      async function checkFacilitiesPage(app, reopen) {
        const { patchRecord } = await import("../store.js");
        const el = () => app().element;
        const wait = async test => { for (let i = 0; i < 60 && !test(); i++) await new Promise(r => setTimeout(r, 50)); };
        const guardsBefore = getRecord(getEntry(entryId)).garrison?.guards ?? 0;
        await patchRecord(getEntry(entryId), { "garrison.guards": 3 });
        await wait(() => el()?.querySelector('[data-defenders="guards"] .dxpb-def-count')?.dataset.count === "3");
        try {
          assert.ok(el().querySelector(".dxpb-facpage"), "the Facilities page");
          assert.equal(el().querySelector('[data-defenders="guards"] .dxpb-def-count').dataset.count, "3", "hired guards in the defenders list");
          assert.ok(el().querySelector('[data-defenders="mercenaries"]'), "mercenaries listed");
          assert.equal(el().querySelector('[data-defenders="system"] .dxpb-def-count').dataset.count, "2", "the Barrack's defenders");
          assert.equal(el().querySelectorAll('[data-defenders="system"] .dxpb-def-portraits img').length, 2, "with their portraits");
          const sections = [...el().querySelectorAll(".dxpb-fac-section[data-section]")].map(x => x.dataset.section);
          assert.deepEqual(sections, ["defenders", "rooms", "fortifications", "supplies", "access", "trade", "staff", "arcane"]);
          for (const sec of el().querySelectorAll('.dxpb-fac-section:not([data-section="defenders"])')) {
            assert.ok(sec.querySelector(".dxpb-fac-summary span")?.textContent.trim(), `${sec.dataset.section}: a summary`);
            assert.ok(sec.querySelector(".dxpb-fac-limit")?.textContent.trim(), `${sec.dataset.section}: a limit`);
          }
          const titles = key => [...el().querySelectorAll(`[data-section="${key}"] .dxpb-fac .title`)].map(x => x.textContent.trim());
          assert.include(titles("fortifications"), "Gatehouse");
          assert.include(titles("fortifications"), `${PREFIX} Barrack`, "a system special facility in its section");
          assert.include(titles("rooms"), "Kitchen");
          assert.notInclude(titles("fortifications"), "Kitchen");
          const kitchen = [...el().querySelectorAll('[data-section="rooms"] .dxpb-fac')].find(x => x.querySelector(".title").textContent.trim() === "Kitchen");
          assert.ok(kitchen.querySelector(".dxpb-fac-up"), "a roomy kitchen can be enlarged: double arrow up");
          const wall = [...el().querySelectorAll('[data-section="fortifications"] .dxpb-fac')].find(x => x.querySelector(".title").textContent.trim() === "Wall");
          assert.ok(wall?.querySelector(".dxpb-fac-up"), "a stone wall can be raised");
          // A section's Plan button: the catalog on the Projects page, only that section.
          el().querySelector('[data-section="rooms"] [data-action="planSection"]').click();
          await wait(() => el()?.querySelector('.dxpb-tab.active[data-tab="projects"]') && el()?.querySelector(".dxpb-chip"));
          assert.ok(el().querySelector('.dxpb-tab.active[data-tab="projects"]'), "the Projects page");
          assert.ok(el().querySelector(".dxpb-chip"), "the catalog shows one section");
          assert.isAtMost(el().querySelectorAll(".dxpb-group").length, 1, "only that section's group");
          el().querySelector('[data-action="clearCatalogGroup"]').click();
          await wait(() => !el()?.querySelector(".dxpb-chip"));
          assert.notOk(el().querySelector(".dxpb-chip"), "every group again");
          await reopen();
        } finally {
          await patchRecord(getEntry(entryId), { "garrison.guards": guardsBefore });
        }
      }

      it("the Bastion window has the same Facilities page", async () => {
        const app = BastionSheet.open(entryId, { tab: "facilities" });
        await app.render({ force: true });
        try {
          await checkFacilitiesPage(() => app, async () => { app.tab = "facilities"; await app.render(); });
        } finally {
          await app.close();
        }
      });

      it("the world's dnd5e special facilities can be added from the Projects page, by level and free slots", async () => {
        const [cls] = await hero.createEmbeddedDocuments("Item", [{ name: `${PREFIX} Fighter`, type: "class", system: { identifier: "fighter", levels: 5 } }]);
        const smithy = await Item.create({ name: `${PREFIX} Smithy`, type: "facility",
          system: { type: { value: "special", subtype: "smithy" }, level: 5, size: "roomy" } });
        const vault = await Item.create({ name: `${PREFIX} Demiplane`, type: "facility",
          system: { type: { value: "special", subtype: "demiplane" }, level: 17, size: "roomy" } });
        const app = BastionSheet.open(entryId, { tab: "projects" });
        try {
          await app.render({ force: true });
          const row = id => app.element.querySelector(`.dxpb-system-facility[data-uuid="${id}"]`);
          assert.ok(row(smithy.uuid), "listed in the catalog");
          assert.ok(row(smithy.uuid).closest(".dxpb-group"), "under a group");
          assert.ok(row(vault.uuid)?.classList.contains("dxpb-locked"), "a level 17 facility is locked");
          // Too high a level: refused by the GM side too.
          let res = await ACTIONS.addSystemFacility({ entryId, uuid: vault.uuid, actorId: hero.id }, game.user);
          assert.isFalse(res.ok);
          res = await ACTIONS.addSystemFacility({ entryId, uuid: smithy.uuid, actorId: hero.id }, game.user);
          assert.isTrue(res.ok, res.reason);
          const added = hero.itemTypes.facility.find(i => i.name === `${PREFIX} Smithy`);
          assert.ok(added, "on the character's sheet");
          assert.equal(added.getFlag(MODULE_ID, "entryId"), entryId);
          res = await ACTIONS.addSystemFacility({ entryId, uuid: smithy.uuid, actorId: hero.id }, game.user);
          assert.isFalse(res.ok, "not twice");
          app.tab = "facilities";
          await app.render();
          const titles = [...app.element.querySelectorAll('[data-section="trade"] .dxpb-fac .title')].map(x => x.textContent.trim());
          assert.include(titles, `${PREFIX} Smithy`, "a smithy is trade and crafting");
          await added.delete();
        } finally {
          await app.close();
          await smithy.delete();
          await vault.delete();
          await cls.delete();
        }
      });

      it("the party's group sheet keeps a rook button in its header", async () => {
        await group.sheet.render({ force: true });
        for (let i = 0; i < 20 && !group.sheet.element?.querySelector(".dxpb-open-bastion"); i++) await new Promise(r => setTimeout(r, 50));
        assert.ok(group.sheet.element.querySelector(".window-header .dxpb-open-bastion"));
        await group.sheet.close();
      });

      it("reads DMG defenders and hirelings from the dnd5e facilities", () => {
        const ctx = systemContext(getRecord(getEntry(entryId)));
        assert.equal(ctx.dmgDefenders, 2);
        assert.equal(ctx.dmgHirelings, 1);
        const { stats } = statsFor(getRecord(getEntry(entryId)));
        assert.equal(stats.garrison, 22, "2 defenders + 20 guards");
        assert.equal(stats.wall.integrity, 160);
      });

      it("hiring keeps the founding garrison; more guards need a Barracks", async () => {
        let res = await ACTIONS.hire({ entryId, guards: 20 }, game.user);
        assert.isTrue(res.ok);
        assert.equal(getRecord(getEntry(entryId)).garrison.guards, 20, "the founding 20 guards stay");
        await ACTIONS.hire({ entryId, guards: 35 }, game.user);
        assert.equal(getRecord(getEntry(entryId)).garrison.guards, 20, "no Barracks: no more than 20");
        await ACTIONS.hire({ entryId, guards: 15 }, game.user);
        assert.equal(getRecord(getEntry(entryId)).garrison.guards, 15, "dismissing works");
        await ACTIONS.hire({ entryId, guards: 20 }, game.user);
        assert.equal(getRecord(getEntry(entryId)).garrison.guards, 15, "dismissed guards can't be rehired without a Barracks");
        const { patchRecord } = await import("../store.js");
        await patchRecord(getEntry(entryId), { "garrison.guards": 20 });
      });

      it("the edit wizard previews the real Bastion's stats", async () => {
        const wiz = new FoundingWizard({ entryId });
        const { stats: real } = statsFor(getRecord(getEntry(entryId)));
        const preview = computeStats(wiz.previewRecord(), { rules: rules(), catalog: catalog(), ctx: {} });
        assert.equal(preview.wall.integrity, real.wall.integrity, "same wall integrity as the built Bastion");
        assert.equal(preview.housing, real.housing, "same housing");
      });

      it("the Structure step offers one first building, suggested by the structure; the GM's pick sticks", async () => {
        const wiz = new FoundingWizard();
        wiz.step = 3;
        await wiz.render({ force: true });
        const radios = () => [...wiz.element.querySelectorAll(".dxpb-first-buildings input[name=first]")];
        assert.isAtLeast(radios().length, 4, "a few options");
        assert.equal(radios().filter(r => r.checked).length, 1, "exactly one");
        assert.equal(radios().find(r => r.checked).value, "hall", "a keep suggests a hall");
        const pickRadio = async (sel, value) => {
          const r = wiz.element.querySelector(`${sel}[value="${value}"]`);
          r.checked = true;
          r.dispatchEvent(new Event("change", { bubbles: true }));
          await new Promise(res => setTimeout(res, 300));
        };
        await pickRadio("input[name=structureType]", "temple");
        assert.equal(radios().find(r => r.checked).value, "chapel", "a temple suggests a chapel");
        await pickRadio(".dxpb-first-buildings input[name=first]", "tower");
        assert.equal(wiz.answers.first, "tower");
        await pickRadio("input[name=structureType]", "manor");
        assert.equal(radios().find(r => r.checked).value, "tower", "the GM's pick stays");
        const preview = wiz.previewRecord();
        assert.deepEqual(Object.values(preview.features).map(f => f.id), ["watchtower"], "one building from this step");
        await wiz.close();
      });

      it("the wizard lets the GM pick the battle map's ground whatever the terrain; editing it redraws the map", async () => {
        const wiz = new FoundingWizard({ entryId });
        wiz.step = 3; // structure
        await wiz.render({ force: true });
        const tiles = wiz.element.querySelectorAll(".dxpb-map-ground input[name=mapGround]");
        assert.equal(tiles.length, 9, "Automatic and eight grounds");
        assert.isTrue(wiz.element.querySelector(".dxpb-map-ground input[value='']").checked, "Automatic at first");
        const sand = wiz.element.querySelector(".dxpb-map-ground input[value=sand]");
        sand.checked = true;
        sand.dispatchEvent(new Event("change", { bubbles: true }));
        for (let i = 0; i < 40 && wiz.answers.mapGround !== "sand"; i++) await new Promise(r => setTimeout(r, 50));
        assert.equal(wiz.answers.mapGround, "sand");
        assert.equal(planFor(wiz.previewRecord()).ground, "sand", "on hills, sand all the same");
        await wiz.close();
        // Saving it on a Bastion with a battle map redraws the map.
        let redrawn = false;
        const hook = Hooks.on(`${MODULE_ID}.mapLookChanged`, ({ entryId: id }) => { if (id === entryId) redrawn = true; });
        await ACTIONS.updateRecord({ entryId, changes: { mapGround: "snow" } }, game.user);
        Hooks.off(`${MODULE_ID}.mapLookChanged`, hook);
        assert.isTrue(redrawn);
        assert.equal(getRecord(getEntry(entryId)).mapGround, "snow");
        assert.equal(planFor(getRecord(getEntry(entryId))).ground, "snow");
        await ACTIONS.updateRecord({ entryId, changes: { mapGround: null } }, game.user);
      });

      it("the Bastion page shows the picture the GM chose", async () => {
        const pic = "modules/dxcufgbs-player-bastions/assets/sites/hilltop.webp";
        await ACTIONS.updateRecord({ entryId, changes: { image: pic } }, game.user);
        const app = BastionSheet.open(entryId);
        await app.render({ force: true });
        assert.include(app.element.querySelector(".dxpb-hero img").getAttribute("src"), "sites/hilltop.webp");
        await app.close();
        await ACTIONS.updateRecord({ entryId, changes: { image: null } }, game.user);
      });

      it("measures distances on the map scene", () => {
        const d = sceneDistance(scene, { x: 0, y: 0 }, { x: scene.grid.size * 2, y: 0 });
        assert.closeTo(d, scene.grid.distance * 2, 0.2);
        assert.isArray(settlementsNear(scene, { x: 1000, y: 1000 }));
      });

      it("full grounds block building until they are extended; the walls grow with them", async () => {
        const { patchRecord } = await import("../store.js");
        let rec = getRecord(getEntry(entryId));
        assert.equal(statsFor(rec).stats.grounds.key, "plot");
        let res = await ACTIONS.planProject({ entryId, opts: { expansionId: "great-hall" } }, game.user);
        assert.isFalse(res.ok, "a 64-square hall doesn't fit on a plot with 51 free");
        assert.include(res.reason, "Extend the grounds");
        res = await ACTIONS.planProject({ entryId, opts: { kind: "grounds" } }, game.user);
        assert.isTrue(res.ok, res.reason);
        const pid = res.projectId;
        let p = getRecord(getEntry(entryId)).projects[pid];
        assert.equal(p.toGrounds, "compound");
        await patchRecord(getEntry(entryId), { treasury: (getRecord(getEntry(entryId)).treasury ?? 0) + p.cost });
        res = await ACTIONS.fundProject({ entryId, projectId: pid, amount: p.cost, from: "treasury" }, game.user);
        assert.isTrue(res.ok, res.reason);
        res = await ACTIONS.construction({ entryId, projectId: pid, action: "start" }, game.user);
        assert.isTrue(res.ok, res.reason);
        // Skip most of the long wall work, then let a turn finish it.
        await patchRecord(getEntry(entryId), { [`projects.${pid}.progress`]: p.days - 1 });
        await runTurn(getEntry(entryId), { systemAdvance: false });
        rec = getRecord(getEntry(entryId));
        assert.equal(rec.projects[pid].state, "complete");
        assert.equal(rec.grounds, "compound");
        assert.equal(Object.values(rec.features).find(f => f.id === "wall").count, 96);
        res = await ACTIONS.planProject({ entryId, opts: { expansionId: "great-hall" } }, game.user);
        assert.isTrue(res.ok, res.reason);
        await ACTIONS.removeProject({ entryId, projectId: res.projectId }, game.user);
      });

      it("the Projects tab shows the grounds and the room each building takes", async () => {
        const app = BastionSheet.open(entryId);
        app.tab = "projects";
        await app.render({ force: true });
        assert.ok(app.element.querySelector(".dxpb-grounds"), "grounds panel");
        assert.include(app.element.querySelector(".dxpb-grounds").textContent, "Compound");
        assert.ok(app.element.querySelector("[data-action=extendGrounds]"), "extend button to a Holding");
        await app.close();
      });

      it("draws the battle map: a scene of the grounds with walls and doors; new buildings join, nothing moves", async () => {
        const { patchRecord } = await import("../store.js");
        let scene = await buildMap(getEntry(entryId), { notify: false });
        made.scenes.push(scene.id);
        let rec = getRecord(getEntry(entryId));
        const plan = planFor(rec);
        assert.equal(rec.map.sceneUuid, scene.uuid);
        assert.equal(scene.width, plan.total * 100);
        assert.equal(scene.grid.size, 100);
        assert.include(scene.background.src, "/bastions/");
        const ours = scene.walls.filter(w => w.getFlag(MODULE_ID, "generated"));
        assert.equal(ours.length, wallData(plan).length);
        assert.ok(ours.some(w => w.door === CONST.WALL_DOOR_TYPES.DOOR), "doors, the gate among them");
        assert.equal(scene.lights.filter(l => l.getFlag(MODULE_ID, "generated")).length, lightData(plan).length, "a light at every fire");
        const tex = await foundry.canvas.loadTexture(scene.background.src);
        assert.ok(tex?.width > 1000, "the picture loads");
        const before = structuredClone(rec.layout);
        await patchRecord(getEntry(entryId), { "features.dxpbMapTest": { id: "smokehouse", builtAt: now() } });
        scene = await buildMap(getEntry(entryId), { notify: false });
        rec = getRecord(getEntry(entryId));
        assert.equal(mapScene(rec).id, scene.id, "the same scene is redrawn");
        assert.equal(rec.map.version, 2);
        assert.ok(rec.layout.dxpbMapTest, "the smokehouse has its squares");
        for (const [fid, p] of Object.entries(before)) assert.deepEqual(rec.layout[fid], p);
        assert.equal(scene.walls.filter(w => w.getFlag(MODULE_ID, "generated")).length, wallData(planFor(rec)).length, "old walls replaced, not doubled");
        const app = BastionSheet.open(entryId);
        app.tab = "projects";
        await app.render({ force: true });
        assert.ok(app.element.querySelector("[data-action=buildMap]"));
        assert.ok(app.element.querySelector("[data-action=viewMap]"));
        await app.close();
        await patchRecord(getEntry(entryId), { "features.dxpbMapTest": undefined });
      });

      it("plans, funds, starts and finishes a Roomy Granary, adding a dnd5e basic facility", async () => {
        let res = await ACTIONS.planProject({ entryId, opts: { expansionId: "granary", size: "roomy" } }, game.user);
        assert.isTrue(res.ok, res.reason);
        const pid = res.projectId;
        let p = getRecord(getEntry(entryId)).projects[pid];
        res = await ACTIONS.fundProject({ entryId, projectId: pid, amount: p.cost, from: "treasury" }, game.user);
        assert.isTrue(res.ok, res.reason);
        res = await ACTIONS.construction({ entryId, projectId: pid, action: "start" }, game.user);
        assert.isTrue(res.ok, res.reason);
        p = getRecord(getEntry(entryId)).projects[pid];
        assert.equal(p.state, "building");
        const before = statsFor(getRecord(getEntry(entryId))).stats.food.cap;
        const turns = Math.ceil(p.days / rules().turnDays);
        for (let i = 0; i < turns; i++) await runTurn(getEntry(entryId), { systemAdvance: false });
        const rec = getRecord(getEntry(entryId));
        assert.equal(rec.projects[pid].state, "complete");
        const after = statsFor(rec).stats.food.cap;
        assert.equal(after - before, 6000);
        const feature = Object.values(rec.features).find(f => f.id === "granary");
        assert.ok(feature?.systemItem, "a system facility item was made");
        const item = await fromUuid(feature.systemItem);
        assert.equal(item.system.type.value, "basic");
      });

      it("the Projects tab totals gold and work in the column headers and lists only what can be planned now", async () => {
        const res = await ACTIONS.planProject({ entryId, opts: { expansionId: "rookery" } }, game.user);
        assert.isTrue(res.ok, res.reason);
        const app = BastionSheet.open(entryId);
        app.tab = "projects";
        await app.render({ force: true });
        const open = Object.values(getRecord(getEntry(entryId)).projects).filter(p => !["complete", "cancelled"].includes(p.state));
        const head = app.element.querySelector("table.dxpb-projects thead").textContent;
        const cost = open.reduce((n, p) => n + p.cost, 0), days = open.reduce((n, p) => n + p.days, 0);
        assert.include(head, cost.toLocaleString(), "the total gold in the Funding header");
        assert.include(head, `/ ${days}`, "the total work in the Build header");
        const listed = [...app.element.querySelectorAll(".dxpb-catalog [data-action=plan][data-id]")].map(el => el.dataset.id);
        assert.notInclude(listed, "wall", "the wall is built: upgraded, not planned again");
        assert.notInclude(listed, "drawbridge", "no drawbridge without a moat");
        assert.notInclude(listed, "rookery", "already planned");
        assert.include(listed, "spike-barricade", "available");
        await app.close();
        await ACTIONS.removeProject({ entryId, projectId: res.projectId }, game.user);
      });

      it("the project list: started projects first, then the least gold left, then the least work left", async () => {
        const { patchRecord } = await import("../store.js");
        const ids = [];
        for (const id of ["rookery", "chapel", "smokehouse"]) {
          const r = await ACTIONS.planProject({ entryId, opts: { expansionId: id } }, game.user);
          assert.isTrue(r.ok, `${id}: ${r.reason}`);
          ids.push(r.projectId);
        }
        const [a, b, c] = ids;
        // a: planned, nothing paid; b: building; c: planned, almost paid.
        const rec = getRecord(getEntry(entryId));
        await patchRecord(getEntry(entryId), {
          [`projects.${b}.state`]: "building", [`projects.${b}.funded`]: rec.projects[b].cost,
          [`projects.${c}.funded`]: rec.projects[c].cost - 1, [`projects.${a}.funded`]: 0
        });
        const app = BastionSheet.open(entryId);
        app.tab = "projects";
        await app.render({ force: true });
        const order = [...app.element.querySelectorAll("tbody.dxpb-project")].map(el => el.dataset.project).filter(id => ids.includes(id));
        assert.deepEqual(order, [b, c, a], "building, then 1 GP left, then all of it left");
        await app.close();
        await patchRecord(getEntry(entryId), Object.fromEntries(ids.flatMap(id => [[`projects.${id}.state`, "planned"], [`projects.${id}.funded`, 0]])));
        for (const id of ids) await ACTIONS.removeProject({ entryId, projectId: id }, game.user);
      });

      it("the Projects tab sums up what one of every missing building would take", async () => {
        const app = BastionSheet.open(entryId);
        app.tab = "projects";
        await app.render({ force: true });
        const box = app.element.querySelector("details.dxpb-everything");
        assert.ok(box, "the summary is there");
        const rows = [...box.querySelectorAll("tbody tr:not(.dxpb-total)")];
        const total = box.querySelector("tr.dxpb-total").children;
        const num = s => Number(String(s).replace(/[^0-9]/g, "")) || 0;
        assert.equal(rows.reduce((n, r) => n + num(r.children[1].textContent), 0), num(total[1].textContent), "buildings add up");
        assert.equal(rows.reduce((n, r) => n + num(r.children[2].textContent), 0), num(total[2].textContent), "gold adds up");
        assert.equal(rows.reduce((n, r) => n + num(r.children[3].textContent), 0), num(total[3].textContent), "work adds up");
        const built = new Set(Object.values(getRecord(getEntry(entryId)).features).map(f => f.id));
        const missing = [...catalog().values()].filter(e => !e.legacy && !built.has(e.id)).length;
        assert.isAtMost(num(total[1].textContent), missing);
        assert.isAbove(num(total[1].textContent), 0);
        await app.close();
      });

      it("the Set crews picker offers as many crews as the Bastion has; more crews on a project: same cost, less time", async () => {
        const { patchRecord } = await import("../store.js");
        const hiredBefore = getRecord(getEntry(entryId)).garrison?.crews ?? 0;
        let res = await ACTIONS.hireCrews({ entryId, crews: 2, from: "free" }, game.user);
        assert.isTrue(res.ok, res.reason);
        res = await ACTIONS.planProject({ entryId, opts: { expansionId: "chapel" } }, game.user);
        assert.isTrue(res.ok, res.reason);
        const pid = res.projectId;
        const before = getRecord(getEntry(entryId)).projects[pid];
        const app = BastionSheet.open(entryId);
        app.tab = "projects";
        await app.render({ force: true });
        let row = app.element.querySelector(`[data-project="${pid}"]`);
        assert.ok(row, "the project row is on the Projects tab");
        const total = statsFor(getRecord(getEntry(entryId))).stats.crews;
        assert.equal(row.querySelectorAll("[name=crews] option").length, Math.min(total, 1 + rules().maxExtraCrews), "one option per crew");
        row.querySelector("[name=crews]").value = "2";
        row.querySelector("[data-action=construction][data-op=crews]").click();
        let p;
        for (let i = 0; i < 40 && !(p = getRecord(getEntry(entryId)).projects[pid])?.extraCrews; i++) await new Promise(r => setTimeout(r, 50));
        assert.equal(p.extraCrews, 2, "three crews in all were set");
        assert.equal(p.state, "planned", "setting crews doesn't change the project's state");
        assert.equal(p.cost, before.cost, "more crews cost nothing more");
        assert.isAtMost(p.days, Math.ceil(before.days / 3) + 1);
        await app.render({ force: true });
        row = app.element.querySelector(`[data-project="${pid}"]`);
        assert.include(row.textContent, t("Crews.OnProject", { n: 3 }));
        // More crews than the Bastion has are refused.
        res = await ACTIONS.construction({ entryId, projectId: pid, extraCrews: total }, game.user);
        assert.isFalse(res.ok);
        assert.equal(res.code, "tooMany");
        await app.close();
        await ACTIONS.removeProject({ entryId, projectId: pid }, game.user);
        await patchRecord(getEntry(entryId), { "garrison.crews": hiredBefore });
      });

      it("one building crew builds one project at a time; a queued one starts by itself when the crew is free", async () => {
        const { patchRecord } = await import("../store.js");
        const entry = () => getEntry(entryId);
        await patchRecord(entry(), { "garrison.crews": 0 });
        assert.equal(statsFor(getRecord(entry())).stats.crews, 1, "a Bastion starts with one crew");
        const plan = async id => {
          const res = await ACTIONS.planProject({ entryId, opts: { expansionId: id } }, game.user);
          assert.isTrue(res.ok, res.reason);
          const pp = getRecord(entry()).projects[res.projectId];
          await patchRecord(entry(), { [`projects.${res.projectId}.funded`]: pp.cost });
          return res.projectId;
        };
        const a = await plan("chapel");
        const b = await plan("rookery");
        let res = await ACTIONS.construction({ entryId, projectId: a, action: "start" }, game.user);
        assert.isTrue(res.ok, res.reason);
        res = await ACTIONS.construction({ entryId, projectId: b, action: "start" }, game.user);
        assert.isFalse(res.ok, "the only crew is busy");
        assert.equal(res.code, "busy");
        assert.equal(res.reason, t("Notify.Crews.busy"));
        // A second crew on the running project is refused too: none is free.
        res = await ACTIONS.construction({ entryId, projectId: a, extraCrews: 1 }, game.user);
        assert.isFalse(res.ok);
        res = await ACTIONS.construction({ entryId, projectId: b, action: "queue" }, game.user);
        assert.isTrue(res.ok, res.reason);
        assert.equal(getRecord(entry()).projects[b].state, "queued");

        // The counter on the Projects tab: 1 of 1 at work, 1 queued.
        const app = BastionSheet.open(entryId);
        app.tab = "projects";
        await app.render({ force: true });
        const count = app.element.querySelector(".dxpb-crew-count");
        assert.equal(count.dataset.crewsUsed, "1");
        assert.equal(count.dataset.crewsTotal, "1");
        assert.include(app.element.querySelector(`[data-project="${b}"]`).textContent, t("Crews.WaitCrew"));

        // Pausing the chapel frees the crew: the rookery starts by itself.
        res = await ACTIONS.construction({ entryId, projectId: a, action: "pause" }, game.user);
        assert.isTrue(res.ok, res.reason);
        assert.deepEqual(res.started, [b]);
        assert.equal(getRecord(entry()).projects[b].state, "building");
        res = await ACTIONS.construction({ entryId, projectId: a, action: "resume" }, game.user);
        assert.isFalse(res.ok, "the chapel can't resume while the rookery has the crew");

        // Hiring a crew from the treasury lets both run; it costs the hiring fee.
        await patchRecord(entry(), { treasury: (getRecord(entry()).treasury ?? 0) + rules().crewHireCost });
        const gold = getRecord(entry()).treasury;
        app.element.querySelector("[name=crewFrom]").value = "treasury";
        app.element.querySelector("[data-action=hireCrew][data-delta='1']").click();
        for (let i = 0; i < 40 && !getRecord(entry()).garrison?.crews; i++) await new Promise(r => setTimeout(r, 50));
        assert.equal(getRecord(entry()).garrison.crews, 1, "the Hire button hired a crew");
        assert.equal(getRecord(entry()).treasury, gold - rules().crewHireCost);
        res = await ACTIONS.construction({ entryId, projectId: a, action: "resume" }, game.user);
        assert.isTrue(res.ok, res.reason);
        // Both crews are at work: neither can be dismissed.
        res = await ACTIONS.hireCrews({ entryId, crews: 0 }, game.user);
        assert.isFalse(res.ok);

        // The rookery finishes on a turn; the chapel (made long here) goes on; nothing waits.
        await patchRecord(entry(), { [`projects.${b}.progress`]: getRecord(entry()).projects[b].days - 1, [`projects.${a}.days`]: 1000 });
        await runTurn(entry(), { systemAdvance: false });
        const rec = getRecord(entry());
        assert.equal(rec.projects[b].state, "complete");
        assert.equal(rec.projects[a].state, "building");
        await app.close();
        // Clean up: the test rookery and chapel go, and the hired crew.
        const fid = Object.entries(rec.features).find(([, f]) => f.id === "rookery")?.[0];
        await patchRecord(entry(), { [`projects.${a}.state`]: "planned", [`projects.${a}.funded`]: 0, "garrison.crews": 0,
          ...(fid ? { [`features.${fid}`]: undefined } : {}) });
        await ACTIONS.removeProject({ entryId, projectId: a }, game.user);
      });

      it("with the long-rest clock, each party long rest is a day of work; members resting together count once", async () => {
        const { patchRecord } = await import("../store.js");
        await game.settings.set(MODULE_ID, "clock", "rests");
        await game.settings.set(MODULE_ID, "timePrompt", "off");
        try {
          let res = await ACTIONS.planProject({ entryId, opts: { expansionId: "chapel" } }, game.user);
          assert.isTrue(res.ok, res.reason);
          const pid = res.projectId;
          await patchRecord(getEntry(entryId), { [`projects.${pid}.days`]: 4, [`projects.${pid}.funded`]: getRecord(getEntry(entryId)).projects[pid].cost,
            [`projects.${pid}.state`]: "building", [`projects.${pid}.progress`]: 0 });
          const progress = () => getRecord(getEntry(entryId)).projects[pid].progress;
          const count = () => getRecord(getEntry(entryId)).rests?.count ?? 0;
          const waitFor = async (fn) => { for (let i = 0; i < 60 && !fn(); i++) await new Promise(r => setTimeout(r, 50)); };
          const rest = actor => actor.longRest({ dialog: false, chat: false, newDay: false, advanceTime: false });
          const start = count();

          // The sheet counts in long rests now.
          const app = BastionSheet.open(entryId);
          app.tab = "projects";
          await app.render({ force: true });
          const row = app.element.querySelector(`[data-project="${pid}"]`);
          assert.include(row.textContent, t("FinishesRests", { n: 4 }));
          assert.include(row.textContent, `4 ${t("LongRests")}`);
          await app.close();

          await rest(hero);
          await waitFor(() => progress() === 1);
          assert.equal(progress(), 1, "the hero's long rest is a day of work");
          await rest(ally);
          await new Promise(r => setTimeout(r, 400));
          assert.equal(progress(), 1, "the ally resting with the hero is the same rest");
          await rest(hero);
          await waitFor(() => progress() === 2);
          assert.equal(progress(), 2, "the hero resting again is a new rest");
          assert.equal(count() - start, 2);

          // The GM's button counts one by hand; two more finish the chapel.
          res = await ACTIONS.countRest({ entryId }, game.user);
          assert.isTrue(res.counted);
          res = await ACTIONS.countRest({ entryId }, game.user);
          assert.equal(res.completed.map(c => c.projectId)[0], pid);
          assert.equal(getRecord(getEntry(entryId)).projects[pid].state, "complete");
          // Take the test chapel down again so the later tests have the same room.
          await patchRecord(getEntry(entryId), { [`features.${res.completed[0].featureId}`]: undefined });

          // A turn with this clock leaves the building work alone and starts the count of rests again.
          res = await ACTIONS.planProject({ entryId, opts: { expansionId: "rookery" } }, game.user);
          const pid2 = res.projectId;
          await patchRecord(getEntry(entryId), { [`projects.${pid2}.days`]: 3, [`projects.${pid2}.funded`]: getRecord(getEntry(entryId)).projects[pid2].cost,
            [`projects.${pid2}.state`]: "building" });
          await runTurn(getEntry(entryId), { systemAdvance: false });
          const rec = getRecord(getEntry(entryId));
          assert.equal(rec.projects[pid2].progress, 0);
          assert.equal(rec.rests.sinceTurn, 0);
          await patchRecord(getEntry(entryId), { [`projects.${pid2}.state`]: "planned", [`projects.${pid2}.funded`]: 0 });
          await ACTIONS.removeProject({ entryId, projectId: pid2 }, game.user);
        } finally {
          await game.settings.set(MODULE_ID, "clock", "calendar");
          await game.settings.set(MODULE_ID, "timePrompt", saved.timePrompt);
        }
      });

      it("with the long-rest clock the Bastion page shows no dates, only long rests", async () => {
        await game.settings.set(MODULE_ID, "clock", "rests");
        try {
          const rec = getRecord(getEntry(entryId));
          const { patchRecord } = await import("../store.js");
          // Something on every tab that would carry a date: history, a merchant leaving, a finished project.
          const turnTime = rec.turn?.lastTime ?? 0;
          await patchRecord(getEntry(entryId), { merchant: { id: "m", label: "Peddler", arrivedAt: turnTime, leavesAt: turnTime + 3 * 86400, stock: [] } });
          const app = BastionSheet.open(entryId);
          const dates = new Set([formatGameTime(turnTime), formatGameTime(turnTime + 3 * 86400), ...(rec.history ?? []).map(h => formatGameTime(h.time ?? 0))]);
          for (const tab of ["overview", "projects", "trade", "history", "dispatches"]) {
            app.tab = tab;
            await app.render({ force: true });
            for (const d of dates) assert.notInclude(app.element.textContent, d, `${tab}: no date`);
            if (tab === "trade") assert.include(app.element.textContent, t("DueRests", { n: 3 }));
          }
          await app.close();
          await patchRecord(getEntry(entryId), { merchant: null });
        } finally {
          await game.settings.set(MODULE_ID, "clock", "calendar");
        }
      });

      it("the GM's Finish now button finishes a planned project at once; players can't", async () => {
        const res = await ACTIONS.planProject({ entryId, opts: { expansionId: "rookery" } }, game.user);
        assert.isTrue(res.ok, res.reason);
        const pid = res.projectId;
        const app = BastionSheet.open(entryId);
        app.tab = "projects";
        await app.render({ force: true });
        assert.ok(app.element.querySelector(`[data-project="${pid}"] [data-action=finishProject]`), "the GM sees the button");
        await app.close();
        let threw = false;
        try { await ACTIONS.finishProject({ entryId, projectId: pid }, { isGM: false, id: "x", name: "Player" }); } catch { threw = true; }
        assert.isTrue(threw, "players can't");
        const out = await ACTIONS.finishProject({ entryId, projectId: pid }, game.user);
        assert.isTrue(out.ok, out.reason);
        const rec = getRecord(getEntry(entryId));
        assert.equal(rec.projects[pid].state, "complete");
        const fid = out.completed[0].featureId;
        assert.equal(rec.features[fid].id, "rookery");
        const { patchRecord } = await import("../store.js");
        await patchRecord(getEntry(entryId), { [`features.${fid}`]: undefined });
      });

      it("the party queues planned projects and orders them; when one is done the next in the queue starts at once", async () => {
        const { patchRecord } = await import("../store.js");
        const entry = () => getEntry(entryId);
        await patchRecord(entry(), { "garrison.crews": 0 });
        const plan = async id => {
          const res = await ACTIONS.planProject({ entryId, opts: { expansionId: id } }, game.user);
          assert.isTrue(res.ok, `${id}: ${res.reason}`);
          await patchRecord(entry(), { [`projects.${res.projectId}.funded`]: getRecord(entry()).projects[res.projectId].cost });
          return res.projectId;
        };
        const [a, b, c] = [await plan("chapel"), await plan("rookery"), await plan("smokehouse")];
        let res = await ACTIONS.construction({ entryId, projectId: a, action: "start" }, game.user);
        assert.isTrue(res.ok, res.reason);

        const app = BastionSheet.open(entryId);
        app.tab = "projects";
        await app.render({ force: true });
        const click = async (pid, op) => {
          app.element.querySelector(`[data-project="${pid}"] [data-action=queueProject][data-op=${op}]`).click();
          await new Promise(r => setTimeout(r, 300));
          await app.render({ force: true });
        };
        assert.ok(app.element.querySelector(`[data-project="${b}"] [data-action=queueProject][data-op=add]`), "a planned project has a Queue button");
        await click(b, "add");
        await click(c, "add");
        const { queueOrder } = await import("../core/crews.js");
        assert.deepEqual(queueOrder(getRecord(entry()).projects).map(p => p.id), [b, c], "queued in the order they were added");
        assert.include(app.element.querySelector(`[data-project="${b}"]`).textContent, t("BuildQueue.Place", { n: 1 }));
        assert.ok(app.element.querySelector(`[data-project="${b}"] [data-op=up]`).disabled, "the first can't move up");
        await click(c, "up");
        assert.deepEqual(queueOrder(getRecord(entry()).projects).map(p => p.id), [c, b], "the smokehouse moved up");
        const rows = [...app.element.querySelectorAll("tbody.dxpb-project")].map(el => el.dataset.project).filter(id => [a, b, c].includes(id));
        assert.deepEqual(rows, [a, c, b], "the list shows the running project, then the queue in its order");

        // Someone who isn't an owner can't touch the queue.
        let refused = false;
        try { refused = (await ACTIONS.queueProject({ entryId, projectId: b, op: "up" }, { isGM: false, id: "x", name: "Stranger" })).ok === false; }
        catch { refused = true; }
        assert.isTrue(refused);

        // The chapel is done: the smokehouse (first in the queue) starts at once, the rookery waits.
        res = await ACTIONS.finishProject({ entryId, projectId: a }, game.user);
        assert.isTrue(res.ok, res.reason);
        let rec = getRecord(entry());
        assert.equal(rec.projects[c].state, "building");
        assert.equal(rec.projects[b].state, "queued");
        // Taking the rookery out of the queue makes it plain planned again.
        await click(b, "remove");
        assert.equal(getRecord(entry()).projects[b].state, "planned");
        await app.close();

        rec = getRecord(entry());
        const fids = Object.entries(rec.features).filter(([, f]) => f.id === "chapel").map(([fid]) => fid).slice(-1);
        await patchRecord(entry(), Object.fromEntries([
          ...[b, c].flatMap(id => [[`projects.${id}.state`, "planned"], [`projects.${id}.funded`, 0]]),
          ...fids.map(fid => [`features.${fid}`, undefined])
        ]));
        for (const id of [b, c]) await ACTIONS.removeProject({ entryId, projectId: id }, game.user);
      });

      it("the Prices setting re-prices planned projects; gold paid beyond the new price goes into the treasury", async () => {
        const { patchRecord } = await import("../store.js");
        const entry = () => getEntry(entryId);
        const res = await ACTIONS.planProject({ entryId, opts: { expansionId: "chapel" } }, game.user);
        assert.isTrue(res.ok, res.reason);
        const pid = res.projectId;
        const dmgCost = getRecord(entry()).projects[pid].cost;
        const gold = getRecord(entry()).treasury ?? 0;
        try {
          await patchRecord(entry(), { [`projects.${pid}.funded`]: dmgCost });
          assert.equal(rules().crewHireCost, 50, "DMG crew price");
          await game.settings.set(MODULE_ID, "buildPrice", "fair");
          let p;
          for (let i = 0; i < 60 && (p = getRecord(entry()).projects[pid]).price?.scale !== 1.2; i++) await new Promise(r => setTimeout(r, 100));
          assert.equal(p.price?.scale, 1.2, "re-priced at Fair");
          assert.isBelow(p.cost, dmgCost, "cheaper");
          assert.equal(p.funded, p.cost, "paid in full at the new price");
          assert.equal(getRecord(entry()).treasury, gold + dmgCost - p.cost, "the rest went into the treasury");
          assert.equal(rules().crewHireCost, 40, "Fair crew price");
          // The catalog shows the Fair price too.
          const app = BastionSheet.open(entryId);
          app.tab = "projects";
          await app.render({ force: true });
          assert.include(app.element.querySelector(`[data-project="${pid}"]`).textContent, p.cost.toLocaleString());
          await app.close();
          await game.settings.set(MODULE_ID, "buildPrice", "dmg");
          for (let i = 0; i < 60 && getRecord(entry()).projects[pid].price?.scale !== 1; i++) await new Promise(r => setTimeout(r, 100));
          assert.equal(getRecord(entry()).projects[pid].cost, dmgCost, "back at the DMG's price");
        } finally {
          if (game.settings.get(MODULE_ID, "buildPrice") !== "dmg") await game.settings.set(MODULE_ID, "buildPrice", "dmg");
          await patchRecord(entry(), { treasury: gold, [`projects.${pid}.funded`]: 0 });
          await ACTIONS.removeProject({ entryId, projectId: pid }, game.user);
        }
      });

      it("a room with an enlarge project planned shows that instead of its Enlarge button, until the project goes", async () => {
        const { ENLARGE } = await import("../data/catalog.js");
        const rec = getRecord(getEntry(entryId));
        const [fid] = Object.entries(rec.features).find(([, f]) => catalog().get(f.id)?.unit === "sized" && ENLARGE[f.size]) ?? [];
        assert.ok(fid, "the test Bastion has a room that can be enlarged");
        const res = await ACTIONS.planProject({ entryId, opts: { kind: "enlarge", featureId: fid } }, game.user);
        assert.isTrue(res.ok, res.reason);
        const app = BastionSheet.open(entryId);
        app.tab = "projects";
        await app.render({ force: true });
        const button = () => app.element.querySelector(`.dxpb-built [data-action=featureProject][data-kind=enlarge][data-fid="${fid}"]`);
        assert.notExists(button(), "no Enlarge button while the enlarge project is planned");
        const row = app.element.querySelector(`.dxpb-built [data-fid="${fid}"]`)?.closest("tr")
          ?? [...app.element.querySelectorAll(".dxpb-built tr")].find(tr => tr.textContent.includes(t("Busy.enlarge", { state: t("State.planned") })));
        assert.include(row?.textContent ?? "", t("Busy.enlarge", { state: t("State.planned") }));
        await ACTIONS.removeProject({ entryId, projectId: res.projectId }, game.user);
        await app.render({ force: true });
        assert.exists(button(), "the Enlarge button is back");
        await app.close();
      });

      it("finishing a project always redraws the battle map, even one that adds no building to the layout", async () => {
        const { patchRecord } = await import("../store.js");
        if (!mapScene(getRecord(getEntry(entryId)))) await buildMap(getEntry(entryId), { notify: false });
        const before = getRecord(getEntry(entryId)).map?.builtAt ?? 0;
        // The spike barricade is a ring along the wall: no layout item.
        const res = await ACTIONS.planProject({ entryId, opts: { expansionId: "spike-barricade" } }, game.user);
        assert.isTrue(res.ok, res.reason);
        const out = await ACTIONS.finishProject({ entryId, projectId: res.projectId }, game.user);
        assert.isTrue(out.ok, out.reason);
        let after = before;
        for (let i = 0; i < 200 && after === before; i++) {
          await new Promise(r => setTimeout(r, 100));
          after = getRecord(getEntry(entryId)).map?.builtAt ?? 0;
        }
        assert.isAbove(after, before, "the map was redrawn");
        const fid = out.completed[0].featureId;
        await patchRecord(getEntry(entryId), { [`features.${fid}`]: undefined });
        await buildMap(getEntry(entryId), { notify: false });
      });

      it("the GM's Finish all button in the Build header finishes every open project; players can't", async () => {
        const a = await ACTIONS.planProject({ entryId, opts: { expansionId: "rookery" } }, game.user);
        const b = await ACTIONS.planProject({ entryId, opts: { expansionId: "chapel" } }, game.user);
        assert.isTrue(a.ok && b.ok, a.reason ?? b.reason);
        const app = BastionSheet.open(entryId);
        app.tab = "projects";
        await app.render({ force: true });
        assert.ok(app.element.querySelector("thead th.dxpb-th-build [data-action=finishAllProjects]"), "the button sits in the Build header");
        await app.close();
        let threw = false;
        try { await ACTIONS.finishAllProjects({ entryId }, { isGM: false, id: "x", name: "Player" }); } catch { threw = true; }
        assert.isTrue(threw, "players can't");
        const out = await ACTIONS.finishAllProjects({ entryId }, game.user);
        assert.isTrue(out.ok, out.reason);
        const rec = getRecord(getEntry(entryId));
        assert.equal(rec.projects[a.projectId].state, "complete");
        assert.equal(rec.projects[b.projectId].state, "complete");
        assert.isFalse(Object.values(rec.projects).some(p => !["complete", "cancelled"].includes(p.state)), "nothing left open");
        const { patchRecord } = await import("../store.js");
        await patchRecord(getEntry(entryId), Object.fromEntries(out.completed.map(c => [`features.${c.featureId}`, undefined])));
      });

      it("a player can't start construction (GM only)", async () => {
        const fake = { isGM: false, id: "x", name: "Player" };
        let threw = false;
        try { await ACTIONS.construction({ entryId, projectId: "none", action: "start" }, fake); } catch { threw = true; }
        assert.isTrue(threw);
      });

      it("cancelling refunds the payers", async () => {
        const res = await ACTIONS.planProject({ entryId, opts: { expansionId: "chapel" } }, game.user);
        assert.isTrue(res.ok, res.reason);
        const pid = res.projectId;
        const gpBefore = hero.system.currency.gp;
        await ACTIONS.fundProject({ entryId, projectId: pid, amount: 500, actorId: hero.id }, game.user);
        assert.equal(game.actors.get(hero.id).system.currency.gp, gpBefore - 500);
        await ACTIONS.construction({ entryId, projectId: pid, action: "cancel" }, game.user);
        assert.equal(game.actors.get(hero.id).system.currency.gp, gpBefore);
      });

      it("upgrades a tiered revenue building after it is built", async () => {
        const entry = getEntry(entryId);
        const { patchRecord } = await import("../store.js");
        await patchRecord(entry, { "features.testmarket": { id: "market-square", tier: 1 } });
        const res = await ACTIONS.planProject({ entryId, opts: { kind: "upgrade", featureId: "testmarket" } }, game.user);
        assert.isTrue(res.ok, res.reason);
        assert.include(getRecord(entry).projects[res.projectId].label, "Market hall");
      });

      it("sends dispatches: Sending is instant, an envoy takes days by distance", async () => {
        await ACTIONS.setPresence({ entryId, presence: "away" }, game.user);
        const rec = getRecord(getEntry(entryId));
        const facility = hero.itemTypes.facility.find(f => f.system.type.value === "special");
        let res = await ACTIONS.sendDispatch({ entryId, method: "sending", actorId: hero.id, distance: 300,
          orders: [{ type: "facility", facility: facility.uuid, facilityUuid: facility.uuid, facilityName: facility.name, order: "recruit" }] }, game.user);
        assert.isTrue(res.ok, res.reason);
        assert.isTrue(res.instant);
        res = await ACTIONS.sendDispatch({ entryId, method: "envoy", actorId: hero.id, distance: 120, gold: 100, orders: [] }, game.user);
        assert.isTrue(res.ok, res.reason);
        assert.equal(res.arrivesAt - now(), 7 * 86400);
        const report = await runTurn(getEntry(entryId), { systemAdvance: false });
        assert.notEqual(report.mode, "maintain", "the Sending dispatch counts as orders (unless it was lost)");
        void rec;
      });

      it("a turn covers its whole week: an envoy arriving mid-week is delivered", async () => {
        const facility = hero.itemTypes.facility.find(f => f.system.type.value === "special");
        const before = getRecord(getEntry(entryId));
        const due = (before.turn?.lastTime ?? now()) + rules().turnDays * 86400;
        const res = await ACTIONS.sendDispatch({ entryId, method: "envoy", actorId: hero.id, distance: 60,
          orders: [{ type: "facility", facility: facility.uuid, facilityUuid: facility.uuid, facilityName: facility.name, order: "recruit" }] }, game.user);
        assert.isTrue(res.ok, res.reason);
        assert.isAbove(res.arrivesAt, now(), "still on the road");
        assert.isAtMost(res.arrivesAt, due, "arrives before the turn is due");
        const report = await runTurn(getEntry(entryId), { systemAdvance: false });
        const d = getRecord(getEntry(entryId)).dispatches[res.dispatchId ?? res.id];
        if (d) assert.notEqual(d.status, "transit", "the dispatch was delivered or lost, not still on the road");
        assert.equal(getRecord(getEntry(entryId)).turn.lastTime, due, "the turn happened at its due time");
        void report;
      });

      it("away with nothing sent: Maintain and a Bastion event", async () => {
        const report = await runTurn(getEntry(entryId), { systemAdvance: false });
        assert.equal(report.mode, "maintain");
        const rec = getRecord(getEntry(entryId));
        assert.ok(Object.keys(rec.events ?? {}).length >= 1);
      });

      it("applies every one of the 11 Bastion events", async () => {
        for (const e of EVENTS) {
          const entry = getEntry(entryId);
          const record = getRecord(entry);
          const { stats, ctx } = statsFor(record);
          const ev = await applyEvent(entry, record, stats, ctx, { key: e.key, label: e.label, text: e.text, roll: null, source: "test" });
          assert.equal(ev.key, e.key);
        }
        const rec = getRecord(getEntry(entryId));
        assert.ok(rec.people.refugees > 0, "refugees arrived");
        assert.ok((rec.vault ?? []).length >= 2, "discovery and treasure are stored");
      });

      it("event decisions: pay the criminal hireling's bribe", async () => {
        const entry = getEntry(entryId);
        const record = getRecord(entry);
        const { stats, ctx } = statsFor(record);
        const ev = await applyEvent(entry, record, stats, ctx, { key: "criminal", label: "Criminal hireling", text: "", roll: null, source: "test" });
        const before = getRecord(entry).treasury;
        const res = await ACTIONS.resolveEvent({ entryId, eventId: ev.id, choice: "pay" }, game.user);
        assert.isTrue(res.ok, res.reason);
        assert.equal(getRecord(entry).treasury, before - ev.data.bribe);
      });

      it("buying a ware under 1 GP charges its real price", async () => {
        const { patchRecord } = await import("../store.js");
        await ACTIONS.setPresence({ entryId, presence: "present" }, game.user);
        await patchRecord(getEntry(entryId), { merchant: { id: "test", label: "Peddler", arrivedAt: now(), leavesAt: now() + 86400,
          stock: [{ uuid: "", name: "Test sack", img: "", price: 0.2, rarity: "mundane" }] } });
        await ally.update({ "system.currency": { pp: 0, gp: 2, ep: 0, sp: 0, cp: 0 } });
        const res = await ACTIONS.buy({ entryId, index: 0, actorId: ally.id, payFrom: "actor" }, game.user);
        assert.isTrue(res.ok, res.reason);
        const c = game.actors.get(ally.id).system.currency;
        const value = c.pp * 1000 + c.gp * 100 + c.ep * 50 + c.sp * 10 + c.cp;
        assert.equal(value, 180, "2 GP minus 2 SP leaves 1 GP 8 SP");
        assert.isTrue(getRecord(getEntry(entryId)).merchant.stock[0].sold);
        await ally.update({ "system.currency.gp": 5000 });
      });

      it("every ware in the Trade tab opens its item page from the compendium", async () => {
        const { stats } = statsFor(getRecord(getEntry(entryId)));
        const stock = await fillStock({ budget: 2000, rarities: ["mundane", "common"] }, stats);
        assert.ok(stock.length, "the compendia have wares");
        const { patchRecord } = await import("../store.js");
        await patchRecord(getEntry(entryId), { merchant: { id: "test", label: "Peddler", arrivedAt: now(), leavesAt: now() + 86400, stock } });
        const app = BastionSheet.open(entryId);
        app.tab = "trade";
        await app.render({ force: true });
        const links = app.element.querySelectorAll("a.dxpb-ware[data-action=viewWare]");
        assert.equal(links.length, stock.length, "every ware is a link");
        links[0].click();
        // A compendium document can come back as a new object each time: look for any open page of it.
        const opened = () => [...foundry.applications.instances.values()].find(a => a.document?.uuid === stock[0].uuid && a.rendered);
        for (let i = 0; i < 100 && !opened(); i++) await new Promise(r => setTimeout(r, 50));
        assert.ok(opened(), `${stock[0].name}'s page opened`);
        await opened().close();
        await app.close();
        await patchRecord(getEntry(entryId), { merchant: null });
      });

      it("fills a merchant's stock within budget", async () => {
        const { stats } = statsFor(getRecord(getEntry(entryId)));
        const stock = await fillStock({ budget: 1000, rarities: ["mundane", "common"] }, stats);
        const total = stock.reduce((n, w) => n + w.price, 0);
        assert.ok(total <= 1000);
      });

      it("runs a live siege day by day", async () => {
        let res = await ACTIONS.startSiege({ entryId, forceKey: "warband" }, game.user);
        assert.isTrue(res.ok);
        res = await ACTIONS.siegeDay({ entryId }, game.user);
        assert.isTrue(res.ok);
        const s = getRecord(getEntry(entryId)).siege;
        assert.equal(s.day, 1);
        assert.isBelow(s.integrity, 160);
        await ACTIONS.endSiege({ entryId }, game.user);
        assert.isNull(getRecord(getEntry(entryId)).siege);
      });

      it("pays the party's dividend split between the owners", async () => {
        const { patchRecord } = await import("../store.js");
        await patchRecord(getEntry(entryId), { dividends: 101 });
        const h = game.actors.get(hero.id).system.currency.gp;
        const a = game.actors.get(ally.id).system.currency.gp;
        const res = await ACTIONS.claimDividend({ entryId }, game.user);
        assert.isTrue(res.ok);
        assert.equal(game.actors.get(hero.id).system.currency.gp, h + 50);
        assert.equal(game.actors.get(ally.id).system.currency.gp, a + 50);
        assert.equal(getRecord(getEntry(entryId)).dividends, 0);
      });

      it("renders every tab of the Bastion page, the wizard steps and the dashboard", async () => {
        const app = BastionSheet.open(entryId);
        await app.render({ force: true });
        for (const tab of ["stats", "defense", "facilities", "projects", "dispatches", "trade", "history", "overview"]) {
          // Click the real tab link, the way a user does.
          app.element.querySelector(`.dxpb-tab[data-tab="${tab}"]`).click();
          for (let i = 0; i < 60 && app.element.querySelector(".dxpb-tab.active")?.dataset.tab !== tab; i++) {
            await new Promise(r => setTimeout(r, 50));
          }
          assert.equal(app.element.querySelector(".dxpb-tab.active")?.dataset.tab, tab, `clicking the ${tab} tab`);
        }
        await app.close();
        const wiz = new FoundingWizard();
        for (let i = 0; i < 6; i++) {
          wiz.step = i;
          await wiz.render({ force: true });
          assert.ok(wiz.element.querySelector(".dxpb-steps li.active"), `step ${i}`);
        }
        await wiz.close();
        const dash = new BastionDashboard();
        await dash.render({ force: true });
        assert.ok(dash.element.querySelector(`[data-id="${entryId}"]`));
        await dash.close();
      });

      it("the house-rules window scrolls and downloads the default and in-use rules and catalog as JSON", async () => {
        const { RulesConfig } = await import("../apps/settings-apps.js");
        const { DEFAULT_RULES } = await import("../data/rules.js");
        const app = new RulesConfig();
        await app.render({ force: true });
        const body = app.element.querySelector(".dxpb-rules-body");
        assert.ok(body, "the body is there");
        assert.include(["auto", "scroll"], getComputedStyle(body).overflowY, "the body scrolls");
        app.element.querySelectorAll("details").forEach(d => { d.open = true; });
        assert.isAbove(body.scrollHeight, body.clientHeight, "with the defaults open there is more than fits: it scrolls");
        assert.ok(app.element.querySelector("button[type=submit]").getBoundingClientRect().bottom <= app.element.getBoundingClientRect().bottom + 1,
          "Save stays in the window");
        const saved = [];
        const orig = RulesConfig.saveFile;
        RulesConfig.saveFile = (data, type, name) => saved.push({ data, type, name });
        try {
          for (const file of ["default-rules", "rules-in-use", "default-catalog", "catalog-in-use"]) {
            app.element.querySelector(`[data-action=download][data-file="${file}"]`).click();
          }
        } finally { RulesConfig.saveFile = orig; }
        assert.equal(saved.length, 4);
        assert.deepEqual(JSON.parse(saved[0].data), JSON.parse(JSON.stringify(DEFAULT_RULES)), "the default rules, every key");
        assert.equal(saved[0].type, "application/json");
        assert.match(saved[0].name, /\.json$/);
        assert.deepEqual(JSON.parse(saved[1].data).price, rules().price, "the rules in use carry the Prices setting");
        assert.ok(JSON.parse(saved[2].data).chapel, "the default catalog, keyed by id");
        assert.ok(JSON.parse(saved[3].data).bedroom);
        await app.close();
      });

      it("the Bastions have a scene-control group of their own, after Journal Notes, that opens the list", async () => {
        await ui.controls.render({ reset: true });
        const controls = ui.controls.controls;
        const group = controls.dxpbBastions;
        assert.ok(group, "the Bastions group is there");
        assert.notOk(controls.notes?.tools?.dxpbBastions, "no longer under Journal Notes");
        if (controls.notes) assert.equal(group.order, controls.notes.order + 1, "right after Journal Notes");
        const orders = Object.values(controls).map(c => c.order);
        assert.equal(new Set(orders).size, orders.length, "no two groups share a place");
        assert.ok(group.tools.list?.button && group.tools.found?.button, "list and found buttons");
        assert.notOk(group.tools.mine, "players find their Bastion in their character sheet, not here");
        assert.ok(canvas.dxpbBastions, "the group has its own canvas layer");
        const btn = document.querySelector('#scene-controls [data-control="dxpbBastions"]');
        assert.ok(btn, "the group's button is on the screen");
        // Clicking the group must keep it the active group (on the token layer it fell back to the Token group).
        btn.click();
        for (let i = 0; i < 40 && ui.controls.control?.name !== "dxpbBastions"; i++) await new Promise(r => setTimeout(r, 50));
        await new Promise(r => setTimeout(r, 200));
        assert.equal(ui.controls.control?.name, "dxpbBastions", "the Bastions group stays open");
        assert.ok(document.querySelector('#scene-controls [data-tool="list"]'), "its tools are shown");
        ui.controls.activate({ control: "tokens" });
        group.tools.list.onChange();
        let dash;
        for (let i = 0; i < 40 && !(dash = [...foundry.applications.instances.values()].find(a => a instanceof BastionDashboard && a.rendered)); i++) {
          await new Promise(r => setTimeout(r, 50));
        }
        assert.ok(dash, "the list opened");
        await dash.close();
      });

      it("registers with Dxcufgb's Debug Recorder: a snapshot without names, and breadcrumbs only while recording", async () => {
        const { debugSnapshot } = await import("../debug-snapshot.js");
        const rec = await import("../debug-recorder.js");
        const snap = debugSnapshot();
        const json = JSON.stringify(snap);
        assert.isAtLeast(snap.bastions.total, 1);
        const mine = snap.bastions.list.find(b => b.docId === entryId);
        assert.ok(mine, "the test Bastion is in the snapshot by its document id");
        assert.ok(mine.statsOk);
        assert.isObject(mine.projects);
        assert.isObject(mine.crews);
        // Nothing private: no Bastion, character, place or user names, no image paths or URLs.
        const record = getRecord(getEntry(entryId));
        for (const text of [record.name, hero.name, ally.name, game.user.name, record.location?.settlement?.name, "modules/", "http"]) {
          if (text) assert.notInclude(json, text, `the snapshot doesn't hold "${text}"`);
        }
        const recorderMod = game.modules.get("dxcufgbs-debug-recorder");
        if (recorderMod?.active && recorderMod.api) assert.isTrue(rec.recorderConnected(), "registered with the installed recorder");

        // A stand-in recorder through the module's own registration path (the real one, if any, is put back after).
        const got = { registered: null, crumbs: [] };
        let recording = false;
        const fake = {
          register: (id, opts) => { got.registered = { id, snapshot: opts?.snapshot }; return true; },
          isRecording: () => recording,
          breadcrumb: (id, key, data) => got.crumbs.push({ id, key, data })
        };
        const restore = rec.testing.swap(fake);
        try {
          assert.equal(got.registered?.id, MODULE_ID, "registers under the module id");
          assert.equal(typeof got.registered.snapshot(), "object");
          const { request } = await import("../socket.js");
          await request("updateRecord", { entryId, changes: {} });
          assert.equal(got.crumbs.length, 0, "nothing while not recording");
          recording = true;
          await request("updateRecord", { entryId, changes: {} });
          const run = got.crumbs.find(c => c.key === "action.run");
          assert.ok(run, "an action leaves a breadcrumb while recording");
          assert.equal(run.id, MODULE_ID);
          // Exactly these fields, of these types: no room for a name.
          assert.sameMembers(Object.keys(run.data), ["action", "ok", "ms", "relayed", "byGM"]);
          assert.equal(run.data.action, "updateRecord");
          assert.isBoolean(run.data.ok);
          assert.isNumber(run.data.ms);
          assert.isBoolean(run.data.relayed);
          assert.isBoolean(run.data.byGM);
          const crumbs = JSON.stringify(got.crumbs);
          for (const text of [record.name, game.user.name]) assert.notInclude(crumbs, text);
          // Error codes stay short fixed codes.
          rec.noteError("self test: <code>");
          const err = got.crumbs.find(c => c.key === "error.caught");
          assert.equal(err.data.code, "selftestcode", "only letters, digits, dots and dashes stay");
        } finally {
          recording = false;
          restore();
        }
      });

      it("the holdout API answers for a preset force", () => {
        const api = game.modules.get(MODULE_ID)?.api ?? globalThis.DxcufgbsPlayerBastions;
        const h = api.siegeHoldout(entryId, "bandits");
        assert.ok(h.days > 0);
        assert.ok(FORCES.bandits);
      });

      it("lists the Bastion among all Bastions", () => {
        assert.ok(allBastions().some(e => e.id === entryId));
        void catalog;
      });

      it("the GM deletes a Bastion only after typing DELETE: record, marker, battle map and room facilities go", async () => {
        const res = await ACTIONS.found({ answers: {
          name: `${PREFIX} Doomed`, description: "Test", groupUuid: group.uuid, ownerUuids: [],
          location: { terrain: "hills", site: "hilltop", settlement: { name: "Town", size: "village", distance: 20 }, road: "trail",
            waterway: "river", waterOnSite: "table", climate: "temperate", land: "fertile", resources: ["stone"],
            danger: "frontier", visibility: "ordinary", political: "freehold" },
          structure: { type: "keep", acquisition: "reward" }, included: [], food: 100, treasury: 100, guards: 0, servants: 0,
          marker: { sceneUuid: scene.uuid, x: 1400, y: 1400 }
        } }, game.user);
        assert.isTrue(res.ok, res.reason);
        const id = res.entryId;
        made.entries.push(id);
        const noteId = getRecord(getEntry(id)).marker.noteId;
        const mapScene = await buildMap(getEntry(id), { notify: false });
        if (mapScene) made.scenes.push(mapScene.id);
        const [room] = await hero.createEmbeddedDocuments("Item", [{ name: "DXPB Test room", type: "facility",
          system: { type: { value: "basic" } }, flags: { [MODULE_ID]: { entryId: id, featureId: "x" } } }]);

        // Not without the word, and players never.
        assert.isFalse((await ACTIONS.deleteBastion({ entryId: id }, game.user)).ok);
        assert.isFalse((await ACTIONS.deleteBastion({ entryId: id, confirm: "delete" }, game.user)).ok);
        let threw = false;
        try { await ACTIONS.deleteBastion({ entryId: id, confirm: "DELETE" }, { isGM: false, id: "x", name: "Player" }); } catch { threw = true; }
        assert.isTrue(threw);
        assert.ok(getEntry(id), "still there");

        // The button on the page opens the dialog; Delete stays off until DELETE is typed.
        const app = BastionSheet.open(id);
        app.tab = "overview";
        await app.render({ force: true });
        app.element.querySelector("[data-action=deleteBastion]").click();
        let dialog;
        for (let i = 0; i < 40 && !(dialog = document.querySelector(".dxpb-delete-dialog")); i++) await new Promise(r => setTimeout(r, 50));
        assert.ok(dialog, "the dialog opened");
        assert.include(dialog.textContent, t("Delete.Warning", { name: `${PREFIX} Doomed` }));
        const input = dialog.querySelector("input[name=confirm]");
        const del = dialog.querySelector("button[data-action=delete]");
        assert.isTrue(del.disabled, "off at first");
        input.value = "delete"; input.dispatchEvent(new Event("input"));
        assert.isTrue(del.disabled, "lower case doesn't count");
        input.value = "DELETE"; input.dispatchEvent(new Event("input"));
        assert.isFalse(del.disabled, "on once DELETE is typed");
        del.click();
        for (let i = 0; i < 60 && getEntry(id); i++) await new Promise(r => setTimeout(r, 50));
        assert.notOk(getEntry(id), "the record is gone");
        assert.notOk(scene.notes.get(noteId), "the marker is gone");
        if (mapScene) assert.notOk(game.scenes.get(mapScene.id), "the battle map is gone");
        assert.notOk(hero.items.get(room.id), "the room facility is gone");
        assert.notOk(BastionSheet.instances.get?.(id)?.rendered, "the page closed");
      });

      it("an open Bastion list shows a new Bastion as soon as it is founded and drops it as soon as it is deleted", async () => {
        const dash = new BastionDashboard();
        await dash.render({ force: true });
        const row = id => dash.element?.querySelector(`[data-id="${id}"]`);
        const waitFor = async test => { for (let i = 0; i < 60 && !test(); i++) await new Promise(r => setTimeout(r, 50)); return test(); };
        const res = await ACTIONS.found({ answers: {
          name: `${PREFIX} Listed`, description: "Test", groupUuid: group.uuid, ownerUuids: [],
          location: { terrain: "hills", site: "hilltop", settlement: { name: "Town", size: "village", distance: 20 }, road: "trail",
            waterway: "river", waterOnSite: "table", climate: "temperate", land: "fertile", resources: ["stone"],
            danger: "frontier", visibility: "ordinary", political: "freehold" },
          structure: { type: "keep", acquisition: "reward" }, included: [], food: 100, treasury: 100, guards: 0, servants: 0
        } }, game.user);
        assert.isTrue(res.ok, res.reason);
        made.entries.push(res.entryId);
        assert.ok(await waitFor(() => row(res.entryId)), "the new Bastion is in the list without reopening it");
        const del = await ACTIONS.deleteBastion({ entryId: res.entryId, confirm: "DELETE" }, game.user);
        assert.isTrue(del.ok, del.reason);
        assert.ok(await waitFor(() => !row(res.entryId)), "the deleted Bastion left the list");
        assert.ok(row(entryId), "the others are still listed");
        await dash.close();
      });
    });
  }, { displayName: "Player Bastions: inside Foundry" });
}

/** Runs the tests: Quench when it's active, otherwise the engine tests with a small built-in runner. */
export async function runSelfTests() {
  const quench = globalThis.quench;
  if (quench) {
    quench.app?.render?.(true);
    return quench.runBatches([`${MODULE_ID}.**`]);
  }
  const tests = [];
  const stack = [];
  const assert = {
    equal: (a, b, m) => { if (a != b) throw new Error(m ?? `${a} != ${b}`); },
    strictEqual: (a, b, m) => { if (a !== b) throw new Error(m ?? `${a} !== ${b}`); },
    deepEqual: (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? "not deep equal"); },
    ok: (v, m) => { if (!v) throw new Error(m ?? "not ok"); },
    isTrue: (v, m) => { if (v !== true) throw new Error(m ?? `${v} is not true`); },
    isFalse: (v, m) => { if (v !== false) throw new Error(m ?? `${v} is not false`); },
    closeTo: (a, b, d, m) => { if (Math.abs(a - b) > d) throw new Error(m ?? `${a} not near ${b}`); },
    include: (h, n, m) => { if (!h.includes(n)) throw new Error(m ?? `${n} missing`); }
  };
  registerCoreTests({ describe: (n, fn) => { stack.push(n); fn(); stack.pop(); }, it: (n, fn) => tests.push({ n: [...stack, n].join(" › "), fn }), assert });
  const fails = [];
  for (const test of tests) {
    try { await test.fn(); } catch (err) { fails.push(`${test.n}: ${err.message}`); }
  }
  const content = `<p>${t("SelfTest.Result", { pass: tests.length - fails.length, total: tests.length })}</p>${fails.length
    ? `<ul>${fails.map(f => `<li>${escapeHTML(f)}</li>`).join("")}</ul>` : ""}<p class="dxpb-muted">${t("SelfTest.QuenchHint")}</p>`;
  foundry.applications.api.DialogV2.prompt({ window: { title: t("SelfTest.Title") }, content });
  return { total: tests.length, failed: fails };
}
