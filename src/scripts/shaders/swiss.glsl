precision highp float;
precision highp int;

uniform float uTime;
uniform vec2 uResolution;
uniform sampler2D uAtlas;

#define iTime uTime
#define iResolution uResolution

#define Rot(a) mat2(cos(a),-sin(a),sin(a),cos(a))
#define antialiasing(n) n/min(iResolution.y,iResolution.x)
#define S(d,b) smoothstep(antialiasing(1.0),b,d)
#define B(p,s) max(abs(p).x-s.x,abs(p).y-s.y)

// Tight Swiss grid. Bump for denser cells, drop for chunkier.
#define DENSITY 6.5

#define ATLAS_COLS 6.0
#define ATLAS_ROWS 6.0

const vec3 PAPER  = vec3(0.945, 0.935, 0.905);
const vec3 INK    = vec3(0.07, 0.07, 0.08);
const vec3 SIGNAL = vec3(0.83, 0.20, 0.12);  // vermilion
const vec3 FLAG   = vec3(0.96, 0.77, 0.19);  // chrome yellow
const vec3 BLOCK  = vec3(0.10, 0.30, 0.55);  // print cyan

float random(vec2 p) {
    return fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float rand2(vec2 p, float salt) {
    return random(p + salt);
}

// Sample the canvas-rendered glyph atlas as a fake-SDF.
float drawFont(vec2 p, int charId) {
    float fc = float(charId);
    float col = mod(fc, ATLAS_COLS);
    float row = floor(fc / ATLAS_COLS);
    vec2 cellUv = vec2(p.x + 0.5, 0.5 - p.y);
    vec2 inner = clamp(cellUv, 0.002, 0.998);
    vec2 uv = (vec2(col, row) + inner) / vec2(ATLAS_COLS, ATLAS_ROWS);
    float a = texture2D(uAtlas, uv).r;
    float glyphD = 0.5 - a;
    float boxClip = max(abs(p.x), abs(p.y)) - 0.5;
    return max(glyphD, boxClip);
}

// Geometric symbols, indexed 0..5.
float symbol(vec2 p, int idx) {
    if (idx == 0) return B(p, vec2(0.28));                         // filled square
    if (idx == 1) return abs(B(p, vec2(0.34))) - 0.03;             // square outline
    if (idx == 2) {                                                 // plus
        float h = B(p, vec2(0.34, 0.06));
        float v = B(p, vec2(0.06, 0.34));
        return min(h, v);
    }
    if (idx == 3) return length(p) - 0.28;                         // filled circle
    if (idx == 4) return abs(length(p) - 0.30) - 0.03;             // circle outline
    // three horizontal dots
    float d = length(p - vec2(-0.22, 0.0)) - 0.06;
    d = min(d, length(p) - 0.06);
    d = min(d, length(p - vec2(0.22, 0.0)) - 0.06);
    return d;
}

// Animated tiles, indexed 0..3.
float animatedTile(vec2 p, int kind, vec2 id) {
    if (kind == 0) {
        // pulsing center dot
        float r = 0.10 + 0.06 * sin(iTime * 1.4 + rand2(id, 1.7) * 6.28318);
        return length(p) - r;
    }
    if (kind == 1) {
        // sliding square
        float dir = step(0.5, rand2(id, 2.3)) * 2.0 - 1.0;
        float t = sin(iTime * 0.8 * dir + rand2(id, 3.1) * 6.28318) * 0.22;
        return B(p - vec2(t, 0.0), vec2(0.12));
    }
    if (kind == 2) {
        // marching diagonal stripes inside a soft frame
        float lineSize = 18.0;
        float lines = tan((mix(p.x, p.y, 0.7) + (-iTime * 0.4 / lineSize)) * lineSize) * lineSize;
        return max(B(p, vec2(0.36)), lines);
    }
    // rotating digit
    int dig = int(mod(iTime * 1.8 + rand2(id, 4.7) * 10.0, 10.0));
    return drawFont(p, dig);
}

vec3 fieldColor(float h) {
    if (h < 0.30) return SIGNAL;
    if (h < 0.55) return FLAG;
    if (h < 0.85) return INK;
    return BLOCK;
}

vec3 cellColor(vec2 grd, vec2 id) {
    float n = random(id);

    // 55% — letter
    if (n < 0.55) {
        int char = int(rand2(id, 0.31) * 35.0);
        float d = drawFont(grd, char);
        return mix(PAPER, INK, S(d, 0.0));
    }

    // 22% — symbol
    if (n < 0.77) {
        int sym = int(rand2(id, 0.59) * 6.0);
        float d = symbol(grd, sym);
        return mix(PAPER, INK, S(d, 0.0));
    }

    // 14% — animated element
    if (n < 0.91) {
        int kind = int(rand2(id, 0.79) * 4.0);
        float d = animatedTile(grd, kind, id);
        return mix(PAPER, INK, S(d, 0.0));
    }

    // 9% — colored field, sometimes with a reversed-out glyph
    vec3 field = fieldColor(rand2(id, 0.91));
    if (rand2(id, 0.97) > 0.45) {
        int char = int(rand2(id, 0.31) * 35.0);
        float d = drawFont(grd, char);
        return mix(field, PAPER, S(d, 0.0));
    }
    return field;
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
    p *= DENSITY;
    vec2 id = floor(p);
    vec2 grd = fract(p) - 0.5;
    gl_FragColor = vec4(cellColor(grd, id), 1.0);
}
