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
const VOX_COLS = 18;
const VOX_ROWS = 30;
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

  // Mirror any [data-collide] DOM elements as static bodies so cells
  // pile on top of them and bounce off their edges. Each body keeps a
  // back-reference to its element so we can nudge its CSS transform
  // when something hits it.
  interface ElState {
    el: HTMLElement;
    rot: number;     // current rotation in deg
    rotVel: number;  // angular velocity
  }
  // Each body.id points to its element's ElState. Multiple voxel
  // sub-bodies share the same ElState object so the whole element
  // wobbles together. uniqueStates is the dedup'd set we iterate.
  const elState = new Map<number, ElState>();
  const uniqueStates = new Set<ElState>();
  let domBodies: Matter.Body[] = [];

  // Search the whole document — data-collide elements live alongside
  // (not inside) the FallingCells container.
  const findCollideEls = () =>
    document.querySelectorAll<HTMLElement>('[data-collide]');

  const buildDomBodies = () => {
    Matter.World.remove(engine.world, domBodies);
    elState.clear();
    uniqueStates.clear();
    domBodies = [];
    const cRect = container.getBoundingClientRect();
    const targets = findCollideEls();
    const opts: Matter.IChamferableBodyDefinition = {
      isStatic: true,
      friction: 0.5,
      restitution: 0.3,
      render: { visible: false },
    };
    targets.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const baseX = r.left - cRect.left;
      const baseY = r.top - cRect.top;
      const shapeUrl = el.dataset.collideShape;
      const mask = shapeUrl ? voxelCache.get(shapeUrl) : null;

      const created: Matter.Body[] = [];
      if (mask) {
        // Voxelised silhouette — one tiny static rect per foreground pixel.
        const cellW = r.width / VOX_COLS;
        const cellH = r.height / VOX_ROWS;
        for (let yy = 0; yy < VOX_ROWS; yy++) {
          for (let xx = 0; xx < VOX_COLS; xx++) {
            if (!mask[yy * VOX_COLS + xx]) continue;
            created.push(
              Matter.Bodies.rectangle(
                baseX + xx * cellW + cellW / 2,
                baseY + yy * cellH + cellH / 2,
                cellW + 0.5, // small overlap to avoid seams
                cellH + 0.5,
                opts,
              ),
            );
          }
        }
      } else {
        created.push(
          Matter.Bodies.rectangle(
            baseX + r.width / 2,
            baseY + r.height / 2,
            r.width,
            r.height,
            opts,
          ),
        );
      }

      domBodies.push(...created);
      // All sub-bodies route nudges back to the same DOM element so the
      // whole portrait wobbles as one when any voxel takes a hit.
      const stateEntry: ElState = { el, rot: 0, rotVel: 0 };
      uniqueStates.add(stateEntry);
      created.forEach((b) => elState.set(b.id, stateEntry));
      el.style.transition = 'transform 60ms linear';
      el.style.willChange = 'transform';
    });
    Matter.World.add(engine.world, domBodies);
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

  // Listen for collisions between cells and DOM-mirrored bodies, kick
  // the matching element's angular velocity.
  Matter.Events.on(engine, 'collisionStart', (event) => {
    for (const pair of event.pairs) {
      const aStatic = pair.bodyA.isStatic;
      const bStatic = pair.bodyB.isStatic;
      if (aStatic === bStatic) continue;
      const staticBody = aStatic ? pair.bodyA : pair.bodyB;
      const cellBody   = aStatic ? pair.bodyB : pair.bodyA;
      const state = elState.get(staticBody.id);
      if (!state) continue;

      // Hit hard? Kick the element's rotation. Sign comes from where on
      // the element's width the impact lands so cells striking the right
      // edge tilt it clockwise and vice versa.
      const speed = Math.hypot(cellBody.velocity.x, cellBody.velocity.y);
      const offset = (cellBody.position.x - staticBody.position.x) / (staticBody.bounds.max.x - staticBody.bounds.min.x);
      const sign = Math.sign(offset || (Math.random() - 0.5));
      state.rotVel += sign * Math.min(speed * 0.18, 1.4);
    }
  });

  // Spring + damping decay so kicked elements settle back to rest.
  // Iterate the dedup'd Set — each element's state is updated once
  // per frame regardless of how many voxel sub-bodies it has.
  const springAnimate = () => {
    uniqueStates.forEach((state) => {
      state.rotVel += -state.rot * 0.06;   // spring toward 0
      state.rotVel *= 0.90;                // damping
      state.rot += state.rotVel;
      if (Math.abs(state.rot) < 0.01 && Math.abs(state.rotVel) < 0.01) {
        state.rot = 0;
        state.rotVel = 0;
        state.el.style.transform = '';
      } else {
        state.el.style.transform = `rotate(${state.rot.toFixed(2)}deg)`;
      }
    });
    rafId = requestAnimationFrame(springAnimate);
  };
  let rafId = requestAnimationFrame(springAnimate);

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
