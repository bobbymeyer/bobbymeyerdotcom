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

  // Mirror any [data-collide] DOM elements as static bodies so cells
  // pile on top of them and bounce off their edges. Each body keeps a
  // back-reference to its element so we can nudge its CSS transform
  // when something hits it.
  interface ElState {
    el: HTMLElement;
    rot: number;     // current rotation in deg
    rotVel: number;  // angular velocity
  }
  const elState = new Map<number, ElState>();
  let domBodies: Matter.Body[] = [];

  const buildDomBodies = () => {
    Matter.World.remove(engine.world, domBodies);
    elState.clear();
    domBodies = [];
    const cRect = container.getBoundingClientRect();
    const targets = container.querySelectorAll<HTMLElement>('[data-collide]');
    targets.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const x = r.left - cRect.left + r.width / 2;
      const y = r.top - cRect.top + r.height / 2;
      const body = Matter.Bodies.rectangle(x, y, r.width, r.height, {
        isStatic: true,
        friction: 0.5,
        restitution: 0.3,
        render: { visible: false },
      });
      domBodies.push(body);
      elState.set(body.id, { el, rot: 0, rotVel: 0 });
      // Make sure transform animates smoothly even on rapid hits.
      el.style.transition = 'transform 60ms linear';
      el.style.willChange = 'transform';
    });
    Matter.World.add(engine.world, domBodies);
  };
  buildDomBodies();

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
  const springAnimate = () => {
    elState.forEach((state) => {
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
  container.querySelectorAll<HTMLElement>('[data-collide]').forEach((el) => elRo.observe(el));

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
      elState.forEach((state) => {
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
