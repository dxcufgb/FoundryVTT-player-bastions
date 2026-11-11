/**
 * Builds the Bastion Codex compendium (packs/codex) from the catalog and the texts in this folder.
 *
 *   node codex/build-pack.mjs [path to @foundryvtt/foundryvtt-cli]
 *
 * Writes the JSON sources to codex/_source/ and, when the Foundry CLI is given (or installed next to the repo),
 * compiles them to the LevelDB pack in packs/codex. Ids are stable (core/codex.js), so links to a page never break.
 * Not part of the module zip; nothing here runs in Foundry.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EXPANSIONS } from "../scripts/data/catalog.js";
import { CODEX_JOURNALS, CODEX_FOLDERS, INHABITANTS, PAGE_TYPES, journalId, pageId, folderId } from "../scripts/core/codex.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const MODULE_ID = JSON.parse(readFileSync(join(root, "module.json"), "utf8")).id;
const facilities = JSON.parse(readFileSync(join(here, "entries-facilities.json"), "utf8"));
const inhabitants = JSON.parse(readFileSync(join(here, "entries-inhabitants.json"), "utf8"));
const asset = (ref, icon = false) => `modules/${MODULE_ID}/assets/codex/${icon ? "icons/" : ""}${ref}.webp`;
const stats = { coreVersion: "13.351", systemId: "dnd5e", systemVersion: "5.2.5", createdTime: 0, modifiedTime: 0, lastModifiedBy: null,
  compendiumSource: null, duplicateSource: null, exportSource: null };

function page(type, ref, name, category, text, sort) {
  const id = pageId(ref);
  return {
    _id: id, name, type, sort,
    title: { show: false, level: 1 },
    system: { ref, category, image: asset(ref), icon: asset(ref, true), description: text ?? "" },
    ownership: { default: -1 }, flags: {}, _stats: stats
  };
}

const missing = [];
const docs = [];
for (const [key, name] of Object.entries(CODEX_FOLDERS)) {
  docs.push({ _id: folderId(key), name, type: "JournalEntry", sorting: "m", sort: key === "facilities" ? 100000 : 200000,
    color: null, folder: null, flags: {}, _stats: stats, _key: `!folders!${folderId(key)}` });
}
CODEX_JOURNALS.forEach((j, ji) => {
  let pages = [];
  if (j.kind === "facility") {
    pages = EXPANSIONS.filter(e => !e.legacy && e.group === j.key).map(e => {
      if (!facilities[e.id]) missing.push(e.id);
      return page(PAGE_TYPES.facility, e.id, e.name, j.key, facilities[e.id]);
    });
  } else {
    pages = Object.entries(INHABITANTS).filter(([, v]) => v.journal === j.key).map(([ref, v]) => {
      if (!inhabitants[ref]) missing.push(ref);
      return page(PAGE_TYPES.inhabitant, ref, v.name, j.key, inhabitants[ref]);
    });
  }
  pages.sort((a, b) => a.name.localeCompare(b.name)).forEach((p, i) => {
    p.sort = (i + 1) * 100000;
    p._key = `!journal.pages!${journalId(j.key)}.${p._id}`;
  });
  docs.push({ _id: journalId(j.key), name: j.name, folder: folderId(j.folder), sort: (ji + 1) * 100000, pages, categories: [],
    ownership: { default: 0 }, flags: { [MODULE_ID]: { codex: j.key } }, _stats: stats, _key: `!journal!${journalId(j.key)}` });
});
if (missing.length) {
  console.error(`No text for: ${missing.join(", ")}`);
  process.exit(1);
}

const src = join(here, "_source");
rmSync(src, { recursive: true, force: true });
mkdirSync(src, { recursive: true });
for (const d of docs) writeFileSync(join(src, `${d._key.split("!")[1]}_${d.name.replace(/[^A-Za-z0-9]+/g, "-")}_${d._id}.json`), JSON.stringify(d, null, 2) + "\n");
console.log(`${docs.length} documents, ${docs.reduce((n, d) => n + (d.pages?.length ?? 0), 0)} pages written to codex/_source`);

const cliPath = process.argv[2] ?? join(root, "..", "fvtt-cli", "node_modules", "@foundryvtt", "foundryvtt-cli", "index.mjs");
if (!existsSync(cliPath)) {
  console.log("Foundry CLI not found: sources only (pass its index.mjs path to compile the pack).");
  process.exit(0);
}
const { compilePack } = await import(pathToFileURL(cliPath).href);
const dest = join(root, "packs", "codex");
rmSync(dest, { recursive: true, force: true });
await compilePack(src, dest, { log: false });
console.log("Compiled packs/codex");
