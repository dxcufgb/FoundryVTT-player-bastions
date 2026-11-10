import { TILE_SQUARES, TILE_OVERRIDE, WALL_BANDS, BLOCK_CROP, TEXTURE_COLORS, PROP_COLORS, OUTER_WALL_WIDTH } from "./data/map-style.js";
import { OPEN } from "./core/layout.js";

/**
 * Paints a map plan (core/mapplan.js) onto a 2D canvas context, in the manner of a modern sourcebook battle map:
 * organic ground with soft patches and worn paths, scattered small details, thick textured walls, soft ambient
 * occlusion and sun shadows from the upper left, warm pools of firelight, trees framing the edge, and a warm grade.
 * No Foundry dependency: the scene builder runs it in the browser, the preview script runs it under Node.
 *
 * assets: { tex(name) → image|null, prop(name) → image|null, canvas?(w, h) → a new canvas }; px: pixels per square.
 * Anything without art is drawn with a plain stand-in, so a map is always produced.
 */

/** Sun from the upper left: shadows fall down and to the right, this far (squares). */
const SUN = { dx: 0.5, dy: 0.7, blur: 0.35, alpha: 0.45 };
const AO = { blur: 0.3, alpha: 0.4 };
const WALL_W = 0.34;

export function renderMap(ctx, plan, assets, px) {
  const o = plan.offset;
  const size = plan.total * px;
  const r = new Painter(ctx, assets, px, v => (v + o) * px, plan);
  const h = plan.side / 2;

  /* 1. Ground outside, with soft patches of a second ground */
  r.tex(plan.ground, -o, -o, plan.total, plan.total);
  if (plan.mix) r.patches(plan.mix, -o, -o, plan.total, plan.total, { scale: 4.5, cover: 0.3, seed: 11 });

  /* 2. Moat or ditch, with soft banks */
  if (plan.moat) {
    const d = plan.moatD ?? 4;
    const a = -h - d;
    const w = plan.side + 2 * d;
    r.ring(plan.moat === "wet" ? "water" : "mud", a, a, w, w, 2);
    r.bank(a, w, 2, plan.moat === "wet" ? "rgba(30,40,25,0.55)" : "rgba(40,28,15,0.6)");
  }

  /* 3. The bailey, greener toward the walls and in the corners (with no wall round it, the same ground just carries on) */
  if (plan.wall || plan.bailey !== plan.ground) {
    r.tex(plan.bailey, -h, -h, plan.side, plan.side);
    if (plan.baileyMix) r.patches(plan.baileyMix, -h, -h, plan.side, plan.side, { scale: 2.6, cover: 0.3, seed: 23 });
  }

  /* 4. Worn paths from the doors, and the roads */
  if (plan.paths?.length) r.wornPaths(plan.paths, plan.pathTex, -h, plan.side);
  for (const road of plan.roads) r.path(road);
  if (plan.moat && plan.bridge) r.bridge(h, plan.moatD ?? 4);

  /* 5. Small things on the ground */
  for (const d of plan.decals) r.decal(d);

  /* 6. Yards and buildings: floors, rugs, furnishings */
  const yards = plan.items.filter(i => i.kind === "yard");
  const open = plan.items.filter(i => OPEN.includes(i.id));
  const solid = plan.items.filter(i => i.kind !== "yard" && !OPEN.includes(i.id));
  for (const y of yards) {
    r.tex(y.floor, y.x, y.y, y.s, y.s);
    r.softEdge(y.x, y.y, y.s, y.s);
  }
  for (const b of solid) {
    r.tex(b.floor, b.x, b.y, b.s, b.s);
    r.innerShade(b.x, b.y, b.s, b.s);
    if (b.rug) r.prop(b.rug.p, b.x + b.rug.x, b.y + b.rug.y, b.rug.n, b.rug.rot, { shadow: false });
  }
  for (const y of yards) for (const p of y.props) if (!p.tall) r.prop(p.p, y.x + p.x, y.y + p.y, p.n, p.rot);
  for (const w of open) for (const p of w.props) r.prop(p.p, w.x + p.x, w.y + p.y, p.n, p.rot);
  for (const b of solid) {
    for (const p of b.props) r.prop(p.p, b.x + p.x, b.y + p.y, p.n, p.rot);
    if (b.damaged) r.damage(b);
  }
  for (const p of plan.clutter ?? []) r.prop(p.p, p.x, p.y, p.n, p.rot);

  /* 7. Shade: ambient occlusion and sun shadows from everything that stands up */
  const casters = c => {
    for (const w of plan.walls) if (!w.outer && !w.tower && !w.door) r.wallStroke(c, w, WALL_W);
    if (plan.wall && plan.wall.type !== "rock") {
      if (plan.gate) r.ringStroke(c, -h - 1, plan.side + 2);
      else r.withGateGap(c, h, 1, () => r.ringStroke(c, -h - 1, plan.side + 2));
    }
    for (const f of plan.fixtures) r.fixtureShape(c, f, plan);
    for (const t of plan.trees) r.treeShape(c, t);
    for (const y of yards) for (const p of y.props) if (p.tall) r.treeShape(c, { p: p.p, x: y.x + p.x + p.n / 2, y: y.y + p.y + p.n / 2, n: p.n * 0.9 });
  };
  r.shade(casters, AO.blur, 0, 0, AO.alpha);
  r.shade(casters, SUN.blur, SUN.dx, SUN.dy, SUN.alpha);

  for (const y of yards) for (const p of y.props) if (p.tall) r.prop(p.p, y.x + p.x, y.y + p.y, p.n, p.rot, { shadow: false });

  /* 8. Building walls and doors */
  // (The centre tower's Foundry walls aren't painted: its art is the wall.)
  for (const w of plan.walls) if (!w.outer && !w.tower && !w.door) r.wall(w);
  for (const w of plan.walls) if (!w.outer && !w.tower && w.door) r.door(w);

  /* 9. The outer wall, its breaches, and the fixtures on it */
  if (plan.wall) {
    const a = -h - 1;
    const w = plan.side + 2;
    const tex = plan.wall.type === "palisade" ? "palisade" : "wallstone";
    if (plan.wall.type === "rock") r.rockWall(a, w);
    else {
      const t = OUTER_WALL_WIDTH;
      const e = (t - 1) / 2;
      // Without a gatehouse the road goes through a plain timber gate in the wall.
      const draw = () => {
        if (plan.wall.reinforced) r.buttresses(a - e, w + 2 * e, plan);
        if (!r.wallBand(tex, a - e, w + 2 * e, t)) r.ring(tex, a - e, a - e, w + 2 * e, w + 2 * e, t);
        r.ringEdge(a - e, a - e, w + 2 * e, w + 2 * e, t, "rgba(18,14,10,0.95)");
        if (plan.wall.walk) r.crenellations(a - e, w + 2 * e, t);
      };
      if (plan.gate) draw();
      else {
        r.withGateGap(r.ctx, h, 1, draw);
        r.palisadeGate(h, 1);
      }
    }
    for (const b of plan.breaches) r.breach(b);
  }

  if (plan.spikes) r.spikes(h, plan.spikes.d);
  for (const f of plan.fixtures) {
    if (f.id === "gatehouse") r.gatehouse(f, plan);
    else if (f.id === "watchtower") r.tower(f);
    else if (f.id === "ballista") r.ballista(f);
    else if (f.id === "postern") r.postern(f);
  }
  for (const p of plan.extras) r.prop(p.p, p.x, p.y, p.n, p.rot);

  /* 10. Trees over everything near the edge */
  for (const t of plan.trees) r.prop(t.p, t.x - t.n / 2, t.y - t.n / 2, t.n, t.rot, { shadow: false });

  /* 11. Firelight, colour grade, vignette */
  for (const L of plan.lights) r.glow(L);
  r.grade(size);
  r.vignette(size);
}

