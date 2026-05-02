import Matter from 'matter-js';

// Cells the colour of the splash grid's CMYK palette.
const COLORS = ['#00aeef', '#ec008c', '#fff200', '#1f1f24'];
const CELL = 48;
const SPAWN_MS = 4000;
const FIRST_DROP_DELAY_MS = 8000;
const MAX_CELLS = 60;

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
  });
  ro.observe(container);

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
      ro.disconnect();
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      Matter.Engine.clear(engine);
      Matter.World.clear(engine.world, false);
    },
  };
}
