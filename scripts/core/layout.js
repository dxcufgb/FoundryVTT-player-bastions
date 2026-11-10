import { FOOTPRINTS } from "../data/grounds.js";
import { footprintOf, groundsOf } from "./grounds.js";

/**
 * Bastion layout: where each building stands inside the walls. Pure.
 *
 * Coordinates are 5-ft squares measured from the centre of the grounds, so a grounds of side S spans
 * x, y ∈ [-S/2, S/2 - 1] and the outer wall runs in the ring just outside that square. Every grounds side is even, so
 * the centre never shifts when the grounds are extended: a building placed on a Plot keeps its squares on the Compound.
 *
 * record.layout = { featureId: { x, y, s } }: top-left square and side of each placed building. Placements are never
 * moved once made. A building that grows (enlarged room, upgraded market) grows in place around its old squares when
 * it can, and only moves when it can't. Anything that doesn't fit yet stays out of the stored layout and is tried
 * again on the next sync (after the grounds are extended, say).
 *
 * Wall fixtures (gatehouse, towers, ballistae, postern) are not stored: they sit on the wall, so they follow it. The
 * first watchtower is the exception: it stands in the middle of the grounds (4 × 4, exactly centred), and anything
 * stored where it now stands is placed again.
 */

/** Buildings that sit on the outer wall rather than inside the grounds. */
export const WALL_FIXTURES = ["gatehouse", "watchtower", "ballista", "postern"];

/** Open ground: may lie against the wall, and is drawn without a roof line. */
export const YARDS = ["courtyard", "kitchen-garden", "orchard", "training-yard", "pleasure-gardens", "market-square"];

/** Built things that stand in the open: placed like buildings, but with no walls round them. */
export const OPEN = ["well", "deep-well"];

/** Expansions that make the wall round the grounds (old saves' separate walls included). */
const WALL_IDS = ["wall", "palisade", "stone-wall", "reinforce-wall", "wall-walk"];

/** Whether the grounds have a wall round them (a cave's rock counts): fixtures stand on it, else they stand free. */
export function isWalled(record) {
  if (record?.structure?.type === "cave") return true;
  return Object.values(record?.features ?? {}).some(f => WALL_IDS.includes(f?.id) && f.enclosed !== false);
}

/** What kind of thing an expansion is on the map: "room" (part of the keep), "yard", "building", "wall" or null. */
export function layoutKind(exp) {
  if (!exp) return null;
  if (WALL_FIXTURES.includes(exp.id)) return "wall";
  if (YARDS.includes(exp.id)) return "yard";
  if (exp.group === "rooms") return "room";
  const fp = exp.footprint ?? FOOTPRINTS[exp.id];
  if (!fp) return null;
  return "building";
}

/** Side in squares of the square that holds `squares`. */
export const sideFor = squares => Math.max(1, Math.ceil(Math.sqrt(Math.max(1, squares))));

/** Bounds of the grounds of side S: inclusive min and max on both axes. */
export function boundsOf(side) {
  const h = side / 2;
  return { min: -h, max: h - 1, side };
}

/** The 2-wide road from the gate (south wall, centre) up to the keep. */
export const ROAD = { x0: -1, x1: 0, y0: 1 };

/** Ordered fallbacks: first try to keep a gap round buildings, a lane behind the wall and the gate road clear. */
const ATTEMPTS = [
  { gap: 1, lane: true, road: true },
  { gap: 0, lane: true, road: true },
  { gap: 0, lane: false, road: true },
  { gap: 0, lane: false, road: false }
];

/** Where the keep's rooms gather. */
const KEEP_ANCHOR = { x: 0, y: -3 };

/**
 * The wall fixtures for grounds of side S, from the record's features. Each { fid, id, kind:"wall", x, y, w, h,
 * where: "south"|"nw"|"ne"|"sw"|"se"|"west"|"east"|"north" }. Rectangles may reach past the grounds into the wall
 * ring; the parts inside the grounds are kept free of buildings.
 */
