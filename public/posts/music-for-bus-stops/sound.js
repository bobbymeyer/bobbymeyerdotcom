
let samples = [];
let activeSounds = [];
let ffts = [];
let playing;
let r = 0;

function preload() {
  soundFormats('mp3');
  i = 1;
  while (i <= 8) {
    samples.push(loadSound('/posts/music-for-bus-stops/samples/p' + i + '.mp3'));
    i++;
  }
  bg = loadImage('/posts/music-for-bus-stops/map.png');
}

function setup() {
  angleMode(DEGREES);
  playing = false;
  size = Math.min(windowWidth, windowWidth, 600);
  cnv = createCanvas(size, size);
  cnv.parent('song-container');
  cnv.mousePressed(toggleMusic);

  for(sample of samples) {
    fft = new p5.FFT();
    fft.setInput(sample);
    ffts.push(fft);
  };
  console.log(ffts);
}

function toggleMusic() {
  // Browsers suspend the AudioContext until a user gesture; resume
  // explicitly here so the first sample isn't silenced while we wait
  // for the context to wake up.
  userStartAudio();
  playing = !playing;
  if (playing == true) {
    playMusic();
  }
}

// A voice is "fresh" for the first 75% of its run — after that we
// assume it's tailing off (silent reverb decay) and stop counting it
// toward the active layer count, while still letting it finish.
const FRESH_FRACTION = 0.75;
const isFresh = v => (Date.now() - v.startedAt) / 1000 < v.duration * FRESH_FRACTION;

async function playMusic() {
  while (playing == true) {
    activeSounds = activeSounds.filter(isFresh);
    if (activeSounds.length < 3) {
      playSample();
    }
    const waitMs = random(500, 2500);
    const startedAt = Date.now();
    while (playing && Date.now() - startedAt < waitMs) {
      await new Promise(r => setTimeout(r, 50));
      activeSounds = activeSounds.filter(isFresh);
      if (activeSounds.length <= 1) break;
    }
  }
}

function playSample() {
  const sampleIndex = Math.floor(random(0, samples.length));
  const sample = samples[sampleIndex];
  sample.play(0, 0.5, 0.05, 0, sample.duration());
  activeSounds.push({
    sample,
    startedAt: Date.now(),
    duration: sample.duration(),
  });
}



function windowResized() {
  size = Math.min(windowWidth, windowWidth, 600);
  resizeCanvas(size, size);
}

function draw() {
  fill(230, 220, 200);
  push();
  tint(255, 127);
  image(bg, 0, 0, size, size);
  pop();
  strokeWeight(0);
  rect(0, 10, size, 120);
  textSize(48);
  fill(230, 220, 200);
  rect(size - 75, size - 75, 160, 160);
  fill(0);
  text(playing == true ? '⏸' : '⏵', size - 50, size - 20);

  noFill();

  strokeWeight(1);``
  translate(250, 20);
  for (fft of ffts) {

    translate(0, 11);
    let spectrum = fft.analyze();
    beginShape();
    h = 0;
    for (i = 0; i < spectrum.length; i++) {
      vertex(i * 2, map(spectrum[i]/50, h, width, 0, height));
    }

    endShape();
  }
}
