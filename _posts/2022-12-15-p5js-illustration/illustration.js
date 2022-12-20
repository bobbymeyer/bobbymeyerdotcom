
function shuffleArray(arr) {
  arr.sort(() => Math.random() - 0.5);
}

function preload(){

}

function setup() {
  createContext()
  createBackgroundStripe()
  createBlockGrid()
  createBlocks(col_count * row_count)
  buildImageArray(9)
  createImageGrid()
  placeImages(col_count * row_count)
  placeScribble()
  label = createDiv('<b>Generated Illustration</b> Refresh to Generate a New Illustration')
  label.parent(root)
}

function createContext() {
  noCanvas();
  col_count = round(random(1,3))
  row_count = round(random(1,3))
  gap = 24
  root = select("#p5js")
  container = createDiv('')
  container.parent(root)

  container.style('overflow', 'hidden')

  container.addClass('p5-container')

}

function createBackgroundStripe() {
  stripes = createDiv()
  stripes.addClass('stripes')
  stripes.parent(container)
  stripes.style('background-color: #F6ECE2')
  blank = createDiv()
  blank.style('background-color: none')
  blank.parent(stripes)
  stripe = createDiv()
  stripe.style('background-color: rgba(0,0,0,0.1)')
  stripe.style('grid-row: ' + round(random(1, col_count)) + '/' + (col_count + 1))
  stripe.parent(stripes)
  stripe = createDiv()

}

function createBlockGrid() {
  blockGrid = createDiv()
  blockGrid.addClass('block-grid')
  blockGrid.style('grid-template-columns', "1fr ".repeat(col_count))
  blockGrid.style('grid-template-rows', "1fr ".repeat(row_count))
  blockGrid.style('grid-gap', gap + "px")
  blockGrid.style('padding', gap * 4 + "px")
  blockGrid.parent(container)
}


function createBlocks(number) {
  count = 0
  while(count < number) {
    createBlock()
    count += 1
  }
}

function createBlock() {
  block = createDiv()
  block.parent(blockGrid)
  block.style('height', '100%')
  block.style('width', '100%')
  block.style('mix-blend-mode: multiply;')
  block.style('justify-items: align-start;')
  block.style('align-self: center;')
  block.style('background-color: #E22;')
  // block.style('grid-column', x)
  // block.style('grid-row', y)
}

function createImageGrid() {
  imageGrid = createDiv()
  imageGrid.addClass('image-grid')
  imageGrid.style('grid-template-columns', "1fr ".repeat(col_count))
  imageGrid.style('grid-template-rows', "1fr ".repeat(row_count))
  imageGrid.parent(container)
}


function placeImages(number) {
  count = 0

  while(count < number) {
    seed = random(1)
    if(seed < .1) {
      placeCharacter('∞¶•–≠—‡|')
    } else if( seed < .7) {
      placeImage(count)
    } else {
      blank = createDiv(" ")
      blank.parent(imageGrid)
    }
    count += 1
  }
}

function placeCharacter(phrase) {
  let positions = ['start', 'center', 'end']
  phrase_array = phrase.split('')
  shuffleArray(phrase_array)
  character = createDiv(phrase_array.pop(count))
  character.style('font-weight: 900')
  character.style('font-size: 3rem')
  character.style('grid-column', round(random(1,col_count)))
  character.style('grid-row', round(random(1,row_count)))
  character.style('background-color: #E22;')
  character.style('mix-blend-mode: multiply;')
  character.style('height: 100%;')
  character.style('width: 100%;')
  character.style('display: grid;')
  character.style('padding: 1rem;')
  shuffleArray(positions)
  character.style('align-items', positions[0])
  shuffleArray(positions)
  character.style('justify-items', positions[0])
  character.parent(blockGrid)
}

function placeImage(index) {
  let positions = ['start', 'center', 'end']
  image = createImg('people-' + image_numbers.shift() + '.png')
  image.style('max-width: 3rem')
  image.style('filter: grayscale(1);')
  image.style('mix-blend-mode: multiply;')
  shuffleArray(positions)
  image.style('align-self', positions[0])
  shuffleArray(positions)
  image.style('justify-self', positions[0])
  image.parent(imageGrid)
}


function buildImageArray(number) {
  image_numbers = [];
  count = 0

  while(count < number) {
    n = (count + 1).toString().padStart(2, "0")
    image_numbers.push(n)
    count += 1
  }
  shuffleArray(image_numbers)
}

function placeScribble() {
  let positions = ['start', 'center', 'end']
  let n = round(random(1,3))
  scribble = createImg('scribble-' + n + '.jpg')
  scribble.parent(container)
  scribble.style('grid-column: 1')
  scribble.style('grid-row: 1')
  scribble.style('margin-top', round(random(1,100)) + '%')
  scribble.style('mix-blend-mode: darken;')
}

function draw(){
  container.style('width', "100%")
  w = document.querySelector('#p5js').clientWidth
  container.style('height', (w * 1.41)+'px')
}