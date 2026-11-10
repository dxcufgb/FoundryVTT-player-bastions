# Dxcufgb's Player Bastions

FoundryVTT v13 module (id `dxcufgbs-player-bastions`), dnd5e 5.2.5+. Builds on the system's Bastion (`facility` items,
`dnd5e.bastion`); never changes the system's data shapes. No build step, no npm dependencies.

Repo `dxcufgb/FoundryVTT-player-bastions`. `main` is protected: work on `feature/<name>` branches and pull requests.
CI (`.github/workflows/ci.yml`, job "Check module") calls `dxcufgb/foundry-module-ci`; `.github/foundry-module.json`
runs `node tests/run-node.mjs` as the lint step and lists what goes into `module.zip` (`tests/`, `CLAUDE.md` and
`.push/` stay out). Release: Actions → "Release module" with the version; `CHANGELOG.md` needs a section for it.
The module id was `dxcufgbs-player-bastion` before the first release (development worlds only).

## Layout
- `scripts/data/` – pure data: `location.js` (wizard questions and effects), `structures.js`, `catalog.js` (69 expansions plus legacy wall entries,
  tiers, `ENLARGE`), `tables.js` (dispatch methods, forces, merchant tiers, visitors, fallback events, guests, treasure),
  `rules.js` (every number, `mergeRules`), `grounds.js` (grounds sizes, footprint per expansion, wall layers),
  `map-style.js` (textures by terrain, floors and furnishings by building, wall-band crops).
- `scripts/core/` – the pure engine (no Foundry globals; Node-testable): `catalog.js` (overrides, prerequisites,
  `featureEffects`, road tier), `stats.js` (`computeStats` with breakdowns), `siege.js` (holdout model, live siege day),
  `projects.js` (quote, plan, fund, transitions, refunds, progress, completion), `dispatch.js`, `visitors.js`,
  `turn.js` (`advanceTurn`), `record.js` (`createRecord`), `grounds.js` (room used, held and free; `extendGroundsBase`),
  `coins.js` (`payFromPurse`), `layout.js` (`syncLayout`: where each building stands, `record.layout`),
  `mapplan.js` (`mapPlan`: the battle map as geometry: rings, roads, furnished buildings, Foundry wall segments),
  `index.js` (api.core).
- `scripts/store.js` – one JournalEntry per Bastion, record in `flags.dxcufgbs-player-bastions.record`; owners' players
  get Observer; every write is a dot-path update by the responsible GM (`patchRecord`, `writeRecordKeys`).
- `scripts/context.js` – reads DMG defenders/hirelings/Armory/War Room/Teleportation Circle from the owners' facilities.
- `scripts/actions.js` – every state change, run on the GM (players relayed by `socket.js`), each re-checking rights.
- `scripts/turn-runner.js` – a turn: pure `advanceTurn`, rooms → dnd5e basic facility items, merchant stock,
  `dnd5e.bastion.advanceAllFacilities`, neglect, DMG event, restore idled facilities, summary card, `postTurn` hook.
- `scripts/events.js` – the 11 DMG events (DMG roll table if found, else module table) with decision buttons.
- `scripts/map-render.js` – paints a map plan on any 2D canvas (browser or Node); `scripts/map.js` – Foundry side:
  paint, upload to `worlds/<world>/bastions/`, create/update the scene, replace our flagged walls, redraw hooks.
- `scripts/marker.js` – Note marker, scene distances, nearby map notes, party position, map click picker.
- `scripts/apps/` – `BastionSheet` (8 tabs), `FoundingWizard` (6 steps, also edit), `BastionDashboard`, settings apps.
- `scripts/tests/` – `core-tests.js` (shared engine tests), `quench.js` (Quench batches + built-in runner); `tests/run-node.mjs`.

## Invariants
- Facilities stay native dnd5e items; module data only in its flags and its own journals.
- Players never write the record; the GM side checks `canAct` / GM-only on every action.
- Room and stone-wall prices are the DMG's; everything else is this module's design. Never copy DMG text.
- The worked example (hilltop keep) must keep giving 212 / 63 / 160 / 65 and the plan's holdout table (tests check it).
- Don't name an ApplicationV2 action `tab` (Foundry reserves it); free-text inputs without a `name` must not re-render on change.
- A turn's time is `turnDueTime(record)` (last turn + turn length), not the world clock.
- Two clocks (`clockMode()` in util.js, "Bastion clock" setting): "calendar" (projects move in the turn) and "rests"
  (auto when no calendar module is active). With "rests", `dnd5e.restCompleted` → `longRest` action → `runRest`
  (turn-runner.js): `countRest` (core/rests.js, members within 30 min count once) and `workDays(record, 1)`
  (core/turn.js); the turn runs with `skipProjects` and resets `rests.sinceTurn`. World-time turns are off then.
