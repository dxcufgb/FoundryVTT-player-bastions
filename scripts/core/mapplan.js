import { syncLayout, buildingWalls, mergeSegments, ROAD, isWalled } from "./layout.js";
import { FLOORS, FURNISH, YARD_PROPS, TERRAIN_GROUND, BAILEY_GROUND, MAP_GROUNDS, FLOOR_RUGS, LIGHT_PROPS, DRESSING, BAILEY_DECALS, GROUND_MIX, PATH_GROUND, WALL_CLUTTER } from "../data/map-style.js";

/**
 * The Bastion battle map as geometry, in 5-ft squares. Pure: the renderer paints it, the scene builder turns
 * `walls` into Foundry walls. Origin is the centre of the grounds (see layout.js); `offset` shifts it to the map's
 * top-left corner.
 *
 * mapPlan(record, catalog, rules, stats) → {
 *   side, margin, total, offset, ground, bailey,
 *   wall: { type: "palisade"|"stone"|"rock", reinforced, walk, slits, ring: { min, max } } | null (none built yet),
 *   spikes: { d } | null (the spike barricade's ring, `d` squares out from the grounds' edge),
 *   moat: "wet"|"dry"|null, moatD (the moat's inner edge, squares out), bridge, gate, breaches: [{ where, x, y, w, h }],
 *   roads: [{ x, y, w, h, tex }], fixtures, items: [{ ...layout item, floor, props: [{ p, x, y, n }], damaged }],
 *   walls: [{ x0, y0, x1, y1, door: 0|1|2 }], layout (the synced layout result)
 * }
 */
export const MARGIN = 5;

