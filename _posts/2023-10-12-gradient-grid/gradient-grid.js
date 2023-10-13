let canvasSize = 1000;
let gridSize = 20;
let canvasColor, centerColor, midColor;
let gridSizeInput, canvasColorPicker, centerColorPicker, midColorPicker;

function setup() {
  let cnv = createCanvas(canvasSize, canvasSize);
  noStroke();

  // Create DOM elements inside 'canvas-container'
  let container = select('#canvas-container-controls');


  canvasColorPicker = createColorPicker('#FFFFFF');
  canvasColorPicker.parent(container);
  canvasColorPicker.input(updateCanvas);

  midColorPicker = createColorPicker('#FFC2F2');
  midColorPicker.parent(container);
  midColorPicker.input(updateCanvas);

  centerColorPicker = createColorPicker('#FF3300');
  centerColorPicker.parent(container);
  centerColorPicker.input(updateCanvas);

  gridSizeInput = createInput('16');
  gridSizeInput.attribute('type', 'number');
  gridSizeInput.parent(container);
  gridSizeInput.input(updateCanvas);
  gridSizeInput.id('grid-squares-input');

  cnv.parent('canvas-container');
  updateCanvas();  // Update and draw the canvas with initial values
}

function drawGradient() {
  if (canvasColor && centerColor && midColor) {
    background(canvasColor);
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        let x = i * (canvasSize / gridSize);
        let y = j * (canvasSize / gridSize);
        let d = dist(canvasSize / 2, canvasSize / 2, x, y);
        let lerpAmount = map(d, 0, canvasSize / sqrt(2), 0, 1);
        let cellColor = lerpColor(lerpColor(centerColor, midColor, lerpAmount), canvasColor, lerpAmount * lerpAmount);
        fill(cellColor);
        rect(x, y, canvasSize / gridSize + 1, canvasSize / gridSize + 1);  // Add 1 to cover gaps
      }
    }
  }
}

function updateCanvas() {
  canvasColor = canvasColorPicker.color();
  centerColor = centerColorPicker.color();
  midColor = midColorPicker.color();
  gridSize = parseInt(gridSizeInput.value());

  if (canvasColor && centerColor && midColor) {
    drawGradient();
  }
}

function draw() {
  // We don't need this function to constantly redraw.
  // The canvas will be updated by the updateCanvas function whenever needed.
  noLoop();
}
