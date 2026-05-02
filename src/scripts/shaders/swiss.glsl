precision highp float;
precision highp int;

uniform float uTime;
uniform vec2 uResolution;

#define iTime uTime
#define iResolution uResolution

#define Rot(a) mat2(cos(a),-sin(a),sin(a),cos(a))
#define antialiasing(n) n/min(iResolution.y,iResolution.x)
#define S(d,b) smoothstep(antialiasing(1.0),b,d)
#define B(p,s) max(abs(p).x-s.x,abs(p).y-s.y)
#define Tri(p,s,a) max(-dot(p,vec2(cos(-a),sin(-a))),max(dot(p,vec2(cos(a),sin(a))),max(abs(p).x-s.x,abs(p).y-s.y)))

#define FS 0.46
#define FGS FS/5.

#define char_0 0
#define char_1 1
#define char_2 2
#define char_3 3
#define char_4 4
#define char_5 5
#define char_6 6
#define char_7 7
#define char_8 8
#define char_9 9
#define char_A 10
#define char_B 11
#define char_C 12
#define char_D 13
#define char_E 14
#define char_F 15
#define char_G 16
#define char_H 17
#define char_I 18
#define char_J 19
#define char_K 20
#define char_L 21
#define char_M 22
#define char_N 23
#define char_O 24
#define char_P 25
#define char_Q 26
#define char_R 27
#define char_S 28
#define char_T 29
#define char_U 30
#define char_V 31
#define char_W 32
#define char_X 33
#define char_Y 34
#define char_Z 35

