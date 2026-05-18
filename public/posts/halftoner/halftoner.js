let img;
let halftoneGraphics;
let cellSizeDropdown;

function preload() {
  img = loadImage('inoki.jpg');  // Load 'inoki.jpg' by default
}

function setup() {

  let cnv = createCanvas(400, 400);
  cnv.parent('canvas-container');
  pixelDensity(2);


  halftoneGraphics = createGraphics(width, height);

  // Cell size dropdown
  cellSizeDropdown = createSelect();
  for (let i = 1; i <= 10; i++) {
    cellSizeDropdown.option(i);
  }
  cellSizeDropdown.parent('canvas-container-controls');
  cellSizeDropdown.changed(updateGraphics);

  let uploadButton = createFileInput(imageUpload);
  uploadButton.parent('canvas-container-controls');

  img = stretchContrast(img);
  imageReady();
  noLoop();
}

function draw() {
  background(255);
  if (halftoneGraphics) {
    image(halftoneGraphics, 0, 0);
  }
}

function updateGraphics() {
  if (img) {
    halftoneGraphics.clear();
    drawHalftone(halftoneGraphics);
    redraw();
  }
}

function drawHalftone(pg) {
  let cellSize = parseInt(cellSizeDropdown.value());
  img.loadPixels();

  const angle = radians(30);
  const cosA = cos(angle);
  const sinA = sin(angle);

  // Adjusted looping range further to ensure full coverage
  const maxDim = max(img.width, img.height);
  for (let y = -maxDim; y < maxDim * 1.5; y += cellSize) {
    for (let x = -maxDim; x < maxDim * 1.5; x += cellSize) {
      // Rotate the grid by 30 degrees
      let xr = x * cosA - y * sinA;
      let yr = x * sinA + y * cosA;

      // Ensure we're accessing valid pixels
      if (xr >= 0 && xr < img.width && yr >= 0 && yr < img.height) {
        let i = (floor(yr) * img.width + floor(xr)) * 4;
        let avg = (img.pixels[i] + img.pixels[i + 1] + img.pixels[i + 2]) / 3;
        let radius = map(avg, 0, 255, cellSize, 0);

        pg.fill(0);
        pg.noStroke();
        pg.ellipse(xr, yr, radius, radius);
      }
    }
  }
}



function imageUpload(file) {
  if (file.type === 'image') {
    img = loadImage(file.data, imageReady);
    img = stretchContrast(img);
  } else {
    console.log('Not an image file!');
  }
}

function stretchContrast(image) {
  image.loadPixels();

  let minVal = 255;
  let maxVal = 0;

  // Find min and max grayscale values
  for (let i = 0; i < image.pixels.length; i += 4) {
    let avg = (image.pixels[i] + image.pixels[i + 1] + image.pixels[i + 2]) / 3;
    if (avg < minVal) minVal = avg;
    if (avg > maxVal) maxVal = avg;
  }

  // Stretch contrast
  for (let i = 0; i < image.pixels.length; i += 4) {
    let avg = (image.pixels[i] + image.pixels[i + 1] + image.pixels[i + 2]) / 3;
    let stretchedValue = map(avg, minVal, maxVal, 0, 255);

    image.pixels[i] = image.pixels[i + 1] = image.pixels[i + 2] = stretchedValue;
  }

  image.updatePixels();
  return image;
}


function imageReady() {
  let containerWidth = select('#canvas-container').width;
  let newHeight = img.height * (containerWidth / img.width);
  resizeCanvas(containerWidth, newHeight);
  halftoneGraphics.resizeCanvas(containerWidth, newHeight);
  img.resize(containerWidth, newHeight);
  updateGraphics();
}