- Build queue: `queueProject` action (owners): add (planned → queued at the end), remove (`unqueue` transition),
  up/down/first/last. Started projects drop `queuePos`; requeued ones (over the crew count) go to the head.
  Partial `dxpbQueueButtons` (templates/queue-buttons.hbs, loaded in main.js onInit).
- Map redraws go through `queueMapRefresh(entry)` (map.js): one at a time per Bastion, a request while one runs
  makes one more after. `.projectFinished` always redraws; `.postTurn` / `.restCounted` when anything completed.
- Building crews (core/crews.js): `stats.crews` = 1 + `record.garrison.crews` (hired, `hireCrews` action) + `fx.crews`
  (Workers' Lodge). A project holds `projectTeams(p)` = 1 + extraCrews only while "building". `quote()` divides days
  by the project's own crews (not the Bastion's). `construction` checks `canAssign` on start/resume/crews; after any
  change `startWaiting` (actions.js) runs `assignCrews`, which starts queued projects (the party's order: `queuePos`, see `queueOrder` / `nextQueuePos` / `moveInQueue`; then queuedAt; funded unless
  pay-as-you-build) and requeues the latest-started when over the count. `workDays(record, days, { crews })` goes day
  by day and reassigns after completions; the turn passes `stats.crews`, `finishProject` passes none.
- Prices (core/price.js): `priceGp(base, rules.price)` on the per-unit base price in `quote()` (and per square in
  `extendGroundsBase`, so grounds aren't priced twice). The `buildPrice` setting (fair default) sets `rules.price`,
  `crewHireCost`, `crewUpkeep` in util `rules()` unless house rules set them. Projects store `price`;
  `repriceBastion` (main.js, run from `repaceAll`) re-quotes planned/queued ones and puts surplus funding in the treasury.
- Build pace: `paceDays` (core/projects.js) applies `rules.pace` to base days inside `quote()`; the "Build pace"
  setting sets `rules().pace` unless the house rules set `pace`. DEFAULT_RULES keeps the DMG pace so the engine tests
  check DMG numbers; the module's default setting is "adventure".
- Walls: no structure brings a wall. One expansion `wall` with `tiers` (palisade → stone → reinforced → wall walk;
  each tier has its own `material`), upgrades priced per square × the wall's count in `quote()`; only one wall can be
  built. `palisade`, `stone-wall`, `reinforce-wall`, `wall-walk` are `legacy: true` (not plannable, hidden);
  `foldLegacyWalls` (core/projects.js, run on ready) folds old saves into one `wall` at the highest tier
  (LEGACY_WALL_TIER), `applyCompletion` raises the existing wall for a wall/legacy build. Stats read the wall type
  from `featureEffects` (tier-aware). `once: true` rings (wall, spike-barricade) are built once and listed in WALL_LAYERS so extensions lengthen them.
  Map: wall ring at 1 square out, spikes at 2, ditch or moat at `moatD` 4.
- `record.mapGround` (MAP_GROUNDS in data/map-style.js) overrides the map's ground, bailey and dressing terrain in
  `mapPlan`; `updateRecord` fires `.mapLookChanged` (map.js redraws) when it or the terrain changes.
- The first watchtower is a `where: "centre"` fixture (4 × 4 at -2,-2; CENTRE_TOWER_EXTRA squares in `spaceUsed`);
  `syncLayout` re-places stored buildings that sit on any fixture. `mapPlan` adds an octagon of Foundry walls
  (`tower: true`) with a door on the south side.
- Structures have no `features`: `firstBuilding(answers)` (data/structures.js) gives the ONE founding building
  (`answers.first`: a FIRST_BUILDINGS key or a feature; else the structure's `first`). Engine tests found the old keep
  with OLD_KEEP_FIRST + OLD_KEEP_REST.
- No wall (`isWalled`, core/layout.js): extra watchtowers become layout items of kind "tower" (key `fid#i`), drawn as
  `where: "free"` fixtures; no wall clutter.
- Quench tests set the clock to "calendar" in `before()` and restore the GM's settings in `after()`.
- Layout coordinates are squares from the centre of the grounds (every grounds side is even), so extending never moves
  a building. A stored placement is never moved; only a building that grew may relocate (`moved: true`).
- `turn-runner.js` KEYS lists every top-level record key a turn may change; a key missing there is silently lost.
- Map art lives in `assets/map/tex` (tileable, 512 px, one tile = 4 squares unless `TILE_OVERRIDE`) and
  `assets/map/props` (transparent, cropped, back of the object at the top of the picture).

## Testing in a running world
A module folder added while Foundry runs isn't registered until the server restarts. To test without a restart, as GM:
`await import("/modules/dxcufgbs-player-bastions/scripts/main.js?v=" + Date.now())` — the late-boot block in `main.js`
loads the language file, the CSS, the flag scope and the Quench batches. Then `quench.runBatches(["dxcufgbs-player-bastions.**"])`.
