precision highp float;
precision highp int;

uniform float uTime;
uniform vec2 uResolution;
uniform sampler2D uAtlas;
// Two-resolution Game of Life. uStateBase encodes whether each base cell
// is "split" (alive in the base GoL); uStateSub encodes content per
// sub-cell (2× resolution per axis): R=colorVal, G=charVal, B=everHit,
// A=alive. The *Prev textures hold the snapshot from the previous tick
// so we can cross-fade.
uniform sampler2D uStateBase;
uniform sampler2D uStateSub;
uniform sampler2D uStateBasePrev;
uniform sampler2D uStateSubPrev;
uniform vec2 uBaseSize;
uniform vec2 uSubSize;
// 0..1 progress through the current tick — 0 just after a tick fires,
// 1 just before the next one. Smoothed via smoothstep before use.
uniform float uTickProgress;

#define iTime uTime
#define iResolution uResolution

#define Rot(a) mat2(cos(a),-sin(a),sin(a),cos(a))
#define antialiasing(n) n/min(iResolution.y,iResolution.x)
#define S(d,b) smoothstep(antialiasing(1.0),b,d)
#define B(p,s) max(abs(p).x-s.x,abs(p).y-s.y)

// Cell size in pixels — drives the responsive grid. The shader fits as
// many whole CELL_PX-sized cells as the panel allows and pads the
// leftover with paper.
#define CELL_PX 48.0
#define ATLAS_COLS 6.0
#define ATLAS_ROWS 6.0

const vec3 PAPER   = vec3(1.0, 1.0, 1.0);
const vec3 KEY     = vec3(0.137, 0.122, 0.125);
const vec3 CYAN    = vec3(0.000, 0.682, 0.937);
const vec3 MAGENTA = vec3(0.925, 0.000, 0.549);
const vec3 YELLOW  = vec3(1.000, 0.949, 0.000);

// ---- atlas + symbols (unchanged) -----------------------------------------

float drawFont(vec2 p, int charId) {
    float fc = float(charId);
    float col = mod(fc, ATLAS_COLS);
    float row = (ATLAS_ROWS - 1.0) - floor(fc / ATLAS_COLS);
    vec2 cellUv = vec2(p.x + 0.5, p.y + 0.5);
    vec2 inner = clamp(cellUv, 0.002, 0.998);
    vec2 uv = (vec2(col, row) + inner) / vec2(ATLAS_COLS, ATLAS_ROWS);
    float a = texture2D(uAtlas, uv).r;
    float glyphD = 0.5 - a;
    float boxClip = max(abs(p.x), abs(p.y)) - 0.5;
    return max(glyphD, boxClip);
}

float symbol(vec2 p, int idx) {
    if (idx == 0) return B(p, vec2(0.28));                                    // ■ filled square
    if (idx == 1) return abs(B(p, vec2(0.34))) - 0.03;                        // □ outline
    if (idx == 2) {                                                            // + plus
        float h = B(p, vec2(0.34, 0.06));
        float v = B(p, vec2(0.06, 0.34));
        return min(h, v);
    }
    if (idx == 3) return length(p) - 0.28;                                    // ● filled circle
    if (idx == 4) return abs(length(p) - 0.30) - 0.03;                        // ○ outline
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
    if (idx == 7) return B(p * Rot(radians(45.0)), vec2(0.22));               // ◆ diamond
    if (idx == 8) return abs(B(p * Rot(radians(45.0)), vec2(0.26))) - 0.03;   // ◇ outline
    if (idx == 9) {                                                            // ▲ filled triangle
        float a = radians(60.0);
        vec2 q = vec2(abs(p.x), p.y - 0.04);
        return max(q.y - 0.30, dot(q, vec2(cos(a), sin(a))) - 0.30);
    }
    if (idx == 10) {                                                           // ‖ vertical bars
        float d = B(p - vec2(-0.18, 0.0), vec2(0.04, 0.30));
        d = min(d, B(p, vec2(0.04, 0.30)));
        d = min(d, B(p - vec2(0.18, 0.0), vec2(0.04, 0.30)));
        return d;
    }
    if (idx == 11) {                                                           // ≡ horizontal bars
        float d = B(p - vec2(0.0, -0.18), vec2(0.30, 0.04));
        d = min(d, B(p, vec2(0.30, 0.04)));
        d = min(d, B(p - vec2(0.0, 0.18), vec2(0.30, 0.04)));
        return d;
    }
    if (idx == 12) return B(p * Rot(radians(45.0)), vec2(0.05, 0.36));        // / slash
    // → arrow
    float shaft = B(p - vec2(-0.05, 0.0), vec2(0.22, 0.05));
    vec2 tipQ = p - vec2(0.20, 0.0);
    float a = radians(45.0);
    float tip = max(tipQ.x - 0.12,
                    max(dot(tipQ, vec2(cos(a), sin(a))),
                        dot(tipQ, vec2(cos(-a), sin(-a)))));
    return min(shaft, tip);
}
#define SYMBOL_COUNT 14

// ---- field colors --------------------------------------------------------

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
vec3 fieldFG(int idx) {
    if (idx == 2) return KEY;   // yellow needs black ink
    return PAPER;
}

// ---- per-seed RNG --------------------------------------------------------
// seedByte is a float in [1, 255]. Salt distinguishes independent rolls.

float seedRand(float seedByte, float salt) {
    float k = seedByte * 0.0173 + salt * 0.5731 + salt * salt * 0.04217;
    return fract(sin(k) * 43758.5453123);
}

// ---- character SDF ------------------------------------------------------
// Returns a signed distance for a character glyph chosen from a seed byte.
// Caller composites it onto whatever background it likes — letting the
// color layer and the character layer stay independent.