/** A seeded value-noise field, roughly in [0, 1]. */
function noiseField(seed) {
  const hash = (x, y) => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = t => t * t * (3 - 2 * t);
  const v = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => v(x, y) * 0.65 + v(x * 2.3 + 17, y * 2.3 + 31) * 0.35;
}

/** Small drawing helpers over a context, in square units. */
class Painter {
  constructor(ctx, assets, px, P, plan) { Object.assign(this, { ctx, assets, px, P, plan }); }

  canvas(w, h) {
    if (this.assets.canvas) return this.assets.canvas(w, h);
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  /** Fills a rectangle (squares) with a tiled texture or its stand-in. `target` draws into another context. */
  tex(name, x, y, w, h, alpha = 1, { crop = null, target = null } = {}) {
    const { px, P } = this;
    const ctx = target ?? this.ctx;
    const img = this.assets.tex?.(name);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.rect(P(x), P(y), w * px, h * px);
    ctx.clip();
    const tile = (TILE_OVERRIDE[name] ?? TILE_SQUARES) * px;
    // Tiles are anchored to the map's origin so neighbouring fills of the same texture line up.
    const x0 = Math.floor(P(x) / tile) * tile;
    const y0 = Math.floor(P(y) / tile) * tile;
    if (img) {
      const [cx, cy, cw, ch] = crop ?? [0, 0, 1, 1];
      const iw = img.width, ih = img.height;
      for (let ty = y0; ty < P(y) + h * px; ty += tile) for (let tx = x0; tx < P(x) + w * px; tx += tile) {
        ctx.drawImage(img, cx * iw, cy * ih, cw * iw, ch * ih, tx, ty, tile + 0.5, tile + 0.5);
      }
    } else {
      const [base, speck] = TEXTURE_COLORS[name] ?? ["#777", "#888"];
      ctx.fillStyle = base;
      ctx.fillRect(P(x), P(y), w * px, h * px);
      ctx.fillStyle = speck;
      let seed = (name.length * 7919) | 0;
      const n = Math.ceil(w * h * 6);
      for (let i = 0; i < n; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const rx = (seed % 10000) / 10000;
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const ry = (seed % 10000) / 10000;
        ctx.fillRect(P(x) + rx * w * px, P(y) + ry * h * px, px * 0.12, px * 0.12);
      }
    }
    ctx.restore();
  }

  /**
   * Soft organic patches of a second texture over a rectangle: the texture is drawn on a layer and masked by a noise
   * field. `edge` (squares) makes patches likelier near the rectangle's border (grass creeping in along the walls).
   */
  patches(name, x, y, w, h, { scale = 3, cover = 0.35, seed = 1, edge = 0 } = {}) {
    const { px, P } = this;
    const W = Math.ceil(w * px), H = Math.ceil(h * px);
    const layer = this.canvas(W, H);
    const lctx = layer.getContext("2d");
    lctx.translate(-P(x), -P(y));
    this.tex(name, x, y, w, h, 1, { target: lctx });
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    const res = 4;
    const mw = Math.max(2, Math.ceil(w * res)), mh = Math.max(2, Math.ceil(h * res));
    const mask = this.canvas(mw, mh);
    const mctx = mask.getContext("2d");
    const img = mctx.createImageData(mw, mh);
    const noise = noiseField(seed);
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
      let v = noise((x + i / res) / scale, (y + j / res) / scale);
      if (edge) {
        const d = Math.min(i / res, j / res, w - i / res, h - j / res);
        v += Math.max(0, 1 - d / edge) * 0.45;
      }
      const a = Math.max(0, Math.min(1, (v - (1 - cover)) / 0.12));
      img.data[(j * mw + i) * 4 + 3] = Math.round(a * 255);
    }
    mctx.putImageData(img, 0, 0);
    lctx.globalCompositeOperation = "destination-in";
    lctx.imageSmoothingEnabled = true;
    lctx.drawImage(mask, 0, 0, W, H);
    this.ctx.drawImage(layer, P(x), P(y));
  }

