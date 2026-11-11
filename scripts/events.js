import { MODULE_ID, t, gp, randomId, now, escapeHTML, rules } from "./util.js";
import { patchRecord, getRecord, ownerActors } from "./store.js";
import { eventForRoll, eventKeyFromText, guestForRoll, treasureForRoll, requestForAid, rollDice } from "./core/visitors.js";
import { EVENTS } from "./data/tables.js";

/**
 * Bastion events (DMG), rolled when the Bastion is on Maintain. Uses a "Bastion Events" roll table when the world or a
 * compendium has one (the DMG premium module does), otherwise the module's own table with the same d100 ranges.
 * Each event becomes record.events[id] and a chat card; events that need a decision get buttons.
 */

async function findEventsTable() {
  const byName = t => /bastion events?/i.test(t?.name ?? "");
  const world = game.tables.find(byName);
  if (world) return world;
  for (const pack of game.packs.filter(p => p.documentName === "RollTable")) {
    try {
      const index = await pack.getIndex();
      const hit = index.find(byName);
      if (hit) return pack.getDocument(hit._id);
    } catch { /* locked or broken pack */ }
  }
  return null;
}

/** Rolls one event: { key, label, text, roll, source }. */
async function rollOne(exclude = []) {
  for (let tries = 0; tries < 10; tries++) {
    const table = await findEventsTable();
    let ev;
    if (table) {
      const draw = await table.draw({ displayChat: false });
      const r = draw.results[0];
      const text = r?.description || r?.name || r?.text || "";
      const key = eventKeyFromText(text);
      const base = EVENTS.find(e => e.key === key);
      ev = { key, label: base.label, text: base.text, roll: draw.roll?.total ?? null, source: table.name };
    } else {
      const roll = await new Roll("1d100").evaluate();
      const e = eventForRoll(roll.total);
      ev = { key: e.key, label: e.label, text: e.text, roll: roll.total, source: "module" };
    }
    if (!exclude.includes(ev.key)) return ev;
  }
  return { ...EVENTS[0], roll: null, source: "module" };
}

function card(record, ev, body, buttons = []) {
  const btns = buttons.map(b => `<button type="button" data-dxpb-event="${b.choice}" data-entry="${b.entryId}" data-event-id="${ev.id}"
    ${b.count ? "data-count=\"1\"" : ""}><i class="${b.icon ?? "fa-solid fa-check"}"></i> ${escapeHTML(b.label)}</button>`).join("");
  return `<div class="dxpb-card dxpb-event">
    <h3><i class="fa-solid fa-chess-rook"></i> ${escapeHTML(record.name)}: ${escapeHTML(ev.label)}</h3>
    ${ev.roll ? `<p class="dxpb-muted">${t("Chat.EventRoll", { roll: ev.roll, source: escapeHTML(ev.source === "module" ? t("Chat.EventTable") : ev.source) })}</p>` : ""}
    <p>${body}</p>${btns ? `<div class="dxpb-buttons">${btns}</div>` : ""}</div>`;
}

function specialFacilities(record) {
  const out = [];
  for (const a of ownerActors(record)) for (const f of a.itemTypes?.facility ?? []) {
    if (f.system.type?.value === "special" && !f.system.disabled) out.push(f);
  }
  return out;
}

async function disableRandomFacility(entry, record) {
  const list = specialFacilities(record);
  if (!list.length) return null;
  const f = list[Math.floor(Math.random() * list.length)];
  await f.update({ "system.disabled": true });
  await patchRecord(entry, { disabledByModule: [...(getRecord(entry).disabledByModule ?? []), f.uuid] });
  return f;
}

