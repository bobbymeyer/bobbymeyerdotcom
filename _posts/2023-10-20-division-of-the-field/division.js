let color_1;
let color_2;
let colorPicker1;
let colorPicker2;

function setup() {
  cnv = createCanvas(windowWidth, windowWidth);
  cnv.parent('canvas-container');
  background(220);

  colorPicker1 = select('#colorPicker1');
  colorPicker2 = select('#colorPicker2');

  colorPicker1.input(updateColors);
  colorPicker2.input(updateColors);

  updateColors();
  frameRate(4);
}

function updateColors() {
  color_1 = colorPicker1.value();
  color_2 = colorPicker2.value();
  drawBlocks();
}

function getRandomColorBetween(c1, c2) {
  return lerpColor(c1, c2, random(1));
}

function drawBlocks() {

  noStroke();

  let halfWidth = windowWidth / 2;
  background(color_1);
  fill(color_2);
  rect(0, 0, halfWidth, height);

  let numLines = 50;
  let lineHeight = height / numLines;
  let minBlockLength = 70;
  let maxBlockLength = 100;
  let waveAmplitude = 50;

  for (let i = 0; i < numLines; i++) {
    let y = i * lineHeight;
    let numBlocks = round(random(2, 3));

    let sineOffset = waveAmplitude * sin(TWO_PI * (i / numLines + random(1)));
    let randomOffset = random(-20, 20);
    let blockStartX = halfWidth - minBlockLength + sineOffset + randomOffset - 20;

    for (let j = 0; j < numBlocks; j++) {
      let blockWidth = random(minBlockLength, maxBlockLength);

      if (blockStartX + blockWidth > width) {
        blockWidth = width - blockStartX;
      } else if (blockStartX < 0) {
        blockStartX = 0;
      }

      let col = getRandomColorBetween(color(color_1), color(color_2));
      fill(col);
      rect(blockStartX, y, blockWidth, lineHeight);

      blockStartX += blockWidth;
    }
  }
}

function draw() { drawBlocks(); }

