import { mergeRules } from "./data/rules.js";
import { buildCatalog } from "./core/catalog.js";
import { BUILD_PACES, BUILD_PRICES } from "./core/projects.js";

export const MODULE_ID = "dxcufgbs-player-bastions";
export const TEMPLATE_PATH = `modules/${MODULE_ID}/templates`;
export const MARKER_ICON = `modules/${MODULE_ID}/assets/icons/bastion-marker.svg`;
export const SECONDS_PER_DAY = 86400;

/** Localize a DXPB.* key, formatting when data is given. */
export function t(key, data) {
  const full = `DXPB.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The one GM client that does world writes and relayed work. */
export function isResponsibleGM() {
  return game.user.isGM && !!game.users.activeGM?.isSelf;
}

export function randomId() {
  return foundry.utils.randomID();
}

/** The merged rules table (defaults + GM overrides), cached until the setting changes. */
let rulesCache = null;
export function rules() {
  if (!rulesCache) {
    let overrides = {};
    try { overrides = game.settings.get(MODULE_ID, "rules") ?? {}; } catch { /* before init */ }
    rulesCache = mergeRules(overrides);
    // The "Build pace" setting picks the pace unless the house rules set one themselves.
    if (!overrides?.pace) {
      let pace;
      try { pace = game.settings.get(MODULE_ID, "buildPace"); } catch { /* before init */ }
      if (BUILD_PACES[pace]) rulesCache.pace = { ...BUILD_PACES[pace] };
    }
    // The "Prices" setting picks the price model and the crews' wages, unless the house rules set them.
    let priceKey;
    try { priceKey = game.settings.get(MODULE_ID, "buildPrice"); } catch { /* before init */ }
    const preset = BUILD_PRICES[priceKey];
    if (preset) {
      if (!overrides?.price) rulesCache.price = { scale: preset.scale, power: preset.power };
      if (overrides?.crewHireCost === undefined) rulesCache.crewHireCost = preset.crewHireCost;
      if (overrides?.crewUpkeep === undefined) rulesCache.crewUpkeep = preset.crewUpkeep;
    }
    try { rulesCache.turnDays = game.settings.get("dnd5e", "bastionConfiguration")?.duration ?? rulesCache.turnDays; } catch { /* no dnd5e */ }
  }
  return rulesCache;
}

let catalogCache = null;
export function catalog() {
  if (!catalogCache) {
    let overrides = {};
    try { overrides = game.settings.get(MODULE_ID, "catalog") ?? {}; } catch { /* before init */ }
    catalogCache = buildCatalog(overrides);
  }
  return catalogCache;
}

export function clearCaches() {
  rulesCache = null;
  catalogCache = null;
}

export function setting(key) {
  try { return game.settings.get(MODULE_ID, key); } catch { return undefined; }
}

/** "1,234" style gold. */
export function gp(n) {
  return `${Math.round(Number(n) || 0).toLocaleString()} GP`;
}

/** A price in gold pieces as coins: whole GP, or SP / CP below 1 GP (a sack is 1 CP, not "0 GP"). */
export function coins(n) {
  const v = Number(n) || 0;
  if (v >= 1 || v === 0) return gp(v);
  if (v >= 0.1) return `${Math.round(v * 10)} SP`;
  return `${Math.max(1, Math.round(v * 100))} CP`;
}

/** Days as text, with Infinity shown as "unlimited". */
export function daysText(n) {
  if (!Number.isFinite(n)) return t("Unlimited");
  return `${n} ${n === 1 ? t("Day") : t("Days")}`;
}

/**
 * Active modules that add their own calendar (Simple Calendar, Calendaria, Seasons & Stars, Simple Timekeeping and
 * the like), found by id.
 */
export function calendarModules() {
  const re = /calendar|calendaria|seasons-and-stars|timekeeping/i;
  return (game.modules?.filter?.(m => m.active && m.id !== MODULE_ID && re.test(m.id)) ?? []).map(m => m.id);
}

/**
 * How the Bastion keeps time: "calendar" (days on the game clock, turns when time passes) or "rests" (each party long
 * rest is one day at the Bastion). The "Clock" setting decides; "auto" uses long rests unless a calendar module is
 * active.
 */
export function clockMode() {
  const mode = setting("clock") ?? "auto";
  if (mode === "calendar" || mode === "rests") return mode;
  return calendarModules().length ? "calendar" : "rests";
}

/** Work days as text: "3 days", or "3 long rests" with the long-rest clock. */
export function workText(n) {
  if (!Number.isFinite(n)) return t("Unlimited");
  if (clockMode() === "rests") return `${n} ${n === 1 ? t("LongRest") : t("LongRests")}`;
  return daysText(n);
}

/** Whether to show dates at all: only with a calendar (the long-rest clock counts rests instead). */
export const showDates = () => clockMode() !== "rests";

/**
 * The Bastion's own "now" in game seconds. With a calendar it is the game clock; with the long-rest clock it is its
 * last turn plus a day for every long rest since, the same clock its turns, merchants and dispatches run on.
 */
export function bastionNow(record) {
  if (showDates()) return now();
  return (record?.turn?.lastTime ?? 0) + (record?.rests?.sinceTurn ?? 0) * SECONDS_PER_DAY;
}

/** When something past happened: its date with a calendar, nothing with the long-rest clock. */
export function whenText(seconds) {
  return showDates() ? formatGameTime(seconds) : "";
}

/** When something is due: its date with a calendar, else "after 3 long rests" counted on the Bastion's clock. */
export function dueText(seconds, record) {
  if (showDates()) return formatGameTime(seconds);
  const n = Math.max(0, Math.ceil(((Number(seconds) || 0) - bastionNow(record)) / SECONDS_PER_DAY));
  return n === 0 ? t("DueNextRest") : n === 1 ? t("DueOneRest") : t("DueRests", { n });
}

/** A game-time timestamp as the calendar shows it (falls back to "day N"). */
export function formatGameTime(seconds) {
  try {
    const cal = game.time.calendar;
    // dnd5e's calendar can write "January 5th, 16:20"; plain Foundry writes a timestamp.
    const statics = cal?.constructor ?? {};
    if (typeof statics.formatMonthDay === "function" && typeof statics.formatHoursMinutes === "function") {
      return `${cal.format(seconds, "formatMonthDay")}, ${cal.format(seconds, "formatHoursMinutes")}`;
    }
    if (cal?.format) return cal.format(seconds);
  } catch { /* fall through */ }
  return `${t("Day")} ${Math.floor((Number(seconds) || 0) / SECONDS_PER_DAY) + 1}`;
}

export function now() {
  return game.time?.worldTime ?? 0;
}
