console.log('stacks.js');

function createBlock(target, block_height) {
  let block = document.createElement("div");
  block.classList.add('block');
  block.style.height = block_height + 'px';
  block.style.backgroundColor = `rgba(${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, 0.5)`;

  target.appendChild(block);
}

function setUpColumns() {
  let doc = document.getElementById("illustration-container");
  let numberOfColumns = Math.floor(Math.random() * 6) + 4;
  for (let i = 0; i < numberOfColumns; i++) {
    let column = document.createElement("div");
    column.classList.add('column');
    doc.appendChild(column);
  }
}

function fillColumns() {
  let columns = document.getElementsByClassName('column');
  for (let i = 0; i < columns.length; i++) {
    fillColumn(columns[i]);
  }
}

async function fillColumn(column) {
  block_heights = createHeightArray();
  for (h of block_heights) {
    createBlock(column, h);
    await new Promise(r => setTimeout(r, 250));
  }
}

function createHeightArray() {
  column_height = 600;
  height_array = [];
  while (column_height > 0) {
    h = Math.floor(Math.random() * column_height / 4) + 50;
    height_array.push(h);
    column_height -= h;
  };
  return height_array.sort(() => Math.random() - 0.5);
}

window.onload = function() {
  setUpColumns();
  fillColumns();
};