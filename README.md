# Dxcufgb's Player Bastions

[![Foundry v13](https://img.shields.io/github/v/release/dxcufgb/FoundryVTT-player-bastions?label=Foundry%20v13&logo=foundryvirtualtabletop&color=ff6400)](https://github.com/dxcufgb/FoundryVTT-player-bastions/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/dxcufgb/FoundryVTT-player-bastions/module.zip?label=downloads&color=blue)](https://github.com/dxcufgb/FoundryVTT-player-bastions/releases)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/dxcufgb)\
[![CI](https://img.shields.io/github/actions/workflow/status/dxcufgb/FoundryVTT-player-bastions/ci.yml?branch=main&label=CI)](https://github.com/dxcufgb/FoundryVTT-player-bastions/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/dxcufgb/FoundryVTT-player-bastions)](LICENSE)
[![System dnd5e](https://img.shields.io/badge/system-dnd5e%205.2.5%2B-8a5cf6)](https://foundryvtt.com/packages/dnd5e)

<a href="https://dxcufgb.github.io/FVTT-dev-showcase/"><img src="https://dxcufgb.github.io/FVTT-dev-showcase/assets/img/workshop-badge.png" alt="Dxcufgb's Workshop: every Foundry VTT project, video and changelog in one place" width="650"></a>

The party's Bastion as a place on the map, built on top of the dnd5e system's own Bastion (2024 DMG). The GM founds it with a marker on a map and a few questions about the site; the Bastion page turns its stats into numbers you can feel: how many days it holds against a given assault, how long the food lasts, how often merchants come, how long a letter takes to get home.

**Foundry VTT:** v13 · **System:** dnd5e 5.2.5+

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this link into **Manifest URL** at the bottom, and click **Install**:

```
https://github.com/dxcufgb/FoundryVTT-player-bastions/releases/latest/download/module.json
```

Then enable **Dxcufgb's Player Bastions** in your dnd5e world. [Quench](https://github.com/Ethaks/FVTT-Quench) is optional: with it, the module's self-tests run inside Foundry.

## Features

- **Founding wizard (GM):** owners (the party's dnd5e Group), a map marker on any scene (the Faerûn map is picked by default; nearby map notes become the nearest settlement with the distance measured), twelve location questions, eight structures (each with its own effects and upkeep), ONE first building picked in the Structure step (cottage, house, large house, hall, tower or chapel; the structure suggests one), and the rest of the first build in its own step. Every Bastion starts without a wall round its grounds, whatever the structure (only a cave keeps its rock, which is the cave itself); the wall is built as a project.
- **Bastion page:** overview with the Bastion's picture (the terrain or site art, or any image the GM picks), stats with tangible numbers, defense with the siege table and calculator, the dnd5e facilities, projects and the catalog, dispatches, trade, history.
- **Grounds:** five sizes, from a Plot (16 × 16 squares) to a Citadel (60 × 60). Every building takes room inside the walls (rooms use the DMG's 4 / 16 / 36 squares; fields, roads and mines lie outside). When the grounds are full, the party extends them before building or enlarging anything inside: new land plus every built wall layer lengthened to the new perimeter.
- **Walls:** one Wall round the grounds, built as a timber Palisade (closed all round: garrison x2, Integrity 40) and upgraded in place: Stone wall (x4, Integrity 120), Reinforced (x5, Integrity 200), then Wall Walk and Crenellations (defense x1.05). Each step is priced per square along the whole wall; the palisade is timber (a lumber camp helps), the stone steps stone (a quarry helps). A Spike Barricade (once, after the wall) rings the foot of the wall, outside it and inside any ditch or moat: defense x1.05, light engines -10 %. A ditch or moat lies outside it all. Extending the grounds lengthens the wall at every step it has and the spike barricade, and digs the ditch or moat out to the new line, so the more the wall has been upgraded, the longer and dearer extending is.
- **One of everything:** the Projects tab sums up the gold and long rests one of every building still missing would take (smallest rooms, the wall round as a palisade, a road to the settlement; today's prices, one crew, one after another), by group and in all.
- **Battle map road:** the road the location has (none, trail, road or highway) runs in from the map's edge; until there is a wall it simply carries on into the grounds, and only inside a wall is the way to the door paved.
- **Battle map ground:** the founding (and edit) wizard's structure step has "Battle map ground" tiles: Automatic (by terrain) or grass, dirt, mud, sand, snow, cobblestone, cave floor or bright rock, whatever the other answers. The pick paints the ground inside and outside the walls, and the trees, rocks and the like follow it; changing it redraws an existing battle map.
- **Battle map (GM):** one button draws the Bastion as a battle-map scene: the first watchtower stands in the middle of the grounds (4 × 4 squares, with Foundry walls and a door facing the road; more towers go on the corners); no wall ring until the wall is built; then the palisade or stone wall (buttresses once reinforced, crenellations with the wall walk) with corner towers, gatehouse (a timber gate without one) and ballistae, crossed stakes of the spike barricade at its foot, and the ditch or moat with a bridge outside it, every building with its walls, doors and furnishings, keep rooms joined into one block, yards and gardens in the open. Foundry walls and doors come with it. Buildings keep their place when more are built or the grounds are extended; the walls move out with the grounds. Once the map exists it is redrawn whenever a project finishes (on a turn, a long rest, Finish now or Finish all), and breaches show in the wall during a siege. Art: tileable textures and top-down props made with ElevenLabs (GPT Image); anything without art is drawn with a plain stand-in.
- **Projects:** 71 expansions (rooms and stone walls at DMG prices; times at the build pace below); players plan and pay and put projects in the party's build queue, only the GM starts, pauses, queues, re-crews, cancels or finishes a project at once ("Finish now", or "Finish all" in the Build header for every unfinished project). Revenue buildings have tiers and can make the Bastion pay for itself and then pay the party a dividend.
- **Bastion list:** the **Bastions** group in the scene controls (the rook, right after Journal Notes) has buttons for the list of Bastions, the player's own Bastion and (GM) founding one; the Journal sidebar has a Bastions button too. An open list updates by itself when a Bastion is founded, changed or deleted, for every player.
- **Deleting:** the GM's red "Delete Bastion" button on the Overview tab asks you to type DELETE, then removes the Bastion for good: its record, world-map marker, battle map scene and the room facilities it added to the characters (the battle map's image file stays in `worlds/<world>/bastions/`).
- **Build queue:** the party puts planned projects in a queue (Queue button) and orders it with the arrows; queued projects start by themselves, in that order, the moment a crew is free and they are paid for, so the next one starts as soon as one is done. A queued project that isn't paid for yet lets the next one go first. The list shows running projects, then the queue ("Queued #1", "#2" ...), then the rest of the plans.
- **Built list:** a building with a project planned or under way (enlarge, upgrade, repair) shows "Enlarging: Planned" (and so on) instead of its buttons, so it can't be planned twice.
- **Building crews:** a Bastion starts with one building crew, so it builds one project at a time. The party hires more on the Projects tab (40 GP each and 8 GP upkeep a turn at Fair prices; up to 4, paid from the treasury or a character) and each Workers' Lodge brings one with no upkeep. A counter shows the crews at work of the total. A project takes one crew or more (more crews, the same price and less time), and no more crews can be at work than the Bastion has: a project only starts or takes more crews when they are free. A queued project waits for a free crew and starts by itself when one comes free, in the build queue's order. Crews at work can't be dismissed. House rules: `crewHireCost`, `crewUpkeep`, `maxHiredCrews`, `maxExtraCrews`, `extraCrewCostPct` (a surcharge per extra crew, 0 by default).
- **Prices:** a "Prices" setting picks how much building costs. **Fair** (the default) takes a little off the book's prices, more off the dearest works; **Thrifty** takes more off; **DMG** keeps the book's. Small jobs keep their price. Planned projects are re-priced when the setting changes (ones under way keep their price; gold paid beyond a new, lower price goes into the treasury).

  | Base price (DMG) | 50 | 250 | 500 (Cramped room) | 1,000 (Roomy) | 3,000 (Vast) | 7,500 | Crew: hire / upkeep a turn | Every building once |
  |---|---|---|---|---|---|---|---|---|
  | DMG | 50 | 250 | 500 | 1,000 | 3,000 | 7,500 | 50 / 10 | about 340,000 |
  | **Fair** (default) | 49 | 230 | 440 | 850 | 2,410 | 5,760 | 40 / 8 | about 266,000 |
  | Thrifty | 50 | 215 | 405 | 750 | 2,020 | 4,610 | 25 / 5 | about 217,000 |

  A base price is per room, per square of wall or per mile of road, before terrain, hauling and the other factors. House rules: `price: { scale, power }` (scale × price^power), `crewHireCost`, `crewUpkeep`, `costMult`.
- **House rules and catalog** (Module Settings → House rules and catalog → Edit, GM): two JSON boxes for the rules and catalog entries you change (only the keys you change). The window scrolls; it shows the default rules, the rules in use (with the Build pace and Prices settings applied) and the default catalog, and downloads each as a JSON file (default rules, rules in use, default catalog, catalog in use, and your own overrides). "Load a file" puts a JSON file you edited into either box; Save keeps it.
- **Build pace:** adventures don't last years, so by default building is far quicker than the DMG's times: a room takes 2 / 4 / 8 days (Cramped / Roomy / Vast), a chapel 3, a gatehouse 5, a great hall 8, a harbor 10 and a 40-square stone wall 19 (more crews on a project divide these). Short jobs shrink about tenfold and long ones about twentyfold, since big works bring more hands. The "Build pace" setting switches to Campaign (about a third of the DMG's time) or DMG (as written); prices don't change, and unfinished projects are re-timed (keeping the share of work done) when the pace changes. In the house rules, `pace: { scale, power }` sets your own curve: days = scale × days^power.
- **Long-rest clock:** with no calendar module active (Simple Calendar, Calendaria, Seasons & Stars, Simple Timekeeping and the like), the Bastion counts the party's long rests instead of days. Each long rest is a day of work on every running project, the page shows "done after 3 more long rests" and no dates anywhere (a merchant leaves, a dispatch arrives "after 2 long rests"), and the Bastion turn comes every 7 rests (the system's turn length), as set by "When time passes". Members resting within half an hour of each other count as one rest. The GM has an "A long rest passed" button for rests taken off the sheet. The "Bastion clock" setting can force either clock. A group rest with the system's "Bastion turn" box ticked also runs a turn.
- **Trade:** click any ware's name or icon to open its item page from the compendium, to read it before buying.
- **Dispatches:** envoy, letter, messenger bird, familiar, Animal Messenger, Sending, Sending Stones, Dream, beacons; each with range, delay, cost, capacity and risk. Standing orders with a Steward's Office.
- **Turns:** wraps the system's Bastion turn; all 11 DMG Bastion events with decision buttons; merchants and visitors; time prompt.
- **Sieges:** holdout estimate per force and a day-by-day live siege.
- **Character sheets:** a rook button in each party member's sheet header opens the Bastion.

The module works with the system's own Bastion rules turned on or off (System Settings → Bastions); with them off, the sheets' Bastion tab and the system's turn button stay hidden, and the GM gets a notice.

## API

`game.modules.get("dxcufgbs-player-bastions").api` — see the header of `scripts/main.js`.

## Tests

- `node tests/run-node.mjs` — the engine tests, headless.
- In Foundry with Quench active: batches `dxcufgbs-player-bastions.core` and `dxcufgbs-player-bastions.integration` (GM; creates and removes its own test actors and Bastion). Settings → Self-test runs them too.

CI runs the engine tests (`node tests/run-node.mjs`) and the standard module checks on every push and pull request.

## Licensing

No DMG text is included. Facility items and the Bastion Events table come from your own Dungeon Master's Guide module when it is installed; otherwise the module's original wording is used.
