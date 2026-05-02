precision highp float;
precision highp int;

uniform float uTime;
uniform vec2 uResolution;
uniform sampler2D uAtlas;
// CA state: per grid cell, encodes (offsetX, offsetY, size, seed).
// offsetX/offsetY are the fragment's position within its containing
// CA cell (0..size-1). size is the cell's edge length in fine cells.
uniform sampler2D uState;
uniform vec2 uGridSize;
// Fraction of cells that carry content. 0 = all paper, 1 = all populated.
// Wired to mouse X by the JS host (left = 0.01, right = 0.99).
uniform float uObjectDensity;

#define iTime uTime
#define iResolution uResolution

#define Rot(a) mat2(cos(a),-sin(a),sin(a),cos(a))
#define antialiasing(n) n/min(iResolution.y,iResolution.x)
#define S(d,b) smoothstep(antialiasing(1.0),b,d)
#define B(p,s) max(abs(p).x-s.x,abs(p).y-s.y)

// Tight Swiss grid. Cell sizes and arrangement come from the JS-side
// cellular automaton (see grid-ca.ts), uploaded each tick into uState.
#define DENSITY 20.0

#define ATLAS_COLS 6.0
#define ATLAS_ROWS 6.0

// Process-CMYK palette (rough Pantone Process equivalents in sRGB).
const vec3 PAPER   = vec3(0.945, 0.935, 0.905);  // warm stock
const vec3 KEY     = vec3(0.137, 0.122, 0.125);  // process black
const vec3 CYAN    = vec3(0.000, 0.682, 0.937);
const vec3 MAGENTA = vec3(0.925, 0.000, 0.549);
const vec3 YELLOW  = vec3(1.000, 0.949, 0.000);

float random(vec2 p) {
    return fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}
float rand2(vec2 p, float salt) { return random(p + salt); }

float drawFont(vec2 p, int charId) {
    float fc = float(charId);
    float col = mod(fc, ATLAS_COLS);
    // CanvasTexture defaults to flipY=true, so canvas row R lives at texture row (N-1-R).
    float row = (ATLAS_ROWS - 1.0) - floor(fc / ATLAS_COLS);
    vec2 cellUv = vec2(p.x + 0.5, p.y + 0.5);
    vec2 inner = clamp(cellUv, 0.002, 0.998);
    vec2 uv = (vec2(col, row) + inner) / vec2(ATLAS_COLS, ATLAS_ROWS);
    float a = texture2D(uAtlas, uv).r;
    float glyphD = 0.5 - a;
    float boxClip = max(abs(p.x), abs(p.y)) - 0.5;
    return max(glyphD, boxClip);
}

