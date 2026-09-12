// Albers' Squares — the p5 sketch, ported to run inline on the project page.
// Instance mode so it tears down on client-side navigation; p5 loads on
// demand, only on the page that has the #albers-container.

const P5_SRC = 'https://cdn.jsdelivr.net/npm/p5@1.11.3/lib/p5.min.js';

let p5Loading: Promise<void> | null = null;
let instance: any = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(script);
  });
}

function loadP5(): Promise<void> {
  p5Loading ??= loadScript(P5_SRC);
  return p5Loading;
}

function teardown() {
  if (!instance) return;
  instance.remove();
  instance = null;
}

export async function initAlbers() {
  const container = document.getElementById('albers-container');
  if (!container || instance) return;

  await loadP5();
  const p5 = (window as any).p5;
  if (!p5 || !document.getElementById('albers-container')) return;

  const SIZE = 600;
  let rotation = 0;
  let squares = 1;
  let colors: any[] = [];
  let grain: any;

  const sketch = (p: any) => {
    // A soft monochrome grain, soft-light blended over each composition so the
    // flat fills read as painted. Stands in for a canvas.jpg lost since 2021.
    const makeGrain = () => {
      const g = p.createGraphics(SIZE, SIZE);
      g.loadPixels();
      for (let i = 0; i < g.pixels.length; i += 4) {
        const v = 128 + p.random(-18, 18);
        g.pixels[i] = v;
        g.pixels[i + 1] = v;
        g.pixels[i + 2] = v;
        g.pixels[i + 3] = 255;
      }
      g.updatePixels();
      return g;
    };

    const setColors = () => {
      const a = p.color(p.random(50, 200), p.random(50, 200), p.random(50, 200));
      const b = p.color(p.random(75, 250), p.random(75, 250), p.random(75, 250));
      const steps = 1 / squares;
      const lerps = [];
      for (let n = squares - 2; n > 0; n -= 1) lerps.push(p.lerpColor(a, b, steps * n));
      colors = lerps.reverse();
      colors.unshift(a);
      colors.push(b);
    };

    // Nested squares, each smaller and offset down and to the right — the
    // weighted stack that gives the Homage its floating look.
    const createSquares = () => {
      let size = SIZE;
      let x = 0;
      let y = 0;
      for (let n = squares; n > 0; n -= 1) {
        p.fill(colors[Math.floor(n)]);
        p.square(x, y, size);
        size = size / 1.5;
        x += size / 4;
        y += size / 2.35;
      }
    };

    p.setup = () => {
      p.createCanvas(SIZE, SIZE);
      p.colorMode(p.RGB);
      p.noStroke();
      grain = makeGrain();
    };

    p.draw = () => {
      // Set the rate inside draw, not setup, so the first composition appears
      // at once and only the cadence after it is slow — a new one every ~3s.
      p.frameRate(0.3);
      p.clear();
      p.blendMode(p.BLEND);
      squares = p.random(1, 5);
      setColors();
      createSquares();
      p.translate(p.width / 2, p.height / 2);
      rotation += 90;
      p.rotate(p.radians(rotation));
      p.imageMode(p.CENTER);
      p.blendMode(p.SOFT_LIGHT);
      p.image(grain, 0, 0);
    };
  };

  instance = new p5(sketch, container);
}

// The client router swaps the DOM without a full reload; tear the sketch down
// before each swap so no canvas survives the navigation.
document.addEventListener('astro:before-swap', teardown);
