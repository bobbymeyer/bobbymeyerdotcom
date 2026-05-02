precision highp float;
precision highp int;

uniform float uTime;
uniform vec2 uResolution;
uniform sampler2D uAtlas;
// Per-grid-cell state from the JS Game-of-Life simulator.
//   R = placement seed (0 = unrevealed → paper, 1..255 = active seed)
//   G = current GoL alive bit (unused by the shader for now)
//   B/A reserved
uniform sampler2D uState;
uniform vec2 uGridSize;

#define iTime uTime
#define iResolution uResolution

#define Rot(a) mat2(cos(a),-sin(a),sin(a),cos(a))
#define antialiasing(n) n/min(iResolution.y,iResolution.x)
#define S(d,b) smoothstep(antialiasing(1.0),b,d)
#define B(p,s) max(abs(p).x-s.x,abs(p).y-s.y)

#define DENSITY 20.0
#define ATLAS_COLS 6.0
#define ATLAS_ROWS 6.0

const vec3 PAPER   = vec3(0.945, 0.935, 0.905);
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

// ---- main ---------------------------------------------------------------

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
    p *= DENSITY;
    vec2 id = floor(p);
    vec2 grd = fract(p) - 0.5;

    // Inside the logical CA grid? If not, we're showing margin.
    vec2 gridXY = id + uGridSize * 0.5;
    if (gridXY.x < 0.0 || gridXY.x >= uGridSize.x
        || gridXY.y < 0.0 || gridXY.y >= uGridSize.y) {
        gl_FragColor = vec4(PAPER, 1.0);
        return;
    }

    vec4 state = texture2D(uState, (gridXY + vec2(0.5)) / uGridSize);
    float colorVal = floor(state.r * 255.0 + 0.5);
    float charVal  = floor(state.g * 255.0 + 0.5);
    bool everHit   = state.b > 0.5;

    if (!everHit) { gl_FragColor = vec4(PAPER, 1.0); return; }

    // -- color layer ------------------------------------------------------
    int colorIdx = int(mod(colorVal, 4.0));
    bool hasColor = colorVal > 0.5;
    vec3 bg = hasColor ? fieldBG(colorIdx) : PAPER;
    vec3 fg = hasColor ? fieldFG(colorIdx) : KEY;

    // -- character layer --------------------------------------------------
    int tch = titleAt(id);
    if (tch >= 0) {
        // Title cells are immutable: their character is fixed regardless
        // of the random char layer roll. The color layer still applies.
        float d = drawFont(grd, tch);
        gl_FragColor = vec4(mix(bg, fg, S(d, 0.0)), 1.0);
        return;
    }
    if (charVal < 0.5) {
        // No character — just the color layer.
        gl_FragColor = vec4(bg, 1.0);
        return;
    }
    float d = charSDF(grd, charVal);
    gl_FragColor = vec4(mix(bg, fg, S(d, 0.0)), 1.0);
}