/** Kills `n` defenders: module guards and mercenaries first, then DMG defenders. Returns how many died. */
async function killDefenders(entry, record, n, { infirmary }) {
  let deaths = n;
  if (infirmary) {
    let saved = 0;
    for (let i = 0; i < n; i++) if (Math.random() < 0.5) saved++;
    deaths -= saved;
  }
  const changes = {};
  let left = deaths;
  const merc = Math.min(left, record.garrison?.mercenaries ?? 0);
  if (merc) { changes["garrison.mercenaries"] = (record.garrison.mercenaries ?? 0) - merc; left -= merc; }
  const guards = Math.min(left, record.garrison?.guards ?? 0);
  if (guards) { changes["garrison.guards"] = (record.garrison.guards ?? 0) - guards; left -= guards; }
  for (const f of specialFacilities(record)) {
    if (left <= 0) break;
    const list = [...(f.system.defenders?.value ?? [])];
    while (left > 0 && list.length) { list.pop(); left--; }
    await f.update({ "system.defenders.value": list });
  }
  if (Object.keys(changes).length) await patchRecord(entry, changes);
  return deaths - left;
}

/**
 * Rolls and applies one Bastion event for a Bastion. twice: Meditation Chamber's Inner Peace (owner picks).
 */
export async function rollBastionEvent(entry, record, stats, ctx, { twice = false, at } = {}) {
  let ev = await rollOne();
  if (twice) {
    const other = await rollOne();
    ev = { ...ev, alternative: other };
  }
  ev.id = randomId();
  // An event happens on its turn's date, which can be ahead of the world clock when turns are run by hand.
  ev.at = at ?? record.turn?.lastTime ?? now();
  ev.state = "pending";
  return applyEvent(entry, record, stats, ctx, ev);
}

