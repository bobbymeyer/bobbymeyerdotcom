precision highp float;
precision highp int;

uniform float uTime;
uniform vec2 uResolution;
uniform sampler2D uAtlas;
// Fraction of cells that carry content. 0 = all paper, 1 = all populated.
// Wired to mouse X by the JS host (left = 0.01, right = 0.99).
uniform float uObjectDensity;

#define iTime uTime
#define iResolution uResolution

#define Rot(a) mat2(cos(a),-sin(a),sin(a),cos(a))
#define antialiasing(n) n/min(iResolution.y,iResolution.x)
#define S(d,b) smoothstep(antialiasing(1.0),b,d)
#define B(p,s) max(abs(p).x-s.x,abs(p).y-s.y)

// Tight Swiss grid.
#define DENSITY 16.0
// Each COARSE×COARSE block of fine cells has at most one macro cell
// anchored at its corner; the rest are 1×1 fillers (sometimes
// subdivided further into half-size mini cells, and those mini cells
// can subdivide once more into quarter-size cells).
#define COARSE 5.0
// Probability a 1×1 filler subdivides into 2×2 half-size cells.
#define SUBDIVIDE_P 0.30
// Probability a half-size mini cell subdivides again into 2×2 quarter cells.
#define SUBSUB_P 0.32

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

// Pick this coarse-cell's macro size. Bigger cells are rarer.
// Title row stays as 1×1 fillers so nothing overruns the BOBBY MEYER cells.
float macroSizeAt(vec2 coarseId) {
    if (coarseId.y > -0.5 && coarseId.y < 0.5) return 1.0;
    float h = rand2(coarseId, 41.0);
    if (h > 0.96) return 5.0;  // 5×5 — ~4%  (fills entire coarse cell)
    if (h > 0.86) return 4.0;  // 4×4 — ~10%
    if (h > 0.70) return 3.0;  // 3×3 — ~16%
    if (h > 0.42) return 2.0;  // 2×2 — ~28%
    return 1.0;                // 1×1 — ~42%
}

// Atlas index for the title letter at this fine cell, or -1 otherwise.
// Layout: B O B B Y _ M E Y E R  on row id.y == 0, id.x ∈ [-5, +5].
int titleAt(vec2 id) {
    if (id.y < -0.5 || id.y > 0.5) return -1;
    float ix = id.x;
    if (ix < -5.5 || ix > 5.5) return -1;
    if (abs(ix - (-5.0)) < 0.5) return 11; // B
    if (abs(ix - (-4.0)) < 0.5) return 24; // O
    if (abs(ix - (-3.0)) < 0.5) return 11; // B
    if (abs(ix - (-2.0)) < 0.5) return 11; // B
    if (abs(ix - (-1.0)) < 0.5) return 34; // Y
    if (abs(ix -   1.0 ) < 0.5) return 22; // M
    if (abs(ix -   2.0 ) < 0.5) return 14; // E
    if (abs(ix -   3.0 ) < 0.5) return 34; // Y
    if (abs(ix -   4.0 ) < 0.5) return 14; // E
    if (abs(ix -   5.0 ) < 0.5) return 27; // R
    return -1; // gap
}

// Anchor offset within the coarse cell, so macros aren't all in the same corner.
vec2 macroAnchorOffsetAt(vec2 coarseId, float macroSize) {
    float maxOff = COARSE - macroSize;
    float ox = floor(rand2(coarseId, 51.0) * (maxOff + 1.0));
    float oy = floor(rand2(coarseId, 53.0) * (maxOff + 1.0));
    return vec2(ox, oy);
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

    // Find which coarse super-cell we're in, and whether we sit inside its macro.
    vec2 coarseId = floor(id / COARSE);
    vec2 coarseAnchor = coarseId * COARSE;
    float macroSize = macroSizeAt(coarseId);
    vec2 macroAnchor = coarseAnchor + macroAnchorOffsetAt(coarseId, macroSize);
    vec2 offset = id - macroAnchor;

    vec3 col;
    if (offset.x >= 0.0 && offset.y >= 0.0 && offset.x < macroSize && offset.y < macroSize) {
        // inside macro: remap fine fragment to local [-0.5, 0.5] across the merged region
        vec2 macroGrd = (offset + grd + vec2(0.5)) / macroSize - vec2(0.5);
        // shift id so macro content is independent of any 1×1 cell that happens to share an id
        col = cellColor(macroGrd, coarseId + vec2(1000.0));
    } else if (rand2(id, 71.0) < SUBDIVIDE_P) {
        // subdivide this 1×1 filler into 2×2 half-size cells
        vec2 sub = (grd + vec2(0.5)) * 2.0;
        vec2 subId = floor(sub);
        vec2 subGrd = fract(sub) - 0.5;
        vec2 subFullId = id * 2.0 + subId + vec2(7777.0);
        // ...and one of those mini cells may subdivide once more into quarters
        if (rand2(subFullId, 113.0) < SUBSUB_P) {
            vec2 sub2 = (subGrd + vec2(0.5)) * 2.0;
            vec2 sub2Id = floor(sub2);
            vec2 sub2Grd = fract(sub2) - 0.5;
            col = cellColor(sub2Grd, subFullId * 2.0 + sub2Id + vec2(31337.0));
        } else {
            col = cellColor(subGrd, subFullId);
        }
    } else {
        col = cellColor(grd, id);
    }

    gl_FragColor = vec4(col, 1.0);
}