// 14 symbols, ~ASCII vibe.
float symbol(vec2 p, int idx) {
    if (idx == 0) return B(p, vec2(0.28));                                    // ■ filled square
    if (idx == 1) return abs(B(p, vec2(0.34))) - 0.03;                        // □ square outline
    if (idx == 2) {                                                            // + plus
        float h = B(p, vec2(0.34, 0.06));
        float v = B(p, vec2(0.06, 0.34));
        return min(h, v);
    }
    if (idx == 3) return length(p) - 0.28;                                    // ● filled circle
    if (idx == 4) return abs(length(p) - 0.30) - 0.03;                        // ○ circle outline
    if (idx == 5) {                                                            // … three dots
        float d = length(p - vec2(-0.22, 0.0)) - 0.06;
        d = min(d, length(p) - 0.06);
        d = min(d, length(p - vec2(0.22, 0.0)) - 0.06);
        return d;
    }
    if (idx == 6) {                                                            // × cross
        vec2 q = p * Rot(radians(45.0));
        float h = B(q, vec2(0.34, 0.05));
        float v = B(q, vec2(0.05, 0.34));
        return min(h, v);
    }
    if (idx == 7) {                                                            // ◆ diamond filled
        return B(p * Rot(radians(45.0)), vec2(0.22));
    }
    if (idx == 8) return abs(B(p * Rot(radians(45.0)), vec2(0.26))) - 0.03;   // ◇ diamond outline
    if (idx == 9) {                                                            // ▲ filled triangle pointing up
        float a = radians(60.0);
        vec2 q = vec2(abs(p.x), p.y - 0.04);
        return max(q.y - 0.30, dot(q, vec2(cos(a), sin(a))) - 0.30);
    }
    if (idx == 10) {                                                           // ‖ three vertical bars
        float d = B(p - vec2(-0.18, 0.0), vec2(0.04, 0.30));
        d = min(d, B(p, vec2(0.04, 0.30)));
        d = min(d, B(p - vec2(0.18, 0.0), vec2(0.04, 0.30)));
        return d;
    }
    if (idx == 11) {                                                           // ≡ three horizontal bars
        float d = B(p - vec2(0.0, -0.18), vec2(0.30, 0.04));
        d = min(d, B(p, vec2(0.30, 0.04)));
        d = min(d, B(p - vec2(0.0, 0.18), vec2(0.30, 0.04)));
        return d;
    }
    if (idx == 12) {                                                           // / single diagonal slash
        return B(p * Rot(radians(45.0)), vec2(0.05, 0.36));
    }
    // arrow → pointing right
    float shaft = B(p - vec2(-0.05, 0.0), vec2(0.22, 0.05));
    vec2 tipQ = p - vec2(0.20, 0.0);
    float a = radians(45.0);
    float tip = max(tipQ.x - 0.12,
                    max(dot(tipQ, vec2(cos(a), sin(a))) - 0.0,
                        dot(tipQ, vec2(cos(-a), sin(-a))) - 0.0));
    return min(shaft, tip);
}
#define SYMBOL_COUNT 14.0

float animatedTile(vec2 p, int kind, vec2 id) {
    if (kind == 0) {
        float r = 0.10 + 0.06 * sin(iTime * 1.4 + rand2(id, 1.7) * 6.28318);
        return length(p) - r;
    }
    if (kind == 1) {
        float dir = step(0.5, rand2(id, 2.3)) * 2.0 - 1.0;
        float t = sin(iTime * 0.8 * dir + rand2(id, 3.1) * 6.28318) * 0.22;
        return B(p - vec2(t, 0.0), vec2(0.12));
    }
    if (kind == 2) {
        float lineSize = 18.0;
        float lines = tan((mix(p.x, p.y, 0.7) + (-iTime * 0.4 / lineSize)) * lineSize) * lineSize;
        return max(B(p, vec2(0.36)), lines);
    }
    int dig = int(mod(iTime * 1.8 + rand2(id, 4.7) * 10.0, 10.0));
    return drawFont(p, dig);
}

// Field types: 0=CYAN, 1=MAGENTA, 2=YELLOW, 3=KEY
int pickField(float h) {
    if (h < 0.27) return 0;
    if (h < 0.52) return 1;
    if (h < 0.77) return 2;
    return 3;
}
vec3 fieldBG(int idx) {
    if (idx == 0) return CYAN;
    if (idx == 1) return MAGENTA;
    if (idx == 2) return YELLOW;
    return KEY;
}
// Yellow has too little contrast against paper, so reverse glyphs in
// black on yellow fields. Other inks reverse in paper.
vec3 fieldFG(int idx) {
    if (idx == 2) return KEY;
    return PAPER;
}