/** Applies an event (also used by the API to force one). */
export async function applyEvent(entry, record, stats, ctx, ev) {
  ev.id ??= randomId();
  ev.at ??= now();
  ev.state ??= "pending";
  const entryId = entry.id;
  let body = escapeHTML(ev.text);
  const buttons = [];
  const changes = {};
  const owners = ownerActors(record);
  switch (ev.key) {
    case "allIsWell":
      ev.state = "resolved";
      break;
    case "attack": {
      changes["people.refugees"] = 0;
      if (record.monsterGuard) {
        changes.monsterGuard = false;
        body += ` ${t("Event.MonsterDefends")}`;
        ev.state = "resolved";
        break;
      }
      const lieutenants = ctx.lieutenants ?? 0;
      const R = rules();
      const dice = Math.max(0, (R.attackDice ?? 6) - (stats.wall.enclosed ? (R.attackWallReduction ?? 2) : 0) - lieutenants);
      const die = ctx.armoryStocked ? 8 : 6;
      const roll = await new Roll(`${dice}d${die}`).evaluate();
      const ones = roll.dice.reduce((n, d) => n + d.results.filter(r => r.active && r.result === 1).length, 0);
      const total = (stats.people.guards ?? 0) + (stats.people.mercenaries ?? 0) + (ctx.dmgDefenders ?? 0);
      let killed = 0;
      if (ones && total) killed = await killDefenders(entry, record, Math.min(ones, total), { infirmary: !!stats.flags.infirmary });
      body += ` ${t("Event.AttackResult", { formula: `${dice}d${die}`, ones, killed })}`;
      if (!total) {
        const f = await disableRandomFacility(entry, record);
        if (f) body += ` ${t("Event.FacilityDamaged", { name: escapeHTML(f.name) })}`;
      }
      ev.data = { formula: `${dice}d${die}`, ones, killed, result: roll.total };
      ev.state = "resolved";
      break;
    }
    case "criminal": {
      const bribe = rollDice("1d6") * 100;
      ev.data = { bribe };
      body += ` ${t("Event.CriminalChoice", { bribe: gp(bribe) })}`;
      buttons.push({ choice: "pay", label: t("Event.PayBribe", { bribe: gp(bribe) }), entryId, icon: "fa-solid fa-coins" });
      buttons.push({ choice: "refuse", label: t("Event.Refuse"), entryId, icon: "fa-solid fa-xmark" });
      break;
    }
    case "opportunity":
      body += ` ${t("Event.OpportunityChoice")}`;
      buttons.push({ choice: "pay", label: t("Event.PayOpportunity"), entryId, icon: "fa-solid fa-coins" });
      buttons.push({ choice: "decline", label: t("Event.Decline"), entryId, icon: "fa-solid fa-xmark" });
      break;
    case "visitors": {
      const gold = Math.round(rollDice("1d6") * 100 * (stats.visitors?.payMult ?? 1));
      changes.treasury = (record.treasury ?? 0) + gold;
      body += ` ${t("Event.Paid", { gold: gp(gold) })}`;
      ev.state = "resolved";
      break;
    }
    case "guest": {
      const g = guestForRoll(rollDice("1d4"));
      ev.data = { guest: g.key };
      body = `${escapeHTML(g.label)}: ${escapeHTML(g.text)}`;
      if (g.key === "renowned") changes.renownBonus = (record.renownBonus ?? 0) + 1;
      if (g.key === "sanctuary") {
        const gold = rollDice("1d6") * 100;
        changes.treasury = (record.treasury ?? 0) + gold;
        body += ` ${t("Event.Paid", { gold: gp(gold) })}`;
      }
      if (g.key === "mercenary") changes["garrison.mercenaries"] = (record.garrison?.mercenaries ?? 0) + 1;
      if (g.key === "monster") changes.monsterGuard = true;
      ev.state = "resolved";
      break;
    }
    case "lostHirelings": {
      const f = await disableRandomFacility(entry, record);
      body += f ? ` ${t("Event.FacilityIdle", { name: escapeHTML(f.name) })}` : ` ${t("Event.NoFacility")}`;
      ev.state = "resolved";
      break;
    }
    case "discovery":
      changes.vault = [...(record.vault ?? []), { name: t("Event.DiscoveryItem"), uuid: null, at: now() }];
      body += ` ${t("Event.DiscoveryStored")}`;
      ev.state = "resolved";
      break;
    case "refugees": {
      const n = rollDice("2d4");
      const gold = Math.round(rollDice("1d6") * 100 * (stats.visitors?.payMult ?? 1));
      changes["people.refugees"] = (record.people?.refugees ?? 0) + n;
      changes.treasury = (record.treasury ?? 0) + gold;
      body += ` ${t("Event.Refugees", { n, gold: gp(gold) })}`;
      ev.state = "resolved";
      break;
    }
    case "aid": {
      const max = (stats.people.guards ?? 0) + (stats.people.mercenaries ?? 0) + (ctx.dmgDefenders ?? 0);
      ev.data = { max };
      body += ` ${t("Event.AidChoice", { max })}`;
      if (max) buttons.push({ choice: "send", label: t("Event.SendDefenders"), entryId, icon: "fa-solid fa-shield", count: true });
      buttons.push({ choice: "decline", label: t("Event.Decline"), entryId, icon: "fa-solid fa-xmark" });
      break;
    }
    case "treasure": {
      const roll = rollDice("1d100");
      const tr = treasureForRoll(roll);
      const item = tr.rarity ? await randomMagicItem(tr.rarity) : null;
      changes.vault = [...(record.vault ?? []), { name: item?.name ?? tr.label, uuid: item?.uuid ?? null, gp: tr.gp ?? null, at: now() }];
      body += ` ${t("Event.Treasure", { what: escapeHTML(item?.name ?? tr.label) })}`;
      ev.state = "resolved";
      break;
    }
    default:
      ev.state = "resolved";
  }
  if (ev.alternative) body += `<br><em>${t("Event.InnerPeace", { other: escapeHTML(ev.alternative.label) })}</em>`;
  ev.summary = body.replace(/<[^>]+>/g, "");
  changes[`events.${ev.id}`] = ev;
  await patchRecord(entry, changes);
  const users = ownerActors(record, { includeGroup: true })
    .flatMap(a => game.users.filter(u => !u.isGM && a.testUserPermission(u, "OWNER")).map(u => u.id));
  const msg = await ChatMessage.create({
    content: card(record, ev, body, buttons),
    whisper: [...new Set([...users, ...ChatMessage.getWhisperRecipients("GM").map(u => u.id)])],
    flags: { [MODULE_ID]: { event: { entryId, eventId: ev.id } } }
  });
  await patchRecord(entry, { [`events.${ev.id}.messageId`]: msg.id });
  Hooks.callAll(`${MODULE_ID}.eventRolled`, entry, ev);
  return ev;
}