export function wallFixtures(record, catalog, side, walled = isWalled(record)) {
  const { min, max } = boundsOf(side);
  const out = [];
  const feats = orderedFeatures(record);
  for (const [fid, f] of feats) {
    const exp = catalog.get(f.id);
    if (!exp) continue;
    if (f.id === "gatehouse") out.push({ fid, id: f.id, kind: "wall", where: "south", x: -2, y: max, w: 4, h: 3 });
    else if (f.id === "postern") out.push({ fid, id: f.id, kind: "wall", where: "north", x: Math.floor(side / 4), y: min - 1, w: 1, h: 2 });
  }
  // The first watchtower in the middle of the grounds; more towers on the corners, in a fixed order, as many as were
  // built (watchtower is an "each" with a count).
  const centre = { where: "centre", x: -2, y: -2, w: 4, h: 4 };
  const corners = [
    { where: "ne", x: max, y: min - 2 }, { where: "nw", x: min - 2, y: min - 2 },
    { where: "se", x: max, y: max }, { where: "sw", x: min - 2, y: max }
  ];
  const ballistaSpots = [
    { where: "west", x: min, y: -1 }, { where: "east", x: max - 1, y: -1 },
    { where: "north", x: -4, y: min }, { where: "south", x: 3, y: max - 1 }
  ];
  let tower = 0;
  let ballista = 0;
  for (const [fid, f] of feats) {
    const n = Math.max(1, Number(f.count) || 1);
    for (let i = 0; i < n; i++) {
      if (f.id === "watchtower" && tower === 0) { out.push({ fid, id: f.id, kind: "wall", ...centre, n: i }); tower++; }
      // With no wall the other towers aren't corner towers: syncLayout places them free-standing (freeTowers).
      else if (f.id === "watchtower" && walled && tower - 1 < corners.length) out.push({ fid, id: f.id, kind: "wall", ...corners[tower++ - 1], w: 3, h: 3, n: i });
      if (f.id === "ballista" && ballista < ballistaSpots.length) out.push({ fid, id: f.id, kind: "wall", ...ballistaSpots[ballista++], w: 2, h: 2, n: i });
    }
  }
  return out;
}

/** Features in build order (oldest first, then id), so placement is the same every time. */
function orderedFeatures(record) {
  return Object.entries(record?.features ?? {})
    .filter(([, f]) => f)
    .sort(([a, fa], [b, fb]) => ((fa.builtAt ?? 0) - (fb.builtAt ?? 0)) || (a < b ? -1 : a > b ? 1 : 0));
}

/** An occupancy grid over the grounds. Cells hold the kind that stands there ("room", "yard", "building", "wall"). */
class Grid {
  constructor(side) {
    this.b = boundsOf(side);
    this.n = side;
    this.cells = new Array(side * side).fill(null);
  }
  inside(x, y) { return x >= this.b.min && x <= this.b.max && y >= this.b.min && y <= this.b.max; }
  get(x, y) { return this.inside(x, y) ? this.cells[(y - this.b.min) * this.n + (x - this.b.min)] : null; }
  set(x, y, v) { if (this.inside(x, y)) this.cells[(y - this.b.min) * this.n + (x - this.b.min)] = v; }
  fill(x, y, w, h, v) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, v); }
}

/** Whether a square of side s with top-left (x, y) can stand here for a thing of `kind` under `opts`. */
function fits(grid, x, y, s, kind, opts) {
  const { min, max } = grid.b;
  const lo = opts.lane ? min + 1 : min;
  const hi = opts.lane ? max - 1 : max;
  if (x < lo || y < lo || x + s - 1 > hi || y + s - 1 > hi) return false;
  if (opts.road && x <= ROAD.x1 && x + s - 1 >= ROAD.x0 && y + s - 1 >= ROAD.y0) return false;
  const g = opts.gap;
  for (let j = y - g; j < y + s + g; j++) {
    for (let i = x - g; i < x + s + g; i++) {
      const v = grid.get(i, j);
      if (!v) continue;
      const own = i >= x && i < x + s && j >= y && j < y + s;
      if (own) return false;
      // In the gap ring: rooms may touch rooms (they make up the keep); nothing else may touch.
      if (!(kind === "room" && v === "room")) return false;
    }
  }
  return true;
}

