let nodes = [], edges = [], canvas_size = 72, speed = 0.125, maxVelocity = speed * 2;
let l = 24, m = 20, base_color = 0;

class Node {
    constructor(x, y) {
        this.pos = createVector(x, y);
        this.vel = createVector(random(-speed, speed), random(-speed, speed));
        this.radius = 5;
        this.color = color(base_color);
        this.neighbors = [];
    }

    show() {
        noStroke();
        fill(this.color);
        ellipse(this.pos.x, this.pos.y, this.radius * 2);
    }

    update() {
        this.pos.add(this.vel);
        this.vel.limit(maxVelocity);
        this.bounceOffWalls();
        this.bounceOffNodes();
    }

    bounceOffWalls() {
        if (this.pos.x - this.radius < 0) {
            this.vel.x *= -1;
            this.pos.x = this.radius;
        } else if (this.pos.x + this.radius > width) {
            this.vel.x *= -1;
            this.pos.x = width - this.radius;
        }

        if (this.pos.y - this.radius < 0) {
            this.vel.y *= -1;
            this.pos.y = this.radius;
        } else if (this.pos.y + this.radius > height) {
            this.vel.y *= -1;
            this.pos.y = height - this.radius;
        }
    }

    bounceOffNodes() {
        for (let node of nodes) {
            if (node !== this && dist(this.pos.x, this.pos.y, node.pos.x, node.pos.y) < this.radius + node.radius) {
                let angle = atan2(this.pos.y - node.pos.y, this.pos.x - node.pos.x);
                this.vel.set(cos(angle), sin(angle));
                node.vel.set(-cos(angle), -sin(angle));
            }
        }
    }
}

class Edge {
    constructor(a, b) {
        this.a = a;
        this.b = b;
    }

    show() {
        stroke(base_color);
        strokeWeight(2);
        line(this.a.pos.x, this.a.pos.y, this.b.pos.x, this.b.pos.y);
    }
}

function setup() {
    let canvas = createCanvas(canvas_size, canvas_size);
    canvas.parent('logo');
    pixelDensity(4);
    let n = floor(random(3, 8));
    logo(width, height, n, m);
}

function draw() {
    clear();
    smooth();
    for (let edge of edges) edge.show();
    for (let node of nodes) {
        node.update();
        node.show();
    }
}

function logo(x, y, n, m) {
    let attempts = 0;
    while (nodes.length < n && attempts < 1000) {
        attempts++;
        let angle = random(TWO_PI), r = random(x / 4, (x / 2) - 5);
        let nodeX = constrain(x / 2 + r * cos(angle), 5, x - 5);
        let nodeY = constrain(y / 2 + r * sin(angle), 5, y - 5);
        let overlapping = nodes.some(node => dist(nodeX, nodeY, node.pos.x, node.pos.y) < m);
        if (!overlapping) nodes.push(new Node(nodeX, nodeY));
    }

    if (nodes.length > 0) {
        let randomNode = random(nodes);
        let colors = [color(255, 0, 0), color(0, 255, 0), color(0, 0, 255)];
        randomNode.color = random(colors);
    }

    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            let d = dist(nodes[i].pos.x, nodes[i].pos.y, nodes[j].pos.x, nodes[j].pos.y);
            if (d < l || nodes[i].neighbors.length == 0 || nodes[j].neighbors.length == 0) {
                edges.push(new Edge(nodes[i], nodes[j]));
                nodes[i].neighbors.push(nodes[j]);
                nodes[j].neighbors.push(nodes[i]);
            }
        }
    }
}

function mouseClicked() {
    if (mouseX > 0 && mouseX < width && mouseY > 0 && mouseY < height) {
        clear();
        nodes = [];
        edges = [];
        let n = floor(random(3, 8));
        logo(width, height, n, m);
    }
}
