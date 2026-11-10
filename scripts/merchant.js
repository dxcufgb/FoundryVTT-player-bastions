import { MODULE_ID } from "./util.js";

/**
 * Fills a visiting merchant's stock from the item compendiums (the system's SRD equipment and items, plus any premium
 * or homebrew item packs), within the merchant's budget and rarities. Stock entries: { uuid, name, img, price, rarity }.
 */
const PRICE_TO_GP = { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 };

export async function fillStock(merchant, stats) {
  const rarities = new Set(merchant.rarities ?? ["mundane"]);
  const pool = [];
  const packs = game.packs.filter(p => p.documentName === "Item");
  for (const pack of packs) {
    let index;
    try { index = await pack.getIndex({ fields: ["system.price", "system.rarity", "type"] }); } catch { continue; }
    for (const e of index) {
      if (!["weapon", "equipment", "consumable", "tool", "loot", "container"].includes(e.type)) continue;
      const rarity = e.system?.rarity || "mundane";
      if (!rarities.has(rarity)) continue;
      const value = Number(e.system?.price?.value) || 0;
      const price = Math.round(value * (PRICE_TO_GP[e.system?.price?.denomination] ?? 1) * 100) / 100;
      if (price <= 0) continue;
      pool.push({ uuid: e.uuid, name: e.name, img: e.img, price, rarity });
    }
  }
  const budget = merchant.budget ?? 200;
  const stock = [];
  let spent = 0;
  const seen = new Set();
  for (let tries = 0; tries < 400 && pool.length && spent < budget; tries++) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (seen.has(pick.name) || pick.price > budget / 3 || spent + pick.price > budget) continue;
    seen.add(pick.name);
    stock.push(pick);
    spent += pick.price;
    if (stock.length >= 24) break;
  }
  stock.sort((a, b) => a.price - b.price);
  return stock;
}

export const MERCHANT_FLAG = `${MODULE_ID}.merchant`;