  /** Worn foot paths (polylines in squares) inside the bailey: a texture showing through a soft stroked mask. */
  wornPaths(paths, name, a, side) {
    const { px, P } = this;
    const W = Math.ceil(side * px);
    const layer = this.canvas(W, W);
    const lctx = layer.getContext("2d");
    lctx.translate(-P(a), -P(a));
    this.tex(name, a, a, side, side, 1, { target: lctx });
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    // The mask: strokes drawn small and scaled up twice, for soft edges.
    const k = Math.max(1, Math.round(px * 0.18));
    const sw = Math.max(2, Math.ceil(W / k));
    const m = this.canvas(sw, sw);
    const mc = m.getContext("2d");
    mc.scale(sw / W, sw / W);
    mc.translate(-P(a), -P(a));
    mc.strokeStyle = "rgba(0,0,0,1)";
    mc.lineWidth = px * 1.35;
    mc.lineCap = "round";
    mc.lineJoin = "round";
    for (const pts of paths) {
      mc.beginPath();
      pts.forEach(([x, y], i) => (i ? mc.lineTo(P(x), P(y)) : mc.moveTo(P(x), P(y))));
      mc.stroke();
    }
    const m2 = this.canvas(sw * 3, sw * 3);
    const m2c = m2.getContext("2d");
    m2c.imageSmoothingEnabled = true;
    m2c.drawImage(m, 0, 0, sw * 3, sw * 3);
    lctx.globalCompositeOperation = "destination-in";
    lctx.imageSmoothingEnabled = true;
    lctx.drawImage(m2, 0, 0, W, W);
    this.ctx.drawImage(layer, P(a), P(a));
  }

