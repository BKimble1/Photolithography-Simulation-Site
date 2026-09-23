/**
 * Plasma etch cluster (illustrative, no manufacturer's design): a vacuum transfer chamber with
 * a SCARA wafer robot, a load lock fed from the equipment front end (EFEM), and a single-wafer
 * process chamber drawn in cutaway. The chamber is a cylindrical aluminium vacuum vessel with an
 * electrostatic chuck on a cantilevered cathode, a turbomolecular pump hanging below a pendulum
 * valve, gas lines and an optical-emission viewport. Its top depends on the process:
 *  - silicon / polysilicon etch: a ceramic window with a flat inductive (ICP) coil;
 *  - oxide (contact) etch: a showerhead top electrode, capacitively coupled (CCP);
 *  - resist ashing: a quartz downstream source with a helical coil above a baffle.
 *
 * Plasma glow is real visible light. It is drawn as an additive, ray-marched volume with a
 * dark sheath just above the wafer. Hues are qualitative: Cl2/HBr silicon etch pale
 * blue-violet, fluorocarbon (oxide/nitride) etch bluish-purple, O2 ash pale bluish-white.
 * All process motion is a pure function of step progress; only pump rotors and the plasma
 * flicker use wall-clock time.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useSimState, useStep } from '../../state/sim';
import { lerp, seg, smooth, useProgressBucket, useProgressFrame } from '../anim';
import { MAT, type MatKey } from '../materials';
import { Box, CleanFloor, Cyl, LightTower, mat } from '../kit/parts';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';

type V2 = [number, number];
type V3 = [number, number, number];
const TAU = Math.PI * 2;

// ───────────────────────────── layout (metres) ─────────────────────────────

const DECK_Y = 0.93; // transfer-chamber floor
const ESC_Y = 1.0; // wafer seat on the chuck
const XFER_Y = 1.016; // top of the robot blade: the transfer plane
const PIN_LO = 0.985; // lift-pin tops when retracted
const PIN_UP = 1.03; // lift-pin tops when raised
const LL_PLATE = 0.99; // load-lock cooling plate
const ARM_Y = 0.987; // first robot link (centre)

const R_PC = 0.912; // hub → process-chamber axis
const R_LL = 0.8; // hub → load-lock wafer centre
const HUB: V2 = [-R_PC, 0]; // the process chamber sits at the origin, the cluster runs along −x
const TH = { pc: 0, ll: -Math.PI } as const; // robot headings (rotation.y); LL → PC swings via the front
const BLADE = 0.3; // wrist → wafer centre
const D_RET = 0.05; // retracted wrist distance
const L1 = 0.36;
const L2 = 0.36;
const EXT_LEN = 0.56; // EFEM blade travel (load-lock centre → inside the EFEM)

const dx = (th: number) => Math.cos(th);
const dz = (th: number) => -Math.sin(th);
const LLW: V2 = [HUB[0] + R_LL * dx(TH.ll), HUB[1] + R_LL * dz(TH.ll)];
const PC2: V2 = [HUB[0], HUB[1] - R_PC];

/** Cutaway of the process chamber: centre angle (from +z toward +x) and width, radians. */
const CUT: [number, number] = [0.48, 1.95];
const SLIT_PHI = (3 * Math.PI) / 2; // direction from the chamber to the transfer chamber (−x)

// ───────────────────────────── local materials ─────────────────────────────

const SECTION = new THREE.MeshStandardMaterial({ color: '#c9cdd2', metalness: 0.4, roughness: 0.55, side: THREE.DoubleSide });
const CHAMBER = new THREE.MeshStandardMaterial({ color: '#c9cdd2', metalness: 0.82, roughness: 0.38 });
const LINER = new THREE.MeshStandardMaterial({ color: '#d9dcd9', metalness: 0.05, roughness: 0.62 });
const LINER_DARK = new THREE.MeshStandardMaterial({ color: '#6e747c', metalness: 0.55, roughness: 0.5 });
const ANODISED = new THREE.MeshStandardMaterial({ color: '#9ba1a9', metalness: 0.75, roughness: 0.42 });
const SILICON = new THREE.MeshStandardMaterial({ color: '#50555e', metalness: 0.55, roughness: 0.28 });
const QUARTZ_RING = new THREE.MeshStandardMaterial({ color: '#e9ecef', metalness: 0, roughness: 0.2 });
const PUCK = new THREE.MeshStandardMaterial({ color: '#b9bcbf', metalness: 0.05, roughness: 0.35 });
const CABLE = new THREE.MeshStandardMaterial({ color: '#232427', metalness: 0.1, roughness: 0.7 });

// ───────────────────────────── geometry helpers ─────────────────────────────

/** Duplicate interior corners so a lathe profile gets crisp, faceted normals. */
function crisp(pts: V2[]): V2[] {
  const out: V2[] = [];
  pts.forEach((p, i) => {
    out.push(p);
    if (i > 0 && i < pts.length - 1) out.push(p);
  });
  return out;
}

/** A turned solid from a closed (r, y) section, optionally over a partial arc, with flat section faces. */
function latheParts(profile: V2[], phiStart: number, phiLen: number) {
  const pts = crisp([...profile, profile[0]]).map(([r, y]) => new THREE.Vector2(r, y));
  const segs = Math.max(6, Math.round((72 * phiLen) / TAU));
  const body = new THREE.LatheGeometry(pts, segs, phiStart, phiLen);
  if (phiLen >= TAU - 1e-6) return { body, caps: null };
  const shape = new THREE.Shape(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const a = new THREE.ShapeGeometry(shape);
  const b = a.clone();
  a.rotateY(phiStart - Math.PI / 2);
  b.rotateY(phiStart + phiLen - Math.PI / 2);
  const caps = mergeGeometries([a, b]);
  a.dispose();
  b.dispose();
  return { body, caps };
}

function Turned({
  profile,
  cut,
  arc,
  m = CHAMBER,
  capM = SECTION,
  position,
  castShadow = true,
}: {
  profile: V2[];
  cut?: [number, number] | null;
  arc?: [number, number];
  m?: MatKey | THREE.Material;
  capM?: THREE.Material;
  position?: V3;
  castShadow?: boolean;
}) {
  const [s, l] = arc ?? (cut ? [cut[0] + cut[1] / 2, TAU - cut[1]] : [0, TAU]);
  const key = JSON.stringify(profile) + s.toFixed(4) + l.toFixed(4);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { body, caps } = useMemo(() => latheParts(profile, s, l), [key]);
  return (
    <group position={position}>
      <mesh geometry={body} material={mat(m)} castShadow={castShadow} receiveShadow />
      {caps && <mesh geometry={caps} material={capM} receiveShadow />}
    </group>
  );
}

/** A tube along a polyline with rounded bends (gas lines, cables). */
function pipeGeometry(pts: V3[], r: number, bend: number) {
  const v = pts.map((p) => new THREE.Vector3(...p));
  const path = new THREE.CurvePath<THREE.Vector3>();
  let cur = v[0];
  for (let i = 1; i < v.length - 1; i++) {
    const a = v[i - 1];
    const b = v[i];
    const c = v[i + 1];
    const d1 = new THREE.Vector3().subVectors(b, a);
    const l1 = d1.length();
    d1.divideScalar(l1);
    const d2 = new THREE.Vector3().subVectors(c, b);
    const l2 = d2.length();
    d2.divideScalar(l2);
    const rr = Math.min(bend, l1 * 0.5, l2 * 0.5);
    const p1 = b.clone().addScaledVector(d1, -rr);
    const p2 = b.clone().addScaledVector(d2, rr);
    if (p1.distanceTo(cur) > 1e-5) path.add(new THREE.LineCurve3(cur, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, b, p2));
    cur = p2;
  }
  path.add(new THREE.LineCurve3(cur, v[v.length - 1]));
  return new THREE.TubeGeometry(path, Math.max(8, Math.ceil(path.getLength() / 0.01)), r, 10, false);
}

function Pipe({ pts, r = 0.005, bend = 0.035, m = 'steel' }: { pts: V3[]; r?: number; bend?: number; m?: MatKey | THREE.Material }) {
  const key = JSON.stringify(pts) + r + bend;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geo = useMemo(() => pipeGeometry(pts, r, bend), [key]);
  return <mesh geometry={geo} material={mat(m)} castShadow receiveShadow />;
}

/** Flat spiral (planar ICP) coil, or a helix when `rise` is set. */
function coilGeometry({ r0, r1, turns, y0, rise = 0, tube }: { r0: number; r1: number; turns: number; y0: number; rise?: number; tube: number }) {
  const pts: THREE.Vector3[] = [];
  const n = Math.ceil(turns * 64);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * TAU;
    const r = lerp(r0, r1, t);
    pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + rise * t, Math.sin(a) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, tube, 8, false);
}

