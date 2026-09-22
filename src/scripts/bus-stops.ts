// Music for Bus Stops — the p5 sketch, ported to run inline on the project
// page. Instance mode, so the whole thing can be torn down on client-side
// navigation; p5 and p5.sound load on demand, only on the page that has the
// #song-container, and only once.

import { clearSketchFallback, showSketchFallback } from '@/scripts/sketch-fallback';

const P5_SRC = 'https://cdn.jsdelivr.net/npm/p5@1.11.3/lib/p5.min.js';
const P5_SOUND_SRC = 'https://cdn.jsdelivr.net/npm/p5@1.11.3/lib/addons/p5.sound.min.js';

/**
 * Where it works when p5 will not load. Unlike the other two sketches this
 * one is not published anywhere but its repository — the page it runs on is
 * this page — so the repository is what there is to point at.
 */
const FALLBACK = {
  href: 'https://github.com/bobbymeyer/music-for-bus-stops',
  label: 'GitHub',
};

let p5Loading: Promise<void> | null = null;
let instance: any = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // A tag already here means the script is loaded or on its way. That is
    // only true because a failed one is taken out again below: left in, it
    // would answer for the script it never managed to fetch, and every retry
    // would resolve at once against a global that was never defined.
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => {
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    });
    document.head.appendChild(script);
  });
}

// p5.sound augments the p5 constructor, so it has to load after core.
function loadP5(): Promise<void> {
    // Memoised so one visit makes one request, but *not* past a failure: a
  // rejected promise left here would be handed to every later attempt, so one
  // flaky moment would follow the reader around the site until they reloaded.
  p5Loading ??= (loadScript(P5_SRC).then(() => loadScript(P5_SOUND_SRC))).catch((error) => {
    p5Loading = null;
    throw error;
  });
  return p5Loading;
}

function teardown() {
  clearSketchFallback(document.getElementById('song-container'));
  if (!instance) return;
  instance.__cleanup?.();
  instance.remove();
  instance = null;
}

export async function initBusStops() {
  const container = document.getElementById('song-container');
  if (!container || instance) return;

  const base = container.dataset.base ?? '/posts/music-for-bus-stops/';

  // A retry after a failed load starts from a clean container.
  clearSketchFallback(container);

  // p5 comes off a CDN, and the reader can navigate away while it is in
  // flight. Neither failing should take the page with it, and an unhandled
  // rejection is not an account of it that anyone reading the page can see.
  try {
    await loadP5();
  } catch (error) {
    console.error('Music for bus stops: could not load p5', error);
    showSketchFallback(container, FALLBACK);
    return;
  }

  const p5 = (window as any).p5;
  // Guard against navigating away while p5 was loading.
  if (!p5 || !document.getElementById('song-container')) return;

  const samples: any[] = [];
  const ffts: any[] = [];
  let activeSounds: any[] = [];
  let playing = false;
  let bg: any;
  let size = 0;

  const sketch = (p: any) => {
    p.preload = () => {
      p.soundFormats('mp3');
      for (let i = 1; i <= 8; i++) {
        samples.push(p.loadSound(`${base}samples/p${i}.mp3`));
      }
      bg = p.loadImage(`${base}map.png`);
    };

    p.setup = () => {
      p.angleMode(p.DEGREES);
      size = Math.min(p.windowWidth, 600);
      const cnv = p.createCanvas(size, size);
      cnv.mousePressed(toggleMusic);
      for (const sample of samples) {
        const fft = new p5.FFT();
        fft.setInput(sample);
        ffts.push(fft);
      }
    };

    p.windowResized = () => {
      size = Math.min(p.windowWidth, 600);
      p.resizeCanvas(size, size);
    };

    p.draw = () => {
      p.fill(230, 220, 200);
      p.push();
      p.tint(255, 127);
      p.image(bg, 0, 0, size, size);
      p.pop();
      p.strokeWeight(0);
      p.rect(0, 10, size, 120);
      p.textSize(48);
      p.fill(230, 220, 200);
      p.rect(size - 75, size - 75, 160, 160);
      p.fill(0);
      p.text(playing ? '⏸' : '⏵', size - 50, size - 20);

      p.noFill();
      p.strokeWeight(1);
      p.translate(250, 20);
      for (const fft of ffts) {
        p.translate(0, 11);
        const spectrum = fft.analyze();
        p.beginShape();
        for (let i = 0; i < spectrum.length; i++) {
          p.vertex(i * 2, p.map(spectrum[i] / 50, 0, p.width, 0, p.height));
        }
        p.endShape();
      }
    };

    function toggleMusic() {
      // Browsers suspend the AudioContext until a user gesture; resume it here
      // so the first sample isn't silenced while the context wakes up.
      p.userStartAudio();
      playing = !playing;
      if (playing) playMusic();
    }

    // Always one voice going, up to three. The samples are trimmed to just
    // their sound, so the space between entries is made here, not baked into
    // the files: a spacious random gap while there's room, but when only one
    // voice is left, the next comes in just before that one ends, so the
    // sound never drops out.
    const MAX_VOICES = 3;
    // A perfect fifth down (2/3), rather than a full octave (0.5): still a
    // musical interval, but it sits higher and clearer than the octave's mud.
    // A fourth (0.75) is milder still.
    const RATE = 2 / 3;

    // Wall-clock seconds until a sample finishes, given the playback rate.
    const remaining = (s: any) => (s.duration() - s.currentTime()) / RATE;

    const sleep = async (ms: number) => {
      const startedAt = Date.now();
      while (playing && Date.now() - startedAt < ms) {
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    async function playMusic() {
      while (playing) {
        activeSounds = activeSounds.filter((s) => s.isPlaying());

        if (activeSounds.length === 0) {
          // Nothing going (just started, or everything ended at once): begin.
          playSample();
          continue;
        }

        if (activeSounds.length < MAX_VOICES) {
          let waitMs = p.random(3, 10) * 1000;
          if (activeSounds.length === 1) {
            // The last voice: bring the next in 0.25–1s before it ends — or
            // sooner, if the gap above is shorter.
            const bridgeMs = (remaining(activeSounds[0]) - p.random(0.25, 1)) * 1000;
            waitMs = Math.min(waitMs, Math.max(0, bridgeMs));
          }
          await sleep(waitMs);
          if (playing) playSample();
        } else {
          // At the cap: wait for a voice to free up, then re-decide.
          await sleep(p.random(1, 3) * 1000);
        }
      }
    }

    function playSample() {
      const idx = Math.floor(p.random(0, samples.length));
      const sample = samples[idx];
      sample.play(0, RATE, 0.05, 0, sample.duration());
      activeSounds.push(sample);
    }

    // Called on teardown: stop the play loop and any audio still going.
    p.__cleanup = () => {
      playing = false;
      for (const s of activeSounds) {
        if (s.isPlaying()) s.stop();
      }
    };
  };

  instance = new p5(sketch, container);
}

// The client router swaps the DOM without a full reload; tear the sketch down
// before each swap so no canvas or audio survives the navigation.
document.addEventListener('astro:before-swap', teardown);
