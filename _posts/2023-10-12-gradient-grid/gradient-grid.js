let canvasSize = 400;
let gridSize = 20;
let canvasColor, centerColor, midColor;
let gridSizeInput, canvasColorPicker, centerColorPicker, midColorPicker, downloadButton;

function setup() {


  // Create DOM elements inside 'canvas-container'
  let container = select('#canvas-container-controls');


  canvasColorPicker = createColorPicker('#A33E8D');
  canvasColorPicker.parent(container);
  canvasColorPicker.input(updateCanvas);

  midColorPicker = createColorPicker('#FF8800');
  midColorPicker.parent(container);
  midColorPicker.input(updateCanvas);

  centerColorPicker = createColorPicker('#FFEA00');
  centerColorPicker.parent(container);
  centerColorPicker.input(updateCanvas);

  gridSizeInput = createInput('16');
  gridSizeInput.attribute('type', 'number');
  gridSizeInput.parent(container);
  gridSizeInput.input(updateCanvas);
  gridSizeInput.id('grid-squares-input');

  downloadButton = createButton('Download');
  downloadButton.parent(container);
  downloadButton.mousePressed(downloadImage);

  let containerWidth = select('#canvas-container').width;
  let cnv = createCanvas(containerWidth, containerWidth);
  cnv.parent('canvas-container');

  noStroke();

  updateCanvas();  // Update and draw the canvas with initial values


}

function windowResized() {
    let containerWidth = document.getElementById('canvas-container').clientWidth;
    resizeCanvas(containerWidth, containerWidth);
    canvasSize = containerWidth;
    updateCanvas();
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
  let containerWidth = document.getElementById('canvas-container').clientWidth;
  canvasSize = containerWidth;
  canvasColor = canvasColorPicker.color();
  centerColor = centerColorPicker.color();
  midColor = midColorPicker.color();
  gridSize = parseInt(gridSizeInput.value());

  if (canvasColor && centerColor && midColor) {
    drawGradient();
  }
}

function downloadImage() {
  saveCanvas('gradient_grid', 'png');
}

function draw() {
  // We don't need this function to constantly redraw.
  // The canvas will be updated by the updateCanvas function whenever needed.
  noLoop();
}
