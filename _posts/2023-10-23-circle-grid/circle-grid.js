let cols, rows;
let cellSizeSlider, probabilityCircleSlider, probabilityBisectSlider, bgColorPicker;
let containerWidth, containerHeight;
function setup() {
  containerWidth = select('#canvas-container').width;
  containerHeight = containerWidth * 1.414;

  let cnv = createCanvas(containerWidth, containerHeight, SVG);
  cnv.parent('canvas-container');

  bgColorLabel = createP('BG:');
  bgColorPicker = createColorPicker('#FF66AA');  // default to white
  bgColorPicker.input(redraw);  // Redraw when value changes
  bgColorLabel.parent('canvas-container-controls');
  bgColorPicker.parent('canvas-container-controls');

  cellSizeLabel = createP('Size:');
  cellSizeSlider = createSlider(1, 20, 16);  // max, min, starting value
  // min, max, starting value
  cellSizeSlider.input(redraw);  // Redraw when value changes
  cellSizeLabel.parent('canvas-container-controls');
  cellSizeSlider.parent('canvas-container-controls');

  probabilityCircleLabel = createP('Circle:');
  probabilityCircleSlider = createSlider(0, 1, 0.7, 0.01); // min, max, starting value, step
  probabilityCircleSlider.input(redraw);
  probabilityCircleLabel.parent('canvas-container-controls');
  probabilityCircleSlider.parent('canvas-container-controls');

  probabilityBisectLabel = createP('Bisect:');
  probabilityBisectSlider = createSlider(0, 1, 0.5, 0.01);
  probabilityBisectSlider.input(redraw);
  probabilityBisectLabel.parent('canvas-container-controls');
  probabilityBisectSlider.parent('canvas-container-controls');

  let downloadButton = createButton('DL');
  downloadButton.mousePressed(downloadSVG);
  downloadButton.parent('canvas-container-controls');

  noLoop();
}

function draw() {
  noStroke();
  background(bgColorPicker.color());

  //cellSize = containerWidth / cellSizeSlider.value();
  cellSize = containerWidth / (21 - cellSizeSlider.value());  // this inverts the effect

  probabilityCircle = probabilityCircleSlider.value();
  probabilityBisect = probabilityBisectSlider.value();

  cols = floor(width / cellSize);
  rows = floor(height / cellSize);

  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      let xPos = x * cellSize;
      let yPos = y * cellSize;

      let choice = random(1);
      if (choice < probabilityCircle) {
        drawCircle(xPos, yPos);
      } else if (choice < probabilityCircle + (1 - probabilityCircle) * probabilityBisect) {
        if (random(1) < 0.5) {
          // Bisect vertically
          drawSegment(xPos, yPos, 'vertical');
        } else {
          // Bisect horizontally
          drawSegment(xPos, yPos, 'horizontal');
        }
      } // Else do nothing, leaving a blank cell
    }
  }
}


function drawCircle(x, y) {
  ellipseMode(CORNER);
  fill(randomColor());
  ellipse(x, y, cellSize);
}

function drawSegment(x, y, direction) {
  ellipseMode(CORNER);
  if (direction == 'vertical') {
    fill(randomColor());
    arc(x, y, cellSize, cellSize, HALF_PI, 3 * HALF_PI);
    fill(randomColor());
    arc(x + cellSize, y, cellSize, cellSize, 3 * HALF_PI, HALF_PI);
  } else {
    fill(randomColor());
    arc(x, y, cellSize, cellSize, 0, PI);
    fill(randomColor());
    arc(x, y + cellSize, cellSize, cellSize, PI, 0);
  }
}

function randomColor() {
  // 75% chance of being either black or white
  if (random(1) < 0.75) {
    if (random(1) < 0.5) {
      return color(0);  // Black
    } else {
      return color(255);  // White
    }
  }
  // 25% chance of a random gray
  else {
    let grayValue = random(255);
    return color(grayValue);
  }
}

function downloadSVG() {
  save('canvas.svg');  // This will save the SVG file with the name 'canvas.svg'
}