export function mapPlan(record, catalog, rules, stats) {
  const lay = syncLayout(record, catalog, rules);
  const side = lay.side;
  const h = side / 2;
  // The wall on the grounds' edge, then the ditch or moat outside it.
  const margin = MARGIN;
  const moatD = 4;
  const total = side + 2 + margin * 2;
  const offset = h + 1 + margin;
  // The GM's pick of ground (record.mapGround) wins over everything; otherwise it follows the terrain and structure.
  const picked = MAP_GROUNDS[record?.mapGround] ? record.mapGround : null;
  const terrain = picked ? MAP_GROUNDS[picked] : (record?.location?.terrain ?? "plains");
  const caveHall = record?.structure?.type === "cave";
  const ground = picked ?? (caveHall ? "cave" : (TERRAIN_GROUND[terrain] ?? "grass"));
  const cave = record?.structure?.type === "cave";
  // A cave Bastion is a hall in the rock: cave floor inside, the rock itself for its wall.
  const bailey = picked ?? (cave ? "cave" : (BAILEY_GROUND[terrain] ?? "dirt"));
  const has = id => Object.values(record?.features ?? {}).some(f => f?.id === id);

  // The outer wall: what it is made of follows the stats (structures can bring their own wall).
  const wt = stats?.wall?.type ?? "none";
  const enclosed = !!stats?.wall?.enclosed;
  let wall = null;
  if (enclosed || wt !== "none") {
    const type = wt === "palisade" ? "palisade" : wt === "rock" ? "rock" : "stone";
    const built = Object.values(record?.features ?? {}).find(f => f?.id === "wall");
    wall = { type, reinforced: wt === "reinforced", walk: (built?.tier ?? 1) >= 4 || has("wall-walk"), slits: has("arrow-slits"),
      ring: { min: -h - 1, max: h } };
  }
  const moat = has("wet-moat") ? "wet" : has("dry-ditch") ? "dry" : null;
  // Stakes at the foot of the wall: outside it, inside the ditch or moat.
  const spikes = has("spike-barricade") ? { d: 2 } : null;
  const gate = lay.fixtures.find(f => f.id === "gatehouse") ?? null;

  // Breaches: how much of the wall a siege has knocked down. Worked out from the live siege, else none.
  const breaches = [];
  if (wall && record?.siege) {
    const max = Math.max(1, stats?.wall?.integrity ?? 1);
    const left = Math.max(0, record.siege.integrity ?? max);
    const lost = 1 - left / max;
    const n = left <= 0 ? 3 : lost >= 0.66 ? 2 : lost >= 0.33 ? 1 : 0;
    const spots = [
      { where: "west", x: -h - 1, y: -7, w: 1, h: 3 }, { where: "east", x: h, y: 5, w: 1, h: 3 },
      { where: "north", x: -Math.floor(side / 4) - 2, y: -h - 1, w: 3, h: 1 }
    ];
    breaches.push(...spots.slice(0, n));
  }

  // Roads: from the gate (or the middle of the south side) out to the edge of the map, and in to the keep.
  // The road the GM chose: none, a narrow dirt trail, a dirt road, or a cobbled highway (cobbles in town). Inside a wall
  // the way to the door is paved; until there is a wall, the chosen road just carries on into the grounds.
  const roadType = record?.location?.road ?? "road";
  const roadTex = roadType === "highway" || (terrain === "urban" && roadType === "road") ? "cobble" : "dirt";
  const roadW = roadType === "trail" ? 1.2 : 2;
  const roads = [];
  if (isWalled(record)) {
    if (roadType !== "none") roads.push({ x: -roadW / 2, y: h + 1, w: roadW, h: margin + 1, tex: roadTex });
    roads.push({ x: ROAD.x0, y: ROAD.y0, w: 2, h: h - ROAD.y0, tex: "cobble" });
  } else if (roadType !== "none") {
    roads.push({ x: -roadW / 2, y: ROAD.y0, w: roadW, h: h - ROAD.y0 + 1 + margin + 1, tex: roadTex });
  }

  // Buildings: floors and furnishings.
  const segs = buildingWalls(lay.items);
  const doorSegs = segs.filter(s => s.door);
  const doorsOf = it => doorSegs.filter(d => onPerimeter(d, it));
  // Free-standing towers (no wall to stand on) are drawn and shaded like the wall's towers.
  const freeTowers = lay.items.filter(it => it.kind === "tower").map(it => ({ fid: it.fid, id: "watchtower", kind: "wall", where: "free",
    x: it.x, y: it.y, w: it.s, h: it.s }));
  const items = lay.items.filter(it => it.kind !== "tower").map(it => {
    const f = record.features[it.fid] ?? {};
    const floor = FLOORS[it.id] ?? (it.kind === "yard" ? bailey : "flagstone");
    const props = it.kind === "yard" ? yardProps(it) : furnish(it, doorsOf(it));
    return { ...it, floor, props, damaged: !!f.damaged, size: f.size ?? null };
  });

  // Foundry walls: the outer wall's outside edge (with the gate as a door and gaps at the breaches), every building.
  const walls = [];
  if (wall) {
    const lo = -h - 1;
    const hi = h + 1;
    const edge = [];
    for (let i = lo; i < hi; i++) {
      edge.push({ x0: i, y0: lo, x1: i + 1, y1: lo }); // north
      edge.push({ x0: i, y0: hi, x1: i + 1, y1: hi }); // south
      edge.push({ x0: lo, y0: i, x1: lo, y1: i + 1 }); // west
      edge.push({ x0: hi, y0: i, x1: hi, y1: i + 1 }); // east
    }
    const postern = lay.fixtures.find(f => f.id === "postern");
    for (const e of edge) {
      if (breaches.some(b => crosses(e, b))) continue;
      const atGate = e.y0 === hi && e.y1 === hi && e.x0 >= ROAD.x0 && e.x1 <= ROAD.x1 + 1;
      const atPostern = postern && e.y0 === lo && e.y1 === lo && e.x0 === postern.x;
      walls.push({ ...e, door: atGate ? 1 : atPostern ? 2 : 0, outer: true });
    }
  }
  for (const s of mergeSegments(segs)) walls.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, door: s.door ? 1 : 0 });
  // The centre tower: an eight-sided wall round its circle, with its door facing the road (south).
  const centreTower = lay.fixtures.find(f => f.where === "centre");
  if (centreTower) {
    const cx = centreTower.x + centreTower.w / 2;
    const cy = centreTower.y + centreTower.h / 2;
    const r = centreTower.w / 2 / Math.cos(Math.PI / 8);
    const pt = k => ({ x: cx + r * Math.cos(Math.PI / 8 + k * Math.PI / 4), y: cy + r * Math.sin(Math.PI / 8 + k * Math.PI / 4) });
    for (let k = 0; k < 8; k++) {
      const a = pt(k), b = pt(k + 1);
      // k = 1 runs from 67.5° to 112.5°: the flat side facing south (y grows southward).
      walls.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, door: k === 1 ? 1 : 0, tower: true });
    }
  }

  // Dressing: rugs under the furniture, torches by the gate, trees round the edge, small things on the ground.
  for (const it of items) {
    const rug = FLOOR_RUGS[it.id];
    if (rug && it.kind !== "yard" && it.s >= 3) {
      const n = Math.min(it.s - 1, rug === "rug" ? 4 : 3);
      it.rug = { p: rug, x: (it.s - n) / 2, y: (it.s - n) / 2, n, rot: 0 };
    }
  }
  const extras = [];
  if (gate) {
    extras.push({ p: "torch", x: gate.x + 0.05, y: gate.y - 0.95, n: 0.9, rot: 180 });
    extras.push({ p: "torch", x: gate.x + gate.w - 0.95, y: gate.y - 0.95, n: 0.9, rot: 180 });
  }
  const blocked = occupancy(side, lay, roads);
  const clearFrom = moat ? h + moatD + 1 : spikes ? h + 3 : h + 2;
  const dressing = dress(record, caveHall && !picked ? "underground" : terrain, side, total, offset, clearFrom, blocked);
  if (cave) {
    // Inside the rock: no trees, and nothing lying about outside the hall.
    dressing.trees = [];
    dressing.decals = dressing.decals.filter(d => Math.max(Math.abs(d.x), Math.abs(d.y)) < h - 0.5);
  }

  // Worn paths from each outside door to the gate road, and clutter along the inside of the wall.
  const paths = [];
  for (const it of lay.items) {
    if (it.kind !== "building" && it.kind !== "room") continue;
    for (const d of doorSegs.filter(dd => onPerimeter(dd, it))) {
      const horiz = d.y0 === d.y1;
      const mx = (d.x0 + d.x1) / 2, my = (d.y0 + d.y1) / 2;
      // Only doors to the outside: the square beyond isn't another room.
      const out = horiz ? (my === it.y ? -1 : 1) : (mx === it.x ? -1 : 1);
      const bx = horiz ? mx : mx + out * 0.5, by = horiz ? my + out * 0.5 : my;
      if (lay.items.some(o => o !== it && o.kind === "room" && bx > o.x && bx < o.x + o.s && by > o.y && by < o.y + o.s)) continue;
      const sx = horiz ? mx : mx + out * 1.2, sy = horiz ? my + out * 1.2 : my;
      const toRoad = -0.5 + (sx < -0.5 ? -0.6 : 0.6);
      // A side door facing away from the road goes round the building's south side first.
      const behind = !horiz && Math.sign(toRoad - sx) === -out;
      const pts = [[mx, my], [sx, sy]];
      if (behind) pts.push([sx, it.y + it.s + 0.8], [toRoad, it.y + it.s + 0.8]);
      else pts.push([toRoad, sy]);
      paths.push(pts);
    }
  }
  if (gate) paths.push([[-0.5, ROAD.y0], [-0.5, h]]);
  // Barrels, crates and hay stood against the wall: only when there is a wall to stand them against.
  const clutter = wall ? wallClutter(record, side, blocked) : [];

  // Light sources: every lit prop, in squares from the centre.
  const lights = [];
  for (const it of items) for (const p of [...it.props]) {
    const L = LIGHT_PROPS[p.p];
    if (L) lights.push({ x: it.x + p.x + p.n / 2, y: it.y + p.y + p.n / 2, ...L });
  }
  for (const p of extras) { const L = LIGHT_PROPS[p.p]; if (L) lights.push({ x: p.x + p.n / 2, y: p.y + p.n / 2, ...L }); }

  return {
    paths, pathTex: PATH_GROUND[bailey] ?? "dirt", clutter,
    mix: GROUND_MIX[ground] ?? null, baileyMix: GROUND_MIX[bailey] ?? null,
    extras, trees: dressing.trees, decals: dressing.decals, lights,
    side, margin, total, offset, ground, bailey, wall, spikes, moat, moatD, bridge: !!moat,
    gate, portcullis: has("portcullis"), barbican: has("barbican"), breaches, roads, fixtures: [...lay.fixtures, ...freeTowers], items,
    walls: mergeOuter(walls), layout: lay
  };
}