float charSDF(vec2 grd, float seedByte) {
    int sub = int(seedRand(seedByte, 7.0) * 4.0);

    if (sub == 0) {
        // Large simple symbol — square / circle / triangle.
        int s = int(seedRand(seedByte, 8.0) * 3.0);
        int symIdx = (s == 0) ? 0 : (s == 1 ? 3 : 9);
        return symbol(grd * 0.85, symIdx);
    }
    if (sub == 1) {
        // Non-letter, non-number — pick from the rest of the symbol table
        // (skip 0, 3, 9 which are the "large simple" set).
        int n = int(seedRand(seedByte, 9.0) * 11.0);
        int symIdx = 1;
        if (n == 0) symIdx = 1;
        else if (n == 1) symIdx = 2;
        else if (n == 2) symIdx = 4;
        else if (n == 3) symIdx = 5;
        else if (n == 4) symIdx = 6;
        else if (n == 5) symIdx = 7;
        else if (n == 6) symIdx = 8;
        else if (n == 7) symIdx = 10;
        else if (n == 8) symIdx = 11;
        else if (n == 9) symIdx = 12;
        else symIdx = 13;
        return symbol(grd, symIdx);
    }
    if (sub == 2) {
        // Letter — atlas indices 10..35.
        int charIdx = 10 + int(seedRand(seedByte, 10.0) * 26.0);
        return drawFont(grd, charIdx);
    }
    // Number — atlas indices 0..9.
    int numIdx = int(seedRand(seedByte, 11.0) * 10.0);
    return drawFont(grd, numIdx);
}

// ---- title row -----------------------------------------------------------
// True for any cell on the title row inside the title column range,
// including the gap at id.x == 0. Whole row is immutable.
bool isTitleCell(vec2 id) {
    if (id.y < -0.5 || id.y > 0.5) return false;
    return id.x >= -5.5 && id.x <= 5.5;
}

// One-cell border wrapping the title row. GoL keeps running through
// these cells, but they never get coloured or stamped with a glyph —
// they read as silent margin around BOBBY MEYER.
bool isMastheadMargin(vec2 id) {
    if (id.y < -1.5 || id.y > 1.5) return false;
    if (id.x < -6.5 || id.x > 6.5) return false;
    return !isTitleCell(id);
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
    return -1;
}

// ---- per-snapshot rendering --------------------------------------------
// Given a base+sub texture pair, return the colour for this fragment.
// Same logic as before, but parameterised on the texture sources so we
// can call it once for the previous tick and once for the current one.

vec3 renderState(sampler2D baseTex, sampler2D subTex, vec2 baseXY, vec2 grd, vec2 id) {
    vec4 baseState = texture2D(baseTex, (baseXY + vec2(0.5)) / uBaseSize);
    bool isSplit = baseState.r > 0.5;

    vec2 subXY;
    vec2 subGrd;
    if (isSplit) {
        vec2 quadrant = step(vec2(0.0), grd);
        subXY = baseXY * 2.0 + quadrant;
        subGrd = grd * 2.0 + (vec2(0.5) - quadrant);
    } else {
        subXY = baseXY * 2.0;
        subGrd = grd;
    }

    vec4 state = texture2D(subTex, (subXY + vec2(0.5)) / uSubSize);
    float colorVal = floor(state.r * 255.0 + 0.5);
    float charVal  = floor(state.g * 255.0 + 0.5);
    bool everHit   = state.b > 0.5;

    if (!everHit) return PAPER;

    int colorIdx = int(mod(colorVal, 4.0));
    bool hasColor = colorVal > 0.5;
    vec3 bg = hasColor ? fieldBG(colorIdx) : PAPER;
    vec3 fg = hasColor ? fieldFG(colorIdx) : KEY;

    if (isTitleCell(id)) {
        int tch = titleAt(id);
        if (tch < 0) return PAPER;
        float d = drawFont(grd, tch);
        return mix(bg, fg, S(d, 0.0));
    }
    if (charVal < 0.5) return bg;
    float d = charSDF(subGrd, charVal);
    return mix(bg, fg, S(d, 0.0));
}

// ---- main ---------------------------------------------------------------

void main() {
    // Fit as many whole CELL_PX cells as the panel can hold, centered.
    vec2 cellCount = floor(uResolution / CELL_PX);
    vec2 cellHalf  = floor(cellCount * 0.5);
    vec2 pad       = (uResolution - cellCount * CELL_PX) * 0.5;

    vec2 fc = gl_FragCoord.xy;
    if (fc.x < pad.x || fc.x >= uResolution.x - pad.x
        || fc.y < pad.y || fc.y >= uResolution.y - pad.y) {
        gl_FragColor = vec4(PAPER, 1.0);
        return;
    }

    vec2 cellPos = (fc - pad) / CELL_PX;
    vec2 id  = floor(cellPos) - cellHalf;
    vec2 grd = fract(cellPos) - 0.5;

    if (isMastheadMargin(id)) {
        gl_FragColor = vec4(PAPER, 1.0);
        return;
    }

    vec2 baseXY = id + uBaseSize * 0.5;
    if (baseXY.x < 0.0 || baseXY.x >= uBaseSize.x
        || baseXY.y < 0.0 || baseXY.y >= uBaseSize.y) {
        gl_FragColor = vec4(PAPER, 1.0);
        return;
    }

    // Render the previous and current snapshots, then cross-fade.
    vec3 colPrev = renderState(uStateBasePrev, uStateSubPrev, baseXY, grd, id);
    vec3 colCur  = renderState(uStateBase,     uStateSub,     baseXY, grd, id);

    // Smoothstep over the tick window for a soft cubic ease.
    float t = smoothstep(0.0, 1.0, clamp(uTickProgress, 0.0, 1.0));
    gl_FragColor = vec4(mix(colPrev, colCur, t), 1.0);
}
