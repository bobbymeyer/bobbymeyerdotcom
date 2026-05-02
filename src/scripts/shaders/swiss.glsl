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
#define Tri(p,s,a) max(-dot(p,vec2(cos(-a),sin(-a))),max(dot(p,vec2(cos(a),sin(a))),max(abs(p).x-s.x,abs(p).y-s.y)))

#define FS 0.46
#define FGS (FS / 5.0)

#define ATLAS_COLS 6.0
#define ATLAS_ROWS 6.0

float random(vec2 p) {
    return fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// Sample the glyph atlas. Returns a fake-SDF: ~0.5 outside, ~-0.5 inside,
// with a smooth transition across glyph edges (canvas already AAs).
// Outside the cell (|p| > 0.5) we return a positive box-distance so the
// glyph is naturally clipped to its tile.
float drawFont(vec2 p, int charId) {
    float fc = float(charId);
    float col = mod(fc, ATLAS_COLS);
    float row = floor(fc / ATLAS_COLS);

    // p ∈ ~[-0.5, 0.5]; map to atlas UV, flipping Y for canvas coords.
    vec2 cellUv = vec2(p.x + 0.5, 0.5 - p.y);
    // tiny inset to avoid neighbor bleed under linear filtering
    vec2 inner = clamp(cellUv, 0.002, 0.998);
    vec2 uv = (vec2(col, row) + inner) / vec2(ATLAS_COLS, ATLAS_ROWS);

    float a = texture2D(uAtlas, uv).r;
    float glyphD = 0.5 - a;

    float boxClip = max(abs(p.x), abs(p.y)) - 0.5;
    return max(glyphD, boxClip);
}

float dSlopeLines(vec2 p) {
    float lineSize = 24.0;
    return tan((mix(p.x, p.y, 0.7) + (-iTime * 0.5 / lineSize)) * lineSize) * lineSize;
}

float blocks(vec2 p) {
    vec2 prevP = p;
    p.x = mod(p.x, 0.24) - 0.12;
    float d = B(p, vec2(FGS * 0.55));
    p = prevP;
    p.x += 0.12;
    p.x = mod(p.x, 0.24) - 0.12;
    p.y = abs(p.y) - 0.12;
    float d2 = B(p, vec2(FGS * 0.55));
    return min(d, d2);
}

float blocks2(vec2 p) {
    p.y = mod(p.y, 0.92) - 0.46;
    vec2 prevP = p;
    p.y -= FGS * 2.5;
    float d = abs(B(p, vec2(FGS * 1.7))) - 0.03;
    float d2 = B(p, vec2(FGS * 0.5));
    d = min(d, d2);
    p = prevP;
    p.y -= -FGS * 2.5;
    d2 = abs(B(p, vec2(FGS))) - 0.03;
    return min(d, d2);
}

float cubicInOut(float t) {
    return t < 0.5
        ? 4.0 * t * t * t
        : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0;
}

float getTime(float t, float duration) {
    return clamp(t, 0.0, duration) / duration;
}

float drawFonts4GridsSpace(int char, float scale, vec2 grd, vec2 prevGrd, vec2 pa, vec2 pb, vec2 pc, vec2 pd) {
    grd -= pa;
    grd *= scale;
    float d = drawFont(grd, char);
    grd = prevGrd;
    grd -= pb;
    grd *= scale;
    float d2 = drawFont(grd, (char + 1 >= 35) ? 10 : char + 1);
    d = min(d, d2);
    grd = prevGrd;
    grd -= pc;
    grd *= scale;
    d2 = drawFont(grd, (char + 2 >= 35) ? 10 : char + 2);
    d = min(d, d2);
    grd = prevGrd;
    grd -= pd;
    grd *= scale;
    d2 = drawFont(grd, (char + 3 >= 35) ? 10 : char + 3);
    return min(d, d2);
}

float gridSystem(vec2 p) {
    p *= 3.0;
    p.y += iTime * 0.15;
    vec2 id = floor(p);
    vec2 grd = fract(p) - 0.5;

    float n = random(id);
    float nChar = random(id) * 35.0;
    int char = int(nChar);
    float d = drawFont(grd, char);
    if (n >= 0.1 && n < 0.2 && char < 10) {
        int num = int(mod(iTime * float(nChar), 10.0));
        d = drawFont(grd, num);
    }

    float d2 = 10.0;
    vec2 prevGrd = grd;
    float scale = 2.1;

    if (n >= 0.2 && n < 0.5) {
        float frame = mod(iTime, 10.0);
        float time = frame;
        vec2 pa = vec2(-0.24, 0.24);
        vec2 pb = vec2(-0.24, -0.24);
        vec2 pc = vec2(0.24, -0.24);
        vec2 pd = vec2(0.24, 0.24);
        if (frame >= 1.0 && frame < 3.0) {
            time = getTime(time - 1.0, 0.6);
            float val = cubicInOut(time) * 0.48;
            pa = vec2(-0.24, 0.24 - val);
            pb = vec2(-0.24 + val, -0.24);
            pc = vec2(0.24, -0.24 + val);
            pd = vec2(0.24 - val, 0.24);
        } else if (frame >= 3.0 && frame < 5.0) {
            time = getTime(time - 3.0, 0.6);
            float val = cubicInOut(time) * 0.48;
            pa = vec2(-0.24 + val, -0.24);
            pb = vec2(0.24, -0.24 + val);
            pc = vec2(0.24 - val, 0.24);
            pd = vec2(-0.24, 0.24 - val);
        } else if (frame >= 5.0 && frame < 7.0) {
            time = getTime(time - 5.0, 0.6);
            float val = cubicInOut(time) * 0.48;
            pa = vec2(0.24, -0.24 + val);
            pb = vec2(0.24 - val, 0.24);
            pc = vec2(-0.24, 0.24 - val);
            pd = vec2(-0.24 + val, -0.24);
        } else if (frame >= 7.0 && frame < 10.0) {
            time = getTime(time - 7.0, 0.6);
            float val = cubicInOut(time) * 0.48;
            pa = vec2(0.24 - val, 0.24);
            pb = vec2(-0.24, 0.24 - val);
            pc = vec2(-0.24 + val, -0.24);
            pd = vec2(0.24, -0.24 + val);
        }
        d = drawFonts4GridsSpace(char, scale, grd, prevGrd, pa, pb, pc, pd);
    } else if (n >= 0.5 && n < 0.6) {
        grd -= vec2(-0.24, 0.24);
        grd *= scale;
        d = drawFont(grd, char);
        grd = prevGrd;
        grd -= vec2(0.24, 0.24);
        grd *= scale;
        d2 = drawFont(grd, (char + 1 >= 35) ? 10 : char + 1);
        d = min(d, d2);
        grd = prevGrd;
        float d3 = B(grd - vec2(0.0, -0.24), vec2(0.46, 0.22));
        float dir = (n >= 0.55) ? -1.0 : 1.0;
        grd.x *= dir;
        grd.x += iTime * n * 0.2;
        grd.x = mod(grd.x, 0.2) - 0.1;
        grd.x += 0.1;
        grd -= vec2(0.0, -0.24);
        grd *= Rot(radians(-90.0));
        d2 = Tri(grd, vec2(FGS * 2.0), radians(45.0));
        float mask = Tri(grd - vec2(0.0, -FGS), vec2(FGS * 2.0), radians(45.0));
        d2 = max(-mask, d2);
        d2 = max(d3, d2);
        d2 = min(d2, abs(d3) - 0.01);
        d = min(d, d2);
    } else if (n >= 0.7 && n < 0.8) {
        grd -= vec2(-0.24, -0.24);
        grd *= scale;
        d = drawFont(grd, char);
        grd = prevGrd;
        grd -= vec2(0.24, -0.24);
        grd *= scale;
        d2 = drawFont(grd, (char + 1 >= 35) ? 10 : char + 1);
        d = min(d, d2);
        grd = prevGrd;
        float d3 = B(grd - vec2(0.0, 0.24), vec2(0.46, 0.22));
        float dir = (n >= 0.75) ? -1.0 : 1.0;
        grd.x += dir * iTime * 0.08;
        d2 = blocks(grd - vec2(0.0, 0.24));
        d2 = max(d3, d2);
        d2 = min(d2, abs(d3) - 0.01);
        d = min(d, d2);
    } else if (n >= 0.8 && n < 0.9) {
        grd -= vec2(-0.24, 0.24);
        grd *= scale;
        d = drawFont(grd, char);
        grd = prevGrd;
        grd -= vec2(-0.24, -0.24);
        grd *= scale;
        d2 = drawFont(grd, (char + 1 >= 35) ? 10 : char + 1);
        d = min(d, d2);
        grd = prevGrd;
        float d3 = B(grd - vec2(0.24, 0.0), vec2(0.22, 0.46));
        grd -= vec2(0.24, 0.0);
        d2 = dSlopeLines(grd);
        d2 = max(d3, d2);
        d2 = min(d2, abs(d3) - 0.01);
        d = min(d, d2);
    } else if (n >= 0.9 && n < 1.0) {
        grd -= vec2(0.24, 0.24);
        grd *= scale;
        d = drawFont(grd, char);
        grd = prevGrd;
        grd -= vec2(0.24, -0.24);
        grd *= scale;
        d2 = drawFont(grd, (char + 1 >= 35) ? 10 : char + 1);
        d = min(d, d2);
        grd = prevGrd;
        float d3 = B(grd - vec2(-0.24, 0.0), vec2(0.22, 0.46));
        float dir = (n >= 0.95) ? -1.0 : 1.0;
        grd.y += dir * iTime * 0.08;
        d2 = blocks2(grd - vec2(-0.24, 0.0));
        d2 = max(d3, d2);
        d2 = min(d2, abs(d3) - 0.01);
        d = min(d, d2);
    }
    return d;
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;

    vec3 paper = vec3(0.945, 0.935, 0.905);
    vec3 ink = vec3(0.07, 0.07, 0.08);

    float d = gridSystem(p);
    vec3 col = mix(paper, ink, S(d, 0.0));

    gl_FragColor = vec4(col, 1.0);
}