// Render the four cell-content types at any size — caller supplies a
// local [-0.5,0.5] coord and an id for randomness.
vec3 cellColor(vec2 grd, vec2 id) {
    // object_density: fraction of cells that carry content. The rest are paper.
    if (rand2(id, 0.13) > uObjectDensity) return PAPER;

    float n = random(id);

    if (n < 0.55) {
        int char = int(rand2(id, 0.31) * 35.0);
        float d = drawFont(grd, char);
        return mix(PAPER, KEY, S(d, 0.0));
    }
    if (n < 0.77) {
        int sym = int(rand2(id, 0.59) * SYMBOL_COUNT);
        float d = symbol(grd, sym);
        return mix(PAPER, KEY, S(d, 0.0));
    }
    if (n < 0.91) {
        int kind = int(rand2(id, 0.79) * 4.0);
        float d = animatedTile(grd, kind, id);
        return mix(PAPER, KEY, S(d, 0.0));
    }
    int fIdx = pickField(rand2(id, 0.91));
    vec3 field = fieldBG(fIdx);
    vec3 fg    = fieldFG(fIdx);
    float kindRoll = rand2(id, 0.97);
    if (kindRoll > 0.65) {
        // reversed letter
        int char = int(rand2(id, 0.31) * 35.0);
        float d = drawFont(grd, char);
        return mix(field, fg, S(d, 0.0));
    }
    if (kindRoll > 0.30) {
        // reversed symbol
        int sym = int(rand2(id, 0.59) * SYMBOL_COUNT);
        float d = symbol(grd, sym);
        return mix(field, fg, S(d, 0.0));
    }
    return field;
}

// Atlas index for the title letter at this fine cell, or -1 otherwise.
// Layout: B O B B Y _ M E Y E R  on row id.y == 0, id.x ∈ [-5, +5].
int titleAt(vec2 id) {
    if (id.y < -0.5 || id.y > 0.5) return -1;
    float ix = id.x;
    if (ix < -5.5 || ix > 5.5) return -1;
    if (abs(ix + 5.0) < 0.5) return 11; // B
    if (abs(ix + 4.0) < 0.5) return 24; // O
    if (abs(ix + 3.0) < 0.5) return 11; // B
    if (abs(ix + 2.0) < 0.5) return 11; // B
    if (abs(ix + 1.0) < 0.5) return 34; // Y
    if (abs(ix - 1.0) < 0.5) return 22; // M
    if (abs(ix - 2.0) < 0.5) return 14; // E
    if (abs(ix - 3.0) < 0.5) return 34; // Y
    if (abs(ix - 4.0) < 0.5) return 14; // E
    if (abs(ix - 5.0) < 0.5) return 27; // R
    return -1; // gap
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
    p *= DENSITY;
    vec2 id = floor(p);
    vec2 grd = fract(p) - 0.5;

    // BOBBY MEYER title cells override everything else.
    int tch = titleAt(id);
    if (tch >= 0) {
        float d = drawFont(grd, tch);
        gl_FragColor = vec4(mix(MAGENTA, PAPER, S(d, 0.0)), 1.0);
        return;
    }

    // Read the cellular automaton state for this fragment's grid cell.
    // grid coords place id == 0 at the centre of the texture.
    vec2 gridXY = id + uGridSize * 0.5;
    if (gridXY.x < 0.0 || gridXY.x >= uGridSize.x || gridXY.y < 0.0 || gridXY.y >= uGridSize.y) {
        gl_FragColor = vec4(PAPER, 1.0);
        return;
    }

    vec2 stateUv = (gridXY + vec2(0.5)) / uGridSize;
    vec4 state = texture2D(uState, stateUv);
    float ox = floor(state.r * 255.0 + 0.5);
    float oy = floor(state.g * 255.0 + 0.5);
    float sz = floor(state.b * 255.0 + 0.5);
    float seed = state.a * 255.0;

    // Local coord inside the CA cell, normalised to [-0.5, 0.5].
    vec2 cellLocal = (vec2(ox, oy) + grd + vec2(0.5)) / max(sz, 1.0) - vec2(0.5);
    // Stable per-cell id derived from anchor + seed.
    vec2 cellAnchor = id - vec2(ox, oy);
    vec2 cellId = cellAnchor + vec2(seed * 0.137, seed * 0.311);

    gl_FragColor = vec4(cellColor(cellLocal, cellId), 1.0);
}
