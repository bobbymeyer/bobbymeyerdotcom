// circle packer — a poster of circles packed around a word. Unlike the other
// sketches on this site there is no repository behind it to load it from, so
// the whole thing lives here and is bundled with the page: nothing to fetch,
// and so nothing to fall back from.
//
// The note supplies an empty #circle-packer; this builds the stage and the
// controls inside it, runs one instance per visit, and tears it down before
// the client router swaps the page.

const TAU = Math.PI * 2;

/** The mask is set in the site's own face, at the heaviest weight it carries. */
const FONT_WEIGHT = 800;
const FONT = 'Archivo, "Arial Black", Impact, sans-serif';

const BOXES: Record<string, [number, number]> = {
  poster: [800, 1000],
  square: [900, 900],
  wide: [1100, 740],
};
const PAPER = '#ffffff';

type Shape =
  | { kind: 'text'; text: string; margin: number; lineGap: number; color: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; color: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: number }
  | { kind: 'polygon'; pts: [number, number][]; color: number };

/*
 * Shape sources. Every shape is painted into one mask. A circle whose area is
 * mostly inside a shape takes that shape's colour index, re-checked every
 * frame as circles move and shrink. Coordinates are fractions of the box, so
 * an ellipse is `{ kind: 'ellipse', cx: .5, cy: .5, rx: .3, ry: .2, color: 1 }`.
 */
function buildShapes(text: string): Shape[] {
  const list: Shape[] = [];
  if (text) list.push({ kind: 'text', text, margin: 0.07, lineGap: 0.38, color: 1 });
  return list;
}

const MARKUP = `
<div class="cp-layout">
  <div class="cp-stage">
    <div class="cp-poster"><canvas role="img" aria-label="Circle packing poster"></canvas></div>
    <p class="cp-stats" data-cp="stats" aria-live="off">starting</p>
  </div>
  <form class="cp-panel" onsubmit="return false">
    <div class="cp-field">
      <label for="cp-text">shape text</label>
      <input type="text" id="cp-text" value="HAPPY HALLOWEEN" autocomplete="off" spellcheck="false">
      <p class="cp-hint">Each word gets its own line, fitted to the box width.</p>
    </div>
    <div class="cp-field">
      <label for="cp-box">box</label>
      <select id="cp-box">
        <option value="poster">poster 4:5</option>
        <option value="square">square 1:1</option>
        <option value="wide">wide 3:2</option>
      </select>
    </div>
    <div class="cp-field">
      <div class="cp-label"><label for="cp-res">max resistance</label><output data-cp="resV">30</output></div>
      <input type="range" id="cp-res" min="0" max="100" value="30">
      <p class="cp-hint">Each circle gets a resistance up to this. Higher resistance holds size and overlap under pressure; low resistance shrinks first.</p>
    </div>
    <div class="cp-field">
      <div class="cp-label"><label for="cp-sin">size inside shape</label><output data-cp="sinV">50%</output></div>
      <input type="range" id="cp-sin" min="20" max="150" value="50">
    </div>
    <div class="cp-field">
      <div class="cp-label"><label for="cp-sfar">size away from shape</label><output data-cp="sfarV">150%</output></div>
      <input type="range" id="cp-sfar" min="50" max="300" value="150">
    </div>
    <div class="cp-field">
      <div class="cp-label"><label for="cp-fall">falloff distance</label><output data-cp="fallV">25%</output></div>
      <input type="range" id="cp-fall" min="3" max="100" value="25">
      <p class="cp-hint">Circle size blends between the two values over this distance from the shape, as a share of box width. Both at 100% leaves size unchanged. Changing these restarts the run.</p>
    </div>
    <div class="cp-field">
      <div class="cp-label"><label for="cp-count">final count</label><output data-cp="countV">10,000</output></div>
      <input type="range" id="cp-count" min="1000" max="20000" step="500" value="10000">
    </div>
    <div class="cp-field">
      <div class="cp-label"><label for="cp-pace">pace</label><output data-cp="paceV">12</output></div>
      <input type="range" id="cp-pace" min="1" max="60" value="12">
    </div>
    <div class="cp-colors">
      <div class="cp-field"><label for="cp-c0">circles</label><input type="color" id="cp-c0" value="#000000"></div>
      <div class="cp-field"><label for="cp-c1">shape</label><input type="color" id="cp-c1" value="#f15a24"></div>
    </div>
    <label class="cp-check"><input type="checkbox" id="cp-showmask"> show shape mask</label>
    <div class="cp-buttons">
      <button type="button" class="btn" id="cp-pause">pause</button>
      <button type="button" class="btn" id="cp-restart">restart</button>
    </div>
  </form>
</div>
`;

