import Matter from 'matter-js';

// Cells the colour of the splash grid's CMYK palette.
const COLORS = ['#00aeef', '#ec008c', '#fff200', '#1f1f24'];
const CELL = 48;
const SPAWN_MS = 4000;
const FIRST_DROP_DELAY_MS = 8000;
const MAX_CELLS = 60;

// data-collide-shape="<image url>" voxelises the image into a grid of
// foreground pixels. Each foreground pixel becomes a small static rect
// and cells bounce off the silhouette instead of the bounding box.
const VOX_COLS = 36;
const VOX_ROWS = 60;
const VOX_LUM_THRESHOLD = 28;
const voxelCache = new Map<string, boolean[]>();

async function loadVoxels(url: string): Promise<boolean[]> {
  const cached = voxelCache.get(url);
  if (cached) return cached;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`load ${url}`));
    img.src = url;
  });
  const cnv = document.createElement('canvas');
  cnv.width = VOX_COLS;
  cnv.height = VOX_ROWS;
  const ctx = cnv.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.drawImage(img, 0, 0, VOX_COLS, VOX_ROWS);
  const { data } = ctx.getImageData(0, 0, VOX_COLS, VOX_ROWS);
  const mask = new Array<boolean>(VOX_COLS * VOX_ROWS);
  for (let i = 0; i < VOX_COLS * VOX_ROWS; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    mask[i] = lum > VOX_LUM_THRESHOLD;
  }
  voxelCache.set(url, mask);
  return mask;
}

export interface Handle {
  destroy(): void;
}

