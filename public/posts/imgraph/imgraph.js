let img;
let canvas;
let colorIsBlack = true;
let nodes = [];
let draggedNodeIndex = null;
let connections = [];
let creatingConnection = false;
let startingNode = null;

class Connection {
    constructor(node1, node2) {
        this.node1 = node1;
        this.node2 = node2;
    }

    draw() {
        line(this.node1.x, this.node1.y, this.node2.x, this.node2.y);
    }

    contains(x, y) {
        // Check if point is near the line
        let d = distToSegment({ x: x, y: y }, this.node1, this.node2);
        return d < 10;  // 10 is a threshold value for how close the click should be to the line
    }
}

// Helper function to calculate distance from a point to a line segment
function distToSegment(p, v, w) {
    return Math.sqrt(distToSegmentSquared(p, v, w));
}


function distToSegmentSquared(p, v, w) {
    let l2 = distSquared(v, w);
    if (l2 === 0) return distSquared(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return distSquared(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

function distSquared(v, w) {
    return (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
}

function findClosestNodeIndex(node) {
    let closestNodeIndex = null;
    let closestDist = Infinity;
    for (let i = 0; i < nodes.length; i++) {
        if (node !== nodes[i]) {
            let d = dist(node.x, node.y, nodes[i].x, nodes[i].y);
            if (d < closestDist) {
                closestDist = d;
                closestNodeIndex = i;
            }
        }
    }
    return closestNodeIndex;
}

function connectionExists(node1, node2) {
    return connections.some(connection =>
        (connection.node1 === node1 && connection.node2 === node2) ||
        (connection.node1 === node2 && connection.node2 === node1)
    );
}


function setup() {
    noCanvas();
    setupDOMElements();
}

function setupDOMElements() {
    const imageInput = document.getElementById('imageInput');
    imageInput.addEventListener('change', handleFile);

    const colorSwitch = document.getElementById('colorSwitch');
    colorSwitch.addEventListener('click', switchColor);

    const saveButton = document.getElementById('saveButton');
    saveButton.addEventListener('click', saveImage);
}

function handleFile(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image')) {
        const fileURL = URL.createObjectURL(file);
        img = loadImage(fileURL, imageReady);
    } else {
        console.log('Not an image file!');
    }
}

function imageReady() {
    let containerWidth = document.getElementById('canvas-container').offsetWidth;
    let imgRatio = img.width / img.height;
    let newWidth = containerWidth;
    let newHeight = newWidth / imgRatio;
    img.resize(newWidth, newHeight);

    canvas = createCanvas(newWidth, newHeight);
    canvas.parent('canvas-container');
    canvas.elt.style.visibility = 'visible';
    console.log('Image Ready');
    canvas.elt.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });
}

function switchColor() {
    let colorSwitch = document.getElementById('colorSwitch');
    colorIsBlack = !colorIsBlack;

    if (colorIsBlack) {
        colorSwitch.classList.remove('color-switch--white');
        colorSwitch.classList.add('color-switch--black');
        colorSwitch.textContent = '⚪️';
    } else {
        colorSwitch.classList.remove('color-switch--black');
        colorSwitch.classList.add('color-switch--white');
        colorSwitch.textContent = '⚫️';
    }
}

function draw() {
    let col = colorIsBlack ? 0 : 255;
    stroke(col);
    fill(col);

    if (img && img.width && img.height) {
        image(img, 0, 0);
    }
    if (draggedNodeIndex !== null) {
        nodes[draggedNodeIndex].vector.set(mouseX, mouseY);
    }
    drawConnections();
    drawNodes();
}

function drawConnections() {
    for (let connection of connections) {
        let node1 = connection.node1.vector;
        let node2 = connection.node2.vector;
        line(node1.x, node1.y, node2.x, node2.y);
    }
}


// Draw Nodes function
function drawNodes() {
    for (let node of nodes) {
        noStroke();
        if (node.markedRed) {
            fill(200, 50, 50);
        } else {
            fill(colorIsBlack ? 0 : 255);
        }
        ellipse(node.vector.x, node.vector.y, node.size * 2, node.size * 2);  // size is the radius, so diameter is size*2
    }
}
function mousePressed(event) {
    if (event.button == 2) {
        event.preventDefault();
    }

    if (keyIsDown(CONTROL)) {
        for (let i = 0; i < nodes.length; i++) {
            let d = dist(mouseX, mouseY, nodes[i].vector.x, nodes[i].vector.y);
            if (d < 5) {
                if (!creatingConnection) {
                    startingNode = nodes[i];
                    creatingConnection = true;
                } else if (startingNode !== nodes[i] && !connectionExists(startingNode, nodes[i])) {
                    connections.push(new Connection(startingNode, nodes[i]));
                    creatingConnection = false;
                    startingNode = null;
                }
                return false;
            }
        }
    }

    for (let i = 0; i < nodes.length; i++) {
        let d = dist(mouseX, mouseY, nodes[i].vector.x, nodes[i].vector.y);
        if (d < 5 + nodes[i].size) {
            if (event.button == 2) {
                connections = connections.filter(connection =>
                    connection.node1 !== nodes[i] && connection.node2 !== nodes[i]
                );
                nodes.splice(i, 1);
                return false;
            } else {
                draggedNodeIndex = i;
                if (keyIsDown(187) || keyIsDown(107)) {  // + key or numpad add
                    nodes[i].size = constrain(nodes[i].size + 1, 1, 100);
                } else if (keyIsDown(189) || keyIsDown(109)) {  // - key or numpad subtract
                    nodes[i].size = constrain(nodes[i].size - 1, 1, 100);
                } else if (keyIsDown(56) || keyIsDown(106)) {  // * key or numpad multiply
                    nodes[i].size = constrain(nodes[i].size * 2, 1, 100);
                } else if (keyIsDown(191) || keyIsDown(111)) {  // / key or numpad divide
                    nodes[i].size = constrain(nodes[i].size / 2, 1, 100);
                }
            }
            return;
        }
    }
    // If the event is a left-click within the canvas, add a new node
    if (mouseButton === LEFT && mouseX > 0 && mouseX < width && mouseY > 0 && mouseY < height) {
        let newNode = {
            vector: createVector(mouseX, mouseY),
            size: 5  // default size
        };
        nodes.push(newNode);

        // Find the closest node to the new node
        let closestNode = null;
        let closestDist = Infinity;
        for (let node of nodes) {
            if (node !== newNode) {
                let d = dist(newNode.vector.x, newNode.vector.y, node.vector.x, node.vector.y);
                if (d < closestDist) {
                    closestDist = d;
                    closestNode = node;
                }
            }
        }

        // Create a connection if a closest node is found
        if (closestNode) {
            connections.push(new Connection(newNode, closestNode));
        }
    }
}

function mouseDragged() {
    if (draggedNodeIndex !== null) {
        nodes[draggedNodeIndex].vector.set(mouseX, mouseY);
    }
}

function doubleClicked() {
    for (let i = 0; i < nodes.length; i++) {
        // Updated the following line to use vector.x and vector.y instead of x and y
        let d = dist(mouseX, mouseY, nodes[i].vector.x, nodes[i].vector.y);
        if (d < 5) {
            // Toggle the markedRed property
            nodes[i].markedRed = !nodes[i].markedRed;
            return;
        }
    }
}


function mouseReleased() {
    draggedNodeIndex = null;
}

function saveImage() {
    if (canvas) {
        saveCanvas(canvas, 'myCanvas', 'png');
    } else {
        console.log('Canvas is not ready yet!');
    }
}
