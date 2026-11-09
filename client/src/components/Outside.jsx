import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { sim } from "../sim.js";
import { view } from "../view.js";
import { UNITS_PER_KM } from "../config.js";
import { updateAmbient, meteorSound } from "../audio.js";

// ===== 창밖 풍경 (스타일: 만화풍과 실사의 중간) =====
// 모양은 단순하게, 빛(대기 빛번짐, 별, 태양 빛번짐)은 실사처럼.
// 외부 이미지 파일 없이 셰이더와 캔버스 그림만 써요. 숫자는 아래 "조절값"에서 바꿀 수 있어요.
// 고도 단위는 km. 엘리베이터는 가만히 있고 풍경이 움직여요. 하늘·행성·태양은 "무한히 먼 곳"이라
// 카메라를 따라다니고(시점을 옮겨도 시차가 안 생김), 지구·구름·인공위성은 실제 위치에 있어요.

// ---------- 조절값 ----------
const EARTH_R = 3000; // 지구 반지름 (화면 단위)
const SKY_R = 4400; // 하늘(별, 행성)이 놓이는 거리. 지구 가장 먼 곳보다 멀어야 해요
// 지구의 꼭대기(극점)를 엘리베이터 바로 아래에 두면 그림이 깨져서, 옆으로 조금 비켜 둔다
const EARTH_OFF_X = 130;
const EARTH_OFF_Z = 70;
const EARTH_UNDER = Math.sqrt(EARTH_R * EARTH_R - EARTH_OFF_X * EARTH_OFF_X - EARTH_OFF_Z * EARTH_OFF_Z); // 엘리베이터 아래 지표면까지의 중심 깊이

// 방위각: +x(오른쪽 창) 0도, -z(문 쪽) 90도, -x(왼쪽 창) 180도, +z(뒤) 270도
const dirOf = (az, el) => {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), -Math.cos(e) * Math.sin(a));
};

// 태양: 오른쪽 창 쪽. 왼쪽 창과 문 쪽에서 보이는 행성들은 태양을 등지고 있어서 환하게 보여요.
const SUN_AZ = 12;
const SUN_EL = 20;
const SUN = dirOf(SUN_AZ, SUN_EL);
const SUN_U = { value: SUN.clone() }; // 모든 셰이더가 같이 쓰는 태양 방향

// 행성: from~to (km) 구간에서 서서히 나타나요. deg = 하늘에서 보이는 지름(도)
// period = 하늘을 한 바퀴 도는 데 걸리는 시간(초). 지구에 가까울수록 빠르게(달 2분 30초 기준). az/el 은 시작 위치.
const ORBIT_TILT = 9; // 공전 길이 위아래로 기울어진 정도(도)
const PLANETS = [
  { name: "moon", az: 168, el: 15, deg: 5.5, from: 60, to: 90, period: 150 },
  { name: "mars", az: 197, el: 12, deg: 2.1, from: 100, to: 130, period: 270 },
  { name: "venus", az: 149, el: 25, deg: 2.7, from: 140, to: 170, period: 210 },
  { name: "jupiter", az: 206, el: 21, deg: 4.4, from: 180, to: 210, period: 360 },
  { name: "saturn", az: 100, el: 14, deg: 3.6, from: 230, to: 260, ring: true, period: 450 },
];

// 인공위성: satAlt(km) 높이에 떠서 천천히 돌아요. 엘리베이터가 그 높이 근처를 지날 때만 보여요
const SATS = [
  { type: "issw", alt: 40, rho: 30, th: 4.2, w: 0.03, s: 2.2 },
  { type: "comm", alt: 16, rho: 46, th: 0.3, w: -0.06, s: 1.0 },
  { type: "comm", alt: 27, rho: 60, th: 2.2, w: 0.035, s: 1.1 },
  { type: "scope", alt: 62, rho: 52, th: 5.4, w: -0.04, s: 1.1 },
  { type: "comm", alt: 84, rho: 68, th: 1.1, w: 0.03, s: 1.2 },
  { type: "cube", alt: 100, rho: 40, th: 3.3, w: -0.07, s: 0.8 },
  { type: "iss", alt: 118, rho: 70, th: 0.2, w: -0.03, s: 1.5 },
  { type: "comm", alt: 134, rho: 62, th: 3.9, w: 0.05, s: 1.1 },
];
// 비행기: 낮은 하늘(alt km)에서 큰 원을 그리며 날아요. 뒤에 비행운이 남아요. rho = 엘리베이터에서의 거리, w = 도는 속도(라디안/초)
const PLANES = [
  { alt: 9.5, rho: 105, th: 0.5, w: 0.032, s: 2.2 },
  { alt: 11.5, rho: 150, th: 2.9, w: -0.024, s: 2.6 },
  { alt: 7.0, rho: 85, th: 4.6, w: 0.04, s: 1.8 },
  { alt: 12.5, rho: 130, th: 1.7, w: -0.03, s: 2.4 },
];
const PLANE_VIEW = 90;
const SAT_VIEW = 70; // 엘리베이터와 이만큼(화면 단위) 높이 차이가 나면 안 보임

const CLOUD_COUNT = 48;

const MILKY = new THREE.Vector3(0.3, 0.85, -0.45).normalize(); // 은하수 띠의 기준 방향

// ---------- 색 ----------
const C = (hex) => new THREE.Color(hex);
const ZEN_LOW = C("#3b8ee6");
const ZEN_MID = C("#16307a");
const ZEN_SPACE = C("#01020a");
const HOR_LOW = C("#cde7ff");
const HOR_MID = C("#6fa6ea");
const HOR_SPACE = C("#040916");
const ATM_HIGH = C("#4fa0ff");
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 고도별 하늘 색 계산 (한 곳에서만 계산해서 하늘, 지구, 구름이 같은 색을 써요)
const sky = {
  zen: new THREE.Color(),
  hor: new THREE.Color(),
  atm: new THREE.Color(),
  limbW: 0.14,
  stars: 0,
};
function updateSky(alt) {
  if (alt < 35) sky.zen.copy(ZEN_LOW).lerp(ZEN_MID, sstep(0, 35, alt));
  else sky.zen.copy(ZEN_MID).lerp(ZEN_SPACE, sstep(35, 90, alt));
  if (alt < 40) sky.hor.copy(HOR_LOW).lerp(HOR_MID, sstep(0, 40, alt));
  else sky.hor.copy(HOR_MID).lerp(HOR_SPACE, sstep(40, 150, alt));
  sky.atm.copy(HOR_LOW).lerp(ATM_HIGH, sstep(10, 70, alt));
  sky.limbW = 0.14 + (0.02 - 0.14) * sstep(0, 140, alt);
  sky.stars = sstep(30, 95, alt);
}

// 지구가 얼마나 아래로 내려가 있는지: 낮은 곳에서는 로비와 같은 속도로 내려가다가, 높아질수록 천천히
function earthSink(alt) {
  const a = Math.min(alt, 900);
  const dip = ((3 + 57 * (1 - Math.exp(-a / 300))) * Math.PI) / 180;
  const target = EARTH_R * (1 / Math.cos(dip) - 1);
  const A = alt * UNITS_PER_KM;
  if (A <= 0) return 0;
  return (A * target) / (A + target);
}

