
let samples = [];
let activeSounds = [];
let ffts = [];
let playing;
let r = 0;

function preload() {
  soundFormats('mp3');
  i = 1;
  while (i <= 8) {
    samples.push(loadSound('samples/p' + i + '.mp3'));
    i++;
  }
  bg = loadImage('map.png');
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
  playing = !playing;
  console.log(playing);
  if (playing == true) {
    playMusic();
  }
}

async function playMusic() {
  while (playing == true) {
    activeSounds = activeSounds.filter(sample => sample.isPlaying());  // Remove any sounds that have finished playing
    if (activeSounds.length < 3) {
      playSample();
    }
    waitTime = random(4, 10) * 1000;
    await new Promise(r => setTimeout(r, waitTime));
  }
}

function playSample() {
  sampleIndex = Math.floor(random(0, samples.length - 1));
  console.log(sampleIndex);
  let sample = samples[sampleIndex];
  rates = [0.25, 0.5, 1.0, 2];
  rate_index = Math.floor(Math.random() * rates.length)

  sample.play(0, rates[rate_index], 0.05, 0, sample.duration());  // Volume set to 0.25, which is 25%
  activeSounds.push(sample);  // Add the new sound to the activeSounds array
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

  strokeWeight(1);
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