/** Robot end effector: a thin ceramic fork, top face at y = 0. */
function bladeGeometry() {
  // tips end just past the far wafer edge (wafer centre at x = BLADE), so a retracted blade
  // stays inside the transfer chamber
  const s = new THREE.Shape();
  s.moveTo(-0.035, -0.032);
  s.lineTo(0.17, -0.032);
  s.lineTo(0.24, -0.056);
  s.lineTo(0.44, -0.056);
  s.quadraticCurveTo(0.455, -0.056, 0.455, -0.042);
  s.lineTo(0.455, -0.03);
  s.lineTo(0.3, -0.026);
  s.lineTo(0.3, 0.026);
  s.lineTo(0.455, 0.03);
  s.lineTo(0.455, 0.042);
  s.quadraticCurveTo(0.455, 0.056, 0.44, 0.056);
  s.lineTo(0.24, 0.056);
  s.lineTo(0.17, 0.032);
  s.lineTo(-0.035, 0.032);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  return g;
}

// ───────────────────────────── plasma glow (ray-marched volume) ─────────────────────────────

const PLASMA_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vC;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vC = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const PLASMA_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uI;
uniform float uR;
uniform float uH;
uniform float uTime;
uniform float uMode;
varying vec3 vW;
varying vec3 vC;

float dens(vec3 p) {
  float r = length(p.xz) / uR;
  float h = p.y / uH;
  if (r > 1.0 || h < 0.0 || h > 1.0) return 0.0;
  float d;
  if (uMode < 0.5) {
    // inductive: power absorbed in a ring under the coil, diffusing down to the wafer
    float ring = exp(-pow((r - 0.55) / 0.3, 2.0)) * exp(-pow((h - 0.78) / 0.24, 2.0));
    float bulk = (1.0 - smoothstep(0.5, 1.0, r)) * (0.55 + 0.45 * h);
    d = 0.8 * bulk + 0.45 * ring;
    d *= smoothstep(0.0, 0.07, h) * (1.0 - smoothstep(0.93, 1.0, h));
  } else if (uMode < 1.5) {
    // capacitive: a slab between two electrodes, dark sheaths at both
    d = (1.0 - smoothstep(0.86, 1.0, r)) * (0.75 + 0.5 * smoothstep(0.55, 0.9, r)) * smoothstep(0.08, 0.26, h) * (1.0 - smoothstep(0.74, 0.92, h));
  } else if (uMode < 2.5) {
    // source tube with a domed top
    float cyl = 0.72;
    if (h > cyl) {
      float q = (h - cyl) / (1.0 - cyl);
      if (r * r + q * q > 1.0) return 0.0;
    }
    d = (1.0 - smoothstep(0.5, 1.0, r)) * smoothstep(0.0, 0.15, h);
  } else {
    // weak downstream afterglow above the wafer
    d = (1.0 - smoothstep(0.55, 1.0, r)) * smoothstep(0.08, 0.35, h) * (0.45 + 0.55 * h);
  }
  float n = sin(p.x * 31.0 + uTime * 1.9) * sin(p.z * 27.0 - uTime * 1.3) * sin(p.y * 43.0 + uTime * 2.7);
  return d * (1.0 + 0.12 * n);
}