export function startFallingCells(canvas: HTMLCanvasElement, container: HTMLElement): Handle {
  const engine = Matter.Engine.create();
  engine.gravity.y = 1.0;

  let { clientWidth: w, clientHeight: h } = container;

  const render = Matter.Render.create({
    canvas,
    engine,
    options: {
      width: w,
      height: h,
      wireframes: false,
      background: 'transparent',
      pixelRatio: window.devicePixelRatio || 1,
    },
  });

  let walls: Matter.Body[] = [];
  const buildWalls = () => {
    Matter.World.remove(engine.world, walls);
    walls = [
      // floor at the bottom of the container (= bottom of main = bottom of page content)
      Matter.Bodies.rectangle(w / 2, h + 25, w + 100, 50, { isStatic: true }),
      Matter.Bodies.rectangle(-25, h / 2, 50, h * 2, { isStatic: true }),
      Matter.Bodies.rectangle(w + 25, h / 2, 50, h * 2, { isStatic: true }),
    ];
    Matter.World.add(engine.world, walls);
  };
  buildWalls();

  // Mirror any [data-collide] DOM elements as physics bodies. Voxelised
  // shapes stay static (silhouette is the whole point). Other elements
  // are dynamic but pinned at their centre — gravity / cell impacts
  // tilt them, an angular spring brings them back upright. The DOM
  // element gets a CSS rotate that follows the body's actual angle.
  interface ElState {
    el: HTMLElement;
    body: Matter.Body | null;   // dynamic body for tippable elements
  }
  const elState = new Map<number, ElState>();
  const uniqueStates = new Set<ElState>();
  let domBodies: Matter.Body[] = [];
  let pinConstraints: Matter.Constraint[] = [];

  // Search the whole document — data-collide elements live alongside
  // (not inside) the FallingCells container.
  const findCollideEls = () =>
    document.querySelectorAll<HTMLElement>('[data-collide]');

  // Per-line client rects for an element. Multi-line text returns one
  // DOMRect per visual line (including the short trailing line); a
  // single-line block returns just one. Used to build compound bodies
  // that hug the actual text shape.
  const lineRectsOf = (el: HTMLElement): DOMRect[] => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return Array.from(range.getClientRects()).filter(
      (r) => r.width >= 4 && r.height >= 4,
    );
  };

  const buildDomBodies = () => {
    Matter.World.remove(engine.world, [...domBodies, ...pinConstraints]);
    elState.clear();
    uniqueStates.clear();
    domBodies = [];
    pinConstraints = [];
    const cRect = container.getBoundingClientRect();
    const targets = findCollideEls();

    const staticOpts: Matter.IChamferableBodyDefinition = {
      isStatic: true,
      friction: 0.5,
      restitution: 0.3,
      render: { visible: false },
    };
    const tippableOpts: Matter.IChamferableBodyDefinition = {
      isStatic: false,
      density: 0.0008,
      friction: 0.5,
      frictionAir: 0.10,
      restitution: 0.18,
      render: { visible: false },
    };

    targets.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const baseX = r.left - cRect.left;
      const baseY = r.top - cRect.top;
      const shapeUrl = el.dataset.collideShape;
      const mask = shapeUrl ? voxelCache.get(shapeUrl) : null;

      if (mask) {
        // Voxelised silhouette — static, no tipping.
        const cellW = r.width / VOX_COLS;
        const cellH = r.height / VOX_ROWS;
        const created: Matter.Body[] = [];
        for (let yy = 0; yy < VOX_ROWS; yy++) {
          for (let xx = 0; xx < VOX_COLS; xx++) {
            if (!mask[yy * VOX_COLS + xx]) continue;
            created.push(
              Matter.Bodies.rectangle(
                baseX + xx * cellW + cellW / 2,
                baseY + yy * cellH + cellH / 2,
                cellW + 0.5,
                cellH + 0.5,
                staticOpts,
              ),
            );
          }
        }
        domBodies.push(...created);
        const stateEntry: ElState = { el, body: null };
        uniqueStates.add(stateEntry);
        created.forEach((b) => elState.set(b.id, stateEntry));
        el.style.transition = '';
        el.style.willChange = '';
        el.style.transformOrigin = '';
        el.style.transform = '';
      } else {
        // Tippable: a dynamic body pinned at its center of mass.
        // Multi-line text becomes a compound body of per-line rects so
        // cells can fall into the empty space alongside a short final
        // line; everything else collapses to a single rect (the
        // bounding box).
        const lineRects = lineRectsOf(el);
        const useCompound = lineRects.length > 1;

        const partOpts: Matter.IChamferableBodyDefinition = {
          friction: 0.5,
          restitution: 0.18,
          render: { visible: false },
        };

        const subRects = useCompound
          ? lineRects
          : [el.getBoundingClientRect()];
        const parts = subRects.map((rr) => {
          const cx = rr.left - cRect.left + rr.width / 2;
          const cy = rr.top - cRect.top + rr.height / 2;
          return Matter.Bodies.rectangle(cx, cy, rr.width, rr.height, partOpts);
        });

        const body = useCompound
          ? Matter.Body.create({ parts, ...tippableOpts })
          : parts[0];
        if (!useCompound) {
          // Single-rect case still needs the tippableOpts applied —
          // Bodies.rectangle was created with partOpts. Override here.
          Matter.Body.set(body, 'isStatic', tippableOpts.isStatic);
          Matter.Body.set(body, 'density', tippableOpts.density);
          Matter.Body.set(body, 'frictionAir', tippableOpts.frictionAir);
        }

        const pin = Matter.Constraint.create({
          pointA: { x: body.position.x, y: body.position.y },
          bodyB: body,
          pointB: { x: 0, y: 0 },
          length: 0,
          stiffness: 1,
          damping: 1,
          render: { visible: false },
        });
        domBodies.push(body);
        pinConstraints.push(pin);

        const stateEntry: ElState = { el, body };
        uniqueStates.add(stateEntry);
        elState.set(body.id, stateEntry);

        // CSS rotation pivots around the same point Matter pins (the
        // compound's center of mass), in element-local px so the
        // visual stays aligned with the physics.
        const originX = body.position.x - baseX;
        const originY = body.position.y - baseY;
        el.style.transition = '';                    // physics-driven, no easing
        el.style.willChange = 'transform';
        el.style.transformOrigin = `${originX.toFixed(1)}px ${originY.toFixed(1)}px`;
      }
    });
    Matter.World.add(engine.world, [...domBodies, ...pinConstraints]);
  };
  buildDomBodies();

  // Async: voxelise any data-collide-shape images, then rebuild bodies
  // so those elements upgrade from bounding rect to silhouette.
  const shapeUrls = Array.from(findCollideEls())
    .map((el) => el.dataset.collideShape)
    .filter((s): s is string => !!s);
  const uniqueShapes = Array.from(new Set(shapeUrls));
  if (uniqueShapes.length > 0) {
    Promise.all(uniqueShapes.map((u) => loadVoxels(u).catch(() => null)))
      .then(() => buildDomBodies());
  }

  // Soft angular spring back to upright on every physics step. Cell
  // collisions naturally apply torque via Matter; this keeps elements
  // from drifting indefinitely after the cells leave.
  Matter.Events.on(engine, 'beforeUpdate', () => {
    uniqueStates.forEach((state) => {
      const body = state.body;
      if (!body) return;
      Matter.Body.setAngularVelocity(body, body.angularVelocity - body.angle * 0.005);
    });
  });

  // Mirror each tippable body's actual angle onto the DOM element it
  // represents.
  const updateTransforms = () => {
    uniqueStates.forEach((state) => {
      const body = state.body;
      if (!body) return;
      if (Math.abs(body.angle) < 0.0005 && Math.abs(body.angularVelocity) < 0.0005) {
        state.el.style.transform = '';
      } else {
        const deg = body.angle * (180 / Math.PI);
        state.el.style.transform = `rotate(${deg.toFixed(2)}deg)`;
      }
    });
    rafId = requestAnimationFrame(updateTransforms);
  };
  let rafId = requestAnimationFrame(updateTransforms);

  const ro = new ResizeObserver(() => {
    w = container.clientWidth;
    h = container.clientHeight;
    canvas.width = w * (window.devicePixelRatio || 1);
    canvas.height = h * (window.devicePixelRatio || 1);
    render.options.width = w;
    render.options.height = h;
    Matter.Render.setPixelRatio(render, window.devicePixelRatio || 1);
    Matter.Render.lookAt(render, { min: { x: 0, y: 0 }, max: { x: w, y: h } });
    buildWalls();
    buildDomBodies();
  });
  ro.observe(container);
  // Also rebuild collide bodies whenever any tracked element resizes
  // (text reflow, image load, font swap, etc.).
  const elRo = new ResizeObserver(() => buildDomBodies());
  findCollideEls().forEach((el) => elRo.observe(el));

  const live: Matter.Body[] = [];
  const spawn = () => {
    // Snap to the splash grid's 48px column centers so spawns line up
    // with the shader cells overhead.
    const cellCount = Math.max(1, Math.floor(w / CELL));
    const padX = (w - cellCount * CELL) / 2;
    const idx = (Math.random() * cellCount) | 0;
    const x = padX + idx * CELL + CELL / 2;
    const color = COLORS[(Math.random() * COLORS.length) | 0];

    const body = Matter.Bodies.rectangle(x, -CELL, CELL, CELL, {
      restitution: 0.42,
      friction: 0.5,
      frictionAir: 0.012,
      density: 0.0015,
      angle: (Math.random() - 0.5) * 0.1,
      render: { fillStyle: color },
    });
    Matter.World.add(engine.world, body);
    live.push(body);

    while (live.length > MAX_CELLS) {
      const old = live.shift()!;
      Matter.World.remove(engine.world, old);
    }
  };

  let spawnInterval: number | null = null;
  const spawnStart = window.setTimeout(() => {
    spawn();
    spawnInterval = window.setInterval(spawn, SPAWN_MS);
  }, FIRST_DROP_DELAY_MS);

  const runner = Matter.Runner.create();
  Matter.Runner.run(runner, engine);
  Matter.Render.run(render);

  return {
    destroy() {
      window.clearTimeout(spawnStart);
      if (spawnInterval !== null) window.clearInterval(spawnInterval);
      cancelAnimationFrame(rafId);
      ro.disconnect();
      elRo.disconnect();
      uniqueStates.forEach((state) => {
        state.el.style.transform = '';
        state.el.style.transition = '';
        state.el.style.willChange = '';
      });
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      Matter.Engine.clear(engine);
      Matter.World.clear(engine.world, false);
    },
  };
}