let destroy: (() => void) | null = null;

export function initCirclePacker(): void {
  const root = document.getElementById('circle-packer');
  if (!root || destroy) return;
  destroy = mount(root);
}

// The client router swaps the DOM without a full reload; stop the loop and let
// go of the observers before each swap so nothing runs against a dead canvas.
document.addEventListener('astro:before-swap', () => {
  destroy?.();
  destroy = null;
});

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mount(root: HTMLElement): () => void {
  root.innerHTML = MARKUP;

  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) =>
    root.querySelector<T>(`#cp-${id}`)!;
  const out = (name: string) => root.querySelector<HTMLElement>(`[data-cp="${name}"]`)!;

  const poster = root.querySelector<HTMLElement>('.cp-poster')!;
  const canvas = poster.querySelector('canvas')!;
  const ctx = canvas.getContext('2d')!;
  const statsEl = out('stats');
  const showMask = $('showmask');
  const COLORS = [$('c0').value, $('c1').value]; // 0 = circles, 1.. = shape colours

  // ---------- state ----------
  const MAXN = 24000, NODECAP = 1500000, POP = 20, SUBS = 3;
  const X = new Float32Array(MAXN), Y = new Float32Array(MAXN), R = new Float32Array(MAXN);
  const VX = new Float32Array(MAXN), VY = new Float32Array(MAXN);
  const STF = new Float32Array(MAXN), QR = new Float32Array(MAXN), WT = new Float32Array(MAXN);
  const PEN = new Float32Array(MAXN);
  const AGE = new Uint16Array(MAXN), COL = new Uint8Array(MAXN);
  const CX0 = new Int16Array(MAXN), CY0 = new Int16Array(MAXN), STAMP = new Int32Array(MAXN);
  const nodeC = new Int32Array(NODECAP), nodeN = new Int32Array(NODECAP);
  let head: Int32Array = new Int32Array(1), nodeCount = 0, stampN = 0;
  let W = 800, H = 1000, rmin = 3, rmax = 40, rfloor = 1, cs = 20, gw = 1, gh = 1;
  let N = 0, settle = 0, fill = 0, paused = false, raf = 0, frames = 0;
  let state: 'running' | 'settling' | 'done' = 'running';
  let rng: () => number = Math.random;
  let mask: Uint8Array = new Uint8Array(1);
  let preview: HTMLCanvasElement | null = null;
  let shapes: Shape[] = [];
  let pace = 12, maxRes = 0.12, nFinal = 10000;
  // Distance-to-shape sizing: D is the distance in px to the nearest shape
  // pixel, LUT the size multiplier by distance.
  let D: Float32Array = new Float32Array(1), hasShape = false, LUT: Float32Array = new Float32Array(2).fill(1), LM = 1;
  let Kmean = 1, sumRN2 = 0;
  let sIn = 0.5, sFar = 1.5, fall = 0.25;

  // ---------- shape mask ----------
  function paintText(c: CanvasRenderingContext2D, s: Extract<Shape, { kind: 'text' }>) {
    const lines = s.text.toUpperCase().split(/\s+/).filter(Boolean);
    if (!lines.length) return;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.font = `${FONT_WEIGHT} 100px ${FONT}`;
    const cap100 = c.measureText('H').actualBoundingBoxAscent;
    const targetW = W * (1 - 2 * s.margin);
    const items = lines.map((t) => {
      const m = c.measureText(t);
      const ink = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
      return { t, ink, abl: m.actualBoundingBoxLeft, k: targetW / ink };
    });
    const heightAt = (f: number) => {
      const caps = items.map((it) => cap100 * it.k * f);
      return caps.reduce((a, b) => a + b, 0) + s.lineGap * Math.min(...caps) * (items.length - 1);
    };
    const avail = H * (1 - 2 * s.margin);
    const f = Math.min(1, avail / heightAt(1));
    const caps = items.map((it) => cap100 * it.k * f);
    const gap = s.lineGap * Math.min(...caps);
    let y = (H - heightAt(f)) / 2;
    items.forEach((it, i) => {
      const k = it.k * f;
      y += caps[i]!;
      c.font = `${FONT_WEIGHT} ${100 * k}px ${FONT}`;
      c.fillText(it.t, (W - it.ink * k) / 2 + it.abl * k, y);
      y += gap;
    });
  }

  function paintShape(c: CanvasRenderingContext2D, s: Shape, fillStyle: string) {
    c.fillStyle = fillStyle;
    if (s.kind === 'text') return paintText(c, s);
    if (s.kind === 'ellipse') {
      c.beginPath();
      c.ellipse(s.cx * W, s.cy * H, s.rx * W, s.ry * H, 0, 0, TAU);
      c.fill();
    } else if (s.kind === 'rect') {
      c.fillRect(s.x * W, s.y * H, s.w * W, s.h * H);
    } else {
      c.beginPath();
      s.pts.forEach(([x, y], i) => (i ? c.lineTo(x * W, y * H) : c.moveTo(x * W, y * H)));
      c.closePath();
      c.fill();
    }
  }

  function buildMask() {
    const sc = document.createElement('canvas');
    sc.width = W;
    sc.height = H;
    const sx = sc.getContext('2d', { willReadFrequently: true })!;
    preview = document.createElement('canvas');
    preview.width = W;
    preview.height = H;
    const px = preview.getContext('2d')!;
    mask = new Uint8Array(W * H);
    for (const s of shapes) {
      sx.clearRect(0, 0, W, H);
      paintShape(sx, s, '#fff');
      const d = sx.getImageData(0, 0, W, H).data;
      for (let p = 0, q = 3; p < W * H; p++, q += 4) if (d[q]! > 127) mask[p] = s.color;
      paintShape(px, s, '#ec008c');
    }
    hasShape = mask.some((m) => m !== 0);
    D = hasShape ? distanceField() : new Float32Array(W * H);
  }

  // Exact Euclidean distance (px) from every pixel to the nearest shape pixel;
  // 0 inside the shape. Felzenszwalb and Huttenlocher, by columns then rows.
  function distanceField(): Float32Array {
    const INF = 1e9, f = new Float64Array(W * H), n = Math.max(W, H);
    for (let p = 0; p < W * H; p++) f[p] = mask[p] ? 0 : INF;
    const v = new Int32Array(n), z = new Float64Array(n + 1), d = new Float64Array(n);
    const pass = (off: number, stride: number, len: number) => {
      let k = 0;
      v[0] = 0;
      z[0] = -INF;
      z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s: number;
        for (;;) {
          const p = v[k]!;
          s = (f[off + q * stride]! + q * q - (f[off + p * stride]! + p * p)) / (2 * q - 2 * p);
          if (s <= z[k]!) k--;
          else break;
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) {
        while (z[k + 1]! < q) k++;
        const dq = q - v[k]!;
        d[q] = dq * dq + f[off + v[k]! * stride]!;
      }
      for (let q = 0; q < len; q++) f[off + q * stride] = d[q]!;
    };
    for (let x = 0; x < W; x++) pass(x, W, H);
    for (let y = 0; y < H; y++) pass(y * W, 1, W);
    const result = new Float32Array(W * H);
    for (let p = 0; p < W * H; p++) result[p] = Math.sqrt(f[p]!);
    return result;
  }

  function scaleAt(x: number, y: number): number {
    let px = x | 0, py = y | 0;
    if (px < 0) px = 0;
    else if (px >= W) px = W - 1;
    if (py < 0) py = 0;
    else if (py >= H) py = H - 1;
    const dd = D[py * W + px]! | 0;
    return LUT[dd > LM ? LM : dd]!;
  }

  // Size multiplier by distance: sIn at the shape, sFar beyond the falloff,
  // smooth in between.
  function setScale() {
    const len = Math.ceil(Math.hypot(W, H)) + 2;
    LUT = new Float32Array(len).fill(1);
    LM = len - 1;
    Kmean = 1;
    if (!hasShape) return;
    const span = Math.max(1, fall * W), ratio = sFar / sIn;
    for (let k = 0; k < len; k++) {
      const t = Math.min(1, k / span), e = t * t * (3 - 2 * t);
      LUT[k] = sIn * Math.pow(ratio, e);
    }
    let sum = 0;
    for (let gy = 0; gy < 48; gy++)
      for (let gx = 0; gx < 48; gx++) {
        const s = scaleAt(((gx + 0.5) / 48) * W, ((gy + 0.5) / 48) * H);
        sum += 1 / (s * s);
      }
    Kmean = sum / 2304;
  }

  function setGrid() {
    const smin = hasShape ? Math.min(1, sIn, sFar) : 1;
    cs = Math.max(6, rmin * 7 * smin);
    gw = Math.ceil(W / cs);
    gh = Math.ceil(H / cs);
    head = new Int32Array(gw * gh).fill(-1);
  }

  // ---------- spatial grid ----------
  function insert(i: number) {
    const r = R[i]!;
    let x0 = Math.floor((X[i]! - r) / cs), x1 = Math.floor((X[i]! + r) / cs);
    let y0 = Math.floor((Y[i]! - r) / cs), y1 = Math.floor((Y[i]! + r) / cs);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= gw) x1 = gw - 1;
    if (y1 >= gh) y1 = gh - 1;
    CX0[i] = x0;
    CY0[i] = y0;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        if (nodeCount >= NODECAP) return;
        const n = nodeCount++, cell = cy * gw + cx;
        nodeC[n] = i;
        nodeN[n] = head[cell]!;
        head[cell] = n;
      }
  }

  // Largest radius that fits at (x,y), capped at T. Stops early once it drops
  // to `floor`.
  function clearance(x: number, y: number, T: number, floor: number): number {
    let c = Math.min(T, x, W - x, y, H - y);
    if (c <= floor) return c;
    const x0 = Math.max(0, Math.floor((x - T) / cs)), x1 = Math.min(gw - 1, Math.floor((x + T) / cs));
    const y0 = Math.max(0, Math.floor((y - T) / cs)), y1 = Math.min(gh - 1, Math.floor((y + T) / cs));
    const st = ++stampN;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        for (let a = head[cy * gw + cx]!; a !== -1; a = nodeN[a]!) {
          const i = nodeC[a]!;
          if (STAMP[i] === st) continue;
          STAMP[i] = st;
          const d = Math.hypot(x - X[i]!, y - Y[i]!) - R[i]!;
          if (d < c) {
            c = d;
            if (c <= floor) return c;
          }
        }
      }
    return c;
  }

  // ---------- spawning ----------
  // A new circle appears small at the roomiest of a few random points, then
  // grows to capacity.
  function trySpawn() {
    if (N >= MAXN - 1) return;
    const meanRn = N ? Math.sqrt(sumRN2 / N) : rmax; // typical radius at scale 1
    const smin = hasShape ? Math.min(sIn, sFar) : 1;
    let bx = rng() * W, by = rng() * H, bs = 1, bc = 0, best = -1e9;
    for (let k = 0; k < 8; k++) {
      let x = 0, y = 0, s = 1;
      // Density follows 1/scale²: small zones get more circles.
      for (let t = 0; t < 30; t++) {
        x = rng() * W;
        y = rng() * H;
        s = scaleAt(x, y);
        const a = smin / s;
        if (rng() < a * a) break;
      }
      const T = Math.min(rmax * s, 1.5 * meanRn * s + 1);
      const c = clearance(x, y, T, best * T);
      if (c / T > best) {
        best = c / T;
        bx = x;
        by = y;
        bs = s;
        bc = c;
        if (c >= T) break;
      }
    }
    const i = N++, q = rng();
    X[i] = bx;
    Y[i] = by;
    R[i] = Math.max(Math.max(0.5, rfloor * Math.min(1, bs)), Math.min(Math.max(bc, 0) * 0.5, 0.3 * rmax * bs));
    QR[i] = q; // resistance rank, scaled by the slider
    STF[i] = 0.5 + 2 * q; // resistant circles are heavier and move less
    WT[i] = 0.6 + 0.8 * rng(); // base share of capacity
    VX[i] = (rng() - 0.5) * 0.8;
    VY[i] = (rng() - 0.5) * 0.8;
    AGE[i] = 0;
    COL[i] = 0;
    insert(i);
  }

  // ---------- physics ----------
  function substep() {
    head.fill(-1);
    nodeCount = 0;
    PEN.fill(0, 0, N);
    for (let i = 0; i < N; i++) insert(i);
    for (let cy = 0; cy < gh; cy++)
      for (let cx = 0; cx < gw; cx++) {
        for (let a = head[cy * gw + cx]!; a !== -1; a = nodeN[a]!) {
          const i = nodeC[a]!;
          for (let b = nodeN[a]!; b !== -1; b = nodeN[b]!) {
            const j = nodeC[b]!;
            const dx = X[j]! - X[i]!, dy = Y[j]! - Y[i]!, rs = R[i]! + R[j]!;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rs * rs) continue;
            // Each pair is resolved once, in the first cell both of them cover.
            if (cx !== Math.max(CX0[i]!, CX0[j]!) || cy !== Math.max(CY0[i]!, CY0[j]!)) continue;
            let d = Math.sqrt(d2), nx: number, ny: number;
            if (d < 1e-4) {
              const t = rng() * TAU;
              nx = Math.cos(t);
              ny = Math.sin(t);
              d = 0;
            } else {
              nx = dx / d;
              ny = dy / d;
            }
            const pn = rs - d;
            const st = Math.min(pn / rs, 0.1); // contact strain, shared by both circles
            PEN[i] = PEN[i]! + st;
            PEN[j] = PEN[j]! + st;
            const mi = STF[i]! * R[i]! * R[i]!, mj = STF[j]! * R[j]! * R[j]!;
            const cr = pn * 0.85, ci = (cr * mj) / (mi + mj), cj = cr - ci;
            X[i] = X[i]! - nx * ci;
            Y[i] = Y[i]! - ny * ci;
            X[j] = X[j]! + nx * cj;
            Y[j] = Y[j]! + ny * cj;
            VX[i] = VX[i]! - nx * ci * 0.25;
            VY[i] = VY[i]! - ny * ci * 0.25;
            VX[j] = VX[j]! + nx * cj * 0.25;
            VY[j] = VY[j]! + ny * cj * 0.25;
          }
        }
      }
    // Capacity per circle falls as more circles share the box.
    const Rcap = 0.5 * Math.sqrt((W * H * Kmean) / Math.max(1, N));
    let area = 0, areaN = 0;
    for (let i = 0; i < N; i++) {
      let x = X[i]! + VX[i]!, y = Y[i]! + VY[i]!;
      VX[i] = VX[i]! * 0.82;
      VY[i] = VY[i]! * 0.82;
      let r = R[i]!, P = PEN[i]!;
      if (x < r) { P += Math.min((r - x) / (2 * r), 0.1); x = r; VX[i] = 0; }
      else if (x > W - r) { P += Math.min((x - (W - r)) / (2 * r), 0.1); x = W - r; VX[i] = 0; }
      if (y < r) { P += Math.min((r - y) / (2 * r), 0.1); y = r; VY[i] = 0; }
      else if (y > H - r) { P += Math.min((y - (H - r)) / (2 * r), 0.1); y = H - r; VY[i] = 0; }
      X[i] = x;
      Y[i] = y;
      const tol = QR[i]! * maxRes;
      const sc = scaleAt(x, y);
      const cap = Math.min(rmax * sc, Rcap * sc * (WT[i]! + 2.5 * tol));
      const rf = Math.max(0.5, rfloor * Math.min(1, sc));
      if (r > cap) r += (cap - r) * 0.15; // over capacity: shrink
      if (P > tol + 0.002) r *= 1 - 0.3 * Math.min(P - tol, 0.3); // squeezed past its resistance: shrink
      else if (r < cap) {
        if (P <= 0.002) r = Math.min(cap, r * 1.1 + 0.25); // free: grow fast
        else if (P < 0.25 * tol) r = Math.min(cap, r * 1.025); // light contact: keep pressing
      }
      if (r < rf) r = rf;
      if (AGE[i]! < POP) AGE[i] = AGE[i]! + 1;
      R[i] = r;
      area += r * r;
      areaN += (r / sc) * (r / sc);
    }
    sumRN2 = areaN;
    fill = (area * Math.PI) / (W * H);
  }

  // ---------- drawing ----------
  // Nineteen sample points spread over a unit disc, for asking how much of a
  // circle lies inside the shape.
  const NS = 19, OX = new Float32Array(NS), OY = new Float32Array(NS);
  for (let k = 0; k < NS; k++) {
    const rr = Math.sqrt((k + 0.5) / NS), th = k * 2.39996323;
    OX[k] = rr * Math.cos(th);
    OY[k] = rr * Math.sin(th);
  }
  const cnt = new Int16Array(8), DR = new Float32Array(MAXN);

  function draw() {
    const s = canvas.width / W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < N; i++) {
      const r = R[i]!, x = X[i]!, y = Y[i]!;
      cnt.fill(0);
      for (let k = 0; k < NS; k++) {
        const px = (x + OX[k]! * r) | 0, py = (y + OY[k]! * r) | 0;
        const m = px >= 0 && px < W && py >= 0 && py < H ? mask[py * W + px]! : 0;
        cnt[m] = cnt[m]! + 1;
      }
      // A circle takes a shape colour when most of its area is inside, and
      // keeps it until it is under 40%.
      const prev = COL[i]!;
      let best = 0;
      if (prev && cnt[prev]! > NS * 0.4) best = prev;
      else {
        let bn = NS / 2;
        for (let m = 1; m < 8; m++)
          if (cnt[m]! > bn) {
            bn = cnt[m]!;
            best = m;
          }
      }
      COL[i] = best;
      const age = AGE[i]!;
      DR[i] = Math.max(0.5, r - 0.3) * (age < POP ? 1 + 0.12 * Math.sin((Math.PI * age) / POP) : 1);
    }
    for (let k = 0; k < COLORS.length; k++) {
      ctx.fillStyle = COLORS[k]!;
      ctx.beginPath();
      for (let i = 0; i < N; i++)
        if (COL[i] === k) {
          const r = DR[i]!;
          ctx.moveTo(X[i]! + r, Y[i]!);
          ctx.arc(X[i]!, Y[i]!, r, 0, TAU);
        }
      ctx.fill();
    }
    if (showMask.checked && preview) {
      ctx.globalAlpha = 0.4;
      ctx.drawImage(preview, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  function resize() {
    const cw = poster.clientWidth || 600, dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round((cw * dpr * H) / W);
    draw();
  }

  // ---------- loop ----------
  function schedule() {
    if (!raf && !paused && state !== 'done') raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    if (!paused && state !== 'done') {
      if (state === 'running') {
        for (let k = 0; k < pace; k++) trySpawn();
        if (N >= nFinal || N >= MAXN - 2) state = 'settling';
      }
      for (let s = 0; s < SUBS; s++) substep();
      if (state === 'settling' && ++settle > 240) state = 'done';
    }
    draw();
    if ((++frames & 3) === 0 || state === 'done') stats();
    schedule();
  }

  function stats() {
    const label =
      state === 'done' ? 'settled' : paused ? 'paused' : state === 'settling' ? 'settling' : 'packing';
    statsEl.textContent = `${N.toLocaleString()} circles · ${Math.round(fill * 100)}% filled · ${label}`;
  }

  function init() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    [W, H] = BOXES[$<HTMLSelectElement>('box').value] ?? BOXES.poster!;
    poster.style.setProperty('--ar', String(W / H));
    const a = Math.sqrt(W * H);
    rmin = 0.0035 * a;
    rmax = 0.05 * a;
    rfloor = 0.3 * rmin;
    sIn = +$('sin').value / 100;
    sFar = +$('sfar').value / 100;
    fall = +$('fall').value / 100;
    N = 0; settle = 0; fill = 0; sumRN2 = 0; frames = 0;
    state = 'running';
    rng = mulberry32((Math.random() * 4294967296) >>> 0);
    const text = $('text').value.trim();
    shapes = buildShapes(text);
    canvas.setAttribute('aria-label', 'Circle packing poster' + (text ? ` reading ${text}` : ''));
    buildMask();
    setScale();
    setGrid();
    resize();
    stats();
    schedule();
  }

  // ---------- controls ----------
  const timers = new Set<number>();
  const debounce = (fn: () => void, ms: number) => {
    let id = 0;
    return () => {
      clearTimeout(id);
      timers.delete(id);
      id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
  };

  $('text').addEventListener('input', debounce(init, 400));
  $('box').addEventListener('change', init);
  $('pace').addEventListener('input', (e) => {
    pace = +(e.target as HTMLInputElement).value;
    out('paceV').textContent = String(pace);
  });
  $('res').addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value;
    maxRes = (+v / 100) * 0.4;
    out('resV').textContent = v;
  });
  $('count').addEventListener('input', (e) => {
    nFinal = +(e.target as HTMLInputElement).value;
    out('countV').textContent = nFinal.toLocaleString();
    if (state !== 'running' && N < nFinal && N < MAXN - 2) {
      state = 'running';
      settle = 0;
      schedule();
    }
  });
  const rescale = debounce(init, 300);
  for (const id of ['sin', 'sfar', 'fall']) {
    $(id).addEventListener('input', (e) => {
      out(`${id}V`).textContent = `${(e.target as HTMLInputElement).value}%`;
      rescale();
    });
  }
  $('c0').addEventListener('input', (e) => {
    COLORS[0] = (e.target as HTMLInputElement).value;
    draw();
  });
  $('c1').addEventListener('input', (e) => {
    COLORS[1] = (e.target as HTMLInputElement).value;
    draw();
  });
  showMask.addEventListener('change', draw);
  const pauseButton = $<HTMLButtonElement>('pause');
  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'resume' : 'pause';
    stats();
    schedule();
  });
  $('restart').addEventListener('click', init);

  const observer = new ResizeObserver(() => resize());
  observer.observe(poster);

  // The mask is set in Archivo, so wait for it — otherwise the first run
  // measures a fallback face and packs around the wrong letters.
  let live = true;
  Promise.race([
    document.fonts.load(`${FONT_WEIGHT} 100px Archivo`).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]).then(() => {
    if (live) init();
  });

  return () => {
    live = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    for (const id of timers) clearTimeout(id);
    observer.disconnect();
  };
}