// ---------- 공통 셰이더 조각 ----------
const NOISE = /* glsl */ `
float hash31(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x){
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
`;

// ---------- 하늘 돔 (그라데이션 + 지구 가장자리 빛번짐 + 태양 + 은하수) ----------
const domeMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: false,
  uniforms: {
    uZen: { value: new THREE.Color() },
    uHor: { value: new THREE.Color() },
    uAtm: { value: new THREE.Color() },
    uSun: SUN_U,
    uNadir: { value: new THREE.Vector3(0, -1, 0) },
    uAlpha: { value: 1.5 },
    uLimbW: { value: 0.14 },
    uStars: { value: 0 },
    uMW: { value: MILKY },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main(){
      vDir = position;
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vDir;
    uniform vec3 uZen, uHor, uAtm, uSun, uNadir, uMW;
    uniform float uAlpha, uLimbW, uStars;
    ${NOISE}
    void main(){
      vec3 d = normalize(vDir);
      float g = pow(clamp(d.y, 0.0, 1.0), 0.45);
      vec3 col = mix(uHor, uZen, g);

      // 지구 가장자리(림)를 따라 번지는 푸른 대기 빛
      float theta = acos(clamp(dot(d, uNadir), -1.0, 1.0));
      float e = max(theta - uAlpha, 0.0);
      vec2 dh = normalize(d.xz + 1e-5);
      vec2 sh = normalize(uSun.xz + 1e-5);
      float toSun = max(dot(dh, sh), 0.0);
      float boost = 0.55 + 0.75 * pow(toSun, 3.0);
      float glow = exp(-e / uLimbW);
      float core = exp(-e / (uLimbW * 0.22));
      col = mix(col, uAtm, clamp(glow * boost * 0.8, 0.0, 1.0));
      col += uAtm * core * boost * 0.35 * (0.4 + 0.6 * uStars);

      // 태양: 원반 + 번짐
      float sd = dot(d, uSun);
      float disc = smoothstep(0.99935, 0.99950, sd);
      float halo = pow(max(sd, 0.0), 90.0) * 0.55 + pow(max(sd, 0.0), 14.0) * 0.22 + pow(max(sd, 0.0), 3.0) * 0.05;
      col += vec3(1.0, 0.92, 0.75) * halo;
      col = mix(col, vec3(1.0, 0.97, 0.88), disc);

      // 은하수 띠 (우주에 가까울수록)
      if (uStars > 0.01) {
        float band = exp(-pow(dot(d, uMW), 2.0) * 60.0);
        float n = vnoise(d * 12.0) * 0.5 + vnoise(d * 28.0) * 0.3 + vnoise(d * 60.0) * 0.2;
        float dust = smoothstep(0.35, 0.65, vnoise(d * 17.0 + 4.0));
        vec3 mw = mix(vec3(0.2, 0.26, 0.5), vec3(0.62, 0.5, 0.52), n);
        col += mw * band * (0.15 + 0.85 * n) * (1.0 - 0.6 * dust) * 0.26 * uStars;
      }
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
});

// ---------- 별 ----------
function makeStars(count) {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const bright = new Float32Array(count);
  const tint = new Float32Array(count);
  const phase = new Float32Array(count);
  const u = new THREE.Vector3().crossVectors(MILKY, new THREE.Vector3(0, 1, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(MILKY, u).normalize();
  const d = new THREE.Vector3();
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  for (let i = 0; i < count; i++) {
    const inBand = Math.random() < 0.38;
    if (inBand) {
      const phi = Math.random() * Math.PI * 2;
      const b = gauss() * 0.28;
      d.set(0, 0, 0)
        .addScaledVector(u, Math.cos(phi) * Math.cos(b))
        .addScaledVector(v, Math.sin(phi) * Math.cos(b))
        .addScaledVector(MILKY, Math.sin(b));
    } else {
      const z = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      d.set(r * Math.cos(a), z, r * Math.sin(a));
    }
    d.multiplyScalar(SKY_R * 0.985);
    pos[i * 3] = d.x;
    pos[i * 3 + 1] = d.y;
    pos[i * 3 + 2] = d.z;
    const k = Math.pow(Math.random(), 5);
    size[i] = (inBand ? 0.75 : 0.9) + k * 2.6;
    bright[i] = 0.35 + 0.65 * Math.min(1, k * 2 + Math.random() * 0.4);
    tint[i] = Math.random();
    phase[i] = Math.random() * 6.28;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aBright", new THREE.BufferAttribute(bright, 1));
  geo.setAttribute("aTint", new THREE.BufferAttribute(tint, 1));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SKY_R * 2);
  return geo;
}

const starMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uVis: { value: 0 }, uPx: { value: 1.5 }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    attribute float aSize, aBright, aTint, aPhase;
    uniform float uPx, uTime;
    varying float vB;
    varying vec3 vC;
    void main(){
      float tw = 0.82 + 0.18 * sin(uTime * (0.8 + aPhase * 0.3) + aPhase * 9.0);
      vB = aBright * tw;
      vC = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.7), aTint);
      gl_PointSize = aSize * uPx;
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uVis;
    varying float vB;
    varying vec3 vC;
    void main(){
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float a = clamp(1.0 - d, 0.0, 1.0);
      a = a * a;
      gl_FragColor = vec4(vC * vB * a * uVis, 1.0);
      #include <colorspace_fragment>
    }`,
});

// ---------- 지구 ----------
const EARTH_ROT = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(4.57, 0.53, 2.03)));
const earthMat = new THREE.ShaderMaterial({
  uniforms: {
    uSun: SUN_U,
    uTime: { value: 0 },
    uRot: { value: EARTH_ROT },
    uAtm: { value: new THREE.Color() },
    uDeep: { value: C("#14498f") },
    uShallow: { value: C("#2f8fd0") },
    uGreen: { value: C("#4d9a3c") },
    uDry: { value: C("#a39a55") },
    uIce: { value: C("#eef4fa") },
  },
  vertexShader: /* glsl */ `
    varying vec3 vObj;
    varying vec3 vN;
    varying vec3 vP;
    void main(){
      vObj = position;
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vObj;
    varying vec3 vN;
    varying vec3 vP;
    uniform vec3 uSun, uAtm, uDeep, uShallow, uGreen, uDry, uIce;
    uniform float uTime;
    uniform mat3 uRot;
    ${NOISE}
    float fbm3(vec3 p){ return vnoise(p) * 0.55 + vnoise(p * 2.1) * 0.3 + vnoise(p * 4.3) * 0.15; }
    void main(){
      vec3 N = normalize(vN);
      vec3 V = normalize(cameraPosition - vP);
      vec3 p0 = uRot * normalize(vObj);
      float s = uTime * 0.0008;
      vec3 p = vec3(p0.x * cos(s) - p0.z * sin(s), p0.y, p0.x * sin(s) + p0.z * cos(s));

      // 땅과 바다 (경계는 또렷하게 = 만화풍)
      float h = fbm3(p * 2.4 + 7.0);
      float land = smoothstep(0.535, 0.55, h);
      float shallow = smoothstep(0.46, 0.535, h);
      vec3 ocean = mix(uDeep, uShallow, shallow);
      float e = fbm3(p * 6.0 + 3.0);
      vec3 ground = mix(uGreen, uDry, smoothstep(0.56, 0.8, e + (h - 0.55) * 0.8));
      ground *= 0.9 + 0.2 * vnoise(p * 70.0);
      vec3 surf = mix(ocean, ground, land);
      float ice = smoothstep(0.9, 0.93, abs(p.y) + (h - 0.5) * 0.12);
      surf = mix(surf, uIce, ice);

      // 구름 (땅보다 빨리 흘러감)
      float cs = uTime * 0.0025;
      vec3 q = vec3(p0.x * cos(cs) - p0.z * sin(cs), p0.y, p0.x * sin(cs) + p0.z * cos(cs));
      float c = fbm3(q * 5.5 + 11.0) * 0.78 + vnoise(q * 30.0) * 0.22;
      float cloud = smoothstep(0.55, 0.62, c) * 0.9;

      // 빛
      float lam = dot(N, uSun);
      float day = smoothstep(-0.14, 0.32, lam);
      // 구름 그림자: 태양 반대쪽으로 살짝 밀린 곳의 구름이 땅과 바다를 어둡게 한다
      vec3 sl = uRot * uSun;
      vec3 st = normalize(sl - dot(sl, p0) * p0 + 1e-5);
      vec3 qs = q - st * 0.012;
      float cs2 = fbm3(qs * 5.5 + 11.0) * 0.78 + vnoise(qs * 30.0) * 0.22;
      float shadow = smoothstep(0.55, 0.62, cs2) * (1.0 - cloud) * day;
      vec3 col = surf * (1.0 - 0.38 * shadow) * (0.1 + 0.9 * day);
      col = mix(col, vec3(1.0) * (0.12 + 0.88 * day), cloud);
      // 밤의 지구: 도시 불빛과 오로라
      float night = 1.0 - smoothstep(-0.3, 0.08, lam);
      float city = smoothstep(0.5, 0.66, fbm3(p * 9.0 + 21.0)) * step(0.8, vnoise(p * 220.0)) * land * (1.0 - cloud);
      col += vec3(1.0, 0.72, 0.34) * city * night * 1.2;
      float lat = abs(p.y);
      float aband = smoothstep(0.64, 0.72, lat) * (1.0 - smoothstep(0.8, 0.88, lat));
      float wav = 0.55 + 0.45 * sin(p.x * 38.0 + p.z * 21.0 + uTime * 0.7 + vnoise(p * 26.0 + uTime * 0.15) * 7.0);
      vec3 acol = mix(vec3(0.15, 1.0, 0.5), vec3(0.65, 0.3, 0.95), smoothstep(0.72, 0.86, lat));
      col += acol * aband * wav * night * (1.0 - 0.8 * cloud) * 0.85;
      // 바다에 비친 태양 빛
      float glint = pow(max(dot(reflect(-uSun, N), V), 0.0), 260.0) * (1.0 - land) * (1.0 - cloud) * day;
      col += vec3(1.0, 0.95, 0.85) * glint * 0.9;
      // 낮과 밤 경계의 노을빛
      float term = exp(-pow(lam / 0.13, 2.0));
      col += vec3(1.0, 0.5, 0.25) * term * 0.16;

      // 가장자리 대기 빛 (림 발광) + 낮은 곳에서는 안개처럼 하늘색으로 녹아듦
      float rim = pow(1.0 - max(dot(N, V), 0.0), 2.7);
      col = mix(col, uAtm * (0.4 + 0.75 * day), clamp(rim * 0.92, 0.0, 1.0));

      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
});

// ---------- 구름 (낮은 하늘) ----------
const cloudMat = new THREE.ShaderMaterial({
  uniforms: { uSun: SUN_U, uHaze: { value: new THREE.Color() } },
  vertexShader: /* glsl */ `
    varying vec3 vN;
    varying vec3 vP;
    void main(){
      vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vP = wp.xyz;
      vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vN;
    varying vec3 vP;
    uniform vec3 uSun, uHaze;
    void main(){
      vec3 N = normalize(vN);
      vec3 base = mix(vec3(0.62, 0.72, 0.88), vec3(1.0), smoothstep(-0.5, 0.75, N.y));
      base *= 0.82 + 0.28 * dot(N, uSun);
      float dist = length(vP - cameraPosition);
      base = mix(base, uHaze, smoothstep(45.0, 160.0, dist) * 0.85);
      gl_FragColor = vec4(base, 1.0);
      #include <colorspace_fragment>
    }`,
});

// ---------- 태양 빛을 받는 물체용 (행성, 위성) ----------
const SATURN_CENTER = { value: new THREE.Vector3() };
const SATURN_RAD = { value: 1 };
const RING_EULER = new THREE.Euler(-1.15, 0.2, 0.35);
const RING_N = { value: new THREE.Vector3(0, 0, 1).applyEuler(RING_EULER) };
function litMaterial({ color = "#ffffff", map = null, spec = 0, rim = "#000000", rimAmt = 0, transparent = false, ring = false, amb = 0.07 }) {
  return new THREE.ShaderMaterial({
    transparent,
    uniforms: {
      uSun: SUN_U,
      uColor: { value: C(color) },
      uMap: { value: map },
      uUseMap: { value: map ? 1 : 0 },
      uSpec: { value: spec },
      uFade: { value: 1 },
      uRim: { value: C(rim) },
      uRimAmt: { value: rimAmt },
      uRingAmt: { value: ring ? 1 : 0 },
      uAmb: { value: amb },
      uRingN: RING_N,
      uCenter: SATURN_CENTER,
      uRad: SATURN_RAD,
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vP;
      varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vP;
      varying vec2 vUv;
      uniform vec3 uSun, uColor, uRim, uRingN, uCenter;
      uniform sampler2D uMap;
      uniform float uUseMap, uSpec, uFade, uRimAmt, uRingAmt, uRad, uAmb;
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vP);
        vec3 base = uColor;
        if (uUseMap > 0.5) base *= texture2D(uMap, vUv).rgb;
        float lit = smoothstep(-0.08, 0.35, dot(N, uSun));
        if (uRingAmt > 0.5) {
          // 토성: 고리가 행성 위에 드리우는 그림자
          vec3 pl = (vP - uCenter) / uRad;
          float dn = dot(uSun, uRingN);
          if (abs(dn) > 0.02) {
            float tt = -dot(pl, uRingN) / dn;
            if (tt > 0.0) {
              float rr = length(pl + uSun * tt);
              lit *= 1.0 - 0.7 * smoothstep(1.2, 1.3, rr) * (1.0 - smoothstep(2.2, 2.26, rr));
            }
          }
        }
        vec3 col = base * (uAmb + (1.0 - uAmb) * lit);
        col += vec3(1.0, 0.95, 0.85) * pow(max(dot(reflect(-uSun, N), V), 0.0), 26.0) * uSpec * lit;
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += uRim * rim * uRimAmt * (0.3 + 0.7 * lit);
        gl_FragColor = vec4(col, uFade);
        #include <colorspace_fragment>
      }`,
  });
}

// ---------- 행성 무늬 (캔버스로 직접 그림) ----------
function canvasTex(w, h, draw) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d");
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
const rnd = (a, b) => a + Math.random() * (b - a);

function bandsTex(colors, wobble, extra) {
  return canvasTex(512, 256, (g, w, h) => {
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const k = (Math.sin(t * 38) * 0.5 + 0.5) * 0.6 + (Math.sin(t * 13 + 1.7) * 0.5 + 0.5) * 0.4;
      const i = Math.min(colors.length - 1, Math.floor(k * colors.length));
      g.fillStyle = colors[i];
      for (let x = 0; x < w; x += 8) {
        const off = Math.sin(x * 0.05 + y * 0.3) * wobble;
        g.fillRect(x, y + off, 9, 1.4);
      }
    }
    if (extra) extra(g, w, h);
  });
}

function makePlanetTextures() {
  const moon = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = "#a8a8a6";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = "rgba(70,70,78,0.30)";
      g.beginPath();
      g.ellipse(rnd(0, w), rnd(30, h - 30), rnd(25, 70), rnd(18, 40), rnd(0, 3), 0, 6.3);
      g.fill();
    }
    for (let i = 0; i < 170; i++) {
      const x = rnd(0, w);
      const y = rnd(0, h);
      const r = rnd(2, 15) * (Math.random() < 0.12 ? 1.8 : 1);
      g.fillStyle = "rgba(60,60,64,0.30)";
      g.beginPath();
      g.arc(x, y, r, 0, 6.3);
      g.fill();
      g.strokeStyle = "rgba(235,235,230,0.38)";
      g.lineWidth = 1.3;
      g.beginPath();
      g.arc(x - r * 0.1, y - r * 0.1, r * 0.95, 3.4, 5.4);
      g.stroke();
    }
  });
  const mars = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = "#b65a33";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 45; i++) {
      g.fillStyle = Math.random() < 0.6 ? "rgba(110,48,28,0.34)" : "rgba(222,150,105,0.28)";
      g.beginPath();
      g.ellipse(rnd(0, w), rnd(20, h - 20), rnd(14, 60), rnd(8, 26), rnd(0, 3), 0, 6.3);
      g.fill();
    }
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "rgba(255,255,255,0.95)");
    gr.addColorStop(0.07, "rgba(255,255,255,0)");
    gr.addColorStop(0.93, "rgba(255,255,255,0)");
    gr.addColorStop(1, "rgba(255,255,255,0.95)");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  const venus = bandsTex(["#efd9a6", "#e4c78c", "#f3e2b8", "#d9b87a"], 5, null);
  const jupiter = bandsTex(["#e8d3ad", "#b98a5c", "#f1e4cb", "#8e6244", "#d1a878"], 3, (g, w, h) => {
    g.fillStyle = "rgba(176,76,48,0.85)";
    g.beginPath();
    g.ellipse(w * 0.3, h * 0.62, 30, 15, 0, 0, 6.3);
    g.fill();
    g.strokeStyle = "rgba(240,220,190,0.5)";
    g.lineWidth = 3;
    g.stroke();
  });
  const saturn = bandsTex(["#ead9a6", "#d2b97c", "#f1e5bd", "#c4a869"], 2, null);
  return { moon, mars, venus, jupiter, saturn };
}

const ringMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: { uFade: { value: 1 }, uSun: SUN_U, uCenter: SATURN_CENTER, uRad: SATURN_RAD },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vP;
    void main(){
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vP;
    uniform float uFade, uRad;
    uniform vec3 uSun, uCenter;
    void main(){
      float r = length(vUv - 0.5) * 2.0;
      float t = (r - 0.55) / 0.45;
      if (t < 0.0 || t > 1.0) discard;
      float bands = 0.62 + 0.24 * sin(t * 70.0) + 0.14 * sin(t * 27.0 + 1.3);
      float gap = smoothstep(0.58, 0.6, t) * (1.0 - smoothstep(0.66, 0.68, t));
      float a = 0.9 * (1.0 - 0.9 * gap) * smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.93, 1.0, t));
      vec3 col = vec3(0.86, 0.78, 0.6) * bands;
      // 행성이 고리에 드리우는 그림자
      vec3 pl = (vP - uCenter) / uRad;
      float b = dot(pl, uSun);
      float d = sqrt(max(dot(pl, pl) - b * b, 0.0));
      float sh = b < 0.0 ? 1.0 - smoothstep(0.96, 1.04, d) : 0.0;
      col *= 1.0 - 0.78 * sh;
      gl_FragColor = vec4(col, a * uFade);
      #include <colorspace_fragment>
    }`,
});

// ---------- 태양 빛번짐 (렌즈 플레어 느낌) ----------
function flareTexture(kind) {
  return canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    if (kind === "ring") {
      gr.addColorStop(0, "rgba(255,255,255,0)");
      gr.addColorStop(0.62, "rgba(255,255,255,0.05)");
      gr.addColorStop(0.82, "rgba(255,255,255,0.8)");
      gr.addColorStop(0.95, "rgba(255,255,255,0.08)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
    } else {
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.25, "rgba(255,255,255,0.55)");
      gr.addColorStop(0.6, "rgba(255,255,255,0.12)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
    }
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
}
const FLARES = [
  // t: 화면 가운데를 기준으로 태양 반대쪽(-)/같은 쪽(+) 위치, deg: 크기, a: 밝기
  { t: 0, deg: 22, a: 0.55, tex: "soft", color: "#ffe2b0" },
  { t: 0, deg: 46, a: 0.16, tex: "streak", color: "#ffd7a0" },
  { t: -0.4, deg: 5, a: 0.3, tex: "ring", color: "#ffd9a0" },
  { t: -0.8, deg: 3.2, a: 0.38, tex: "soft", color: "#9ad0ff" },
  { t: 0.55, deg: 9, a: 0.14, tex: "ring", color: "#b8ffcf" },
  { t: -1.3, deg: 13, a: 0.14, tex: "soft", color: "#ffc2a0" },
];

// 태양이 엘리베이터 창으로 보이는지 (벽에 가려지면 빛번짐을 끈다)
function sunThroughWindow(p, s) {
  if (Math.abs(p.x) > 2.0 || p.y < 0.05 || p.y > 2.95 || Math.abs(p.z) > 1.95) return false;
  let t = Infinity;
  let face = "";
  if (s.x !== 0) {
    const tx = ((s.x > 0 ? 2.05 : -2.05) - p.x) / s.x;
    if (tx > 0 && tx < t) {
      t = tx;
      face = "x";
    }
  }
  if (s.z !== 0) {
    const tz = ((s.z > 0 ? 2.0 : -2.0) - p.z) / s.z;
    if (tz > 0 && tz < t) {
      t = tz;
      face = "z";
    }
  }
  if (s.y !== 0) {
    const ty = ((s.y > 0 ? 3.0 : 0.0) - p.y) / s.y;
    if (ty > 0 && ty < t) {
      t = ty;
      face = "y";
    }
  }
  const y = p.y + s.y * t;
  if (face === "x") return y > 1.2 && y < 2.4 && Math.abs(p.z + s.z * t) < 1.35;
  if (face === "z" && s.z < 0) {
    if (Math.abs(sim.altitude - sim.landingAlt) < 3.6) return false; // 문 앞에 로비 벽이 있음
    const ax = Math.abs(p.x + s.x * t);
    if (sim.doorOpen > 0.05) return ax < 1.3 && y > 0.1 && y < 2.4;
    return ax > 0.2 && ax < 1.2 && y > 0.55 && y < 2.25;
  }
  return false;
}

// ---------- 깜빡이는 불빛 / 비행운 / 우주인 / 유성 재료 ----------
let glowCache = null;
const glowTex = () => (glowCache = glowCache || flareTexture("soft"));

// 인공위성, 비행기에 달린 깜빡이 불빛
function Blink({ position, color = "#ff3b3b", period = 1.2, phase = 0, size = 0.9 }) {
  const ref = useRef();
  useFrame((st) => {
    if (ref.current) ref.current.visible = (st.clock.elapsedTime / period + phase) % 1 < 0.16;
  });
  return (
    <sprite ref={ref} position={position} scale={[size, size, 1]}>
      <spriteMaterial map={glowTex()} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </sprite>
  );
}

// 비행운: 비행기 뒤로 길게 퍼지며 옅어지는 흰 줄
const contrailMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: {},
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    void main(){
      float a = pow(vUv.y, 1.6) * 0.6;
      gl_FragColor = vec4(vec3(1.0), a);
      #include <colorspace_fragment>
    }`,
});

function PlaneModel() {
  const body = useMemo(() => litMaterial({ color: "#eceff4", spec: 0.5, amb: 0.62 }), []);
  const dark = useMemo(() => litMaterial({ color: "#6d7686", spec: 0.2, amb: 0.5 }), []);
  return (
    <group>
      <mesh material={body} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.24, 0.2, 3.4, 12]} />
      </mesh>
      <mesh material={body} position={[0, 0, 1.95]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.24, 0.6, 12]} />
      </mesh>
      <mesh material={body} position={[0, -0.05, 0.1]}>
        <boxGeometry args={[3.6, 0.05, 0.75]} />
      </mesh>
      <mesh material={body} position={[0, 0.5, -1.5]}>
        <boxGeometry args={[0.05, 0.8, 0.55]} />
      </mesh>
      <mesh material={body} position={[0, 0.05, -1.5]}>
        <boxGeometry args={[1.5, 0.05, 0.4]} />
      </mesh>
      {[-0.8, 0.8].map((x) => (
        <mesh key={x} material={dark} position={[x, -0.22, 0.35]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.6, 10]} />
        </mesh>
      ))}
      <Blink position={[1.8, 0, 0.1]} color="#ff3030" period={1.1} size={1.5} />
      <Blink position={[-1.8, 0, 0.1]} color="#40ff60" period={1.1} size={1.5} phase={0.3} />
      <Blink position={[0, 0.95, -1.6]} color="#ffffff" period={0.9} size={1.8} phase={0.1} />
      <mesh material={contrailMat} position={[0, -0.05, -24.7]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.35, 1.0, 46, 10, 1, true]} />
      </mesh>
    </group>
  );
}

// 우주 정거장 밖에서 일하는 우주인. mode: "work"(도구를 쥐고 작업) / "float"(둥둥 떠다님)
function Astronaut({ mode, phase = 0, position, rotation = [0, 0, 0] }) {
  const g = useRef();
  const body = useRef();
  const armL = useRef();
  const armR = useRef();
  const suit = useMemo(() => litMaterial({ color: "#eef0f4", spec: 0.35 }), []);
  const visor = useMemo(() => litMaterial({ color: "#d9a93c", spec: 1.2 }), []);
  const pack = useMemo(() => litMaterial({ color: "#c3c7ce", spec: 0.2 }), []);
  useFrame((st) => {
    const t = st.clock.elapsedTime + phase;
    if (!g.current) return;
    if (mode === "work") {
      body.current.rotation.x = 0.35 + Math.sin(t * 0.9) * 0.05;
      armR.current.rotation.x = -1.1 + Math.sin(t * 3.2) * 0.45;
      armL.current.rotation.x = -0.9;
    } else {
      g.current.position.y = position[1] + Math.sin(t * 0.7) * 0.06;
      g.current.rotation.z = Math.sin(t * 0.45) * 0.35;
      g.current.rotation.x = Math.sin(t * 0.33) * 0.3;
      armL.current.rotation.z = 0.7 + Math.sin(t * 1.1) * 0.25;
      armR.current.rotation.z = -0.7 - Math.sin(t * 0.9) * 0.25;
      armL.current.rotation.x = armR.current.rotation.x = -0.3;
    }
  });
  return (
    <group ref={g} position={position} rotation={rotation}>
      <group ref={body}>
        {[-0.07, 0.07].map((x) => (
          <mesh key={x} material={suit} position={[x, -0.2, 0]}>
            <capsuleGeometry args={[0.06, 0.2, 4, 8]} />
          </mesh>
        ))}
        <mesh material={suit} position={[0, 0.26, 0]}>
          <capsuleGeometry args={[0.14, 0.2, 4, 10]} />
        </mesh>
        <mesh material={pack} position={[0, 0.3, -0.15]}>
          <boxGeometry args={[0.26, 0.34, 0.12]} />
        </mesh>
        <mesh material={suit} position={[0, 0.62, 0]}>
          <sphereGeometry args={[0.15, 14, 12]} />
        </mesh>
        <mesh material={visor} position={[0, 0.62, 0.075]} scale={[1, 0.9, 0.65]}>
          <sphereGeometry args={[0.115, 12, 10]} />
        </mesh>
        {[[armL, 1], [armR, -1]].map(([ref, sd]) => (
          <group key={sd} ref={ref} position={[0.19 * sd, 0.4, 0]} rotation={[0, 0, 0.15 * sd]}>
            <mesh material={suit} position={[0, -0.14, 0]}>
              <capsuleGeometry args={[0.045, 0.2, 4, 8]} />
            </mesh>
            <mesh material={suit} position={[0, -0.3, 0]}>
              <sphereGeometry args={[0.055, 8, 8]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

// ---------- 인공위성 모델 ----------
function Panel({ position, size, color = "#2b56c4" }) {
  const mat = useMemo(() => litMaterial({ color, spec: 0.5 }), [color]);
  return (
    <mesh position={position} material={mat}>
      <boxGeometry args={size} />
    </mesh>
  );
}
function Part({ geo, position, rotation, color, spec = 0.2 }) {
  const mat = useMemo(() => litMaterial({ color, spec }), [color, spec]);
  return (
    <mesh position={position} rotation={rotation} material={mat}>
      {geo}
    </mesh>
  );
}

function SatModel({ type }) {
  if (type === "issw") {
    // 우주인이 점검 작업을 하는 우주 정거장
    return (
      <group>
        <SatModel type="iss" />
        <Astronaut mode="work" position={[1.2, 0.42, 0]} rotation={[0, Math.PI / 2, 0]} />
        <Astronaut mode="float" phase={2} position={[-1.2, 1.1, 0.7]} />
        <mesh position={[-1.2, 0.53, 0.35]} rotation={[0.64, 0, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 1.17, 6]} />
          <meshBasicMaterial color="#bfc3ca" />
        </mesh>
      </group>
    );
  }
  if (type === "iss") {
    return (
      <group>
        <Part geo={<boxGeometry args={[4.2, 0.12, 0.12]} />} color="#c9ccd2" />
        <Blink position={[2.1, 0.1, 0]} color="#ff4040" period={1.6} />
        <Blink position={[-2.1, 0.1, 0]} color="#5cff7a" period={1.6} phase={0.5} />
        <Blink position={[0, 0.3, 1.7]} color="#ffffff" period={0.9} phase={0.2} />
        <Part geo={<cylinderGeometry args={[0.2, 0.2, 1.8, 14]} />} rotation={[Math.PI / 2, 0, 0]} color="#e6e8ec" />
        <Part geo={<cylinderGeometry args={[0.16, 0.16, 1.1, 14]} />} position={[0, 0, 1.4]} rotation={[Math.PI / 2, 0, 0]} color="#d8dadf" />
        <Part geo={<cylinderGeometry args={[0.14, 0.14, 0.8, 14]} />} position={[0, 0, -1.2]} rotation={[Math.PI / 2, 0, 0]} color="#d8dadf" />
        {[-1.75, 1.75].map((x) =>
          [-1.4, 1.4].map((z) => <Panel key={`${x}${z}`} position={[x, 0, z]} size={[0.8, 0.03, 2.3]} color="#c78d2c" />)
        )}
        {[-0.8, 0.8].map((x) => (
          <Part key={x} geo={<boxGeometry args={[0.35, 0.03, 1.3]} />} position={[x, 0.1, 0]} color="#f2f2f2" />
        ))}
      </group>
    );
  }
  if (type === "scope") {
    return (
      <group>
        <Part geo={<cylinderGeometry args={[0.3, 0.3, 1.5, 16]} />} rotation={[Math.PI / 2, 0, 0]} color="#d9dce2" />
        <Blink position={[0, 0.4, -0.7]} color="#ffffff" period={1.9} phase={0.7} />
        <Part geo={<cylinderGeometry args={[0.22, 0.22, 0.05, 16]} />} position={[0, 0, 0.76]} rotation={[Math.PI / 2, 0, 0]} color="#10131a" />
        <Panel position={[-1.0, 0, -0.1]} size={[1.3, 0.02, 0.6]} />
        <Panel position={[1.0, 0, -0.1]} size={[1.3, 0.02, 0.6]} />
      </group>
    );
  }
  if (type === "cube") {
    return (
      <group>
        <Part geo={<boxGeometry args={[0.4, 0.4, 0.8]} />} color="#8d9099" spec={0.5} />
        <Blink position={[0, 0.3, 0]} color="#5cff7a" period={1.1} />
        <Panel position={[-0.5, 0, 0]} size={[0.6, 0.02, 0.8]} />
        <Panel position={[0.5, 0, 0]} size={[0.6, 0.02, 0.8]} />
      </group>
    );
  }
  return (
    <group>
      <Part geo={<boxGeometry args={[0.7, 0.7, 0.7]} />} color="#caa24b" spec={0.9} />
      <Blink position={[0, 0.95, 0]} color="#ff4040" period={1.3} phase={0.4} />
      <Part geo={<cylinderGeometry args={[0.02, 0.02, 0.5, 6]} />} position={[0, 0.55, 0]} color="#bbbbbb" />
      <Part geo={<sphereGeometry args={[0.28, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />} position={[0, 0.8, 0]} color="#f0f0f0" />
      <Panel position={[-1.15, 0, 0]} size={[1.4, 0.02, 0.6]} />
      <Panel position={[1.15, 0, 0]} size={[1.4, 0.02, 0.6]} />
    </group>
  );
}

// ---------- 유성 / 별 열차 ----------
function makeMeteorMat() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uA: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uA;
      void main(){
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float head = exp(-pow((1.0 - vUv.x) * 14.0, 2.0));
        float a = (pow(vUv.x, 3.0) * 0.8 + head) * across * across * uA;
        gl_FragColor = vec4(vec3(0.8, 0.9, 1.0) * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
const TRAIN_N = 14;
const TRAIN_A = dirOf(185, 22);
const TRAIN_B = (() => {
  const b = dirOf(100, 40);
  return b.addScaledVector(TRAIN_A, -b.dot(TRAIN_A)).normalize();
})();
const planetR = (p) => SKY_R * 0.93 * Math.tan((p.deg * Math.PI) / 360);

// ---------- 메인 ----------
export default function Outside() {
  const { scene, camera, gl, size } = useThree();
  const skyRef = useRef();
  const earthRef = useRef();
  const cloudsRef = useRef();
  const satRefs = useRef([]);
  const planetRefs = useRef([]);
  const flareRefs = useRef([]);
  const flareI = useRef(0);
  const planeRefs = useRef([]);
  const trainRef = useRef();
  const meteorMeshes = useRef([]);
  const meteorMats = useMemo(() => [0, 1, 2].map(makeMeteorMat), []);
  const meteorState = useRef({
    next: 4,
    list: [0, 1, 2].map(() => ({ t: -1, dur: 0.7, len: 4, dir0: new THREE.Vector3(), tan: new THREE.Vector3() })),
  }).current;
  const trainGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIN_N * 3), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SKY_R * 2);
    return g;
  }, []);
  const tmp = useRef({
    v: new THREE.Vector3(),
    w: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    nadir: new THREE.Vector3(),
    obj: new THREE.Object3D(),
    x: new THREE.Vector3(),
    y: new THREE.Vector3(),
    m4: new THREE.Matrix4(),
  }).current;

  const stars = useMemo(() => makeStars(window.innerWidth < 700 ? 2600 : 4200), []);
  const textures = useMemo(() => makePlanetTextures(), []);
  const planetMats = useMemo(
    () => ({
      moon: litMaterial({ color: "#ffffff", map: textures.moon, transparent: true }),
      mars: litMaterial({ color: "#ffffff", map: textures.mars, transparent: true, rim: "#ff9a6a", rimAmt: 0.25 }),
      venus: litMaterial({ color: "#ffffff", map: textures.venus, transparent: true, rim: "#fff1c8", rimAmt: 0.45 }),
      jupiter: litMaterial({ color: "#ffffff", map: textures.jupiter, transparent: true }),
      saturn: litMaterial({ color: "#ffffff", map: textures.saturn, transparent: true, ring: true }),
    }),
    [textures]
  );
  const flareTex = useMemo(() => ({ soft: flareTexture("soft"), ring: flareTexture("ring"), streak: flareTexture("soft") }), []);

  const clouds = useMemo(() => {
    const list = [];
    const puffs = [];
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 24 + Math.pow(Math.random(), 0.7) * 120;
      const s = 2.6 + Math.random() * 4.6;
      const cloud = { ang, rad, alt: 0.4 + Math.random() * 11.6, first: puffs.length, n: 0 };
      const n = 3 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0 : k / (n - 1) - 0.5;
        const sc = s * (0.7 + 0.5 * Math.cos(t * 3.1));
        puffs.push({ dx: t * s * 2.4, dy: (Math.random() - 0.3) * s * 0.25, dz: (Math.random() - 0.5) * s * 0.7, sc });
      }
      cloud.n = n;
      list.push(cloud);
    }
    return { list, puffs };
  }, []);

  // 별 점 크기를 화면 해상도에 맞춘다
  useEffect(() => {
    starMat.uniforms.uPx.value = Math.min(gl.getPixelRatio(), 2) * 1.15;
  }, [gl, size]);

  useEffect(() => {
    // 구름 모양이 하늘에서 가운데는 풍성하고 아래는 평평하게 보이도록 고정 배율
    const mesh = cloudsRef.current;
    if (mesh) mesh.frustumCulled = false;
    camera.far = 6000;
    camera.updateProjectionMatrix();
  }, [camera]);

  useFrame((state) => {
    // 디버그: 주소 끝에 ?debug 를 붙이면 window.__alt = 숫자(km) 로 고도를 바꿔 볼 수 있어요
    if (window.__alt !== undefined && window.__alt !== null) sim.altitude = window.__alt;
    const alt = sim.altitude;
    const time = state.clock.elapsedTime + (window.__tOff || 0); // 디버그: window.__tOff 로 시간을 앞당겨 볼 수 있어요
    updateSky(alt);

    if (!scene.background) scene.background = new THREE.Color();
    scene.background.copy(sky.hor);

    // 하늘은 카메라를 따라다닌다 (무한히 먼 곳)
    skyRef.current.position.copy(camera.position);

    // 지구 위치와 대기
    const sink = earthSink(alt);
    const earth = earthRef.current;
    earth.position.set(EARTH_OFF_X, -sink - EARTH_UNDER, EARTH_OFF_Z);
    tmp.nadir.copy(earth.position).sub(camera.position);
    const dist = tmp.nadir.length();
    tmp.nadir.normalize();
    const alpha = Math.asin(Math.min(1, EARTH_R / dist));

    earthMat.uniforms.uTime.value = time;
    earthMat.uniforms.uAtm.value.copy(sky.atm);

    const du = domeMat.uniforms;
    du.uZen.value.copy(sky.zen);
    du.uHor.value.copy(sky.hor);
    du.uAtm.value.copy(sky.atm);
    du.uNadir.value.copy(tmp.nadir);
    du.uAlpha.value = alpha;
    du.uLimbW.value = sky.limbW;
    du.uStars.value = sky.stars;
    starMat.uniforms.uVis.value = sky.stars;
    starMat.uniforms.uTime.value = time;
    cloudMat.uniforms.uHaze.value.copy(sky.hor).lerp(sky.atm, 0.2);

    // 행성: 고도에 따라 하나씩 나타남
    PLANETS.forEach((p, i) => {
      const g = planetRefs.current[i];
      if (!g) return;
      const f = sstep(p.from, p.to, alt);
      g.visible = f > 0.001;
      if (!g.visible) return;
      const m = planetMats[p.name];
      m.uniforms.uFade.value = f;
      if (p.ring) ringMat.uniforms.uFade.value = f;
      const k = 0.7 + 0.3 * f;
      g.scale.setScalar(k);
      // 공전: 하늘을 한 바퀴 돈다 (돌면서 태양 빛을 받는 면이 바뀌어 초승달처럼 보이기도 해요)
      const ang = ((p.az + (360 * time) / p.period) * Math.PI) / 180;
      const el = ((p.el + ORBIT_TILT * Math.sin(ang - (p.az * Math.PI) / 180)) * Math.PI) / 180;
      g.position.set(Math.cos(el) * Math.cos(ang), Math.sin(el), -Math.cos(el) * Math.sin(ang)).multiplyScalar(SKY_R * 0.93);
      if (p.ring) {
        SATURN_CENTER.value.copy(skyRef.current.position).add(g.position);
        SATURN_RAD.value = planetR(p) * k;
      }
    });

    // 구름
    const cm = cloudsRef.current;
    cm.visible = alt < 45;
    if (cm.visible) {
      const o = tmp.obj;
      clouds.list.forEach((c) => {
        const cy = (c.alt - alt) * UNITS_PER_KM;
        const cx = Math.cos(c.ang) * c.rad;
        const cz = -Math.sin(c.ang) * c.rad;
        for (let k = 0; k < c.n; k++) {
          const p = clouds.puffs[c.first + k];
          o.position.set(cx + p.dx, cy + p.dy, cz + p.dz);
          o.scale.set(p.sc * 1.35, p.sc * 0.62, p.sc);
          o.updateMatrix();
          cm.setMatrixAt(c.first + k, o.matrix);
        }
      });
      cm.instanceMatrix.needsUpdate = true;
    }

    // 인공위성
    SATS.forEach((s, i) => {
      const g = satRefs.current[i];
      if (!g) return;
      const y = (s.alt - alt) * UNITS_PER_KM;
      const f = 1 - sstep(SAT_VIEW * 0.65, SAT_VIEW, Math.abs(y));
      g.visible = f > 0.01;
      if (!g.visible) return;
      const th = s.th + s.w * time;
      g.position.set(Math.cos(th) * s.rho, y, Math.sin(th) * s.rho);
      g.rotation.set(0.25, -th + time * 0.05, 0.1);
      g.scale.setScalar(s.s * f);
    });

    // 비행기 (낮은 하늘)
    PLANES.forEach((pl, i) => {
      const g = planeRefs.current[i];
      if (!g) return;
      const y = (pl.alt - alt) * UNITS_PER_KM;
      const f = 1 - sstep(PLANE_VIEW * 0.65, PLANE_VIEW, Math.abs(y));
      g.visible = f > 0.01;
      if (!g.visible) return;
      const th = pl.th + pl.w * time;
      const sg = Math.sign(pl.w);
      g.position.set(Math.cos(th) * pl.rho, y, Math.sin(th) * pl.rho);
      g.rotation.set(0, Math.atan2(-Math.sin(th) * sg, Math.cos(th) * sg), -0.12 * sg);
      g.scale.setScalar(pl.s * f);
    });

    // 유성(별똥별): 하늘이 어두워진 뒤 몇 초에 한 번 창 쪽 하늘을 가로지른다
    const MS = meteorState;
    if (alt > 35 && time > MS.next) {
      const m = MS.list.find((e) => e.t < 0);
      if (m) {
        const r = Math.random();
        const az = r < 0.4 ? 150 + Math.random() * 60 : r < 0.75 ? -30 + Math.random() * 60 : 70 + Math.random() * 40;
        m.dir0.copy(dirOf(az, 8 + Math.random() * 40));
        tmp.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        m.tan.crossVectors(m.dir0, tmp.v).normalize();
        m.t = time;
        m.dur = 0.5 + Math.random() * 0.5;
        m.len = 3 + Math.random() * 4;
        meteorSound();
      }
      MS.next = time + 3 + Math.random() * 6;
    }
    MS.list.forEach((m, i) => {
      const mesh = meteorMeshes.current[i];
      if (!mesh) return;
      const sp = (time - m.t) / m.dur;
      if (m.t < 0 || sp >= 1) {
        m.t = -1;
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      tmp.v.copy(m.dir0).addScaledVector(m.tan, sp * 0.3).normalize();
      mesh.position.copy(tmp.v).multiplyScalar(SKY_R * 0.96);
      tmp.w.copy(tmp.v).negate();
      tmp.x.copy(m.tan).addScaledVector(tmp.w, -m.tan.dot(tmp.w)).normalize();
      tmp.y.crossVectors(tmp.w, tmp.x);
      tmp.m4.makeBasis(tmp.x, tmp.y, tmp.w);
      mesh.quaternion.setFromRotationMatrix(tmp.m4);
      mesh.scale.set(2 * SKY_R * 0.96 * Math.tan((m.len * Math.PI) / 360), 14, 1);
      meteorMats[i].uniforms.uA.value = Math.sin(Math.PI * sp);
    });

    // 작은 위성 여러 개가 줄지어 하늘을 지나가는 "별 열차"
    const tr = trainRef.current;
    const trVis = sstep(40, 70, alt) * (1 - sstep(140, 170, alt));
    tr.visible = trVis > 0.01;
    if (tr.visible) {
      tr.material.opacity = trVis * 0.9;
      const pos = tr.geometry.attributes.position;
      const t0 = (time / 120) * Math.PI * 2;
      for (let i = 0; i < TRAIN_N; i++) {
        const th = t0 - i * 0.012;
        tmp.v.copy(TRAIN_A).multiplyScalar(Math.cos(th)).addScaledVector(TRAIN_B, Math.sin(th)).multiplyScalar(SKY_R * 0.97);
        pos.setXYZ(i, tmp.v.x, tmp.v.y, tmp.v.z);
      }
      pos.needsUpdate = true;
    }

    // 분위기 소리: 속도, 고도에 따라 웅웅/바람/우주 저음
    updateAmbient(sim.speed, alt, sky.stars);

    // 태양 빛번짐: 태양이 창으로 보일 때만, 화면 가운데를 기준으로 반대쪽에 유령 빛이 생김
    const cam = camera;
    let target = 0;
    let sx = 0;
    let sy = 0;
    if (!view.overview && sunThroughWindow(cam.position, SUN)) {
      tmp.q.copy(cam.quaternion).invert();
      tmp.v.copy(SUN).applyQuaternion(tmp.q);
      if (tmp.v.z < -0.05) {
        const th = Math.tan((cam.fov * Math.PI) / 360);
        sx = tmp.v.x / -tmp.v.z / (th * cam.aspect);
        sy = tmp.v.y / -tmp.v.z / th;
        const edge = Math.max(Math.abs(sx), Math.abs(sy));
        const centered = 1 - Math.min(1, Math.hypot(sx, sy) / 1.6);
        target = (1 - sstep(0.85, 1.4, edge)) * (0.45 + 0.55 * centered);
      }
    }
    flareI.current += (target - flareI.current) * Math.min(1, 0.25);
    const fi = flareI.current;
    const th = Math.tan((cam.fov * Math.PI) / 360);
    FLARES.forEach((fl, i) => {
      const sp = flareRefs.current[i];
      if (!sp) return;
      sp.visible = fi > 0.01;
      if (!sp.visible) return;
      const gx = sx * (fl.t === 0 ? 1 : fl.t);
      const gy = sy * (fl.t === 0 ? 1 : fl.t);
      tmp.w.set(gx * th * cam.aspect, gy * th, -1).normalize().applyQuaternion(cam.quaternion);
      sp.position.copy(cam.position).addScaledVector(tmp.w, SKY_R * 0.9);
      const sz = 2 * SKY_R * 0.9 * Math.tan((fl.deg * Math.PI) / 360);
      sp.scale.set(fl.tex === "streak" ? sz * 2.4 : sz, fl.tex === "streak" ? sz * 0.18 : sz, 1);
      sp.material.opacity = fl.a * fi * (1 + 0.5 * sky.stars);
    });
  });

  return (
    <>
      {/* 하늘 (카메라를 따라다님) */}
      <group ref={skyRef}>
        <mesh material={domeMat} renderOrder={-100} frustumCulled={false}>
          <sphereGeometry args={[SKY_R, 48, 32]} />
        </mesh>
        <points geometry={stars} material={starMat} renderOrder={-90} frustumCulled={false} />

        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            ref={(el) => {
              meteorMeshes.current[i] = el;
            }}
            material={meteorMats[i]}
            renderOrder={-70}
            visible={false}
            frustumCulled={false}
          >
            <planeGeometry args={[1, 1]} />
          </mesh>
        ))}
        <points ref={trainRef} geometry={trainGeo} renderOrder={-60} frustumCulled={false} visible={false}>
          <pointsMaterial
            size={3.4}
            sizeAttenuation={false}
            color="#fff2cf"
            map={glowTex()}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>

        {PLANETS.map((p, i) => {
          const d = dirOf(p.az, p.el).multiplyScalar(SKY_R * 0.93);
          const r = SKY_R * 0.93 * Math.tan((p.deg * Math.PI) / 360);
          return (
            <group key={p.name} ref={(el) => {
                planetRefs.current[i] = el;
              }} position={d.toArray()}>
              <mesh material={planetMats[p.name]} rotation={[0.3, 0.8, 0.2]} scale={r}>
                <sphereGeometry args={[1, 40, 28]} />
              </mesh>
              {p.ring && (
                <mesh material={ringMat} rotation={RING_EULER} scale={r * 2.25} renderOrder={2}>
                  <ringGeometry args={[0.55, 1, 96]} />
                </mesh>
              )}
            </group>
          );
        })}
      </group>

      {/* 지구 */}
      <mesh ref={earthRef} material={earthMat} frustumCulled={false}>
        <sphereGeometry args={[EARTH_R, 96, 64]} />
      </mesh>

      {/* 낮은 하늘의 구름 */}
      <instancedMesh ref={cloudsRef} args={[null, null, clouds.puffs.length]} material={cloudMat}>
        <icosahedronGeometry args={[1, 2]} />
      </instancedMesh>

      {/* 인공위성 */}
      {SATS.map((s, i) => (
        <group key={i} ref={(el) => {
            satRefs.current[i] = el;
          }}>
          <SatModel type={s.type} />
        </group>
      ))}

      {/* 비행기 */}
      {PLANES.map((pl, i) => (
        <group
          key={i}
          ref={(el) => {
            planeRefs.current[i] = el;
          }}
        >
          <PlaneModel />
        </group>
      ))}

      {/* 태양 빛번짐 */}
      {FLARES.map((f, i) => (
        <sprite key={i} ref={(el) => {
            flareRefs.current[i] = el;
          }} renderOrder={50} visible={false}>
          <spriteMaterial
            map={flareTex[f.tex]}
            color={f.color}
            transparent
            depthTest={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            opacity={0}
          />
        </sprite>
      ))}
    </>
  );
}