void main() {
  vec3 ro = cameraPosition - vC;
  vec3 rd = normalize(vW - cameraPosition);
  float ry = abs(rd.y) < 1e-5 ? 1e-5 : rd.y;
  float t0 = (0.0 - ro.y) / ry;
  float t1 = (uH - ro.y) / ry;
  float tn = min(t0, t1);
  float tf = max(t0, t1);
  float a = dot(rd.xz, rd.xz);
  float b = dot(ro.xz, rd.xz);
  float c = dot(ro.xz, ro.xz) - uR * uR;
  if (a > 1e-7) {
    float disc = b * b - a * c;
    if (disc <= 0.0) discard;
    float s = sqrt(disc);
    tn = max(tn, (-b - s) / a);
    tf = min(tf, (-b + s) / a);
  } else if (c > 0.0) {
    discard;
  }
  tn = max(tn, 0.0);
  if (tf <= tn) discard;
  const int N = 26;
  float dt = (tf - tn) / float(N);
  float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float acc = 0.0;
  for (int i = 0; i < N; i++) acc += dens(ro + rd * (tn + (float(i) + j) * dt));
  acc *= dt;
  gl_FragColor = vec4(uColor * acc * uI, 1.0);
}`;

function makePlasmaMaterial(mode: number, r: number, h: number) {
  return new THREE.ShaderMaterial({
    vertexShader: PLASMA_VERT,
    fragmentShader: PLASMA_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(0, 0, 0) },
      uI: { value: 0 },
      uR: { value: r },
      uH: { value: h },
      uTime: { value: 0 },
      uMode: { value: mode },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    toneMapped: false,
  });
}

interface GlowSpec {
  mode: number;
  r: number;
  y0: number;
  h: number;
  gain: number;
}

/** A glow volume (a bounding cylinder shaded by the ray-marching material). */
function PlasmaVolume({ spec, material }: { spec: GlowSpec; material: THREE.ShaderMaterial }) {
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(spec.r * 1.01, spec.r * 1.01, spec.h, 48, 1, false);
    g.translate(0, spec.h / 2, 0);
    return g;
  }, [spec]);
  return <mesh geometry={geo} material={material} position={[0, spec.y0, 0]} renderOrder={5} />;
}

// ───────────────────────────── recipes and process timeline ─────────────────────────────

type Station = 'out' | 'll' | 'pc';
interface Move {
  a: number;
  b: number;
  from: Station;
  to: Station;
}
type Chem = 'bt' | 'poly' | 'oe' | 'nit' | 'si' | 'oxide' | 'o2';
interface GlowWin {
  a: number;
  b: number;
  chem: Chem;
}
type Top = 'icp' | 'ccp' | 'ash';
interface Recipe {
  top: Top;
  start: Station;
  moves: Move[];
  plasma: GlowWin[];
  /** Robot heading before the first vacuum move. */
  th0: number;
}

const HEX: Record<Chem, number> = {
  bt: 0xa896ff, // CF4 breakthrough of the native oxide
  poly: 0x93a0ff, // Cl2/HBr main etch: pale blue-violet
  oe: 0xa7b2ff, // HBr/O2 over-etch, selective to the gate oxide
  nit: 0xa58fff, // CF4/CHF3 nitride open: bluish-purple
  si: 0x95a6ff, // Cl2/HBr/O2 silicon trench
  oxide: 0x9f88ff, // C4F8/Ar/O2 oxide etch: bluish-purple
  o2: 0xdce6ff, // O2 ash: pale bluish-white
};
/** Relative brightness: pale, whitish emission saturates sooner, so it is drawn dimmer. */
const GAIN: Record<Chem, number> = { bt: 1, poly: 1, oe: 1, nit: 1, si: 1, oxide: 1.05, o2: 0.5 };
// raw sRGB components for the shader (it writes display values directly)
const CHEM_RAW = Object.fromEntries(Object.entries(HEX).map(([k, h]) => [k, new THREE.Color().setHex(h, THREE.LinearSRGBColorSpace)])) as Record<Chem, THREE.Color>;
// colour-managed versions for built-in materials and lights
const CHEM_LIN = Object.fromEntries(Object.entries(HEX).map(([k, h]) => [k, new THREE.Color(h)])) as Record<Chem, THREE.Color>;

function recipe(r: Omit<Recipe, 'th0'>): Recipe {
  const first = r.moves.find((m) => m.from !== 'out' && m.to !== 'out');
  return { ...r, th0: first ? TH[first.from as 'll' | 'pc'] : TH.ll };
}

const RECIPES: Record<string, Recipe> = {
  // Lithography (0–0.42) happens in the litho cluster; the wafer arrives afterwards.
  'sti-etch': recipe({
    top: 'icp',
    start: 'out',
    moves: [
      { a: 0.43, b: 0.49, from: 'out', to: 'll' },
      { a: 0.49, b: 0.61, from: 'll', to: 'pc' },
      { a: 0.908, b: 0.99, from: 'pc', to: 'll' },
    ],
    plasma: [
      { a: 0.62, b: 0.655, chem: 'nit' },
      { a: 0.655, b: 0.73, chem: 'si' },
      { a: 0.78, b: 0.902, chem: 'o2' },
    ],
  }),
  'gate-etch': recipe({
    top: 'icp',
    start: 'll',
    moves: [
      { a: 0.05, b: 0.38, from: 'll', to: 'pc' },
      { a: 0.83, b: 0.995, from: 'pc', to: 'll' },
    ],
    plasma: [
      { a: 0.5, b: 0.54, chem: 'bt' },
      { a: 0.54, b: 0.72, chem: 'poly' },
      { a: 0.72, b: 0.78, chem: 'oe' },
    ],
  }),
  'contact-etch': recipe({
    top: 'ccp',
    start: 'll',
    moves: [
      { a: 0.05, b: 0.32, from: 'll', to: 'pc' },
      { a: 0.91, b: 0.995, from: 'pc', to: 'll' },
    ],
    plasma: [
      { a: 0.38, b: 0.71, chem: 'oxide' },
      { a: 0.77, b: 0.902, chem: 'o2' },
    ],
  }),
  strip: recipe({
    top: 'ash',
    start: 'll',
    moves: [
      { a: 0.05, b: 0.32, from: 'll', to: 'pc' },
      { a: 0.66, b: 0.94, from: 'pc', to: 'll' },
    ],
    plasma: [{ a: 0.36, b: 0.615, chem: 'o2' }],
  }),
};

interface FrameState {
  th: number;
  d: number;
  pinsPC: number;
  pinsLL: number;
  slitPC: number;
  slitLL: number;
  doorLL: number;
  ext: number;
  wx: number;
  wy: number;
  wz: number;
  wrot: number;
  wvis: boolean;
  glow: number;
  col: THREE.Color;
  colLin: THREE.Color;
}

const pinTop = (v: number) => PIN_LO + (PIN_UP - PIN_LO) * v;
const STN = {
  ll: { x: LLW[0], z: LLW[1], base: LL_PLATE, dist: R_LL },
  pc: { x: 0, z: 0, base: ESC_Y, dist: R_PC },
};

function atStation(f: FrameState, s: 'll' | 'pc', y: number) {
  f.wvis = true;
  f.wx = STN[s].x;
  f.wz = STN[s].z;
  f.wy = y;
  f.wrot = TH[s] - TH.pc;
}

/** Robot, lift pins and valves for a vacuum transfer A → B at local time u ∈ [0, 1]. */
function vacMove(u: number, A: 'll' | 'pc', B: 'll' | 'pc', thPrev: number, f: FrameState) {
  const thA = TH[A];
  const thB = TH[B];
  f.th = u < 0.1 ? lerp(thPrev, thA, smooth(u, 0, 0.1)) : u < 0.5 ? thA : lerp(thA, thB, smooth(u, 0.5, 0.6));
  const dA = STN[A].dist - BLADE;
  const dB = STN[B].dist - BLADE;
  f.d = D_RET + (dA - D_RET) * (smooth(u, 0.1, 0.26) - smooth(u, 0.34, 0.48)) + (dB - D_RET) * (smooth(u, 0.6, 0.76) - smooth(u, 0.84, 0.94));
  const vA = smooth(u, 0.03, 0.1) - smooth(u, 0.5, 0.56);
  const vB = smooth(u, 0.52, 0.59) - smooth(u, 0.95, 1);
  let pA: number;
  let pB: number;
  if (A === 'll') {
    pA = 1 - smooth(u, 0.26, 0.34) + smooth(u, 0.5, 0.56);
    pB = smooth(u, 0.76, 0.84) - smooth(u, 0.95, 1);
    f.pinsLL = pA;
    f.pinsPC = pB;
    f.slitLL = vA;
    f.slitPC = vB;
  } else {
    pA = smooth(u, 0.03, 0.1) - smooth(u, 0.26, 0.34);
    pB = 1 - smooth(u, 0.52, 0.59) + smooth(u, 0.76, 0.84);
    f.pinsPC = pA;
    f.pinsLL = pB;
    f.slitPC = vA;
    f.slitLL = vB;
  }
  if (u < 0.26) atStation(f, A, Math.max(STN[A].base, pinTop(pA)));
  else if (u < 0.34) atStation(f, A, Math.max(XFER_Y, pinTop(pA)));
  else if (u < 0.76) {
    f.wvis = true;
    const r = f.d + BLADE;
    f.wx = HUB[0] + dx(f.th) * r;
    f.wz = HUB[1] + dz(f.th) * r;
    f.wy = XFER_Y;
    f.wrot = f.th - TH.pc;
  } else if (u < 0.84) atStation(f, B, Math.max(XFER_Y, pinTop(pB)));
  else atStation(f, B, Math.max(STN[B].base, pinTop(pB)));
}

function onExtBlade(f: FrameState, e: number) {
  f.wvis = e > 0.015;
  f.wx = LLW[0] + dx(TH.ll) * (1 - e) * EXT_LEN;
  f.wz = LLW[1] + dz(TH.ll) * (1 - e) * EXT_LEN;
  f.wy = XFER_Y;
  f.wrot = TH.ll - TH.pc;
}

/** The EFEM blade passes the wafer through the load lock's outer door. */
function atmMove(u: number, inward: boolean, f: FrameState) {
  f.doorLL = smooth(u, 0, 0.12) - smooth(u, 0.88, 1);
  if (inward) {
    f.ext = smooth(u, 0.12, 0.42) - smooth(u, 0.6, 0.86);
    f.pinsLL = 1 - smooth(u, 0, 0.1) + smooth(u, 0.44, 0.58);
    if (u < 0.44) onExtBlade(f, f.ext);
    else atStation(f, 'll', Math.max(XFER_Y, pinTop(f.pinsLL)));
  } else {
    f.ext = smooth(u, 0.12, 0.38) - smooth(u, 0.56, 0.86);
    f.pinsLL = 1 - smooth(u, 0.4, 0.54) + smooth(u, 0.88, 0.98);
    if (u < 0.4) atStation(f, 'll', pinTop(f.pinsLL));
    else if (u < 0.54) atStation(f, 'll', Math.max(XFER_Y, pinTop(f.pinsLL)));
    else onExtBlade(f, f.ext);
  }
}

function simulate(p: number, R: Recipe, f: FrameState) {
  f.pinsPC = 0;
  f.pinsLL = 1;
  f.slitPC = 0;
  f.slitLL = 0;
  f.doorLL = 0;
  f.ext = 0;
  f.th = R.th0;
  f.d = D_RET;
  let loc: Station = R.start;
  let th = R.th0;
  let active = false;
  for (let i = 0; i < R.moves.length; i++) {
    const m = R.moves[i];
    if (p < m.a) break;
    const vac = m.from !== 'out' && m.to !== 'out';
    if (p >= m.b) {
      loc = m.to;
      if (vac) th = TH[m.to as 'll' | 'pc'];
      continue;
    }
    const u = (p - m.a) / (m.b - m.a);
    f.th = th;
    if (vac) vacMove(u, m.from as 'll' | 'pc', m.to as 'll' | 'pc', th, f);
    else atmMove(u, m.from === 'out', f);
    active = true;
    break;
  }
  if (!active) {
    f.th = th;
    if (loc === 'out') f.wvis = false;
    else atStation(f, loc, loc === 'pc' ? ESC_Y : pinTop(1));
  }
  // plasma: windows that share a boundary cross-fade, so the glow stays lit between recipe steps
  f.glow = 0;
  f.col.setRGB(0, 0, 0);
  f.colLin.setRGB(0, 0, 0);
  let w = 0;
  const ramp = 0.005;
  for (let i = 0; i < R.plasma.length; i++) {
    const g = R.plasma[i];
    const e = seg(p, g.a - ramp, g.a + ramp) * (1 - seg(p, g.b - ramp, g.b + ramp));
    if (e <= 0) continue;
    const cr = CHEM_RAW[g.chem];
    const cl = CHEM_LIN[g.chem];
    const k = e * GAIN[g.chem];
    f.col.r += cr.r * k;
    f.col.g += cr.g * k;
    f.col.b += cr.b * k;
    f.colLin.r += cl.r * k;
    f.colLin.g += cl.g * k;
    f.colLin.b += cl.b * k;
    w += e;
  }
  if (w > 0) {
    f.col.multiplyScalar(1 / w);
    f.colLin.multiplyScalar(1 / w);
  }
  f.glow = Math.min(1, w);
}

/** SCARA inverse kinematics: wrist at signed distance d along heading th, blade along th. */
function ik(th: number, d: number, out: { b: number; e: number; w: number }) {
  const dist = Math.max(0.02, Math.abs(d));
  const ang = d >= 0 ? th : th + Math.PI;
  const c = Math.max(-1, Math.min(1, (dist * dist - L1 * L1 - L2 * L2) / (2 * L1 * L2)));
  const e = Math.acos(c);
  const alpha = Math.atan2(L2 * Math.sin(e), L1 + L2 * Math.cos(e));
  out.b = ang - alpha;
  out.e = e;
  out.w = th - out.b - out.e;
}

// ───────────────────────────── parts ─────────────────────────────

/** A slit valve: a housing around a slot and a gate that drops to open (local +x = passage). */
function SlitValve({ length, gate, bonnet = true }: { length: number; gate: React.RefObject<THREE.Mesh | null>; bonnet?: boolean }) {
  const yc = 1.01;
  return (
    <group>
      <Box size={[length, 0.032, 0.46]} position={[length / 2, yc + 0.051, 0]} m="aluminum" radius={0.006} />
      <Box size={[length, 0.03, 0.46]} position={[length / 2, yc - 0.05, 0]} m="aluminum" radius={0.006} />
      <Box size={[length, 0.07, 0.05]} position={[length / 2, yc, 0.205]} m="aluminum" radius={0.006} />
      <Box size={[length, 0.07, 0.05]} position={[length / 2, yc, -0.205]} m="aluminum" radius={0.006} />
      {bonnet && <Box size={[length * 0.7, 0.08, 0.4]} position={[length / 2, yc - 0.105, 0]} m="black" radius={0.008} />}
      <mesh ref={gate} position={[length / 2, yc, 0]} castShadow>
        <boxGeometry args={[0.014, 0.066, 0.36]} />
        <meshStandardMaterial color="#aeb3ba" metalness={0.9} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Pins({ refs, r = 0.09, entry, both = false }: { refs: React.RefObject<(THREE.Mesh | null)[]>; r?: number; entry: number; both?: boolean }) {
  // Pins sit clear of the blade: one on the far side of the entry axis, two at ±60° off it.
  // Where forks enter from both ends (load lock), four pins sit off-axis instead.
  const angles = both ? [0.25, 0.75, 1.25, 1.75].map((k) => entry + k * Math.PI) : [entry + Math.PI, entry + Math.PI / 3, entry - Math.PI / 3];
  return (
    <group>
      {angles.map((a, i) => (
        <mesh
          key={i}
          ref={(m) => {
            if (refs.current) refs.current[i] = m;
          }}
          position={[Math.sin(a) * r, PIN_LO - 0.025, Math.cos(a) * r]}
          material={MAT.ceramic}
        >
          <cylinderGeometry args={[0.0032, 0.0032, 0.05, 10]} />
        </mesh>
      ))}
    </group>
  );
}

/** Electrostatic chuck (or a plain heater for the asher) on a cathode held by three spokes. */
function Pedestal({ kind, cut, pins }: { kind: 'esc' | 'heater'; cut: [number, number] | null; pins: React.RefObject<(THREE.Mesh | null)[]> }) {
  return (
    <group>
      {/* cathode body, bias feed and spokes to the wall */}
      <Turned profile={[[0, 0.88], [0.19, 0.88], [0.19, 0.965], [0, 0.965]]} cut={cut} m="aluminum" />
      <Turned profile={[[0.19, 0.9], [0.202, 0.9], [0.202, 0.992], [0.19, 0.992]]} cut={cut} m={LINER} />
      {[Math.PI * 0.55, Math.PI * 1.25, Math.PI * 1.9].map((a) => (
        <Box key={a} size={[0.07, 0.04, 0.05]} position={[Math.sin(a) * 0.226, 0.905, Math.cos(a) * 0.226]} rotation={[0, a + Math.PI / 2, 0]} m="aluminum" radius={0.006} />
      ))}
      {kind === 'esc' ? (
        <>
          {/* ceramic puck (the clamping electrode is buried in it) and the edge ring */}
          <Turned profile={[[0, 0.965], [0.147, 0.965], [0.147, ESC_Y], [0, ESC_Y]]} cut={cut} m={PUCK} />
          <Turned
            profile={[[0.148, 0.97], [0.19, 0.97], [0.19, 1.0035], [0.158, 1.0035], [0.155, 0.998], [0.148, 0.998]]}
            cut={cut}
            m={QUARTZ_RING}
          />
        </>
      ) : (
        <Turned profile={[[0, 0.965], [0.17, 0.965], [0.17, ESC_Y], [0, ESC_Y]]} cut={cut} m="aluminum" />
      )}
      <Pins refs={pins} entry={SLIT_PHI} />
    </group>
  );
}

/** Chamber body: floor with pump port, wall with the slit opening, top flange, anodised liner. */
function ChamberBody({ cut, slit = true }: { cut: [number, number] | null; slit?: boolean }) {
  const [s, l] = cut ? [cut[0] + cut[1] / 2, TAU - cut[1]] : [0, TAU];
  const half = 0.7;
  const e = s + l;
  const band: V2[] = [[0.25, 0.975], [0.27, 0.975], [0.27, 1.045], [0.25, 1.045]];
  const bandLiner: V2[] = [[0.244, 0.975], [0.25, 0.975], [0.25, 1.045], [0.244, 1.045]];
  const arcs: [number, number][] = slit
    ? ([
        [s, SLIT_PHI - half - s],
        [SLIT_PHI + half, e - (SLIT_PHI + half)],
      ] as [number, number][]).filter(([, len]) => len > 0.01)
    : [[s, l]];
  return (
    <group>
      <Turned profile={[[0.17, 0.8], [0.3, 0.8], [0.3, 0.83], [0.27, 0.83], [0.27, 0.975], [0.25, 0.975], [0.25, 0.82], [0.17, 0.82]]} arc={[s, l]} />
      {arcs.map((a, i) => (
        <group key={i}>
          <Turned profile={band} arc={a} />
          <Turned profile={bandLiner} arc={a} m={LINER_DARK} castShadow={false} />
        </group>
      ))}
      <Turned profile={[[0.25, 1.045], [0.27, 1.045], [0.27, 1.18], [0.3, 1.18], [0.3, 1.2], [0.25, 1.2]]} arc={[s, l]} />
      {/* replaceable anodised liner on the inside of the wall */}
      <Turned profile={[[0.244, 0.83], [0.25, 0.83], [0.25, 0.975], [0.244, 0.975]]} arc={[s, l]} m={LINER_DARK} castShadow={false} />
      <Turned profile={[[0.244, 1.045], [0.25, 1.045], [0.25, 1.2], [0.244, 1.2]]} arc={[s, l]} m={LINER_DARK} castShadow={false} />
    </group>
  );
}

function IcpTop({ cut, closed = false }: { cut: [number, number] | null; closed?: boolean }) {
  const coil = useMemo(() => coilGeometry({ r0: 0.075, r1: 0.215, turns: 2.25, y0: 1.24, tube: 0.0065 }), []);
  return (
    <group>
      {/* ceramic window */}
      <Turned profile={[[0, 1.2], [0.285, 1.2], [0.285, 1.228], [0, 1.228]]} cut={cut} m="ceramic" />
      <Cyl r={0.016} h={0.024} position={[0, 1.19, 0]} m={LINER} />
      <Cyl r={0.007} h={0.006} position={[0, 1.176, 0]} m="ceramicGray" />
      {/* flat spiral coil and its leads */}
      {!closed && (
        <>
          <mesh geometry={coil} material={MAT.copper} castShadow />
          <Cyl r={0.0065} h={0.17} position={[0.075, 1.325, 0]} m="copper" seg={10} />
          <Cyl r={0.0065} h={0.17} position={[Math.cos(2.25 * TAU) * 0.215, 1.325, Math.sin(2.25 * TAU) * 0.215]} m="copper" seg={10} />
        </>
      )}
      {/* RF enclosure over the coil, and the matching network */}
      <Turned profile={[[0.27, 1.228], [0.29, 1.228], [0.29, 1.42], [0, 1.42], [0, 1.405], [0.27, 1.405]]} cut={cut} m="aluminum" />
      <Box size={[0.3, 0.15, 0.26]} position={[0, 1.495, -0.02]} m="panel" radius={0.012} />
      <Box size={[0.302, 0.02, 0.262]} position={[0, 1.44, -0.02]} m="panelGray" radius={0.004} />
      <Cyl r={0.022} h={0.04} position={[0.09, 1.59, -0.06]} m="black" />
    </group>
  );
}

function CcpTop({ cut }: { cut: [number, number] | null }) {
  return (
    <group>
      {/* lid, showerhead backing plate (with its gas plenum) and silicon upper electrode */}
      <Turned profile={[[0, 1.2], [0.3, 1.2], [0.3, 1.245], [0, 1.245]]} cut={cut} m="aluminum" />
      <Turned profile={[[0, 1.135], [0.2, 1.135], [0.2, 1.2], [0, 1.2]]} cut={cut} m="aluminum" />
      <Turned profile={[[0, 1.158], [0.18, 1.158], [0.18, 1.166], [0, 1.166]]} cut={cut ? [cut[0], cut[1] - 0.012] : null} m="black" capM={MAT.black} castShadow={false} />
      <Turned profile={[[0, 1.12], [0.198, 1.12], [0.198, 1.135], [0, 1.135]]} cut={cut} m={SILICON} />
      <Turned profile={[[0.2, 1.12], [0.232, 1.12], [0.232, 1.2], [0.2, 1.2]]} cut={cut} m={LINER} />
      {/* quartz confinement rings around the gap */}
      {[1.03, 1.057, 1.084].map((y) => (
        <Turned key={y} profile={[[0.212, y], [0.24, y], [0.24, y + 0.005], [0.212, y + 0.005]]} cut={cut} m={QUARTZ_RING} />
      ))}
      {[0, 2.1, 4.2].map((a) => (
        <Cyl key={a} r={0.004} h={0.09} position={[Math.sin(a + 1) * 0.236, 1.075, Math.cos(a + 1) * 0.236]} m="ceramicGray" />
      ))}
      {/* RF feed and match box */}
      <Cyl r={0.035} h={0.06} position={[0, 1.275, 0]} m="steelSatin" />
      <Box size={[0.3, 0.14, 0.26]} position={[0, 1.375, -0.02]} m="panel" radius={0.012} />
      <Box size={[0.302, 0.02, 0.262]} position={[0, 1.315, -0.02]} m="panelGray" radius={0.004} />
    </group>
  );
}

function AshTop({ cut }: { cut: [number, number] | null }) {
  const coil = useMemo(() => coilGeometry({ r0: 0.142, r1: 0.142, turns: 3, y0: 1.27, rise: 0.13, tube: 0.0065 }), []);
  const dome: V2[] = useMemo(() => {
    const out: V2[] = [[0.12, 1.24], [0.12, 1.4]];
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * (Math.PI / 2);
      out.push([Math.cos(a) * 0.12, 1.4 + Math.sin(a) * 0.075]);
    }
    return out;
  }, []);
  const domeGeo = useMemo(() => new THREE.LatheGeometry(dome.map(([r, y]) => new THREE.Vector2(r, y)), 64), [dome]);
  return (
    <group>
      <Turned profile={[[0.125, 1.2], [0.3, 1.2], [0.3, 1.24], [0.125, 1.24]]} cut={cut} m="aluminum" />
      {/* baffle that keeps ions in the source and lets radicals through */}
      <Turned profile={[[0, 1.112], [0.24, 1.112], [0.24, 1.12], [0, 1.12]]} cut={cut} m="aluminum" />
      {[0.06, 0.12, 0.18].map((r) => (
        <mesh key={r} position={[0, 1.1115, 0]} rotation={[Math.PI / 2, 0, 0]} material={MAT.black}>
          <ringGeometry args={[r - 0.004, r, 48]} />
        </mesh>
      ))}
      {/* quartz source tube, helical coil and Faraday cage posts */}
      <mesh geometry={domeGeo} material={MAT.quartz} renderOrder={2} />
      <mesh geometry={coil} material={MAT.copper} castShadow />
      {[0.6, 2.2, 3.8, 5.4].map((a) => (
        <Cyl key={a} r={0.008} h={0.28} position={[Math.sin(a) * 0.19, 1.38, Math.cos(a) * 0.19]} m="steelSatin" />
      ))}
      <Turned profile={[[0.17, 1.515], [0.2, 1.515], [0.2, 1.53], [0.17, 1.53]]} m="steelSatin" />
      <Cyl r={0.02} h={0.05} position={[0, 1.495, 0]} m="steel" />
      <Box size={[0.22, 0.14, 0.18]} position={[0.02, 1.32, -0.3]} m="panel" radius={0.012} />
      <Pipe pts={[[0.08, 1.3, -0.21], [0.08, 1.3, -0.16], [0.1, 1.3, -0.1]]} r={0.005} m="copper" />
    </group>
  );
}

function setupBlades(mesh: THREE.InstancedMesh | null, stator: boolean, nStage: number, nBlade: number) {
  if (!mesh || mesh.userData.done) return;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (let s = 0; s < nStage; s++)
    for (let i = 0; i < nBlade; i++) {
      e.set(stator ? -0.42 : 0.42, (i / nBlade) * TAU + s * 0.4, 0, 'YXZ');
      pos.set(0, 0.47 + s * 0.035 + (stator ? 0.0175 : 0), 0);
      mesh.setMatrixAt(k++, m4.compose(pos, q.setFromEuler(e), one));
    }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.done = true;
}

function TurboPump({ cut, rotor }: { cut: [number, number] | null; rotor?: React.RefObject<THREE.Group | null> }) {
  const blades = useMemo(() => {
    const g = new THREE.BoxGeometry(0.084, 0.0016, 0.013);
    g.translate(0.056 + 0.042, 0, 0);
    return g;
  }, []);
  const nStage = 6;
  const nBlade = 22;
  return (
    <group>
      {/* inlet flange, bladed stage housing, finned motor section */}
      <Turned profile={[[0.15, 0.44], [0.16, 0.44], [0.16, 0.68], [0.19, 0.68], [0.19, 0.72], [0.15, 0.72]]} cut={cut} m="aluminum" />
      <Turned profile={[[0, 0.33], [0.13, 0.33], [0.14, 0.34], [0.14, 0.44], [0, 0.44]]} cut={cut} m="steelSatin" />
      {[0.35, 0.37, 0.39, 0.41, 0.43].map((y) => (
        <Turned key={y} profile={[[0.14, y - 0.004], [0.168, y - 0.004], [0.168, y + 0.004], [0.14, y + 0.004]]} cut={cut} m="aluminum" />
      ))}
      {cut && (
        <>
          <group ref={rotor}>
            <Cyl r={0.055} h={0.24} position={[0, 0.56, 0]} m="steel" />
            <instancedMesh ref={(m) => setupBlades(m, false, nStage, nBlade)} args={[blades, MAT.steelDark, nStage * nBlade]} castShadow />
          </group>
          {Array.from({ length: nStage }, (_, i) => (
            <Turned key={i} profile={[[0.1, 0.4855 + i * 0.035], [0.15, 0.4855 + i * 0.035], [0.15, 0.4895 + i * 0.035], [0.1, 0.4895 + i * 0.035]]} cut={cut} m="steelDark" />
          ))}
        </>
      )}
      <Box size={[0.1, 0.12, 0.14]} position={[0, 0.39, -0.2]} m="black" radius={0.01} />
    </group>
  );
}

/** Support frame, pendulum valve and turbo pump under a chamber. */
function Undercarriage({ cut, rotor }: { cut: [number, number] | null; rotor?: React.RefObject<THREE.Group | null> }) {
  return (
    <group>
      {[
        [0.27, 0.27],
        [-0.27, 0.27],
        [0.27, -0.27],
        [-0.27, -0.27],
      ].map(([x, z]) => (
        <Box key={`${x}${z}`} size={[0.04, 0.78, 0.04]} position={[x, 0.39, z]} m="steelSatin" radius={0.004} />
      ))}
      {[-0.27, 0.27].map((z) => (
        <Box key={`bx${z}`} size={[0.58, 0.03, 0.04]} position={[0, 0.785, z]} m="steelSatin" radius={0.004} />
      ))}
      {[-0.27, 0.27].map((x) => (
        <Box key={`bz${x}`} size={[0.04, 0.03, 0.58]} position={[x, 0.785, 0]} m="steelSatin" radius={0.004} />
      ))}
      {/* pendulum valve body (the gate swings sideways into the wide end) */}
      <Box size={[0.5, 0.07, 0.36]} position={[-0.07, 0.765, -0.02]} m="aluminum" radius={0.03} />
      <Cyl r={0.045} h={0.06} position={[-0.26, 0.83, -0.02]} m="black" />
      <TurboPump cut={cut} rotor={rotor} />
      {/* foreline to the dry pump in the sub-fab */}
      <Pipe pts={[[-0.13, 0.38, 0.02], [-0.33, 0.38, 0.02], [-0.33, 0.38, -0.34], [-0.33, 0.02, -0.34]]} r={0.022} bend={0.06} m="steelSatin" />
    </group>
  );
}

function OesViewport({ glow }: { glow: React.RefObject<THREE.MeshBasicMaterial | null> }) {
  const phi = 1.95;
  return (
    <group rotation={[0, phi, 0]}>
      <Cyl r={0.034} h={0.05} position={[0, 1.1, 0.29]} rotation={[Math.PI / 2, 0, 0]} m="steelSatin" />
      <Cyl r={0.04} h={0.012} position={[0, 1.1, 0.314]} rotation={[Math.PI / 2, 0, 0]} m="steel" />
      <mesh position={[0, 1.1, 0.3205]}>
        <circleGeometry args={[0.022, 32]} />
        <meshBasicMaterial ref={glow} color="#000000" toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.1, 0.3215]} material={MAT.glassDark}>
        <circleGeometry args={[0.024, 32]} />
      </mesh>
      {/* fibre to the emission spectrometer used for endpoint detection */}
      <Pipe pts={[[0.03, 1.1, 0.33], [0.06, 1.1, 0.36], [0.06, 0.86, 0.36], [0.06, 0.66, 0.34]]} r={0.0035} bend={0.05} m={CABLE} />
      <Box size={[0.1, 0.07, 0.05]} position={[0.06, 0.63, 0.33]} m="black" radius={0.006} />
    </group>
  );
}

function Robot({ b, e, w }: { b: React.RefObject<THREE.Group | null>; e: React.RefObject<THREE.Group | null>; w: React.RefObject<THREE.Group | null> }) {
  const blade = useMemo(bladeGeometry, []);
  return (
    <group position={[HUB[0], 0, HUB[1]]}>
      <Cyl r={0.1} h={ARM_Y - 0.009 - DECK_Y} position={[0, (ARM_Y - 0.009 + DECK_Y) / 2, 0]} m="panel" />
      <group ref={b} position={[0, ARM_Y, 0]}>
        <Cyl r={0.05} h={0.02} m="steelSatin" />
        <Box size={[L1 + 0.08, 0.018, 0.075]} position={[L1 / 2, 0, 0]} m="aluminum" radius={0.009} />
        <group ref={e} position={[L1, 0.017, 0]}>
          <Cyl r={0.034} h={0.016} m="steelSatin" />
          <Box size={[L2 + 0.06, 0.014, 0.06]} position={[L2 / 2, 0, 0]} m="aluminum" radius={0.007} />
          <group ref={w} position={[L2, 0.013, 0]}>
            <Cyl r={0.027} h={0.012} m="steelSatin" />
            <mesh geometry={blade} material={MAT.ceramic} position={[0, XFER_Y - (ARM_Y + 0.03), 0]} castShadow />
          </group>
        </group>
      </group>
    </group>
  );
}

/** One face of the transfer chamber: a wall with a slit opening, or a low cut-away wall. */
function Face({ rot, slit }: { rot: number; slit: boolean }) {
  const H = 1.12;
  const y0 = DECK_Y;
  return (
    <group rotation={[0, rot, 0]}>
      {slit ? (
        <>
          <Box size={[0.04, H - y0, 0.38]} position={[0.54, (H + y0) / 2, 0.37]} m={ANODISED} radius={0.005} />
          <Box size={[0.04, H - y0, 0.38]} position={[0.54, (H + y0) / 2, -0.37]} m={ANODISED} radius={0.005} />
          <Box size={[0.04, 0.975 - y0, 0.36]} position={[0.54, (0.975 + y0) / 2, 0]} m={ANODISED} radius={0.005} />
          <Box size={[0.04, H - 1.045, 0.36]} position={[0.54, (H + 1.045) / 2, 0]} m={ANODISED} radius={0.005} />
        </>
      ) : (
        <Box size={[0.04, 0.975 - y0, 1.12]} position={[0.54, (0.975 + y0) / 2, 0]} m={ANODISED} radius={0.005} />
      )}
    </group>
  );
}

/** Transfer chamber (open at the front, cut away), load lock and EFEM. */
function TransferModule({
  slitLL,
  doorLL,
  slitPC2,
  pinsLL,
  extBlade,
}: {
  slitLL: React.RefObject<THREE.Mesh | null>;
  doorLL: React.RefObject<THREE.Mesh | null>;
  slitPC2: React.RefObject<THREE.Mesh | null>;
  pinsLL: React.RefObject<(THREE.Mesh | null)[]>;
  extBlade: React.RefObject<THREE.Group | null>;
}) {
  const blade = useMemo(bladeGeometry, []);
  return (
    <group position={[HUB[0], 0, HUB[1]]}>
      {/* mainframe plinth under the transfer chamber and load lock */}
      <Box size={[1.62, DECK_Y - 0.08, 1.16]} position={[-0.23, 0.04 + (DECK_Y - 0.08) / 2, 0]} m="panelGray" radius={0.02} />
      <Box size={[1.6, 0.08, 1.14]} position={[-0.23, 0.04, 0]} m="panelDark" radius={0.01} />
      {[-0.62, -0.08, 0.3].map((x) => (
        <Box key={x} size={[0.008, 0.78, 0.01]} position={[x, 0.47, 0.581]} m="panelDark" radius={0.002} castShadow={false} />
      ))}
      <Box size={[0.3, 0.16, 0.012]} position={[0.1, 0.62, 0.582]} m="glassDark" radius={0.004} castShadow={false} />
      <Box size={[1.12, 0.03, 1.12]} position={[0, DECK_Y - 0.015, 0]} m="aluminum" radius={0.006} />
      <Face rot={0} slit />
      <Face rot={Math.PI} slit />
      <Face rot={Math.PI / 2} slit />
      <Face rot={-Math.PI / 2} slit={false} />
      <Box size={[0.07, 1.12 - DECK_Y, 0.07]} position={[0.53, (1.12 + DECK_Y) / 2, -0.53]} m={ANODISED} radius={0.01} />
      <Box size={[0.07, 1.12 - DECK_Y, 0.07]} position={[-0.53, (1.12 + DECK_Y) / 2, -0.53]} m={ANODISED} radius={0.01} />
      {/* slit valve to the second (closed) process chamber, at the back */}
      <group position={[0, 0, -0.56]} rotation={[0, Math.PI / 2, 0]}>
        <SlitValve length={R_PC - 0.27 - 0.56 + 0.004} gate={slitPC2} />
      </group>
      {/* load lock: its local +z points away from the transfer chamber */}
      <group position={[-R_LL, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <group position={[0, 0, -0.24]} rotation={[0, -Math.PI / 2, 0]}>
          <SlitValve length={0.03} gate={slitLL} bonnet={false} />
        </group>
        <Box size={[0.5, 0.055, 0.42]} position={[0, LL_PLATE - 0.0275, 0]} m="aluminum" radius={0.006} />
        <Box size={[0.04, 0.1, 0.42]} position={[-0.23, LL_PLATE + 0.05, 0]} m="aluminum" radius={0.005} />
        <Box size={[0.04, 0.1, 0.42]} position={[0.23, LL_PLATE + 0.05, 0]} m="aluminum" radius={0.005} />
        <Box size={[0.46, 0.01, 0.4]} position={[0, LL_PLATE + 0.105, 0]} m="glassDark" radius={0.003} castShadow={false} />
        <Box size={[0.5, 0.016, 0.03]} position={[0, LL_PLATE + 0.106, -0.195]} m="aluminum" radius={0.004} />
        <Box size={[0.5, 0.016, 0.03]} position={[0, LL_PLATE + 0.106, 0.195]} m="aluminum" radius={0.004} />
        <Pins refs={pinsLL} entry={Math.PI} r={0.1} both />
        <Box size={[0.3, 0.04, 0.3]} position={[0, LL_PLATE - 0.075, 0]} m="black" radius={0.006} />
        <group position={[0, 0, 0.21]} rotation={[0, -Math.PI / 2, 0]}>
          <SlitValve length={0.05} gate={doorLL} bonnet={false} />
        </group>
        {/* equipment front end (atmospheric robot inside) */}
        <Box size={[1.0, 1.28, 0.46]} position={[0, 0.64, 0.49]} m="panel" radius={0.02} />
        <Box size={[1.0, 0.1, 0.46]} position={[0, 1.33, 0.49]} m="panelGray" radius={0.02} />
        <Box size={[0.012, 0.3, 0.3]} position={[0.502, 1.02, 0.49]} m="glassDark" radius={0.004} castShadow={false} />
        <group ref={extBlade} visible={false}>
          <mesh geometry={blade} material={MAT.ceramicGray} rotation={[0, Math.PI / 2, 0]} position={[0, XFER_Y, BLADE]} />
        </group>
      </group>
    </group>
  );
}

/** A second process chamber on the cluster, closed. */
function SideChamber() {
  return (
    <group position={[PC2[0], 0, PC2[1]]}>
      <ChamberBody cut={null} slit={false} />
      <IcpTop cut={null} closed />
      <Undercarriage cut={null} />
    </group>
  );
}

function StatusTower({ R, position }: { R: Recipe; position: V3 }) {
  const b = useProgressBucket(200);
  const on = R.plasma.some((g) => b >= g.a && b < g.b);
  return <LightTower position={position} on={on ? 'violet' : 'green'} />;
}

// ───────────────────────────── scene ─────────────────────────────

const GLOWS: Record<Top, GlowSpec[]> = {
  icp: [{ mode: 0, r: 0.236, y0: 1.006, h: 0.19, gain: 4.2 }],
  ccp: [{ mode: 1, r: 0.226, y0: 1.004, h: 0.114, gain: 7 }],
  ash: [
    { mode: 2, r: 0.108, y0: 1.242, h: 0.23, gain: 6.5 },
    { mode: 3, r: 0.235, y0: 1.005, h: 0.106, gain: 4.5 },
  ],
};

export default function Etch({ variant }: ToolProps) {
  const state = useSimState();
  const { id } = useStep();
  const R = RECIPES[id] ?? (variant === 'ash' ? RECIPES.strip : RECIPES['gate-etch']);
  const top = R.top;
  const cut = CUT;

  const wafer = useRef<THREE.Group>(null);
  const jb = useRef<THREE.Group>(null);
  const je = useRef<THREE.Group>(null);
  const jw = useRef<THREE.Group>(null);
  const slitPC = useRef<THREE.Mesh>(null);
  const slitLL = useRef<THREE.Mesh>(null);
  const doorLL = useRef<THREE.Mesh>(null);
  const slitPC2 = useRef<THREE.Mesh>(null);
  const pinsPC = useRef<(THREE.Mesh | null)[]>([]);
  const pinsLL = useRef<(THREE.Mesh | null)[]>([]);
  const extBlade = useRef<THREE.Group>(null);
  const rotor1 = useRef<THREE.Group>(null);
  const glowMats = useMemo(
    () =>
      GLOWS[top].map((g) => {
        const m = makePlasmaMaterial(g.mode, g.r, g.h);
        m.userData.gain = g.gain;
        return m;
      }),
    [top],
  );
  useEffect(() => () => glowMats.forEach((m) => m.dispose()), [glowMats]);
  const viewGlow = useRef<THREE.MeshBasicMaterial>(null);

  const f = useMemo<FrameState>(
    () => ({
      th: 0,
      d: D_RET,
      pinsPC: 0,
      pinsLL: 1,
      slitPC: 0,
      slitLL: 0,
      doorLL: 0,
      ext: 0,
      wx: 0,
      wy: ESC_Y,
      wz: 0,
      wrot: 0,
      wvis: false,
      glow: 0,
      col: new THREE.Color(),
      colLin: new THREE.Color(),
    }),
    [],
  );
  const joints = useMemo(() => ({ b: 0, e: 0, w: 0 }), []);

  useProgressFrame((p, t) => {
    simulate(p, R, f);
    ik(f.th, f.d, joints);
    if (jb.current) jb.current.rotation.y = joints.b;
    if (je.current) je.current.rotation.y = joints.e;
    if (jw.current) jw.current.rotation.y = joints.w;
    if (wafer.current) {
      wafer.current.visible = f.wvis;
      wafer.current.position.set(f.wx, f.wy, f.wz);
      wafer.current.rotation.y = f.wrot;
    }
    if (slitPC.current) slitPC.current.position.y = 1.01 - 0.085 * f.slitPC;
    if (slitLL.current) slitLL.current.position.y = 1.01 - 0.085 * f.slitLL;
    if (doorLL.current) doorLL.current.position.y = 1.01 - 0.085 * f.doorLL;
    if (slitPC2.current) slitPC2.current.position.y = 1.01;
    for (let i = 0; i < 4; i++) {
      const a = pinsPC.current[i];
      const b = pinsLL.current[i];
      if (a) a.position.y = pinTop(f.pinsPC) - 0.025;
      if (b) b.position.y = pinTop(f.pinsLL) - 0.025;
    }
    if (extBlade.current) {
      extBlade.current.visible = f.ext > 0.01;
      extBlade.current.position.z = (1 - f.ext) * EXT_LEN;
    }
    if (rotor1.current) rotor1.current.rotation.y = t * 2.2;
    // plasma: real visible light, with a gentle flicker
    const flick = 1 + 0.03 * Math.sin(t * 23.1) + 0.02 * Math.sin(t * 57.7 + 1.3);
    const I = f.glow * flick;
    for (let i = 0; i < glowMats.length; i++) {
      const m = glowMats[i];
      m.uniforms.uI.value = I * (m.userData.gain as number);
      (m.uniforms.uColor.value as THREE.Color).copy(f.col);
      m.uniforms.uTime.value = t;
    }
    if (viewGlow.current) viewGlow.current.color.copy(f.colLin).multiplyScalar(0.9 * I);
  });

  const gas: V3[] =
    top === 'icp'
      ? [[0.5, 1.6, -0.5], [0.5, 1.68, -0.5], [0.05, 1.68, -0.5], [0.05, 1.33, -0.5], [0.05, 1.33, -0.29]]
      : top === 'ccp'
        ? [[0.5, 1.6, -0.5], [0.5, 1.66, -0.5], [0.06, 1.66, -0.5], [0.06, 1.3, -0.5], [0.06, 1.3, -0.26], [0.06, 1.245, -0.26]]
        : [[0.5, 1.6, -0.5], [0.5, 1.66, -0.5], [0.0, 1.66, -0.5], [0.0, 1.66, 0.0], [0.0, 1.52, 0.0]];

  const rf: V3[] =
    top === 'icp'
      ? [[0.08, 1.5, -0.14], [0.08, 1.5, -0.44], [0.41, 1.5, -0.44]]
      : top === 'ccp'
        ? [[0.08, 1.38, -0.14], [0.08, 1.38, -0.44], [0.41, 1.38, -0.44]]
        : [[0.08, 1.32, -0.38], [0.08, 1.32, -0.44], [0.41, 1.32, -0.44]];

  return (
    <group>
      <CleanFloor size={12} />

      {/* ── process chamber (cutaway) ── */}
      <group>
        <ChamberBody cut={cut} />
        <Pedestal kind={top === 'ash' ? 'heater' : 'esc'} cut={cut} pins={pinsPC} />
        {top === 'icp' && <IcpTop cut={cut} />}
        {top === 'ccp' && <CcpTop cut={cut} />}
        {top === 'ash' && <AshTop cut={cut} />}
        {GLOWS[top].map((g, i) => (
          <PlasmaVolume key={`${top}${i}`} spec={g} material={glowMats[i]} />
        ))}
        <group rotation={[0, SLIT_PHI - Math.PI / 2, 0]}>
          <group position={[0.262, 0, 0]}>
            <SlitValve length={R_PC - 0.56 - 0.262 + 0.004} gate={slitPC} />
          </group>
        </group>
        <OesViewport glow={viewGlow} />
        <Undercarriage cut={cut} rotor={rotor1} />
        {/* side gas injection */}
        <Pipe pts={[[-0.12, 1.12, -1.08], [-0.12, 1.12, -0.6], [0.16, 1.12, -0.6], [0.16, 1.12, -0.235]]} r={0.0045} m="steel" />
        <Pipe pts={gas} r={0.0055} m="steel" />
      </group>

      {/* ── transfer chamber, robot, load lock, EFEM ── */}
      <TransferModule slitLL={slitLL} doorLL={doorLL} slitPC2={slitPC2} pinsLL={pinsLL} extBlade={extBlade} />
      <Robot b={jb} e={je} w={jw} />
      <SideChamber />

      {/* gas box and RF generators behind the chamber */}
      <group position={[-0.35, 0, -1.35]}>
        <Box size={[0.5, 1.6, 0.54]} position={[0, 0.8, 0]} m="panelWarm" radius={0.02} />
        <Box size={[0.36, 0.5, 0.012]} position={[0, 1.15, 0.271]} m="glassDark" radius={0.004} castShadow={false} />
        {Array.from({ length: 6 }, (_, i) => (
          <Box key={i} size={[0.4, 0.008, 0.01]} position={[0, 0.3 + i * 0.03, 0.271]} m="black" radius={0.002} castShadow={false} />
        ))}
        <StatusTower R={R} position={[0.16, 1.6, -0.18]} />
      </group>
      <Pipe pts={rf} r={0.012} bend={0.06} m={CABLE} />

      {/* the simulated wafer */}
      <group ref={wafer} visible={false}>
        <Wafer anchor look={{ summary: state.wafer, showParticles: true }} size={768} />
      </group>
    </group>
  );
}