/** Whether a one-square wall segment lies on a building's outline. */
function onPerimeter(d, it) {
  const x2 = it.x + it.s;
  const y2 = it.y + it.s;
  if (d.y0 === d.y1) return (d.y0 === it.y || d.y0 === y2) && d.x0 >= it.x && d.x1 <= x2;
  return (d.x0 === it.x || d.x0 === x2) && d.y0 >= it.y && d.y1 <= y2;
}

/** Whether a wall edge runs through a breach rectangle. */
function crosses(e, b) {
  const mx = (e.x0 + e.x1) / 2;
  const my = (e.y0 + e.y1) / 2;
  return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
}

/** Joins the one-square outer wall edges into long runs. */
function mergeOuter(walls) {
  const plain = walls.filter(w => !w.door);
  const doors = walls.filter(w => w.door);
  const out = [];
  const rows = new Map();
  for (const w of plain) {
    const k = (w.outer ? "o" : "b") + (w.y0 === w.y1 ? `h${w.y0}` : `v${w.x0}`);
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k).push(w);
  }
  for (const [k, list] of rows) {
    const horiz = k[1] === "h";
    list.sort((a, b) => (horiz ? a.x0 - b.x0 : a.y0 - b.y0));
    let cur = null;
    for (const w of list) {
      if (cur && (horiz ? cur.x1 === w.x0 : cur.y1 === w.y0)) { cur.x1 = w.x1; cur.y1 = w.y1; continue; }
      if (cur) out.push(cur);
      cur = { ...w };
    }
    if (cur) out.push(cur);
  }
  // Doors next to each other (the 2-wide gate) become one door.
  const dmerged = [];
  for (const d of doors.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const prev = dmerged[dmerged.length - 1];
    if (prev && prev.door === d.door && !!prev.outer === !!d.outer && prev.y0 === prev.y1 && d.y0 === d.y1 && prev.y0 === d.y0 && prev.x1 === d.x0) { prev.x1 = d.x1; continue; }
    dmerged.push({ ...d });
  }
  const seen = new Set();
  return [...out, ...dmerged].filter(w => {
    const k = `${w.x0},${w.y0},${w.x1},${w.y1}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A tiny seeded rng from a string, so the same building is always furnished the same way. */
function rngFor(str) {
  let a = 0;
  for (let i = 0; i < str.length; i++) a = (Math.imul(a ^ str.charCodeAt(i), 2654435761) + i) | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Furnishings for a building, in squares from its top-left: [{ p, x, y, n, rot }]. Props stand against the walls; the
 * squares just inside the door and the middle of rooms 6 squares or wider stay clear.
 */
export function furnish(it, doors = []) {
  const spec = FURNISH[it.id];
  const s = it.s;
  if (!spec || s < 1) return [];
  const area = s * s;
  const taken = new Set();
  const key = (x, y) => `${x},${y}`;
  // Keep the door's inside square (and the one beyond it) free.
  for (const door of [doors].flat().filter(Boolean)) {
    const dx = Math.min(door.x0, door.x1) - it.x;
    const dy = Math.min(door.y0, door.y1) - it.y;
    const cells = door.y0 === door.y1
      ? (dy === 0 ? [[dx, 0], [dx, 1]] : [[dx, s - 1], [dx, s - 2]])
      : (dx === 0 ? [[0, dy], [1, dy]] : [[s - 1, dy], [s - 2, dy]]);
    for (const [x, y] of cells) taken.add(key(x, y));
  }
  if (s >= 6) {
    const c0 = Math.floor(s / 2) - 1;
    for (let y = c0; y <= c0 + 1; y++) for (let x = c0; x <= c0 + 1; x++) taken.add(key(x, y));
  }
  const free = (x, y, n) => {
    if (x < 0 || y < 0 || x + n > s || y + n > s) return false;
    for (let j = y; j < y + n; j++) for (let i = x; i < x + n; i++) if (taken.has(key(i, j))) return false;
    return true;
  };
  const take = (x, y, n) => { for (let j = y; j < y + n; j++) for (let i = x; i < x + n; i++) taken.add(key(i, j)); };
  // Spots against the walls (clockwise from the top-left), tried before anything in the middle of the room.
  const wallSpots = [];
  for (let x = 0; x < s; x++) wallSpots.push([x, 0]);
  for (let y = 1; y < s; y++) wallSpots.push([s - 1, y]);
  for (let x = s - 2; x >= 0; x--) wallSpots.push([x, s - 1]);
  for (let y = s - 2; y >= 1; y--) wallSpots.push([0, y]);
  const innerSpots = [];
  for (let y = 1; y < s - 1; y++) for (let x = 1; x < s - 1; x++) innerSpots.push([x, y]);
  const rng = rngFor(it.fid + it.id);
  const out = [];
  const wanted = [...spec].sort((a, b) => b[1] - a[1]);
  const tryList = (list, n, p, start) => {
    for (let q = 0; q < list.length; q++) {
      const [x0, y0] = list[(start + q) % list.length];
      // A big prop at a wall spot slides inward so it still fits, keeping its back to that wall.
      const x = x0 === s - 1 ? s - n : Math.min(x0, s - n);
      const y = y0 === s - 1 ? s - n : Math.min(y0, s - n);
      if (free(x, y, n)) { take(x, y, n); out.push({ p, x, y, n, rot: wallRotation(x, y, n, s) }); return true; }
    }
    return false;
  };
  for (const [p, n0, per] of wanted) {
    let n = Math.min(n0, s);
    const count = Math.max(1, Math.round(per * area / 16));
    for (let k = 0; k < count; k++) {
      const start = Math.floor(rng() * wallSpots.length);
      // Tables may stand in the middle of a room; everything else wants a wall.
      const lists = p === "table" ? [innerSpots, wallSpots] : [wallSpots, innerSpots];
      let ok = false;
      while (!ok && n >= 1) {
        ok = tryList(lists[0], n, p, start) || tryList(lists[1], n, p, Math.floor(rng() * Math.max(1, lists[1].length)));
        if (!ok) n -= 1; // a smaller one fits where the full size doesn't
      }
      if (!ok) break;
      n = Math.min(n0, s);
    }
  }
  return out;
}

/** Turn a prop so its back is to the nearest wall (0, 90, 180, 270 degrees; art is drawn with its back at the top). */
function wallRotation(x, y, n, s) {
  const d = [y, s - (x + n), s - (y + n), x];
  const i = d.indexOf(Math.min(...d));
  return [0, 90, 180, 270][i];
}

/** Patterns for open ground. */
export function yardProps(it) {
  const s = it.s;
  const pattern = YARD_PROPS[it.id];
  const out = [];
  const mid = Math.floor(s / 2) - 1;
  switch (pattern) {
    case "centre-well":
      out.push({ p: s >= 4 ? "fountain" : "well", x: Math.max(0, mid), y: Math.max(0, mid), n: Math.min(2, s), rot: 0 });
      break;
    case "corner-hay":
      out.push({ p: "hay", x: s - 1, y: 0, n: 1, rot: 0 });
      break;
    case "tree-grid": {
      // Fruit trees in rows, a little irregular, crowns overlapping.
      const rng = rngFor(it.fid + "orchard");
      for (let y = 0; y + 2 <= s; y += 2) for (let x = 0; x + 2 <= s; x += 2) {
        const n = 2.3 + rng() * 0.5;
        out.push({ p: "tree", x: x + 1 - n / 2 + (rng() - 0.5) * 0.3, y: y + 1 - n / 2 + (rng() - 0.5) * 0.3, n, rot: Math.floor(rng() * 360), tall: true });
      }
      break;
    }
    case "dummies":
      for (let x = 1; x < s - 1; x += 2) out.push({ p: "dummy", x, y: 1, n: 1, rot: 0 });
      out.push({ p: "weaponrack", x: 0, y: s - 1, n: 1, rot: 180 });
      out.push({ p: "weaponrack", x: s - 1, y: s - 1, n: 1, rot: 180 });
      break;
    case "garden":
      out.push({ p: "fountain", x: mid, y: mid, n: 2, rot: 0 });
      out.push({ p: "oak", x: -0.2, y: -0.2, n: 2.4, rot: 0, tall: true }, { p: "oak", x: s - 2.2, y: s - 2.2, n: 2.4, rot: 90, tall: true });
      out.push({ p: "bush", x: s - 1.6, y: 0.2, n: 1.3, rot: 40 }, { p: "flowers", x: 0.3, y: s - 1.7, n: 1.3, rot: 0 });
      out.push({ p: "statue", x: mid - 1, y: mid + 0.5, n: 1, rot: 0 }, { p: "statue", x: mid + 2, y: mid + 0.5, n: 1, rot: 0 });
      break;
    case "market":
      out.push({ p: "fountain", x: mid, y: mid, n: 2, rot: 0 });
      for (let x = 0; x + 2 <= s; x += 3) { out.push({ p: "stall", x, y: 0, n: 2, rot: 180 }); out.push({ p: "stall", x, y: s - 2, n: 2, rot: 0 }); }
      break;
    default:
  }
  return out;
}

/** Squares inside the grounds that something stands on (buildings, yards, wall fixtures, the gate road). */
function occupancy(side, lay, roads) {
  const set = new Set();
  const add = (x, y, w, h) => { for (let j = Math.floor(y); j < y + h; j++) for (let i = Math.floor(x); i < x + w; i++) set.add(`${i},${j}`); };
  for (const it of lay.items) add(it.x - 0.5, it.y - 0.5, it.s + 1, it.s + 1);
  for (const f of lay.fixtures) add(f.x, f.y, f.w, f.h);
  for (const r of roads) add(r.x, r.y, r.w, r.h);
  return set;
}

/**
 * Trees round the map edge and small things on the ground, by terrain. Deterministic: seeded from the Bastion's name
 * and creation time, so the dressing doesn't jump about on every redraw. Squares from the centre (x, y = centre).
 */
function dress(record, terrain, side, total, offset, clearFrom, blocked) {
  const D = DRESSING[terrain] ?? DRESSING.plains;
  const rng = rngFor(`${record?.name ?? ""}|${record?.createdAt ?? 0}|dress`);
  const pick = list => {
    const sum = list.reduce((n, [, w]) => n + w, 0);
    let r = rng() * sum;
    for (const [k, w] of list) { if ((r -= w) <= 0) return k; }
    return list[list.length - 1][0];
  };
  const h = side / 2;
  const lo = -offset;
  const hi = total - offset;
  const wallOut = h + 1;               // the outer face of the wall
  // clearFrom: the first free square outside the walls, palisade and moat.
  const onRoad = (x, y) => y > h && x > -3.5 && x < 2.5;
  const outside = (x, y) => Math.max(Math.abs(x + 0.5), Math.abs(y + 0.5)) > clearFrom;
  const trees = [];
  if (D.trees.length) {
    // Walk round the map edge in steps, putting a tree near (and often past) the edge.
    const per = total * 4;
    const n = Math.round(per / 10 * D.treeDensity);
    for (let i = 0; i < n; i++) {
      const t = (i + rng() * 0.8) / n * per;
      const edge = Math.floor(t / total);
      const along = lo + (t % total);
      const inset = rng() * 2.6 - 0.6;
      let x, y;
      if (edge === 0) { x = along; y = lo + inset; }
      else if (edge === 1) { x = hi - inset; y = along; }
      else if (edge === 2) { x = hi - along + lo; y = hi - inset; }
      else { x = lo + inset; y = hi - along + lo; }
      if (onRoad(x, y) || !outside(x, y)) continue;
      const kind = pick(D.trees);
      const size = kind === "bush" ? 1.2 + rng() * 0.8 : 2.6 + rng() * 1.6;
      trees.push({ p: kind, x, y, n: size, rot: Math.floor(rng() * 360) });
    }
  }
  const decals = [];
  // Outside the walls.
  const openOut = Math.max(0, total * total - (2 * clearFrom) ** 2);
  const nOut = Math.round(openOut / 10 * D.density);
  for (let i = 0, tries = 0; i < nOut && tries < nOut * 6; tries++) {
    const x = lo + rng() * total;
    const y = lo + rng() * total;
    if (onRoad(x, y) || !outside(x, y)) continue;
    const kind = pick(D.decals);
    decals.push({ p: kind, x, y, n: decalSize(kind, rng), rot: Math.floor(rng() * 360), alpha: 0.85 + rng() * 0.15 });
    i++;
  }
  // Inside the walls, on open bailey only.
  const nIn = Math.round(side * side / 18);
  for (let i = 0, tries = 0; i < nIn && tries < nIn * 8; tries++) {
    const x = -h + rng() * side;
    const y = -h + rng() * side;
    if (blocked.has(`${Math.floor(x)},${Math.floor(y)}`)) continue;
    const kind = terrain === "underground" ? pick([["rocks", 2], ["puddle", 1], ["debris", 2]]) : pick(BAILEY_DECALS);
    decals.push({ p: kind, x, y, n: decalSize(kind, rng) * 0.8, rot: Math.floor(rng() * 360), alpha: 0.8 + rng() * 0.2 });
    i++;
  }
  void wallOut;
  return { trees, decals };
}

function decalSize(kind, rng) {
  const base = { grass: 0.8, flowers: 0.9, rocks: 1, leaves: 1.1, puddle: 1.3, debris: 1.1, bush: 1.3 }[kind] ?? 1;
  return base * (0.75 + rng() * 0.5);
}

/** Little groups of barrels, crates, hay and carts stood against the inside of the wall, on free ground. */
function wallClutter(record, side, blocked) {
  const rng = rngFor(`${record?.name ?? ""}|${record?.createdAt ?? 0}|clutter`);
  const h = side / 2;
  const out = [];
  const n = Math.round(side / 5);
  const taken = new Set();
  for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
    const group = WALL_CLUTTER[Math.floor(rng() * WALL_CLUTTER.length)];
    const edge = Math.floor(rng() * 4);
    const along = -h + 1 + Math.floor(rng() * (side - 4));
    let x = edge === 0 || edge === 2 ? along : edge === 1 ? h - 1 : -h;
    let y = edge === 1 || edge === 3 ? along : edge === 2 ? h - 1 : -h;
    const pieces = [];
    let ok = true;
    for (const [p, size] of group) {
      const px = edge === 1 ? x - (size - 1) : x, py = edge === 2 ? y - (size - 1) : y;
      for (let j = py; j < py + size; j++) for (let k = px; k < px + size; k++) {
        if (blocked.has(`${k},${j}`) || taken.has(`${k},${j}`) || Math.abs(k) > h || Math.abs(j) > h) ok = false;
      }
      pieces.push({ p, x: px, y: py, n: size, rot: [0, 90, 180, 270][edge] });
      if (edge === 0 || edge === 2) x += size; else y += size;
    }
    if (!ok) continue;
    for (const q of pieces) for (let j = q.y; j < q.y + q.n; j++) for (let k = q.x; k < q.x + q.n; k++) taken.add(`${k},${j}`);
    out.push(...pieces);
    i++;
  }
  return out;
}
