import Matter from 'matter-js';

// Cells the colour of the splash grid's CMYK palette.
const COLORS = ['#00aeef', '#ec008c', '#fff200', '#1f1f24'];
// Match the shader's responsive cell size: smaller on mobile so the
// falling cells line up with the splash grid above them.
const cellPxFor = (width: number) => (width < 768 ? 24 : 48);
const SPAWN_MS = 4000;
const FIRST_DROP_DELAY_MS = 8000;
const MAX_CELLS = 60;

// data-collide-shape="<image url>" voxelises the image into a grid of
// foreground pixels. Each foreground pixel becomes a small static rect
// and cells bounce off the silhouette instead of the bounding box.
const VOX_COLS = 36;
const VOX_ROWS = 60;
const VOX_LUM_THRESHOLD = 28;
// Each voxel rect inflates by this many px so the silhouette has a soft
// halo of collision area around it instead of cells landing right on
// the photo's outline.
const VOX_PAD_PX = 8;
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
  const engine = Matter.Engine.create({ enableSleeping: true });
  engine.gravity.y = 1.0;
  // More solver work per step → constraints (pins) resolve closer to
  // equilibrium and stacks settle without micro-jitter.
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
  engine.constraintIterations = 4;

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
      // Engine sleeping is on for smoothness; don't let the renderer
      // dim sleeping bodies when they come to rest.
      showSleeping: false,
    },
  });

  let walls: Matter.Body[] = [];
  const buildWalls = () => {
    Matter.World.remove(engine.world, walls);
    const wallOpts: Matter.IChamferableBodyDefinition = {
      isStatic: true,
      render: { visible: false }, // physics only — never drawn by Matter.Render
    };
    walls = [
      // floor at the bottom of the container
      Matter.Bodies.rectangle(w / 2, h + 25, w + 100, 50, wallOpts),
      // left + right
      Matter.Bodies.rectangle(-25, h / 2, 50, h * 2, wallOpts),
      Matter.Bodies.rectangle(w + 25, h / 2, 50, h * 2, wallOpts),
      // top — splash header is a hard ceiling; cells can't push past it
      Matter.Bodies.rectangle(w / 2, -25, w + 100, 50, wallOpts),
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
    baseX?: number;             // initial body.position.x — for translate
    baseY?: number;
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
      density: 0.0004,        // lighter so cells visibly push them down
      friction: 0.5,
      frictionAir: 0.14,      // moderate damping; not so high it stops motion
      restitution: 0.10,
      sleepThreshold: 30,     // sleep after ~half a second of rest
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
                cellW + VOX_PAD_PX,
                cellH + VOX_PAD_PX,
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
        // - inputs / textarea → a thin strip at the visual underline so
        //   cells settle on the line rather than the input's full box
        // - multi-line text → compound body of per-line rects so cells
        //   can fall into the empty space alongside a short final line
        // - everything else → single rect bounding box
        const isLineField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
        const LINE_STRIP_PX = 6;

        const partOpts: Matter.IChamferableBodyDefinition = {
          friction: 0.5,
          restitution: 0.18,
          render: { visible: false },
        };

        let body: Matter.Body;
        if (isLineField) {
          // Thin horizontal bar at the input's bottom border. Cells
          // landing on it rest with their bottom edge on the underline.
          const cx = baseX + r.width / 2;
          const cy = baseY + r.height - LINE_STRIP_PX / 2;
          body = Matter.Bodies.rectangle(cx, cy, r.width, LINE_STRIP_PX, partOpts);
        } else {
          const lineRects = lineRectsOf(el);
          const useCompound = lineRects.length > 1;
          const subRects = useCompound ? lineRects : [el.getBoundingClientRect()];
          const parts = subRects.map((rr) => {
            const cx = rr.left - cRect.left + rr.width / 2;
            const cy = rr.top - cRect.top + rr.height / 2;
            return Matter.Bodies.rectangle(cx, cy, rr.width, rr.height, partOpts);
          });
          body = useCompound ? Matter.Body.create({ parts, ...tippableOpts }) : parts[0];
        }

        // Apply tippableOpts (Bodies.rectangle was created with partOpts).
        Matter.Body.set(body, 'isStatic', tippableOpts.isStatic);
        Matter.Body.set(body, 'density', tippableOpts.density);
        Matter.Body.set(body, 'frictionAir', tippableOpts.frictionAir);

        // Soft pin: low stiffness lets cells push the element down
        // under sustained load; high damping eats single-hit oscillation.
        const pin = Matter.Constraint.create({
          pointA: { x: body.position.x, y: body.position.y },
          bodyB: body,
          pointB: { x: 0, y: 0 },
          length: 0,
          stiffness: 0.06,
          damping: 0.7,
          render: { visible: false },
        });
        domBodies.push(body);
        pinConstraints.push(pin);

        const stateEntry: ElState = {
          el,
          body,
          baseX: body.position.x,
          baseY: body.position.y,
        };
        uniqueStates.add(stateEntry);
        elState.set(body.id, stateEntry);

        // CSS rotation pivots around the same point Matter pins (the
        // compound's center of mass), in element-local px so the
        // visual stays aligned with the physics.
        const originX = body.position.x - baseX;
        const originY = body.position.y - baseY;
        el.style.transition = '';                    // physics-driven, no easing
        el.style.willChange = 'transform';
        // Keep the element on a single persistent compositor layer so
        // text antialiasing doesn't switch modes when motion starts /
        // stops (subpixel ↔ grayscale would read as a saturation flash).
        el.style.transform = 'translateZ(0)';
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

  // Soft angular spring back to upright. Skip sleeping bodies so the
  // engine can actually let them rest; a small deadzone around 0
  // prevents perpetual nudges that would otherwise read as twitch.
  Matter.Events.on(engine, 'beforeUpdate', () => {
    uniqueStates.forEach((state) => {
      const body = state.body;
      if (!body || body.isSleeping) return;
      if (Math.abs(body.angle) < 0.004) return;
      Matter.Body.setAngularVelocity(body, body.angularVelocity - body.angle * 0.004);
    });
  });

  // Mirror each tippable body's actual position + angle onto the DOM
  // element. Translation comes from the soft pin constraint giving way
  // under sustained collision force.
  const updateTransforms = () => {
    uniqueStates.forEach((state) => {
      const body = state.body;
      if (!body || state.baseX === undefined || state.baseY === undefined) return;
      const dx = body.position.x - state.baseX;
      const dy = body.position.y - state.baseY;
      const deg = body.angle * (180 / Math.PI);
      const isResting =
        Math.abs(dx) < 0.3
        && Math.abs(dy) < 0.3
        && Math.abs(body.angle) < 0.0008
        && Math.abs(body.angularVelocity) < 0.0008
        && Math.hypot(body.velocity.x, body.velocity.y) < 0.05;
      if (isResting) {
        // Don't clear the transform — keep the element on its existing
        // compositor layer so antialiasing stays in the same mode it
        // had during motion. Visually identical to no transform.
        state.el.style.transform = 'translateZ(0)';
      } else {
        state.el.style.transform =
          `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) rotate(${deg.toFixed(2)}deg)`;
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

  // Wire keystrokes on form inputs to nudge their parent collide body —
  // each typed character pushes the field upward + jitters cells off it.
  type InputListener = { el: HTMLElement; fn: () => void };
  const inputListeners: InputListener[] = [];
  const wireInputNudges = () => {
    inputListeners.forEach(({ el, fn }) => el.removeEventListener('input', fn));
    inputListeners.length = 0;
    document
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
      .forEach((input) => {
        const collideEl = input.closest('[data-collide]') as HTMLElement | null;
        if (!collideEl) return;
        const fn = () => {
          let state: ElState | undefined;
          uniqueStates.forEach((s) => { if (s.el === collideEl) state = s; });
          if (!state?.body || state.body.isStatic) return;
          // Wake the body so the impulse takes effect immediately.
          if (state.body.isSleeping) Matter.Sleeping.set(state.body, false);
          Matter.Body.applyForce(
            state.body,
            state.body.position,
            { x: (Math.random() - 0.5) * 0.0012, y: -0.0010 },
          );
        };
        input.addEventListener('input', fn);
        inputListeners.push({ el: input, fn });
      });
  };
  wireInputNudges();

  const live: Matter.Body[] = [];
  const spawn = () => {
    // Snap to the splash grid's column centres so spawns line up with
    // the shader cells overhead — the splash uses the same cell size.
    const cell = cellPxFor(window.innerWidth);
    const cellCount = Math.max(1, Math.floor(w / cell));
    const padX = (w - cellCount * cell) / 2;
    const idx = (Math.random() * cellCount) | 0;
    const x = padX + idx * cell + cell / 2;
    const color = COLORS[(Math.random() * COLORS.length) | 0];

    // Spawn just inside the world (below the top wall at y ≈ 0).
    const body = Matter.Bodies.rectangle(x, cell / 2 + 4, cell, cell, {
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
      inputListeners.forEach(({ el, fn }) => el.removeEventListener('input', fn));
      inputListeners.length = 0;
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
