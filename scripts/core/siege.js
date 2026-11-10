import { QUALITY, ENGINES } from "../data/tables.js";

/**
 * The siege holdout model (see the plan). Pure.
 * force: { troops, quality, monsters: [{cr, count}], casters: [{level, count}], engine }
 */
export function attackStrength(force, rules) {
  const troops = (Number(force?.troops) || 0) * (QUALITY[force?.quality] ?? 1);
  const monsters = (force?.monsters ?? []).reduce((n, m) => n + (Number(m.cr) || 0) * rules.monsterPerCR * (Number(m.count) || 0), 0);
  const casters = (force?.casters ?? []).reduce((n, c) => n + (Number(c.level) || 0) * rules.casterPerLevel * (Number(c.count) || 0), 0);
  return Math.round((troops + monsters + casters) * 100) / 100;
}

/** Integrity damage per day this force does to these walls. */
export function engineDamage(force, stats, rules) {
  const engine = force?.engine ?? "none";
  let light = 0;
  let heavy = 0;
  let magical = 0;
  if (engine === "light") light = ENGINES.light;
  else if (engine === "heavy") heavy = ENGINES.heavy;
  else if (engine === "magical") magical = ENGINES.magical;
  else if (engine === "heavyMagical") { heavy = ENGINES.heavy; magical = ENGINES.magical; }
  if (light) {
    light *= 1 - (stats.lightCut ?? 0) / 100;
    if (stats.lightHalve) light *= 0.5;
  }
  if (magical) magical *= 1 - Math.min(100, stats.wards ?? 0) / 100;
  let total = light + heavy + magical;
  total *= 1 - Math.min(rules.engineCutMax, stats.engineCut ?? 0) / 100;
  if (engine === "none" && (Number(force?.troops) || 0) >= rules.sappingMinTroops && !stats.noSapping) total = rules.sappingDamage;
  return Math.round(total * 1000) / 1000;
}

/**
 * Days the Bastion holds against a force.
 * Returns { days, reason, strength, walled, breached, breachDay, foodDays, waterDays, fallsDay }
 * reason: "stormed" | "overrun" | "food" | "water" | "holds" (holds = no limit found, shown as "indefinitely").
 */
export function holdout(stats, force, rules) {
  const strength = attackStrength(force, rules);
  const walled = stats.defense.walled;
  const breached = stats.defense.breached;
  const foodDays = stats.food.siegeDays;
  const waterDays = stats.water.days;
  const damage = engineDamage(force, stats, rules);
  let fallsDay = Infinity;
  let breachDay = Infinity;
  let fallReason = null;

  if (strength > walled) {
    fallsDay = 1;
    fallReason = "stormed";
  } else if (stats.wall.enclosed && stats.wall.integrity > 0) {
    if (damage > 0) {
      breachDay = Math.ceil(stats.wall.integrity / damage - 1e-9);
      if (strength > breached) {
        fallsDay = breachDay + 1;
        fallReason = "overrun";
      }
    }
  }
  const candidates = [
    { days: fallsDay, reason: fallReason },
    { days: foodDays, reason: "food" },
    { days: waterDays, reason: "water" }
  ].filter(c => c.reason);
  candidates.sort((a, b) => a.days - b.days);
  const best = candidates[0];
  const days = best && Number.isFinite(best.days) ? best.days : Infinity;
  return {
    days,
    reason: Number.isFinite(days) ? best.reason : "holds",
    strength,
    walled,
    breached,
    damage,
    breachDay,
    fallsDay,
    foodDays,
    waterDays
  };
}

/** One in-game day of a live siege. state: { day, integrity, food } → new state + whether it fell. */
export function siegeDay(state, stats, force, rules) {
  const next = { ...state, day: (state.day ?? 0) + 1 };
  const damage = engineDamage(force, stats, rules);
  next.integrity = Math.max(0, (state.integrity ?? stats.wall.integrity) - damage);
  const need = Math.max(0, stats.food.perDay - stats.food.inside);
  next.food = Math.max(0, (state.food ?? stats.food.stock) - need / (stats.siegeFood || 1));
  const strength = attackStrength(force, rules);
  const breachedNow = stats.wall.enclosed ? next.integrity <= 0 : true;
  next.breached = breachedNow;
  if (strength > stats.defense.walled) next.fallen = "stormed";
  else if (breachedNow && state.breached && strength > stats.defense.breached) next.fallen = "overrun";
  else if (next.food <= 0 && need > 0) next.fallen = "food";
  return next;
}