float random(vec2 p) {
    return fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float charA(vec2 p) {
    float d = B(p - vec2(0.0, FGS * 4.), vec2(FS, FGS));
    float d2 = B(p, vec2(FS, FGS));
    d = min(d, d2);
    p.x = abs(p.x);
    d2 = B(p - vec2(FGS * 4., 0.), vec2(FGS, FS));
    return min(d, d2);
}

float charB(vec2 p) {
    vec2 prevP = p;
    p.y = abs(p.y);
    float d = B(p - vec2(0.0, FGS * 4.), vec2(FS, FGS));
    p = prevP;
    float d2 = B(p - vec2(-FGS, 0.0), vec2(FGS * 3., FGS));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 4., 0.), vec2(FGS, FS));
    d = min(d, d2);
    p.y = abs(p.y);
    p -= vec2(FGS * 2., FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float charC(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(0.0, FGS * 4.), vec2(FS, FGS));
    float d2 = B(p - vec2(FGS * 2., -FGS * 4.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p -= vec2(-FGS * 2., -FGS * 2.);
    p *= Rot(radians(-45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float charD(vec2 p) {
    vec2 prevP = p;
    p.y = abs(p.y);
    float d = B(p - vec2(0.0, FGS * 4.), vec2(FS, FGS));
    p = prevP;
    float d2 = B(p - vec2(FGS * 4., 0.), vec2(FGS, FS));
    d = min(d, d2);
    d2 = B(p, vec2(FGS, FS));
    return min(d, d2);
}

float charE(vec2 p) {
    float d = charC(p);
    float d2 = B(p, vec2(FS, FGS));
    return min(d, d2);
}

float charF(vec2 p) {
    float d = B(p - vec2(0.0, FGS * 4.), vec2(FS, FGS));
    float d2 = B(p - vec2(-FGS, 0.), vec2(FGS * 4., FGS));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p -= vec2(0., -FGS * 2.);
    d2 = B(p, vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float charG(vec2 p) {
    float d = charC(p);
    float d2 = B(p - vec2(FGS * 2., 0.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    d2 = B(p - vec2(FGS * 4., -FGS * 2.), vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float charH(vec2 p) {
    float d = B(p - vec2(FGS * 4., 0.0), vec2(FGS, FS));
    float d2 = B(p - vec2(0.0, 0.0), vec2(FGS, FS));
    d = min(d, d2);
    d2 = B(p - vec2(FGS * 2., 0.0), vec2(FGS * 3., FGS));
    d = min(d, d2);
    p.y = abs(p.y);
    d2 = B(p - vec2(-FGS * 2., FGS * 4.), vec2(FGS * 3., FGS));
    return min(d, d2);
}

float charI(vec2 p) {
    vec2 prevP = p;
    p.y = abs(p.y);
    float d = B(p - vec2(0., FGS * 4.), vec2(FS, FGS));
    p = prevP;
    float d2 = B(p, vec2(FGS, FS));
    d = min(d, d2);
    d2 = B(p, vec2(FS, FGS));
    return min(d, d2);
}

float charJ(vec2 p) {
    float d = B(p - vec2(0., FGS * 4.), vec2(FS, FGS));
    float d2 = B(p - vec2(0., FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 4., -FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p -= vec2(-FGS * 2., -FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float charK(vec2 p) {
    float d = B(p - vec2(FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    float d2 = B(p, vec2(FS, FGS));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 4., 0.0), vec2(FGS, FS));
    d = min(d, d2);
    d2 = B(p - vec2(FGS * 2., -FGS * 2.), vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float charL(vec2 p) {
    float d = B(p - vec2(-FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    float d2 = B(p - vec2(FGS * 2., -FGS * 4.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    p -= vec2(-FGS * 2., -FGS * 2.);
    p *= Rot(radians(-45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float charM(vec2 p) {
    float d = B(p, vec2(FS, FGS));
    float d2 = B(p, vec2(FGS, FS));
    d = min(d, d2);
    p.x = abs(p.x);
    d2 = B(p - vec2(FGS * 4., -FGS), vec2(FGS, FGS * 4.));
    return min(d, d2);
}

float charN(vec2 p) {
    vec2 prevP = p;
    p.x = abs(p.x);
    float d = B(p - vec2(FGS * 4., 0.), vec2(FGS, FS));
    p = prevP;
    float d2 = B(p, vec2(FGS, FS));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 2., FGS * 4.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    d2 = B(p - vec2(FGS * 2., -FGS * 4.), vec2(FGS * 3., FGS));
    return min(d, d2);
}

float charO(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    p = prevP;
    float d2 = B(p - vec2(FGS * 2., FGS * 4.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 2., -FGS * 4.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 4., -FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p -= vec2(-FGS * 2., FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p = prevP;
    p -= vec2(FGS * 2., -FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float charP(vec2 p) {
    float d = B(p - vec2(0., FGS * 4.), vec2(FS, FGS));
    float d2 = B(p, vec2(FS, FGS));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 2., 0.), vec2(FGS, FS));
    d = min(d, d2);
    d2 = B(p - vec2(FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float charQ(vec2 p) {
    float d = charO(p);
    p -= vec2(FGS * 2., -FGS * 2.);
    p *= Rot(radians(45.));
    float d2 = B(p, vec2(FGS * 3., FGS));
    return min(d, d2);
}

float charR(vec2 p) {
    float d = B(p - vec2(0., FGS * 4.), vec2(FS, FGS));
    float d2 = B(p, vec2(FS, FGS));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 4., 0.), vec2(FGS, FS));
    d = min(d, d2);
    d2 = B(p - vec2(FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    d2 = B(p - vec2(0.0, -FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    d2 = B(p - vec2(FGS * 2., -FGS * 4.), vec2(FGS * 3., FGS));
    return min(d, d2);
}

float charS(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(FGS * 2., FGS * 4.), vec2(FGS * 3., FGS));
    float d2 = B(p, vec2(FS, FGS));
    d = min(d, d2);
    p -= vec2(-FGS * 2., FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p = prevP;
    d2 = B(p - vec2(-FGS * 2., -FGS * 4.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    p -= vec2(FGS * 2., -FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float charT(vec2 p) {
    float d = B(p - vec2(0., FGS * 2.), vec2(FS, FGS));
    p *= Rot(radians(45.));
    float d2 = B(p, vec2(FGS, FS * 1.2));
    return min(d, d2);
}

float charU(vec2 p) {
    float d = B(p - vec2(0., -FGS * 2.), vec2(FS, FGS));
    p.x = abs(p.x);
    float d2 = B(p - vec2(FGS * 2., 0.), vec2(FGS, FS));
    return min(d, d2);
}

float charV(vec2 p) {
    float d = B(p - vec2(-FGS * 4., 0.), vec2(FGS, FS));
    p *= Rot(radians(45.));
    float d2 = B(p, vec2(FGS, FS * 1.2));
    return min(d, d2);
}

float charW(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(-FGS * 4., 0.), vec2(FGS, FS));
    p *= Rot(radians(45.));
    float d2 = B(p, vec2(FGS, FS * 1.2));
    d = min(d, d2);
    p = prevP;
    d2 = B(p, vec2(FGS, FS));
    d = min(d, d2);
    p -= vec2(FGS * 2., -FGS * 2.);
    p *= Rot(radians(-45.));
    d2 = B(p, vec2(FGS * 3., FGS));
    return min(d, d2);
}

float charX(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(-FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    p *= Rot(radians(45.));
    float d2 = B(p, vec2(FGS, FS * 1.2));
    d = min(d, d2);
    p = prevP;
    d2 = B(p - vec2(FGS * 4., -FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    d2 = B(p, vec2(FS, FGS));
    return min(d, d2);
}

float charY(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(-FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    float d2 = B(p - vec2(0., -FGS), vec2(FGS, FGS * 4.));
    d = min(d, d2);
    p = prevP;
    d2 = B(p - vec2(FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    d2 = B(p, vec2(FS, FGS));
    return min(d, d2);
}

float charZ(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(-FGS * 4., FGS * 3.), vec2(FGS, FGS * 2.));
    p *= Rot(radians(45.));
    float d2 = B(p, vec2(FGS, FS * 1.2));
    d = min(d, d2);
    p = prevP;
    d2 = B(p - vec2(FGS * 4., -FGS * 3.), vec2(FGS, FGS * 2.));
    d = min(d, d2);
    p.y = abs(p.y);
    d2 = B(p - vec2(0., FGS * 4.), vec2(FS, FGS));
    return min(d, d2);
}

float char1(vec2 p) {
    float d = B(p - vec2(-FGS * 2., FGS * 4.), vec2(FGS * 3., FGS));
    float d2 = B(p, vec2(FGS, FS));
    d = min(d, d2);
    d2 = B(p - vec2(0., -FGS * 4.), vec2(FS, FGS));
    return min(d, d2);
}

float char2(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(FGS * 2., FGS * 4.), vec2(FGS * 3., FGS));
    float d2 = B(p - vec2(FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    d2 = B(p - vec2(FGS * 2., 0.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    d2 = B(p - vec2(0., -FGS * 4.), vec2(FS, FGS));
    d = min(d, d2);
    p -= vec2(-FGS * 2., FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p = prevP;
    p -= vec2(-FGS * 2., -FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float char3(vec2 p) {
    vec2 prevP = p;
    p.y = abs(p.y);
    float d = B(p - vec2(0., FGS * 4.), vec2(FS, FGS));
    p = prevP;
    p.x = abs(p.x);
    float d2 = B(p - vec2(FGS * 4., -FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p = prevP;
    d2 = B(p - vec2(FGS * 2., 0.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    p -= vec2(FGS * 2., FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float char4(vec2 p) {
    float d = B(p - vec2(0., -FGS * 2.), vec2(FS, FGS));
    float d2 = B(p - vec2(-FGS * 2., 0.), vec2(FGS, FS));
    d = min(d, d2);
    d2 = B(p - vec2(FGS * 2., -FGS * 2.), vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float char5(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(0., FGS * 4.), vec2(FS, FGS));
    float d2 = B(p, vec2(FS, FGS));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p = prevP;
    d2 = B(p - vec2(-FGS * 2., -FGS * 4.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    p -= vec2(FGS * 2., -FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float char6(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(FGS * 2., FGS * 4.), vec2(FGS * 3., FGS));
    float d2 = B(p, vec2(FS, FGS));
    d = min(d, d2);
    p -= vec2(-FGS * 2., FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p = prevP;
    d2 = B(p - vec2(0., -FGS * 4.), vec2(FS, FGS));
    d = min(d, d2);
    p.x = abs(p.x);
    d2 = B(p - vec2(FGS * 4., -FGS * 2.), vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float char7(vec2 p) {
    vec2 prevP = p;
    float d = B(p, vec2(FS, FGS));
    p *= Rot(radians(45.));
    float d2 = B(p, vec2(FGS, FS * 1.2));
    d = min(d, d2);
    p = prevP;
    d2 = B(p - vec2(0., FGS * 4.), vec2(FS, FGS));
    return min(d, d2);
}

float char8(vec2 p) {
    vec2 prevP = p;
    p.y = abs(p.y);
    float d = B(p - vec2(0., FGS * 4.), vec2(FS, FGS));
    p = prevP;
    p *= Rot(radians(45.));
    float d2 = B(p, vec2(FGS, FS * 1.2));
    d = min(d, d2);
    p = prevP;
    p *= Rot(radians(-45.));
    d2 = B(p, vec2(FGS, FS * 1.2));
    return min(d, d2);
}

float char9(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(FGS * 4., FGS * 2.), vec2(FGS, FGS * 3.));
    p = prevP;
    float d2 = B(p - vec2(FGS * 2., FGS * 4.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    d2 = B(p - vec2(-FGS * 2., -FGS * 4.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    d2 = B(p, vec2(FS, FGS));
    d = min(d, d2);
    p -= vec2(-FGS * 2., FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p = prevP;
    p -= vec2(FGS * 2., -FGS * 2.);
    p *= Rot(radians(45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float char0(vec2 p) {
    vec2 prevP = p;
    float d = B(p - vec2(-FGS * 4., 0.), vec2(FGS, FS));
    float d2 = B(p - vec2(-FGS * 2., FGS * 4.), vec2(FGS * 3., FGS));
    d = min(d, d2);
    d2 = B(p - vec2(0.0, -FGS * 4.), vec2(FS, FGS));
    d = min(d, d2);
    p -= vec2(FGS * 2., FGS * 2.);
    p *= Rot(radians(-45.));
    d2 = B(p, vec2(FGS, FGS * 3.));
    d = min(d, d2);
    p = prevP;
    d2 = B(p - vec2(FGS * 4., -FGS * 2.), vec2(FGS, FGS * 3.));
    return min(d, d2);
}

float checkChar(int targetChar, int char) {
    return 1. - abs(sign(float(targetChar) - float(char)));
}

float drawFont(vec2 p, int char) {
    float d = char0(p) * checkChar(char_0, char);
    d += char1(p) * checkChar(char_1, char);
    d += char2(p) * checkChar(char_2, char);
    d += char3(p) * checkChar(char_3, char);
    d += char4(p) * checkChar(char_4, char);
    d += char5(p) * checkChar(char_5, char);
    d += char6(p) * checkChar(char_6, char);
    d += char7(p) * checkChar(char_7, char);
    d += char8(p) * checkChar(char_8, char);
    d += char9(p) * checkChar(char_9, char);
    d += charA(p) * checkChar(char_A, char);
    d += charB(p) * checkChar(char_B, char);
    d += charC(p) * checkChar(char_C, char);
    d += charD(p) * checkChar(char_D, char);
    d += charE(p) * checkChar(char_E, char);
    d += charF(p) * checkChar(char_F, char);
    d += charG(p) * checkChar(char_G, char);
    d += charH(p) * checkChar(char_H, char);
    d += charI(p) * checkChar(char_I, char);
    d += charJ(p) * checkChar(char_J, char);
    d += charK(p) * checkChar(char_K, char);
    d += charL(p) * checkChar(char_L, char);
    d += charM(p) * checkChar(char_M, char);
    d += charN(p) * checkChar(char_N, char);
    d += charO(p) * checkChar(char_O, char);
    d += charP(p) * checkChar(char_P, char);
    d += charQ(p) * checkChar(char_Q, char);
    d += charR(p) * checkChar(char_R, char);
    d += charS(p) * checkChar(char_S, char);
    d += charT(p) * checkChar(char_T, char);
    d += charU(p) * checkChar(char_U, char);
    d += charV(p) * checkChar(char_V, char);
    d += charW(p) * checkChar(char_W, char);
    d += charX(p) * checkChar(char_X, char);
    d += charY(p) * checkChar(char_Y, char);
    d += charZ(p) * checkChar(char_Z, char);

    float a = radians(45.);
    p = abs(p) - 0.37;
    d = max(dot(p, vec2(cos(a), sin(a))), d);
    return d;
}

float dSlopeLines(vec2 p) {
    float lineSize = 24.;
    float d = tan((mix(p.x, p.y, 0.7) + (-iTime * 0.5 / lineSize)) * lineSize) * lineSize;
    return d;
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
    p *= 3.;
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

    float d2 = 10.;
    vec2 prevGrd = grd;
    float scale = 2.1;

    if (n >= 0.2 && n < 0.5) {
        float frame = mod(iTime, 10.0);
        float time = frame;
        vec2 pa = vec2(-0.24, 0.24);
        vec2 pb = vec2(-0.24, -0.24);
        vec2 pc = vec2(0.24, -0.24);
        vec2 pd = vec2(0.24, 0.24);
        if (frame >= 1. && frame < 3.) {
            time = getTime(time - 1., 0.6);
            float val = cubicInOut(time) * 0.48;
            pa = vec2(-0.24, 0.24 - val);
            pb = vec2(-0.24 + val, -0.24);
            pc = vec2(0.24, -0.24 + val);
            pd = vec2(0.24 - val, 0.24);
        } else if (frame >= 3. && frame < 5.) {
            time = getTime(time - 3., 0.6);
            float val = cubicInOut(time) * 0.48;
            pa = vec2(-0.24 + val, -0.24);
            pb = vec2(0.24, -0.24 + val);
            pc = vec2(0.24 - val, 0.24);
            pd = vec2(-0.24, 0.24 - val);
        } else if (frame >= 5. && frame < 7.) {
            time = getTime(time - 5., 0.6);
            float val = cubicInOut(time) * 0.48;
            pa = vec2(0.24, -0.24 + val);
            pb = vec2(0.24 - val, 0.24);
            pc = vec2(-0.24, 0.24 - val);
            pd = vec2(-0.24 + val, -0.24);
        } else if (frame >= 7. && frame < 10.) {
            time = getTime(time - 7., 0.6);
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
        float d3 = B(grd - vec2(0., -0.24), vec2(0.46, 0.22));
        float dir = (n >= 0.55) ? -1. : 1.;
        grd.x *= dir;
        grd.x += iTime * n * 0.2;
        grd.x = mod(grd.x, 0.2) - 0.1;
        grd.x += 0.1;
        grd -= vec2(0., -0.24);
        grd *= Rot(radians(-90.));
        d2 = Tri(grd, vec2(FGS * 2.), radians(45.));
        float mask = Tri(grd - vec2(0.0, -FGS), vec2(FGS * 2.), radians(45.));
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
        float d3 = B(grd - vec2(0., 0.24), vec2(0.46, 0.22));
        float dir = (n >= 0.75) ? -1. : 1.;
        grd.x += dir * iTime * 0.08;
        d2 = blocks(grd - vec2(0., 0.24));
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
    } else if (n >= 0.9 && n < 1.) {
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
        float dir = (n >= 0.95) ? -1. : 1.;
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

    // paper-on-ink inverted from the original (white-on-black)
    vec3 paper = vec3(0.945, 0.935, 0.905);
    vec3 ink = vec3(0.07, 0.07, 0.08);

    float d = gridSystem(p);
    vec3 col = mix(paper, ink, S(d, 0.0));

    gl_FragColor = vec4(col, 1.0);
}