/** Score a candidate: lower is better. */
function score(kind, x, y, s, anchor) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  if (kind === "yard") return -(cx * cx + cy * cy); // open ground drifts out toward the corners
  const dx = cx - anchor.x;
  const dy = cy - anchor.y;
  return dx * dx + dy * dy;
}

/** The best free spot for a square of side s, trying the fallbacks in order. Returns { x, y } or null. */
function findSpot(grid, s, kind, anchor, prefer) {
  const { min, max } = grid.b;
  for (const opts of ATTEMPTS) {
    let best = null;
    const candidates = prefer ?? null;
    if (candidates) {
      for (const c of candidates) {
        if (!fits(grid, c.x, c.y, s, kind, opts)) continue;
        const sc = c.score;
        if (!best || sc < best.sc) best = { x: c.x, y: c.y, sc };
      }
      if (best) return best;
      continue;
    }
    for (let y = min; y <= max - s + 1; y++) {
      for (let x = min; x <= max - s + 1; x++) {
        if (!fits(grid, x, y, s, kind, opts)) continue;
        const sc = score(kind, x, y, s, anchor);
        if (!best || sc < best.sc - 1e-9) best = { x, y, sc };
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Brings the layout up to date with the features: keeps what is placed, grows what grew, drops what is gone, and
 * places what is new. Returns { layout, changed, items, fixtures, unplaced, grounds, side } where
 *   layout    the new record.layout (store it when `changed`)
 *   items     [{ fid, id, kind, x, y, s, moved? }] for every placed building, keep rooms included
 *   fixtures  wallFixtures(...)
 *   unplaced  [{ fid, id, s }] buildings that don't fit yet
 */
export function syncLayout(record, catalog, rules) {
  const grounds = groundsOf(record, catalog, rules);
  const side = grounds.side;
  const grid = new Grid(side);
  const old = record?.layout ?? {};
  const layout = {};
  let changed = false;
  const items = [];
  const unplaced = [];
  const fixtures = wallFixtures(record, catalog, side);
  for (const w of fixtures) grid.fill(w.x, w.y, w.w, w.h, "wall");

  const feats = orderedFeatures(record).map(([fid, f]) => {
    const exp = catalog.get(f.id);
    const kind = layoutKind(exp);
    const sq = kind && kind !== "wall" ? footprintOf(exp, f) : 0;
    return { fid, f, exp, kind, s: sq > 0 ? sideFor(sq) : 0 };
  }).filter(e => e.kind && e.kind !== "wall" && e.s > 0);
  // No wall: watchtowers after the first (the centre tower) stand free like buildings, 3 × 3, near the middle.
  if (!isWalled(record)) {
    let seen = 0;
    for (const [fid, f] of orderedFeatures(record)) {
      if (f.id !== "watchtower") continue;
      for (let i = 0; i < Math.max(1, Number(f.count) || 1); i++) {
        if (seen++ === 0) continue;
        feats.push({ fid: `${fid}#${i}`, f, exp: catalog.get("watchtower"), kind: "tower", s: 3 });
      }
    }
  }
  const present = new Set(feats.map(e => e.fid));
  for (const fid of Object.keys(old)) if (!present.has(fid)) changed = true;

  // 1. Everything already placed at its stored size stays exactly where it is (unless a fixture now stands there:
  //    the centre tower in an older layout, say).
  const pending = [];
  const onFixture = p => { for (let j = p.y; j < p.y + p.s; j++) for (let i = p.x; i < p.x + p.s; i++) if (grid.get(i, j) === "wall") return true; return false; };
  for (const e of feats) {
    const p = old[e.fid];
    if (p && p.s === e.s && inBounds(p, side) && !onFixture(p)) {
      grid.fill(p.x, p.y, p.s, p.s, e.kind);
      layout[e.fid] = { x: p.x, y: p.y, s: p.s };
      items.push({ fid: e.fid, id: e.f.id, kind: e.kind, x: p.x, y: p.y, s: p.s });
    } else pending.push(e);
  }

  // 2. Grown buildings first (they had their ground before anything new), then new ones, in build order.
  pending.sort((a, b) => (old[b.fid] ? 1 : 0) - (old[a.fid] ? 1 : 0));
  for (const e of pending) {
    const anchor = e.kind === "room" ? roomAnchor(items) : { x: 0, y: 0 };
    const p = old[e.fid];
    let spot = null;
    let moved = false;
    if (p) {
      // Grow in place: every position of the new square that still covers the old one, nearest the old centre.
      const grow = e.s - p.s;
      const prefer = [];
      if (grow >= 0) {
        for (let dy = -grow; dy <= 0; dy++) for (let dx = -grow; dx <= 0; dx++) {
          const x = p.x + dx;
          const y = p.y + dy;
          const ddx = x + e.s / 2 - (p.x + p.s / 2);
          const ddy = y + e.s / 2 - (p.y + p.s / 2);
          prefer.push({ x, y, score: ddx * ddx + ddy * ddy + (y * 1e-6) + (x * 1e-9) });
        }
      } else prefer.push({ x: p.x, y: p.y, score: 0 });
      spot = findSpot(grid, e.s, e.kind, anchor, prefer);
      if (!spot) { spot = findSpot(grid, e.s, e.kind, anchor); moved = !!spot; }
    } else spot = findSpot(grid, e.s, e.kind, anchor);
    changed = true;
    if (!spot) { unplaced.push({ fid: e.fid, id: e.f.id, s: e.s }); continue; }
    grid.fill(spot.x, spot.y, e.s, e.s, e.kind);
    layout[e.fid] = { x: spot.x, y: spot.y, s: e.s };
    items.push({ fid: e.fid, id: e.f.id, kind: e.kind, x: spot.x, y: spot.y, s: e.s, ...(moved ? { moved: true } : {}) });
  }
  if (!changed && Object.keys(layout).length !== Object.keys(old).length) changed = true;
  return { layout, changed, items, fixtures, unplaced, grounds, side };
}

function inBounds(p, side) {
  const { min, max } = boundsOf(side);
  return p.x >= min && p.y >= min && p.x + p.s - 1 <= max && p.y + p.s - 1 <= max;
}

/** The keep grows round its existing rooms. */
function roomAnchor(items) {
  const rooms = items.filter(i => i.kind === "room");
  if (!rooms.length) return KEEP_ANCHOR;
  let x = 0;
  let y = 0;
  let w = 0;
  for (const r of rooms) { const a = r.s * r.s; x += (r.x + r.s / 2) * a; y += (r.y + r.s / 2) * a; w += a; }
  return { x: x / w, y: y / w };
}

/**
 * Walls and doors for the placed buildings, as segments on square edges (in squares, same frame as the layout).
 * Returns [{ x0, y0, x1, y1, door: bool, fid }]. Yards get no walls. Keep rooms share interior walls with a door
 * in each shared stretch; each building, and each keep room with an outside edge on the side facing the gate road,
 * gets one outside door on the edge facing the centre of the grounds (keep rooms: facing south).
 */
export function buildingWalls(items) {
  const segs = [];
  const solid = items.filter(i => i.kind === "room" || (i.kind === "building" && !OPEN.includes(i.id)));
  const roomAt = new Map();
  for (const r of solid) if (r.kind === "room") for (let j = r.y; j < r.y + r.s; j++) for (let i = r.x; i < r.x + r.s; i++) roomAt.set(`${i},${j}`, r.fid);
  const sharedDone = new Set();
  for (const b of solid) {
    const edges = [
      { side: "n", cells: range(b.x, b.s).map(i => [i, b.y - 1]), seg: i => [i, b.y, i + 1, b.y] },
      { side: "s", cells: range(b.x, b.s).map(i => [i, b.y + b.s]), seg: i => [i, b.y + b.s, i + 1, b.y + b.s] },
      { side: "w", cells: range(b.y, b.s).map(j => [b.x - 1, j]), seg: j => [b.x, j, b.x, j + 1] },
      { side: "e", cells: range(b.y, b.s).map(j => [b.x + b.s, j]), seg: j => [b.x + b.s, j, b.x + b.s, j + 1] }
    ];
    const doorSide = b.kind === "room" ? "s" : facing(b);
    let outsideDoor = false;
    for (const e of edges) {
      const idx = e.side === "n" || e.side === "s" ? range(b.x, b.s) : range(b.y, b.s);
      // Split the edge into runs by what lies beyond it: outside, or a neighbouring keep room.
      let run = null;
      const runs = [];
      idx.forEach((v, k) => {
        const [cx, cy] = e.cells[k];
        const other = b.kind === "room" ? (roomAt.get(`${cx},${cy}`) ?? null) : null;
        if (!run || run.other !== other) { run = { other, from: v, to: v }; runs.push(run); } else run.to = v;
      });
      for (const r of runs) {
        if (r.other) {
          // Shared with another room: draw it once, from the room with the smaller id, with a door in the middle.
          const key = [b.fid, r.other].sort().join("|") + `:${e.side === "n" || e.side === "s" ? "h" : "v"}:${r.from}`;
          if (b.fid > r.other || sharedDone.has(key)) continue;
          sharedDone.add(key);
          pushRun(segs, e, r, b.fid, true);
        } else {
          const wantDoor = !outsideDoor && e.side === doorSide && (r.to - r.from + 1) >= 1;
          if (wantDoor) outsideDoor = true;
          pushRun(segs, e, r, b.fid, wantDoor);
        }
      }
    }
  }
  return segs;
}

function pushRun(segs, e, r, fid, door) {
  const len = r.to - r.from + 1;
  const mid = r.from + Math.floor((len - 1) / 2);
  for (let v = r.from; v <= r.to; v++) {
    const [x0, y0, x1, y1] = e.seg(v);
    segs.push({ x0, y0, x1, y1, door: door && v === mid, fid });
  }
}

const range = (from, n) => Array.from({ length: n }, (_, k) => from + k);

/** The side of a building that faces the centre of the grounds. */
function facing(b) {
  const cx = b.x + b.s / 2;
  const cy = b.y + b.s / 2;
  if (Math.abs(cx) > Math.abs(cy)) return cx > 0 ? "w" : "e";
  return cy > 0 ? "n" : "s";
}

/**
 * Merges straight runs of wall segments into longer ones (doors stay single squares), so the scene gets few walls.
 */
export function mergeSegments(segs) {
  const out = [];
  const key = s => (s.y0 === s.y1 ? `h:${s.y0}:${s.door ? "d" : "w"}` : `v:${s.x0}:${s.door ? "d" : "w"}`);
  const groups = new Map();
  for (const s of segs) {
    if (s.door) { out.push({ ...s }); continue; }
    const k = key(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  for (const [k, list] of groups) {
    const horiz = k.startsWith("h");
    list.sort((a, b) => (horiz ? a.x0 - b.x0 : a.y0 - b.y0));
    let cur = null;
    for (const s of list) {
      if (cur && (horiz ? cur.x1 === s.x0 : cur.y1 === s.y0)) { cur.x1 = s.x1; cur.y1 = s.y1; continue; }
      if (cur) out.push(cur);
      cur = { ...s };
    }
    if (cur) out.push(cur);
  }
  // Drop exact duplicates (two buildings touching along an edge draw it twice when gap 0).
  const seen = new Set();
  return out.filter(s => {
    const a = `${Math.min(s.x0, s.x1)},${Math.min(s.y0, s.y1)},${Math.max(s.x0, s.x1)},${Math.max(s.y0, s.y1)},${s.door}`;
    if (seen.has(a)) return false;
    seen.add(a);
    return true;
  });
}