async function randomMagicItem(rarity) {
  const pools = game.packs.filter(p => p.documentName === "Item" && p.metadata.packageType !== "world");
  const hits = [];
  for (const pack of pools) {
    try {
      const index = await pack.getIndex({ fields: ["system.rarity", "type"] });
      for (const e of index) if (e.system?.rarity === rarity && ["equipment", "consumable", "weapon", "tool", "loot"].includes(e.type)) hits.push(e.uuid);
    } catch { /* skip */ }
    if (hits.length > 400) break;
  }
  if (!hits.length) return null;
  return fromUuid(hits[Math.floor(Math.random() * hits.length)]);
}

/** A player's or GM's decision on an event card. */
export async function resolveEventChoice(entry, record, eventId, choice, { count } = {}) {
  const ev = record.events?.[eventId];
  if (!ev || ev.state !== "pending") return { ok: false, reason: t("Notify.EventDone") };
  const changes = {};
  let text = "";
  if (ev.key === "criminal") {
    if (choice === "pay") {
      if ((record.treasury ?? 0) < ev.data.bribe) return { ok: false, reason: t("Notify.TreasuryShort") };
      changes.treasury = record.treasury - ev.data.bribe;
      text = t("Event.BribePaid", { bribe: gp(ev.data.bribe) });
    } else {
      const f = specialFacilities(record).find(x => (x.system.hirelings?.value?.length ?? 0) > 0);
      if (f) {
        const list = [...f.system.hirelings.value];
        list.pop();
        await f.update({ "system.hirelings.value": list, ...(list.length ? {} : { "system.disabled": true }) });
        if (!list.length) changes.disabledByModule = [...(record.disabledByModule ?? []), f.uuid];
        text = t("Event.Arrested", { name: f.name });
      } else text = t("Event.ArrestedNoFacility");
    }
  } else if (ev.key === "opportunity") {
    if (choice === "pay") {
      if ((record.treasury ?? 0) < 500) return { ok: false, reason: t("Notify.TreasuryShort") };
      changes.treasury = record.treasury - 500;
      await patchRecord(entry, { ...changes, [`events.${eventId}.state`]: "resolved", [`events.${eventId}.choice`]: choice });
      const { statsFor } = await import("./context.js");
      const fresh = getRecord(entry);
      const { stats, ctx } = statsFor(fresh);
      let next = await rollOne(["opportunity"]);
      await applyEvent(entry, fresh, stats, ctx, next);
      return { ok: true };
    }
    text = t("Event.Declined");
  } else if (ev.key === "aid") {
    if (choice === "send") {
      const n = Math.max(1, Math.min(ev.data.max, Math.floor(Number(count) || 1)));
      const res = requestForAid(n);
      changes.treasury = (record.treasury ?? 0) + res.reward;
      text = t("Event.AidResult", { n, total: res.total, reward: gp(res.reward) });
      if (res.deaths) {
        await killDefenders(entry, record, 1, { infirmary: false });
        text += ` ${t("Event.AidDeath")}`;
      }
    } else text = t("Event.Declined");
  }
  changes[`events.${eventId}.state`] = "resolved";
  changes[`events.${eventId}.choice`] = choice;
  changes[`events.${eventId}.outcome`] = text;
  await patchRecord(entry, changes);
  await ChatMessage.create({ content: `<div class="dxpb-card"><h3>${escapeHTML(record.name)}: ${escapeHTML(ev.label)}</h3><p>${escapeHTML(text)}</p></div>`,
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id).concat(game.user.isGM ? [] : [game.user.id]) });
  Hooks.callAll(`${MODULE_ID}.eventResolved`, entry, ev, choice);
  return { ok: true, text };
}

/** Re-enables facilities this module disabled (lost hirelings, empty after an arrest) one turn later. */
export async function restoreDisabled(entry, uuids) {
  if (!uuids?.length) return [];
  const restored = [];
  for (const uuid of uuids) {
    const f = await fromUuid(uuid);
    if (f?.system?.disabled) { await f.update({ "system.disabled": false }); restored.push(f.name); }
  }
  const left = (getRecord(entry).disabledByModule ?? []).filter(u => !uuids.includes(u));
  await patchRecord(entry, { disabledByModule: left });
  return restored;
}