  /** A worn road: its texture with feathered long edges. */
  path(road) {
    const { px, P } = this;
    const pad = 0.35;
    const W = Math.ceil((road.w + pad * 2) * px), H = Math.ceil(road.h * px);
    const layer = this.canvas(W, H);
    const lctx = layer.getContext("2d");
    lctx.translate(-P(road.x - pad), -P(road.y));
    this.tex(road.tex, road.x - pad, road.y, road.w + pad * 2, road.h, 1, { target: lctx });
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = "destination-in";
    const g = lctx.createLinearGradient(0, 0, W, 0);
    const f = (pad * px) / W;
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(f * 1.6, "rgba(0,0,0,1)");
    g.addColorStop(1 - f * 1.6, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    lctx.fillStyle = g;
    lctx.fillRect(0, 0, W, H);
    this.ctx.drawImage(layer, P(road.x - pad), P(road.y));
  }

  /** A bridge over the moat whose inner edge is `d` squares out from the grounds. */
  bridge(h, d = 4) {
    const { P } = this;
    const y0 = h + d - 2.2, y1 = h + d + 0.2;
    this.tex("planks", -1.25, y0, 2.5, y1 - y0);
    this.line(P(-1.25), P(y0), P(-1.25), P(y1), "#2e1f10", 0.12);
    this.line(P(1.25), P(y0), P(1.25), P(y1), "#2e1f10", 0.12);
  }

  /** The spike barricade: crossed, sharpened stakes along the ring `d` squares out, leaving the road clear. */
  spikes(h, d) {
    const { ctx, px, P } = this;
    const lo = -h - d, hi = h + d - 1;
    const stake = (x0, y0, x1, y1) => {
      ctx.strokeStyle = "rgba(20,12,6,0.55)";
      ctx.lineWidth = px * 0.16;
      ctx.beginPath(); ctx.moveTo(P(x0) + px * 0.08, P(y0) + px * 0.1); ctx.lineTo(P(x1) + px * 0.08, P(y1) + px * 0.1); ctx.stroke();
      ctx.strokeStyle = "#6b4a2b";
      ctx.lineWidth = px * 0.11;
      ctx.beginPath(); ctx.moveTo(P(x0), P(y0)); ctx.lineTo(P(x1), P(y1)); ctx.stroke();
      ctx.fillStyle = "#c9b48c";
      ctx.beginPath(); ctx.arc(P(x1), P(y1), px * 0.05, 0, Math.PI * 2); ctx.fill();
    };
    ctx.save();
    ctx.lineCap = "round";
    for (let i = lo; i <= hi; i++) {
      for (const [x, y, out] of [[i, lo, [0, -1]], [i, hi, [0, 1]], [lo, i, [-1, 0]], [hi, i, [1, 0]]]) {
        if (y === hi && out[1] === 1 && x >= -1 && x < 1) continue; // the road
        for (const off of [0.25, 0.75]) {
          const cx = x + (out[0] ? 0.5 : off), cy = y + (out[1] ? 0.5 : off);
          // Two stakes crossed, pointing outward.
          const sx = out[0] ? 0 : 0.22, sy = out[1] ? 0 : 0.22;
          stake(cx - sx - out[0] * 0.3, cy - sy - out[1] * 0.3, cx + sx + out[0] * 0.35, cy + sy + out[1] * 0.35);
          stake(cx + sx - out[0] * 0.3, cy + sy - out[1] * 0.3, cx - sx + out[0] * 0.35, cy - sy + out[1] * 0.35);
        }
      }
    }
    ctx.restore();
  }

  /** A reinforced wall: stone buttresses on the outside face every four squares (not across the gate). */
  buttresses(a, w, plan) {
    const s = 0.45;
    for (let i = 2; i < w - 2; i += 4) {
      const p = a + i;
      for (const [x, y, bw, bh] of [[p - 0.4, a - s, 0.8, s], [p - 0.4, a + w, 0.8, s], [a - s, p - 0.4, s, 0.8], [a + w, p - 0.4, s, 0.8]]) {
        if (y >= a + w - 0.1 && Math.abs(x + 0.4) < 2.5 && plan.gate) continue;
        this.tex("wallstone", x, y, bw, bh);
        this.rectStroke(x, y, bw, bh, "rgba(18,14,10,0.9)", 0.05);
      }
    }
  }

  /** A wall walk with crenellations: merlons along the outer edge of the wall top. */
  crenellations(a, w, t) {
    const { ctx, px, P } = this;
    ctx.save();
    ctx.fillStyle = "rgba(30,24,18,0.55)";
    const m = 0.28;
    for (let i = 0.15; i < w - 0.3; i += 0.7) {
      ctx.fillRect(P(a + i), P(a), 0.35 * px, m * px);
      ctx.fillRect(P(a + i), P(a + w) - m * px, 0.35 * px, m * px);
      ctx.fillRect(P(a), P(a + i), m * px, 0.35 * px);
      ctx.fillRect(P(a + w) - m * px, P(a + i), m * px, 0.35 * px);
    }
    // The walk itself: a lighter strip along the inner half of the wall top.
    ctx.strokeStyle = "rgba(255,240,210,0.12)";
    ctx.lineWidth = px * 0.25;
    ctx.strokeRect(P(a + t * 0.62), P(a + t * 0.62), (w - t * 1.24) * px, (w - t * 1.24) * px);
    ctx.restore();
  }

  /** Runs `draw` with the road's gap in the south side of the ring `d` squares out clipped away. */
  withGateGap(ctx, h, d, draw) {
    const { P, px } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(P(-h - d - 2), P(-h - d - 2), (2 * h + 2 * d + 4) * px, (2 * h + 2 * d + 4) * px);
    ctx.rect(P(-1), P(h + d - 1.2), 2 * px, 1.4 * px);
    ctx.clip("evenodd");
    draw();
    ctx.restore();
  }

  /** The palisade's timber gate: two leaves of planks with dark edges, standing open a little. */
  palisadeGate(h, d) {
    const { P } = this;
    const y = h + d - 1;
    this.tex("planks", -1, y + 0.3, 0.95, 0.4);
    this.tex("planks", 0.05, y + 0.3, 0.95, 0.4);
    this.rectStroke(-1, y + 0.3, 0.95, 0.4, "rgba(30,18,8,0.95)", 0.06);
    this.rectStroke(0.05, y + 0.3, 0.95, 0.4, "rgba(30,18,8,0.95)", 0.06);
    this.line(P(-1), P(y), P(-1), P(y + 1), "rgba(30,18,8,0.95)", 0.18);
    this.line(P(1), P(y), P(1), P(y + 1), "rgba(30,18,8,0.95)", 0.18);
  }

  /** A square ring of `t` squares thickness. */
  ring(name, x, y, w, h, t) {
    this.tex(name, x, y, w, t);
    this.tex(name, x, y + h - t, w, t);
    this.tex(name, x, y + t, t, h - 2 * t);
    this.tex(name, x + w - t, y + t, t, h - 2 * t);
  }

  /** Darkened soft banks along both edges of a ring starting at square `a`, `w` a side, `t` thick. */
  bank(a, w, t, color) {
    const { ctx, px, P } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = px * 0.35;
    ctx.shadowColor = color;
    ctx.shadowBlur = px * 0.4;
    ctx.strokeRect(P(a), P(a), w * px, w * px);
    ctx.strokeRect(P(a + t), P(a + t), (w - 2 * t) * px, (w - 2 * t) * px);
    ctx.restore();
  }

  ringEdge(x, y, w, h, t, color) {
    this.rectStroke(x, y, w, h, color, 0.07);
    this.rectStroke(x + t, y + t, w - 2 * t, h - 2 * t, color, 0.07);
  }

  rectStroke(x, y, w, h, color, lw, dash) {
    const { ctx, px, P } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw * px;
    if (dash) ctx.setLineDash(dash.map(d => d * px));
    ctx.strokeRect(P(x), P(y), w * px, h * px);
    ctx.restore();
  }

  line(x0, y0, x1, y1, color, lw) {
    const { ctx, px } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw * px;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  /** A yard's edge: a soft darker border instead of a hard line. */
  softEdge(x, y, w, h) {
    const { ctx, px, P } = this;
    ctx.save();
    ctx.strokeStyle = "rgba(45,32,18,0.35)";
    ctx.lineWidth = px * 0.18;
    ctx.shadowColor = "rgba(45,32,18,0.5)";
    ctx.shadowBlur = px * 0.25;
    ctx.strokeRect(P(x) + px * 0.06, P(y) + px * 0.06, w * px - px * 0.12, h * px - px * 0.12);
    ctx.restore();
  }

  /** Darkens a floor toward its walls (soft ambient occlusion inside). */
  innerShade(x, y, w, h) {
    const { ctx, px, P } = this;
    const e = Math.min(0.7, w / 3) * px;
    const X = P(x), Y = P(y), W = w * px, H = h * px;
    ctx.save();
    const sides = [
      [X, Y, W, e, X, Y, X, Y + e], [X, Y + H - e, W, e, X, Y + H, X, Y + H - e],
      [X, Y, e, H, X, Y, X + e, Y], [X + W - e, Y, e, H, X + W, Y, X + W - e, Y]
    ];
    for (const [rx, ry, rw, rh, gx0, gy0, gx1, gy1] of sides) {
      const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      g.addColorStop(0, "rgba(10,6,2,0.38)");
      g.addColorStop(1, "rgba(10,6,2,0)");
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.restore();
  }

  /** A prop: art keeps its proportions, back (top of the picture) against the wall. */
  prop(name, x, y, n, rot = 0, { shadow = true, alpha = 1 } = {}) {
    const { ctx, px, P } = this;
    const img = this.assets.prop?.(name);
    const pad = n * px * 0.04;
    const cx = P(x) + (n * px) / 2;
    const cy = P(y) + (n * px) / 2;
    const d = n * px - pad * 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 180);
    if (img) {
      if (shadow) {
        // Canvas shadows ignore the transform's rotation, so this falls down-right in map space.
        ctx.shadowColor = "rgba(15,8,2,0.55)";
        ctx.shadowBlur = px * 0.14;
        ctx.shadowOffsetX = px * 0.1;
        ctx.shadowOffsetY = px * 0.14;
      }
      const k = d / Math.max(img.width, img.height);
      const w = img.width * k, h = img.height * k;
      ctx.drawImage(img, -w / 2, -d / 2, w, h);
    } else {
      const round = ["cauldron", "well", "tree", "fountain", "barrels", "statue", "oak", "pine", "bush", "rocks", "ruground", "brazier", "puddle"].includes(name);
      ctx.fillStyle = PROP_COLORS[name] ?? (["oak", "pine", "bush", "grass", "flowers"].includes(name) ? "#3d6a2a" : "#888");
      ctx.strokeStyle = "rgba(20,15,10,0.6)";
      ctx.lineWidth = Math.max(1, px * 0.03);
      ctx.beginPath();
      if (round) ctx.arc(0, 0, d * 0.42, 0, Math.PI * 2);
      else ctx.rect(-d * 0.4, -d * 0.4, d * 0.8, d * 0.8);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A small ground decal, centred on (x, y). No stand-in: without art, clutter is left out. */
  decal(d) {
    if (!this.assets.prop?.(d.p)) return;
    this.prop(d.p, d.x - d.n / 2, d.y - d.n / 2, d.n, d.rot, { shadow: d.p === "rocks" || d.p === "bush", alpha: d.alpha ?? 1 });
  }

  damage(b) {
    const { ctx, px, P } = this;
    let seed = 0;
    for (const c of b.fid) seed = (seed * 31 + c.charCodeAt(0)) & 0x7fffffff;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 10000) / 10000;
    const n = Math.max(1, Math.round((b.s * b.s) / 8));
    for (let i = 0; i < n; i++) {
      const s = Math.min(b.s, 1 + Math.floor(rnd() * 2));
      const x = b.x + Math.floor(rnd() * (b.s - s + 1));
      const y = b.y + Math.floor(rnd() * (b.s - s + 1));
      this.tex("rubble", x, y, s, s, 0.9);
    }
    ctx.save();
    const cx = P(b.x + b.s / 2);
    const cy = P(b.y + b.s / 2);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.s * px * 0.6);
    g.addColorStop(0, "rgba(20,12,6,0.5)");
    g.addColorStop(1, "rgba(20,12,6,0)");
    ctx.fillStyle = g;
    ctx.fillRect(P(b.x), P(b.y), b.s * px, b.s * px);
    ctx.restore();
  }

  /* ---------- shade ---------- */

  /**
   * Draws the casters' silhouettes as a soft shadow, offset (squares): drawn small on a layer and scaled back up, which
   * blurs them the same way in every canvas implementation.
   */
  shade(draw, blur, dx, dy, alpha) {
    const { ctx, px } = this;
    const size = this.plan.total * px;
    const k = Math.max(1, Math.round((blur * px) / 2));
    const small = Math.max(2, Math.ceil(size / k));
    const layer = this.canvas(small, small);
    const l = layer.getContext("2d");
    l.scale(small / size, small / size);
    l.fillStyle = "#000";
    l.strokeStyle = "#000";
    // Smear the silhouette along the light direction: tall things throw long shadows.
    const steps = dx || dy ? 6 : 1;
    for (let i = 1; i <= steps; i++) {
      l.save();
      l.translate((dx * px * i) / steps, (dy * px * i) / steps);
      draw(l);
      l.restore();
    }
    // A second, larger pass softens the blocky upscale.
    const mid = Math.max(2, Math.ceil(small * 2));
    const layer2 = this.canvas(mid, mid);
    const l2 = layer2.getContext("2d");
    l2.imageSmoothingEnabled = true;
    l2.drawImage(layer, 0, 0, mid, mid);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(layer2, 0, 0, size, size);
    ctx.restore();
  }

  wallStroke(c, w, width) {
    const { px, P } = this;
    c.lineWidth = width * px;
    c.lineCap = "square";
    c.beginPath();
    c.moveTo(P(w.x0), P(w.y0));
    c.lineTo(P(w.x1), P(w.y1));
    c.stroke();
  }

  ringStroke(c, a, w, width = OUTER_WALL_WIDTH) {
    const { px, P } = this;
    c.lineWidth = px * width;
    c.strokeRect(P(a) + px / 2, P(a) + px / 2, (w - 1) * px, (w - 1) * px);
  }

  fixtureShape(c, f, plan) {
    const { px, P } = this;
    c.beginPath();
    if (f.id === "watchtower") c.arc(P(f.x + f.w / 2), P(f.y + f.h / 2), (f.w / 2) * px, 0, Math.PI * 2);
    else if (f.id === "gatehouse") {
      c.rect(P(f.x - 1.5), P(f.y + 0.25), (f.w + 3) * px, (f.h - 0.5) * px);
      if (plan.barbican) { c.rect(P(f.x - 1), P(f.y + f.h), 1.5 * px, 2 * px); c.rect(P(f.x + f.w - 0.5), P(f.y + f.h), 1.5 * px, 2 * px); }
    } else return;
    c.fill();
  }

  treeShape(c, t) {
    if (t.p === "bush") return;
    const { px, P } = this;
    c.beginPath();
    c.arc(P(t.x), P(t.y), t.n * 0.42 * px, 0, Math.PI * 2);
    c.fill();
  }

  /* ---------- walls ---------- */

  /** A building wall: a thick band of dressed stone with a dark outline and a lit upper-left edge. */
  wall(w) {
    const { ctx, px, P } = this;
    const horiz = w.y0 === w.y1;
    const t = WALL_W;
    const x = Math.min(w.x0, w.x1) - t / 2;
    const y = Math.min(w.y0, w.y1) - t / 2;
    const ww = horiz ? Math.abs(w.x1 - w.x0) + t : t;
    const hh = horiz ? t : Math.abs(w.y1 - w.y0) + t;
    this.tex("wallstone", x, y, ww, hh, 1, { crop: BLOCK_CROP.wallstone });
    ctx.save();
    ctx.fillStyle = "rgba(30,24,18,0.25)";
    ctx.fillRect(P(x), P(y), ww * px, hh * px);
    ctx.strokeStyle = "rgba(14,10,6,0.95)";
    ctx.lineWidth = Math.max(1.5, px * 0.045);
    ctx.strokeRect(P(x), P(y), ww * px, hh * px);
    ctx.strokeStyle = "rgba(255,240,210,0.22)";
    ctx.lineWidth = Math.max(1, px * 0.03);
    ctx.beginPath();
    ctx.moveTo(P(x) + px * 0.03, P(y + hh) - px * 0.03);
    ctx.lineTo(P(x) + px * 0.03, P(y) + px * 0.03);
    ctx.lineTo(P(x + ww) - px * 0.03, P(y) + px * 0.03);
    ctx.stroke();
    ctx.restore();
  }

  /** A wooden door between stone jambs. */
  door(w) {
    const { ctx, px, P } = this;
    const horiz = w.y0 === w.y1;
    const len = (horiz ? Math.abs(w.x1 - w.x0) : Math.abs(w.y1 - w.y0)) * px;
    ctx.save();
    ctx.translate((P(w.x0) + P(w.x1)) / 2, (P(w.y0) + P(w.y1)) / 2);
    if (!horiz) ctx.rotate(Math.PI / 2);
    const t = WALL_W * px;
    ctx.fillStyle = "#4b443c";
    ctx.strokeStyle = "rgba(14,10,6,0.95)";
    ctx.lineWidth = Math.max(1.5, px * 0.045);
    for (const sx of [-len / 2 - t / 2, len / 2 - t / 2]) { ctx.fillRect(sx, -t / 2, t, t); ctx.strokeRect(sx, -t / 2, t, t); }
    const dw = len - t * 0.9, dh = t * 0.55;
    ctx.fillStyle = "#6e4526";
    ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
    ctx.strokeStyle = "rgba(30,18,8,0.85)";
    ctx.lineWidth = Math.max(1, px * 0.02);
    for (let i = 1; i < 4; i++) { const yy = -dh / 2 + (dh * i) / 4; ctx.beginPath(); ctx.moveTo(-dw / 2, yy); ctx.lineTo(dw / 2, yy); ctx.stroke(); }
    ctx.fillStyle = "#2a2622";
    ctx.fillRect(-dw / 2 + dw * 0.2, -dh / 2, dw * 0.06, dh);
    ctx.fillRect(dw / 2 - dw * 0.26, -dh / 2, dw * 0.06, dh);
    ctx.lineWidth = Math.max(1.5, px * 0.035);
    ctx.strokeStyle = "rgba(14,10,6,0.95)";
    ctx.strokeRect(-dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  /**
   * Lays a wall texture along the four sides of the ring (1 square thick, starting at square `a`, `w` squares a side),
   * its outer edge facing out on every side. Returns false when there is no art.
   */
  wallBand(name, a, w, thick = 1) {
    const img = this.assets.tex?.(name);
    const band = WALL_BANDS[name];
    if (!img || !band) return false;
    const { ctx, px, P } = this;
    const [cx, cy, cw, ch] = band.crop;
    const iw = img.width, ih = img.height;
    const seg = band.along * px;
    const len = w * px;
    const sides = [
      { tx: P(a), ty: P(a), rot: 0 },
      { tx: P(a + w), ty: P(a), rot: Math.PI / 2 },
      { tx: P(a + w), ty: P(a + w), rot: Math.PI },
      { tx: P(a), ty: P(a + w), rot: -Math.PI / 2 }
    ];
    for (const sd of sides) {
      ctx.save();
      ctx.translate(sd.tx, sd.ty);
      ctx.rotate(sd.rot);
      const T = thick * px;
      ctx.beginPath();
      ctx.rect(0, 0, len, T);
      ctx.clip();
      for (let t = 0; t < len; t += seg * thick) ctx.drawImage(img, cx * iw, cy * ih, cw * iw, ch * ih, t, 0, seg * thick + 0.5, T);
      const g = ctx.createLinearGradient(0, 0, 0, T);
      g.addColorStop(0, "rgba(255,235,200,0.1)");
      g.addColorStop(0.65, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(10,6,2,0.4)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, len, T);
      ctx.restore();
    }
    return true;
  }

  /**
   * Living rock round a cave hall: everything outside the hall (`a`, `w` squares a side) is rock, with a ragged noisy
   * edge, a tunnel out through the south side, and deep shade where the rock meets the floor.
   */
  rockWall(a, w) {
    const { ctx, px, P } = this;
    const plan = this.plan;
    const o = -plan.offset;
    const N = plan.total;
    const size = N * px;
    // The mask: 4 cells a square; 1 where there is rock.
    const res = 4;
    const mw = N * res;
    const mask = this.canvas(mw, mw);
    const mc = mask.getContext("2d");
    const img = mc.createImageData(mw, mw);
    const noise = noiseField(97);
    const x0 = a + 1, x1 = a + w - 1;   // the hall's floor, inside the wall ring
    for (let j = 0; j < mw; j++) for (let i = 0; i < mw; i++) {
      const x = o + i / res, y = o + j / res;
      const dx = Math.max(x0 - x, x - x1, 0), dy = Math.max(x0 - y, y - x1, 0);
      let d = Math.max(dx, dy) - (x0 - x > 0 || x - x1 > 0 || x0 - y > 0 || y - x1 > 0 ? 0 : Math.min(x - x0, x1 - x, y - x0, x1 - y));
      d += (noise(x / 1.1, y / 1.1) - 0.5) * 2.4;          // ragged edge
      const tunnel = Math.abs(x + 0.5) < 1.3 + (noise(x, y * 0.7) - 0.5) * 0.5 && y > x1 - 1;
      const v = tunnel ? 0 : Math.max(0, Math.min(1, (d + 0.6) / 0.35));
      img.data[(j * mw + i) * 4 + 3] = Math.round(v * 255);
    }
    mc.putImageData(img, 0, 0);
    // Shade the floor along the rock edge (drawn first, offset down-right and blurred by scaling).
    const k = Math.max(2, Math.round(px * 0.3));
    const sm = this.canvas(Math.ceil(size / k), Math.ceil(size / k));
    const smc = sm.getContext("2d");
    smc.imageSmoothingEnabled = true;
    smc.drawImage(mask, (0.35 * px) / k, (0.5 * px) / k, size / k, size / k);
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sm, 0, 0, size, size);
    ctx.restore();
    // The rock itself: cave texture with rubble, darkened, cut out by the mask.
    const layer = this.canvas(size, size);
    const lc = layer.getContext("2d");
    lc.translate(-P(o), -P(o));
    this.tex("cave", o, o, N, N, 1, { target: lc });
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = "multiply";
    lc.fillStyle = "rgb(150,140,130)";
    lc.fillRect(0, 0, size, size);
    lc.globalCompositeOperation = "destination-in";
    lc.imageSmoothingEnabled = true;
    lc.drawImage(mask, 0, 0, size, size);
    ctx.drawImage(layer, 0, 0);
    // A lit rim on the rock's edge facing the light.
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    ctx.restore();
  }

  breach(b) {
    const { ctx, px, P } = this;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(P(b.x + b.w / 2), P(b.y + b.h / 2), (b.w / 2 + 0.6) * px, (b.h / 2 + 0.6) * px, 0, 0, Math.PI * 2);
    ctx.clip();
    this.tex("rubble", b.x - 1, b.y - 1, b.w + 2, b.h + 2);
    ctx.restore();
  }

  gatehouse(f, plan) {
    const { P } = this;
    if (this.assets.prop?.("squaretop")) return this.gatehouseArt(f, plan);
    this.tex("wallstone", f.x, f.y, f.w, f.h, 1, { crop: BLOCK_CROP.wallstone });
    this.rectStroke(f.x, f.y, f.w, f.h, "rgba(14,10,6,0.95)", 0.08);
    this.tex("cobble", f.x + 1, f.y, 2, f.h);
    this.line(P(f.x + 1), P(f.y), P(f.x + 1), P(f.y + f.h), "#1d1813", 0.14);
    this.line(P(f.x + 3), P(f.y), P(f.x + 3), P(f.y + f.h), "#1d1813", 0.14);
    if (plan.portcullis) for (let i = 0; i <= 4; i++) this.line(P(f.x + 1 + i * 0.5), P(f.y + 1.9), P(f.x + 1 + i * 0.5), P(f.y + 2.1), "#111", 0.06);
    if (plan.barbican) {
      const bx = f.x - 1;
      const by = f.y + f.h;
      this.tex("wallstone", bx, by, 1.5, 2, 1, { crop: BLOCK_CROP.wallstone });
      this.tex("wallstone", bx + f.w + 0.5, by, 1.5, 2, 1, { crop: BLOCK_CROP.wallstone });
      this.rectStroke(bx, by, 1.5, 2, "rgba(14,10,6,0.95)", 0.07);
      this.rectStroke(bx + f.w + 0.5, by, 1.5, 2, "rgba(14,10,6,0.95)", 0.07);
    }
  }

  /** Two square towers flanking the gate passage, with the gate leaves and portcullis between them. */
  gatehouseArt(f, plan) {
    const { ctx, px, P } = this;
    const midY = f.y + 1.5;           // the middle of the wall row
    const T = 2.5;
    // The passage: cobbles, shaded under the arch.
    this.tex("cobble", f.x + 1, f.y - 0.1, 2, f.h + 0.2);
    ctx.save();
    const g = ctx.createLinearGradient(0, P(f.y), 0, P(f.y + f.h));
    g.addColorStop(0, "rgba(10,6,2,0.15)");
    g.addColorStop(0.5, "rgba(10,6,2,0.55)");
    g.addColorStop(1, "rgba(10,6,2,0.15)");
    ctx.fillStyle = g;
    ctx.fillRect(P(f.x + 1), P(f.y), 2 * px, f.h * px);
    ctx.restore();
    // Gate leaves standing open against the passage walls, and the portcullis grate.
    ctx.save();
    ctx.fillStyle = "#5e3b20";
    ctx.strokeStyle = "rgba(14,10,6,0.95)";
    ctx.lineWidth = Math.max(1, px * 0.03);
    for (const x of [f.x + 1.02, f.x + 2.83]) { ctx.fillRect(P(x), P(midY - 1.1), px * 0.15, px * 0.95); ctx.strokeRect(P(x), P(midY - 1.1), px * 0.15, px * 0.95); }
    ctx.restore();
    if (plan.portcullis) for (let i = 0; i <= 8; i++) this.line(P(f.x + 1 + i * 0.25), P(midY + 0.85), P(f.x + 1 + i * 0.25), P(midY + 1.05), "#1b1b1b", 0.05);
    for (const cx of [f.x - 0.25, f.x + f.w + 0.25]) this.prop("squaretop", cx - T / 2, midY - T / 2, T, 0, { shadow: false });
    if (plan.barbican) {
      const by = f.y + f.h;
      for (const cx of [f.x - 0.25, f.x + f.w + 0.25]) this.prop("squaretop", cx - 0.9, by, 1.8, 0, { shadow: false });
    }
  }

  tower(f) {
    const { ctx, px, P } = this;
    if (this.assets.prop?.("towertop")) {
      const n = f.w * 1.05;
      this.prop("towertop", f.x + f.w / 2 - n / 2, f.y + f.h / 2 - n / 2, n, ((f.x * 7 + f.y * 3) % 4) * 90, { shadow: false });
      return;
    }
    const cx = P(f.x + f.w / 2);
    const cy = P(f.y + f.h / 2);
    const rad = (f.w / 2) * px * 0.98;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.clip();
    this.tex("wallstone", f.x, f.y, f.w, f.h, 1, { crop: BLOCK_CROP.wallstone });
    const g = ctx.createRadialGradient(cx - rad * 0.35, cy - rad * 0.35, rad * 0.1, cx, cy, rad);
    g.addColorStop(0, "rgba(255,240,210,0.15)");
    g.addColorStop(1, "rgba(10,6,2,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "rgba(14,10,6,0.95)";
    ctx.lineWidth = px * 0.1;
    ctx.beginPath();
    ctx.arc(cx, cy, rad - px * 0.05, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(55,48,40,0.95)";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * (rad - px * 0.26), cy + Math.sin(a) * (rad - px * 0.26));
      ctx.rotate(a);
      ctx.fillRect(-px * 0.13, -px * 0.15, px * 0.26, px * 0.3);
      ctx.strokeStyle = "rgba(14,10,6,0.8)";
      ctx.lineWidth = Math.max(1, px * 0.02);
      ctx.strokeRect(-px * 0.13, -px * 0.15, px * 0.26, px * 0.3);
      ctx.restore();
    }
    ctx.fillStyle = "#4d3420";
    ctx.fillRect(cx - px * 0.3, cy - px * 0.3, px * 0.6, px * 0.6);
    ctx.strokeStyle = "rgba(14,10,6,0.9)";
    ctx.strokeRect(cx - px * 0.3, cy - px * 0.3, px * 0.6, px * 0.6);
    ctx.restore();
  }

  ballista(f) {
    const { ctx, px, P } = this;
    this.tex("planks", f.x, f.y, f.w, f.h);
    this.rectStroke(f.x, f.y, f.w, f.h, "rgba(30,18,8,0.9)", 0.07);
    ctx.save();
    ctx.translate(P(f.x + f.w / 2), P(f.y + f.h / 2));
    ctx.rotate(Math.atan2(f.y + f.h / 2, f.x + f.w / 2) + Math.PI / 2);
    ctx.strokeStyle = "#3a2614";
    ctx.lineWidth = px * 0.12;
    ctx.beginPath();
    ctx.moveTo(0, px * 0.7);
    ctx.lineTo(0, -px * 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, px * 0.2, px * 0.7, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.strokeStyle = "#d9cfb8";
    ctx.lineWidth = px * 0.03;
    ctx.beginPath();
    ctx.moveTo(-px * 0.58, -px * 0.2);
    ctx.lineTo(0, px * 0.45);
    ctx.lineTo(px * 0.58, -px * 0.2);
    ctx.stroke();
    ctx.restore();
  }

  postern(f) {
    const { ctx, px, P } = this;
    ctx.save();
    ctx.fillStyle = "#1a1612";
    ctx.fillRect(P(f.x) + px * 0.15, P(f.y) + px * 0.15, px * 0.7, f.h * px - px * 0.3);
    ctx.strokeStyle = "#6b625a";
    ctx.lineWidth = px * 0.04;
    for (let i = 1; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(P(f.x) + px * 0.2, P(f.y) + (i * f.h * px) / 5);
      ctx.lineTo(P(f.x) + px * 0.8, P(f.y) + (i * f.h * px) / 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- light and grade ---------- */

  /** A warm pool of firelight. */
  glow(L) {
    const { ctx, px, P } = this;
    const cx = P(L.x), cy = P(L.y);
    const r = (L.dim / 5) * px * 0.75;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(255,170,80,0.32)");
    g.addColorStop(0.35, "rgba(255,140,60,0.12)");
    g.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }

  /** A warm, slightly richer grade over the whole map. */
  grade(size) {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = "rgba(255,196,120,0.35)";
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "multiply";
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, "rgba(255,250,235,1)");
    g.addColorStop(1, "rgba(225,215,200,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  vignette(size) {
    const { ctx } = this;
    ctx.save();
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.42, size / 2, size / 2, size * 0.74);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(15,8,2,0.5)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }
}
