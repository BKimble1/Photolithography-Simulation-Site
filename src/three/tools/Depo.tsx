/**
 * CVD cluster tool (illustrative, no manufacturer's design): a hexagonal vacuum transfer
 * chamber with a frog-leg robot, four single-wafer process chambers with lids, and two load
 * locks behind an equipment front end (EFEM) that faces the aisle (+z). The active chamber,
 * on the west side (−x), is drawn in cutaway, opened toward the front left:
 * a ceramic heater on a stem that rises to the process position under a gas showerhead,
 * fixed lift pins that take the wafer when the heater drops, a gas feed and a pumping line.
 *
 *  - 'poly'  (gate stack): the wafer is oxidised in a lamp-heated chamber, then polysilicon is
 *    deposited thermally (no plasma; the heater runs hot enough to glow faintly).
 *  - 'oxide' / 'pass': plasma-enhanced CVD, with a faint glow between showerhead and wafer.
 *
 * While a film grows the simulated wafer shows its thin-film interference colour for the
 * partial thickness, arriving exactly at the process model's result at the operation time.
 * All process motion is a pure function of step progress.
 *
 * In the fab the bay model (`depoCluster` in Fab.tsx) is this cluster in low detail; placed,
 * the scene redraws the parts the cutaway takes away (everything above the chamber frames),
 * including the front end with its load ports as the bay draws it, and leaves the gas and RF
 * cabinet and the status light to the bay.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M } from '../../sim/materials';
import type { Film, WaferSummary } from '../../sim/types';
import { useSimState, useStep } from '../../state/sim';
import { lerp, seg, smooth, useProgressBucket, useProgressFrame } from '../anim';
import { MAT, type MatKey } from '../materials';
import { Box, CleanFloor, Cyl, LightTower, mat, StandaloneOnly } from '../kit/parts';
import { useStationEnv } from '../stage/context';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';

type V2 = [number, number];
type V3 = [number, number, number];
const TAU = Math.PI * 2;

// ───────────────────────────── layout (metres) ─────────────────────────────

const DECK_Y = 0.9; // transfer-chamber floor
const LOW = 0.982; // blade top when passing under a wafer
const HIGH = 1.0; // blade top while carrying
const PIN_TOP = 0.99; // fixed lift pins (chambers and load locks)
const HEAT_LO = 0.95; // heater top at the transfer position
const HEAT_HI = 1.035; // heater top at the process position
const FACE_Y = 1.105; // showerhead faceplate underside

const R_CH = 0.94; // hub → chamber axis
const R_LL = 0.85; // hub → load-lock wafer centre
const TC_IN = 0.55; // transfer chamber in-radius (hexagon)
/** Face directions (degrees from +x toward +z) for each port: load locks toward the front end. */
const FACE = { B: 0, A: 180, C: 240, D: 300, ll: 60, ll2: 120 } as const;
type Port = keyof typeof FACE;
const rad = (deg: number) => (deg * Math.PI) / 180;
const posOf = (port: Port, r: number): V2 => [Math.cos(rad(FACE[port])) * r, Math.sin(rad(FACE[port])) * r];
/** Robot heading (rotation.y) toward a port. */
const thOf = (port: Port) => -rad(FACE[port]);

// frog-leg robot
const ARM_A = 0.33;
const ARM_B = 0.33;
const BLADE = 0.33; // wrist → wafer centre
const D_RET = 0.05;

// cutaway of the active chamber, facing the front left (lathe angle from +z toward +x)
const CUT: [number, number] = [-0.6, 2.0];

// ───────────────────────────── materials ─────────────────────────────

const SECTION = new THREE.MeshStandardMaterial({ color: '#c9cdd2', metalness: 0.4, roughness: 0.55, side: THREE.DoubleSide });
const BODY = new THREE.MeshStandardMaterial({ color: '#d3d7dc', metalness: 0.45, roughness: 0.42 });
const INNER = new THREE.MeshStandardMaterial({ color: '#6f757d', metalness: 0.55, roughness: 0.5 });
const HEATER = new THREE.MeshStandardMaterial({ color: '#d8d6cf', metalness: 0.05, roughness: 0.4, emissive: '#b3220a', emissiveIntensity: 0 });
const FACEPLATE = new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 0.85, roughness: 0.32 });

// ───────────────────────────── helpers ─────────────────────────────

function crisp(pts: V2[]): V2[] {
  const out: V2[] = [];
  pts.forEach((p, i) => {
    out.push(p);
    if (i > 0 && i < pts.length - 1) out.push(p);
  });
  return out;
}

function latheParts(profile: V2[], phiStart: number, phiLen: number) {
  const pts = crisp([...profile, profile[0]]).map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(pts, Math.max(6, Math.round((72 * phiLen) / TAU)), phiStart, phiLen);
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

function Turned({ profile, cut, arc, m = BODY, capM = SECTION, position }: { profile: V2[]; cut?: [number, number] | null; arc?: [number, number]; m?: MatKey | THREE.Material; capM?: THREE.Material; position?: V3 }) {
  const [s, l] = arc ?? (cut ? [cut[0] + cut[1] / 2, TAU - cut[1]] : [0, TAU]);
  const key = JSON.stringify(profile) + s.toFixed(4) + l.toFixed(4);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { body, caps } = useMemo(() => latheParts(profile, s, l), [key]);
  return (
    <group position={position}>
      <mesh geometry={body} material={mat(m)} castShadow receiveShadow />
      {caps && <mesh geometry={caps} material={capM} receiveShadow />}
    </group>
  );
}

function pipeGeometry(pts: V3[], r: number, bend: number) {
  const v = pts.map((p) => new THREE.Vector3(...p));
  const path = new THREE.CurvePath<THREE.Vector3>();
  let cur = v[0];
  for (let i = 1; i < v.length - 1; i++) {
    const d1 = new THREE.Vector3().subVectors(v[i], v[i - 1]);
    const l1 = d1.length();
    d1.divideScalar(l1);
    const d2 = new THREE.Vector3().subVectors(v[i + 1], v[i]);
    const l2 = d2.length();
    d2.divideScalar(l2);
    const rr = Math.min(bend, l1 * 0.5, l2 * 0.5);
    const p1 = v[i].clone().addScaledVector(d1, -rr);
    const p2 = v[i].clone().addScaledVector(d2, rr);
    if (p1.distanceTo(cur) > 1e-5) path.add(new THREE.LineCurve3(cur, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, v[i], p2));
    cur = p2;
  }
  path.add(new THREE.LineCurve3(cur, v[v.length - 1]));
  return new THREE.TubeGeometry(path, Math.max(8, Math.ceil(path.getLength() / 0.01)), r, 8, false);
}

function Pipe({ pts, r = 0.005, bend = 0.035, m = 'steel' }: { pts: V3[]; r?: number; bend?: number; m?: MatKey | THREE.Material }) {
  const key = JSON.stringify(pts) + r + bend;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geo = useMemo(() => pipeGeometry(pts, r, bend), [key]);
  return <mesh geometry={geo} material={mat(m)} castShadow receiveShadow />;
}

function bladeGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.03, -0.03);
  s.lineTo(0.2, -0.03);
  s.lineTo(0.26, -0.052);
  s.lineTo(0.465, -0.052);
  s.quadraticCurveTo(0.478, -0.052, 0.478, -0.04);
  s.lineTo(0.478, -0.028);
  s.lineTo(0.33, -0.024);
  s.lineTo(0.33, 0.024);
  s.lineTo(0.478, 0.028);
  s.lineTo(0.478, 0.04);
  s.quadraticCurveTo(0.478, 0.052, 0.465, 0.052);
  s.lineTo(0.26, 0.052);
  s.lineTo(0.2, 0.03);
  s.lineTo(-0.03, 0.03);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  return g;
}

/** Showerhead faceplate: a disc with a dense hole pattern on its underside. */
function holesTexture() {
  const n = 512;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c4c8cd';
  g.fillRect(0, 0, n, n);
  g.fillStyle = '#50555c';
  const step = 13;
  for (let y = step / 2; y < n; y += step)
    for (let x = step / 2 + ((y / step) % 2) * (step / 2); x < n; x += step) {
      if (Math.hypot(x - n / 2, y - n / 2) > n / 2 - 8) continue;
      g.beginPath();
      g.arc(x, y, 2.2, 0, TAU);
      g.fill();
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ───────────────────────────── plasma glow (ray-marched slab) ─────────────────────────────

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
varying vec3 vW;
varying vec3 vC;
float dens(vec3 p) {
  float r = length(p.xz) / uR;
  float h = p.y / uH;
  if (r > 1.0 || h < 0.0 || h > 1.0) return 0.0;
  // capacitive glow between the showerhead and the heater, dark sheaths at both
  float d = (1.0 - smoothstep(0.84, 1.0, r)) * (0.8 + 0.35 * smoothstep(0.5, 0.92, r));
  d *= smoothstep(0.06, 0.26, h) * (1.0 - smoothstep(0.72, 0.92, h));
  float n = sin(p.x * 29.0 + uTime * 1.7) * sin(p.z * 33.0 - uTime * 1.2);
  return d * (1.0 + 0.1 * n);
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
  const int N = 20;
  float dt = (tf - tn) / float(N);
  float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float acc = 0.0;
  for (int i = 0; i < N; i++) acc += dens(ro + rd * (tn + (float(i) + j) * dt));
  gl_FragColor = vec4(uColor * acc * dt * uI, 1.0);
}`;

// ───────────────────────────── recipes and timeline ─────────────────────────────

type Station = 'out' | 'll' | 'A' | 'B';
interface Move {
  a: number;
  b: number;
  from: Station;
  to: Station;
}
interface Recipe {
  start: Station;
  moves: Move[];
  /** Heater up/down in the active chamber: [up start, up end, down start, down end]. */
  heater: [number, number, number, number];
  /** Film growth window in the active chamber (ends at the deposition operation). */
  depo: [number, number];
  /** PECVD glow colour (sRGB hex), or null for thermal CVD. */
  plasma: number | null;
  /** Lamp-heated oxidation in chamber B (gate stack only). */
  oxidise?: [number, number];
  film: Film;
}

const RECIPES: Record<string, Recipe> = {
  // gate stack: HF strip elsewhere (0.2), gate oxidation in B (0.5), poly CVD in A (0.85)
  poly: {
    start: 'out',
    moves: [
      { a: 0.21, b: 0.26, from: 'out', to: 'll' },
      { a: 0.26, b: 0.36, from: 'll', to: 'B' },
      { a: 0.51, b: 0.6, from: 'B', to: 'A' },
      { a: 0.885, b: 0.985, from: 'A', to: 'll' },
    ],
    oxidise: [0.37, 0.5],
    heater: [0.6, 0.625, 0.855, 0.88],
    depo: [0.63, 0.85],
    plasma: null,
    film: { mat: M.POLY, nm: 150, label: 'Polysilicon' },
  },
  // pre-metal dielectric: PECVD oxide (0.5), then off to CMP (0.85)
  oxide: {
    start: 'll',
    moves: [
      { a: 0.04, b: 0.18, from: 'll', to: 'A' },
      { a: 0.545, b: 0.68, from: 'A', to: 'll' },
      { a: 0.7, b: 0.8, from: 'll', to: 'out' },
    ],
    heater: [0.18, 0.21, 0.505, 0.54],
    depo: [0.22, 0.5],
    plasma: 0xc9bcff,
    film: { mat: M.OX, nm: 900, label: 'Pre-metal dielectric' },
  },
  // passivation: PECVD nitride-rich stack (0.6)
  pass: {
    start: 'll',
    moves: [
      { a: 0.05, b: 0.2, from: 'll', to: 'A' },
      { a: 0.645, b: 0.8, from: 'A', to: 'll' },
    ],
    heater: [0.2, 0.235, 0.605, 0.64],
    depo: [0.245, 0.6],
    plasma: 0xdcb4f0,
    film: { mat: M.PASS, nm: 700, label: 'Passivation' },
  },
};

interface FrameState {
  th: number;
  d: number;
  z: number; // blade top
  heater: number; // 0 transfer … 1 process
  slit: Record<'ll' | 'A' | 'B', number>;
  door: number;
  ext: number;
  extZ: number;
  glow: number;
  lamp: number;
  hot: number;
  wvis: boolean;
  wx: number;
  wy: number;
  wz: number;
  wrot: number;
}

const STN: Record<'ll' | 'A' | 'B', { port: Port; r: number }> = {
  ll: { port: 'll', r: R_LL },
  A: { port: 'A', r: R_CH },
  B: { port: 'B', r: R_CH },
};
const LLW = posOf('ll', R_LL);
const EXT_LEN = 0.55;
const STN_POS: Record<'ll' | 'A' | 'B', V2> = { ll: posOf('ll', R_LL), A: posOf('A', R_CH), B: posOf('B', R_CH) };
const STN_ROT: Record<'ll' | 'A' | 'B', number> = { ll: thOf('ll') - thOf('A'), A: 0, B: thOf('B') - thOf('A') };

function atStation(f: FrameState, s: 'll' | 'A' | 'B', y: number) {
  f.wvis = true;
  f.wx = STN_POS[s][0];
  f.wz = STN_POS[s][1];
  f.wy = y;
  f.wrot = STN_ROT[s];
}

/** Resting height of the wafer in a station (on pins, or on the heater when it is up). */
function rest(f: FrameState, s: 'll' | 'A' | 'B') {
  return s === 'A' ? Math.max(PIN_TOP, lerp(HEAT_LO, HEAT_HI, f.heater)) : PIN_TOP;
}

function vacMove(u: number, A: 'll' | 'A' | 'B', B: 'll' | 'A' | 'B', thPrev: number, f: FrameState) {
  const thA = thOf(STN[A].port);
  let thB = thOf(STN[B].port);
  // take the shorter way round
  while (thB - thA > Math.PI) thB -= TAU;
  while (thB - thA < -Math.PI) thB += TAU;
  let thA0 = thA;
  while (thA0 - thPrev > Math.PI) thA0 -= TAU;
  while (thA0 - thPrev < -Math.PI) thA0 += TAU;
  f.th = u < 0.1 ? lerp(thPrev, thA0, smooth(u, 0, 0.1)) : u < 0.5 ? thA : lerp(thA, thB, smooth(u, 0.5, 0.6));
  const dA = STN[A].r - BLADE;
  const dB = STN[B].r - BLADE;
  f.d = D_RET + (dA - D_RET) * (smooth(u, 0.1, 0.25) - smooth(u, 0.32, 0.47)) + (dB - D_RET) * (smooth(u, 0.6, 0.75) - smooth(u, 0.82, 0.95));
  f.z = lerp(LOW, HIGH, smooth(u, 0.25, 0.32) - smooth(u, 0.75, 0.82));
  f.slit[A] = Math.max(f.slit[A], smooth(u, 0.03, 0.1) - smooth(u, 0.47, 0.53));
  f.slit[B] = Math.max(f.slit[B], smooth(u, 0.53, 0.6) - smooth(u, 0.95, 1));
  if (u < 0.25) atStation(f, A, rest(f, A));
  else if (u < 0.32) atStation(f, A, Math.max(PIN_TOP, f.z));
  else if (u < 0.75) {
    f.wvis = true;
    const r = f.d + BLADE;
    f.wx = Math.cos(f.th) * r;
    f.wz = -Math.sin(f.th) * r;
    f.wy = f.z;
    f.wrot = f.th - thOf('A');
  } else if (u < 0.82) atStation(f, B, Math.max(PIN_TOP, f.z));
  else atStation(f, B, rest(f, B));
}

function onExt(f: FrameState, e: number) {
  const dir = rad(FACE.ll);
  f.wvis = e > 0.015;
  f.wx = LLW[0] + Math.cos(dir) * (1 - e) * EXT_LEN;
  f.wz = LLW[1] + Math.sin(dir) * (1 - e) * EXT_LEN;
  f.wy = f.extZ;
  f.wrot = thOf('ll') - thOf('A');
}

/** EFEM blade passes the wafer through the load lock's outer door. */
function atmMove(u: number, inward: boolean, f: FrameState) {
  f.door = smooth(u, 0, 0.12) - smooth(u, 0.88, 1);
  if (inward) {
    f.ext = smooth(u, 0.12, 0.45) - smooth(u, 0.62, 0.88);
    f.extZ = lerp(HIGH, LOW, smooth(u, 0.47, 0.57));
    if (u < 0.47) onExt(f, f.ext);
    else atStation(f, 'll', Math.max(PIN_TOP, f.extZ));
  } else {
    f.ext = smooth(u, 0.12, 0.4) - smooth(u, 0.58, 0.88);
    f.extZ = lerp(LOW, HIGH, smooth(u, 0.42, 0.52));
    if (u < 0.42) atStation(f, 'll', PIN_TOP);
    else if (u < 0.54) atStation(f, 'll', Math.max(PIN_TOP, f.extZ));
    else onExt(f, f.ext);
  }
}

function simulate(p: number, R: Recipe, f: FrameState) {
  f.slit.ll = 0;
  f.slit.A = 0;
  f.slit.B = 0;
  f.door = 0;
  f.ext = 0;
  f.extZ = HIGH;
  f.z = LOW;
  f.d = D_RET;
  const [h0, h1, h2, h3] = R.heater;
  f.heater = smooth(p, h0, h1) - smooth(p, h2, h3);
  let th = thOf('ll');
  let loc: Station = R.start;
  let active = false;
  for (let i = 0; i < R.moves.length; i++) {
    const m = R.moves[i];
    if (p < m.a) break;
    const vac = m.from !== 'out' && m.to !== 'out';
    if (p >= m.b) {
      loc = m.to;
      if (vac) th = thOf(STN[m.to as 'll' | 'A' | 'B'].port);
      continue;
    }
    const u = (p - m.a) / (m.b - m.a);
    f.th = th;
    if (vac) vacMove(u, m.from as 'll' | 'A' | 'B', m.to as 'll' | 'A' | 'B', th, f);
    else atmMove(u, m.from === 'out', f);
    active = true;
    break;
  }
  if (!active) {
    f.th = th;
    if (loc === 'out') f.wvis = false;
    else atStation(f, loc, rest(f, loc));
  }
  const [d0, d1] = R.depo;
  f.glow = R.plasma !== null ? seg(p, d0, d0 + 0.012) * (1 - seg(p, d1 - 0.008, d1)) : 0;
  f.hot = R.plasma === null ? f.heater : 0;
  f.lamp = R.oxidise ? seg(p, R.oxidise[0], R.oxidise[0] + 0.02) * (1 - seg(p, R.oxidise[1] - 0.02, R.oxidise[1])) : 0;
}

// ───────────────────────────── parts ─────────────────────────────

/** Chamber shell (floor, thick wall with slit band and pumping channel), in local coordinates. */
function ChamberShell({ cut, slitPhi }: { cut: [number, number] | null; slitPhi: number }) {
  const [s, l] = cut ? [cut[0] + cut[1] / 2, TAU - cut[1]] : [0, TAU];
  const e = s + l;
  const half = 0.62;
  const band: V2[] = [[0.215, 0.95], [0.29, 0.95], [0.29, 1.035], [0.215, 1.035]];
  const norm = (a: number) => {
    let x = a;
    while (x < s) x += TAU;
    while (x > s + TAU) x -= TAU;
    return x;
  };
  const sp = norm(slitPhi);
  const arcs: [number, number][] = [
    [s, sp - half - s],
    [sp + half, e - (sp + half)],
  ].filter(([, len]) => len > 0.01) as [number, number][];
  return (
    <group>
      <Turned profile={[[0.05, 0.82], [0.31, 0.82], [0.31, 0.85], [0.29, 0.85], [0.29, 0.95], [0.215, 0.95], [0.215, 0.845], [0.05, 0.845]]} arc={[s, l]} />
      {arcs.map((a, i) => (
        <Turned key={i} profile={band} arc={a} />
      ))}
      {/* upper wall with the annular pumping channel around the showerhead */}
      <Turned profile={[[0.215, 1.035], [0.29, 1.035], [0.29, 1.16], [0.25, 1.16], [0.25, 1.12], [0.23, 1.12], [0.23, 1.16], [0.215, 1.16]]} arc={[s, l]} />
      <Turned profile={[[0.209, 0.85], [0.215, 0.85], [0.215, 0.95], [0.209, 0.95]]} arc={[s, l]} m={INNER} />
      {arcs.map((a, i) => (
        <Turned key={`l${i}`} profile={[[0.209, 0.95], [0.215, 0.95], [0.215, 1.035], [0.209, 1.035]]} arc={a} m={INNER} />
      ))}
      <Turned profile={[[0.209, 1.035], [0.215, 1.035], [0.215, 1.1], [0.209, 1.1]]} arc={[s, l]} m={INNER} />
    </group>
  );
}

const BOLTS = (() => {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    const g = new THREE.CylinderGeometry(0.008, 0.008, 0.008, 8);
    g.translate(Math.sin(a) * 0.275, 1.209, Math.cos(a) * 0.275);
    parts.push(g);
  }
  return mergeGeometries(parts);
})();

function Lid({ cut, rf, back }: { cut: [number, number] | null; rf: boolean; back: number }) {
  // `back` is the lathe angle pointing to the hub: lid-top hardware sits on that side
  const bx = Math.sin(back);
  const bz = Math.cos(back);
  return (
    <group>
      {!cut && <mesh geometry={BOLTS} material={MAT.steelDark} />}
      <Box size={[0.12, 0.05, 0.06]} position={[bx * 0.3, 1.19, bz * 0.3]} rotation={[0, back, 0]} m="steelDark" radius={0.006} />
      {/* lid, gas box and blocker plate, faceplate */}
      <Turned profile={[[0, 1.16], [0.3, 1.16], [0.3, 1.205], [0, 1.205]]} cut={cut} m="aluminum" />
      <Turned profile={[[0, 1.118], [0.2, 1.118], [0.2, 1.16], [0, 1.16]]} cut={cut} m="aluminum" />
      <Turned profile={[[0, 1.132], [0.19, 1.132], [0.19, 1.14], [0, 1.14]]} cut={cut ? [cut[0], cut[1] - 0.012] : null} m="black" capM={MAT.black} />
      <Turned profile={[[0, FACE_Y], [0.2, FACE_Y], [0.2, 1.118], [0, 1.118]]} cut={cut} m={FACEPLATE} />
      <Turned profile={[[0.2, FACE_Y - 0.004], [0.214, FACE_Y - 0.004], [0.214, 1.16], [0.2, 1.16]]} cut={cut} m="ceramic" />
      {/* gas inlet at the centre; remote-plasma clean source and RF match toward the hub */}
      <Cyl r={0.022} h={0.05} position={[0, 1.23, 0]} m="steelSatin" />
      <group position={[bx * 0.17, 0, bz * 0.17]} rotation={[0, back, 0]}>
        <Box size={[0.2, 0.09, 0.11]} position={[0, 1.25, 0]} m="panel" radius={0.012} />
        {rf ? <Box size={[0.14, 0.07, 0.1]} position={[0, 1.33, 0]} m="panelWarm" radius={0.01} /> : <Box size={[0.12, 0.04, 0.09]} position={[0, 1.315, 0]} m="black" radius={0.008} />}
      </group>
    </group>
  );
}

/** A closed process chamber on the cluster (lid on). */
function ClosedChamber({ port, lamp }: { port: Port; lamp?: React.RefObject<THREE.MeshBasicMaterial | null> }) {
  const [x, z] = posOf(port, R_CH);
  const toHub = Math.atan2(-x, -z); // lathe angle pointing back to the hub
  return (
    <group position={[x, 0, z]}>
      <Turned profile={[[0.05, 0.82], [0.31, 0.82], [0.31, 0.85], [0.29, 0.85], [0.29, 1.16], [0.05, 1.16]]} />
      <Lid cut={null} rf={!lamp} back={toHub} />
      <Undercarriage />
      {lamp && (
        <group rotation={[0, 0.35, 0]}>
          {/* viewport: the lamp-heated wafer glows while it is oxidised */}
          <Cyl r={0.04} h={0.03} position={[0, 1.05, 0.3]} rotation={[Math.PI / 2, 0, 0]} m="steelSatin" />
          <mesh position={[0, 1.05, 0.316]}>
            <circleGeometry args={[0.028, 32]} />
            <meshBasicMaterial ref={lamp} color="#000000" toneMapped={false} />
          </mesh>
          <mesh position={[0, 1.05, 0.317]} material={MAT.glassDark}>
            <circleGeometry args={[0.03, 32]} />
          </mesh>
          <Box size={[0.3, 0.06, 0.3]} position={[0, 1.235, -0.02]} m="black" radius={0.01} />
        </group>
      )}
    </group>
  );
}

function Frame() {
  return (
    <group>
      {[
        [0.22, 0.22],
        [-0.22, 0.22],
        [0.22, -0.22],
        [-0.22, -0.22],
      ].map(([x, z]) => (
        <Box key={`${x}${z}`} size={[0.04, 0.8, 0.04]} position={[x, 0.4, z]} m="steelSatin" radius={0.004} />
      ))}
      {[-0.22, 0.22].map((z) => (
        <Box key={`x${z}`} size={[0.48, 0.03, 0.04]} position={[0, 0.805, z]} m="steelSatin" radius={0.004} />
      ))}
      {[-0.22, 0.22].map((x) => (
        <Box key={`z${x}`} size={[0.04, 0.03, 0.48]} position={[x, 0.805, 0]} m="steelSatin" radius={0.004} />
      ))}
      <Box size={[0.48, 0.03, 0.48]} position={[0, 0.06, 0]} m="panelDark" radius={0.006} />
    </group>
  );
}

function Undercarriage() {
  return (
    <group>
      <Cyl r={0.05} h={0.1} position={[0, 0.77, 0]} m="steelSatin" />
      <Cyl r={0.08} h={0.2} position={[0, 0.61, 0]} m="black" />
      <Frame />
      <Pipe pts={[[0.2, 0.83, 0.1], [0.34, 0.83, 0.1], [0.34, 0.08, 0.1]]} r={0.028} bend={0.06} m="steelSatin" />
    </group>
  );
}

function ActiveChamber({
  heater,
  slit,
  showerTex,
  rf,
  glowMat,
}: {
  heater: React.RefObject<THREE.Group | null>;
  slit: React.RefObject<THREE.Mesh | null>;
  showerTex: THREE.Texture;
  rf: boolean;
  glowMat: THREE.ShaderMaterial | null;
}) {
  const [x, z] = posOf('A', R_CH);
  const slitPhi = Math.atan2(-x, -z);
  const glowGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.186, 0.186, FACE_Y - 0.003 - (HEAT_HI + 0.004), 48, 1, false);
    g.translate(0, (FACE_Y - 0.003 - (HEAT_HI + 0.004)) / 2, 0);
    return g;
  }, []);
  return (
    <group position={[x, 0, z]}>
      <ChamberShell cut={CUT} slitPhi={slitPhi} />
      <Lid cut={CUT} rf={rf} back={slitPhi} />
      {/* process gas comes up the back of the chamber from the gas box in the frame */}
      <Pipe
        pts={[
          [0, 1.255, 0],
          [0, 1.29, 0],
          [Math.sin(slitPhi + 0.9) * 0.2, 1.29, Math.cos(slitPhi + 0.9) * 0.2],
          [Math.sin(slitPhi + 0.9) * 0.33, 1.29, Math.cos(slitPhi + 0.9) * 0.33],
          [Math.sin(slitPhi + 0.9) * 0.33, 0.55, Math.cos(slitPhi + 0.9) * 0.33],
        ]}
        r={0.006}
        m="steel"
      />
      <mesh position={[0, FACE_Y - 0.0004, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.199, 64, Math.PI / 2 - (CUT[0] + CUT[1] / 2 + TAU - CUT[1]), TAU - CUT[1]]} />
        <meshStandardMaterial map={showerTex} metalness={0.7} roughness={0.35} side={THREE.DoubleSide} />
      </mesh>
      {/* heater on its stem (rises to the process position) */}
      <group ref={heater}>
        <Turned profile={[[0, -0.032], [0.168, -0.032], [0.168, 0], [0, 0]]} m={HEATER} />
        <Cyl r={0.035} h={0.3} position={[0, -0.18, 0]} m="steelSatin" />
      </group>
      {/* fixed lift pins, clear of the robot fork */}
      {[0, 1, 2].map((i) => {
        const a = slitPhi + Math.PI + ((i - 1) * 2 * Math.PI) / 3;
        return <Cyl key={i} r={0.0035} h={PIN_TOP - 0.85} position={[Math.sin(a) * 0.105, (PIN_TOP + 0.85) / 2, Math.cos(a) * 0.105]} m="ceramic" seg={10} />;
      })}
      <group rotation={[0, slitPhi - Math.PI / 2, 0]}>
        <group position={[0.285, 0, 0]}>
          <SlitValve length={R_CH - TC_IN - 0.05 - 0.285} gate={slit} />
        </group>
      </group>
      {/* bellows and lift drive under the chamber */}
      <Cyl r={0.05} h={0.12} position={[0, 0.76, 0]} m="steelSatin" />
      <Cyl r={0.08} h={0.18} position={[0, 0.6, 0]} m="black" />
      <Frame />
      <Pipe pts={[[-0.2, 0.83, -0.12], [-0.36, 0.83, -0.12], [-0.36, 0.08, -0.12]]} r={0.028} bend={0.06} m="steelSatin" />
      {glowMat && <mesh geometry={glowGeo} material={glowMat} position={[0, HEAT_HI + 0.004, 0]} renderOrder={5} />}
    </group>
  );
}

function SlitValve({ length, gate }: { length: number; gate?: React.RefObject<THREE.Mesh | null> }) {
  const yc = 0.992;
  return (
    <group>
      <Box size={[length, 0.03, 0.46]} position={[length / 2, yc + 0.058, 0]} m="aluminum" radius={0.006} />
      <Box size={[length, 0.03, 0.46]} position={[length / 2, yc - 0.058, 0]} m="aluminum" radius={0.006} />
      <Box size={[length, 0.09, 0.05]} position={[length / 2, yc, 0.205]} m="aluminum" radius={0.006} />
      <Box size={[length, 0.09, 0.05]} position={[length / 2, yc, -0.205]} m="aluminum" radius={0.006} />
      <mesh ref={gate} position={[length / 2, yc, 0]} castShadow>
        <boxGeometry args={[0.012, 0.086, 0.36]} />
        <meshStandardMaterial color="#aeb3ba" metalness={0.9} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** Hexagonal transfer chamber with slit openings on every face (open top, cut away). */
function TransferChamber() {
  const faces = [0, 60, 120, 180, 240, 300];
  const side = (2 * TC_IN) / Math.sqrt(3);
  const H = 1.12;
  return (
    <group>
      {/* hexagonal mainframe plinth and floor */}
      <mesh position={[0, (DECK_Y - 0.02) / 2, 0]} material={MAT.panel} castShadow receiveShadow>
        <cylinderGeometry args={[side + 0.08, side + 0.08, DECK_Y - 0.02, 6]} />
      </mesh>
      <mesh position={[0, DECK_Y - 0.01, 0]} material={MAT.aluminum} receiveShadow>
        <cylinderGeometry args={[side + 0.05, side + 0.05, 0.02, 6]} />
      </mesh>
      {faces.map((deg) => (
        <group key={deg} rotation={[0, -rad(deg), 0]}>
          <Box size={[0.05, H - DECK_Y, (side - 0.36) / 2]} position={[TC_IN + 0.025, (H + DECK_Y) / 2, 0.18 + (side - 0.36) / 4]} m="aluminum" radius={0.005} />
          <Box size={[0.05, H - DECK_Y, (side - 0.36) / 2]} position={[TC_IN + 0.025, (H + DECK_Y) / 2, -0.18 - (side - 0.36) / 4]} m="aluminum" radius={0.005} />
          <Box size={[0.05, 0.95 - DECK_Y, 0.36]} position={[TC_IN + 0.025, (0.95 + DECK_Y) / 2, 0]} m="aluminum" radius={0.005} />
          <Box size={[0.05, H - 1.035, 0.36]} position={[TC_IN + 0.025, (H + 1.035) / 2, 0]} m="aluminum" radius={0.005} />
        </group>
      ))}
    </group>
  );
}

function FrogLeg({
  hub,
  upper,
  fore,
  wrist,
}: {
  hub: React.RefObject<THREE.Group | null>;
  upper: React.RefObject<(THREE.Group | null)[]>;
  fore: React.RefObject<(THREE.Group | null)[]>;
  wrist: React.RefObject<THREE.Group | null>;
}) {
  const blade = useMemo(bladeGeometry, []);
  return (
    <group>
      <Cyl r={0.12} h={0.05} position={[0, DECK_Y + 0.025, 0]} m="panel" />
      <group ref={hub}>
        <Cyl r={0.07} h={0.02} position={[0, 0.955, 0]} m="steelSatin" />
        {[0, 1].map((i) => (
          <group
            key={`u${i}`}
            ref={(g) => {
              if (upper.current) upper.current[i] = g;
            }}
            position={[0, 0.957, 0]}
          >
            <Box size={[ARM_A + 0.06, 0.016, 0.06]} position={[ARM_A / 2, 0, 0]} m="aluminum" radius={0.008} />
            <Cyl r={0.026} h={0.02} position={[ARM_A, 0.008, 0]} m="steelSatin" />
          </group>
        ))}
        {[0, 1].map((i) => (
          <group
            key={`f${i}`}
            ref={(g) => {
              if (fore.current) fore.current[i] = g;
            }}
            position={[0, 0.972, 0]}
          >
            <Box size={[ARM_B + 0.03, 0.012, 0.04]} m="aluminum" radius={0.006} />
          </group>
        ))}
        <group ref={wrist} position={[0, 0.972, 0]}>
          <Box size={[0.08, 0.018, 0.1]} position={[0, 0.002, 0]} m="steelSatin" radius={0.006} />
          <mesh geometry={blade} material={MAT.ceramic} position={[0, LOW - 0.972, 0]} castShadow />
        </group>
      </group>
    </group>
  );
}

function LoadLocks({ door, slitLL, ext }: { door: React.RefObject<THREE.Mesh | null>; slitLL: React.RefObject<THREE.Mesh | null>; ext: React.RefObject<THREE.Group | null> }) {
  const blade = useMemo(bladeGeometry, []);
  return (
    <group>
      {(['ll', 'll2'] as const).map((port) => (
        <group key={port} rotation={[0, thOf(port), 0]}>
          {/* local +x points away from the hub */}
          <group position={[TC_IN + 0.05, 0, 0]}>
            <SlitValve length={R_LL - 0.22 - TC_IN - 0.05 + 0.004} gate={port === 'll' ? slitLL : undefined} />
          </group>
          <group position={[R_LL, 0, 0]}>
            <Box size={[0.44, 0.06, 0.5]} position={[0, PIN_TOP - 0.06, 0]} m="aluminum" radius={0.006} />
            <Box size={[0.44, 0.1, 0.04]} position={[0, PIN_TOP + 0.02, 0.23]} m="aluminum" radius={0.005} />
            <Box size={[0.44, 0.1, 0.04]} position={[0, PIN_TOP + 0.02, -0.23]} m="aluminum" radius={0.005} />
            <Box size={[0.42, 0.01, 0.46]} position={[0, PIN_TOP + 0.075, 0]} m="glassDark" radius={0.003} castShadow={false} />
            {[1, 3, 5, 7].map((k) => (
              <Cyl key={k} r={0.0035} h={0.05} position={[Math.cos((k * Math.PI) / 4) * 0.1, PIN_TOP - 0.025, Math.sin((k * Math.PI) / 4) * 0.1]} m="ceramic" seg={10} />
            ))}
            <Box size={[0.3, 0.9, 0.3]} position={[0, 0.45, 0]} m="panelGray" radius={0.01} />
          </group>
          <group position={[R_LL + 0.22, 0, 0]}>
            <SlitValve length={0.07} gate={port === 'll' ? door : undefined} />
          </group>
          {port === 'll' && (
            <group ref={ext} visible={false}>
              <mesh geometry={blade} material={MAT.ceramicGray} rotation={[0, Math.PI, 0]} position={[BLADE, HIGH, 0]} />
            </group>
          )}
        </group>
      ))}
      {/* equipment front end beyond the load locks (in the bay: FrontEnd) */}
      <StandaloneOnly>
        <Box size={[1.9, 1.5, 0.52]} position={[0, 0.75, 1.36]} m="panel" radius={0.02} />
        <Box size={[1.9, 0.1, 0.52]} position={[0, 1.55, 1.36]} m="panelGray" radius={0.02} />
      </StandaloneOnly>
    </group>
  );
}

/** The simulated wafer, with the film growing during deposition. */
function DepoWafer({ R, group }: { R: Recipe; group: React.RefObject<THREE.Group | null> }) {
  const state = useSimState();
  const b = useProgressBucket(160);
  const [d0, d1] = R.depo;
  const growing = b > d0 && b < d1;
  const frac = growing ? seg(b, d0, d1) : 0;
  const summary = useMemo<WaferSummary>(() => {
    if (!growing) return state.wafer;
    const films = state.wafer.films.map((x) => ({ ...x }));
    const nm = R.film.nm * frac;
    const last = films[films.length - 1];
    if (last && last.mat === R.film.mat && last.label === R.film.label) last.nm += nm;
    else films.push({ ...R.film, nm });
    return { ...state.wafer, films };
  }, [state.wafer, growing, frac, R]);
  return (
    <group ref={group} visible={false}>
      <Wafer anchor look={{ summary, showParticles: true }} size={768} />
    </group>
  );
}

const FOUP_SHELL = new THREE.MeshStandardMaterial({ color: '#b4bcc5', metalness: 0.05, roughness: 0.5 });

/** Height the front end is cut down to when the cluster is opened in the bay. */
const FRONT_CUT = 1.3;

/**
 * In the bay: the front end where the bay model draws it (Fab.tsx `depoCluster`), each part a
 * few millimetres larger so it covers the low-detail one left below the cut, and itself cut
 * down to FRONT_CUT so the cluster can be seen over it: two load ports, a pod on the right one.
 */
function FrontEnd() {
  const zf = 1.8;
  const e = 0.004;
  const h = FRONT_CUT - 0.1;
  return (
    <group>
      <Box size={[2.35 + 2 * e, 0.1 + e, 0.75 + 2 * e]} position={[0, 0.05, zf - 0.4]} m="panelGray" radius={0.008} />
      <Box size={[2.4 + 2 * e, h + e, 0.8 + 2 * e]} position={[0, 0.1 + h / 2, zf - 0.4]} m="panel" radius={0.02} />
      {[-0.55, 0.55].map((x, i) => (
        <group key={x}>
          <Box size={[0.5 + 2 * e, FRONT_CUT - 0.75, 0.035 + 2 * e]} position={[x, (0.75 + FRONT_CUT) / 2, zf + 0.018]} m="steelSatin" radius={0.012} />
          <Box size={[0.5 + 2 * e, 0.06 + 2 * e, 0.44 + 2 * e]} position={[x, 0.87, zf + 0.22]} m="panelGray" radius={0.012} />
          <Box size={[0.42 + 2 * e, 0.8 + 2 * e, 0.06 + 2 * e]} position={[x, 0.43, zf + 0.1]} m="panelGray" radius={0.012} />
          {i === 1 && (
            <group position={[x, 0.9, zf + 0.24]}>
              <Box size={[0.39 + 2 * e, 0.31 + 2 * e, 0.42 + 2 * e]} position={[0, 0.155, 0]} m={FOUP_SHELL} radius={0.04} />
              <Box size={[0.22 + 2 * e, 0.03 + 2 * e, 0.15 + 2 * e]} position={[0, 0.325, 0]} m="panelGray" radius={0.01} />
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

function Status({ R }: { R: Recipe }) {
  const b = useProgressBucket(100);
  const busy = (b >= R.depo[0] && b < R.depo[1]) || (R.oxidise ? b >= R.oxidise[0] && b < R.oxidise[1] : false);
  return <LightTower position={[0.8, 1.6, -1.2]} on={busy ? 'violet' : 'green'} />;
}

// ───────────────────────────── scene ─────────────────────────────

export default function Depo({ variant }: ToolProps) {
  const { id } = useStep();
  const { placed } = useStationEnv();
  const v = variant && RECIPES[variant] ? variant : id === 'pmd' ? 'oxide' : id === 'passivate' ? 'pass' : 'poly';
  const R = RECIPES[v];

  const heater = useRef<THREE.Group>(null);
  const slitA = useRef<THREE.Mesh>(null);
  const slitLL = useRef<THREE.Mesh>(null);
  const door = useRef<THREE.Mesh>(null);
  const ext = useRef<THREE.Group>(null);
  const hub = useRef<THREE.Group>(null);
  const upper = useRef<(THREE.Group | null)[]>([]);
  const fore = useRef<(THREE.Group | null)[]>([]);
  const wrist = useRef<THREE.Group>(null);
  const wafer = useRef<THREE.Group>(null);
  const lamp = useRef<THREE.MeshBasicMaterial>(null);

  const showerTex = useMemo(holesTexture, []);
  const glowMat = useMemo(() => {
    if (R.plasma === null) return null;
    return new THREE.ShaderMaterial({
      vertexShader: PLASMA_VERT,
      fragmentShader: PLASMA_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color().setHex(R.plasma, THREE.LinearSRGBColorSpace) },
        uI: { value: 0 },
        uR: { value: 0.186 },
        uH: { value: FACE_Y - 0.003 - (HEAT_HI + 0.004) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      toneMapped: false,
    });
  }, [R.plasma]);
  useEffect(() => () => glowMat?.dispose(), [glowMat]);
  useEffect(() => () => showerTex.dispose(), [showerTex]);

  const f = useMemo<FrameState>(
    () => ({ th: 0, d: D_RET, z: LOW, heater: 0, slit: { ll: 0, A: 0, B: 0 }, door: 0, ext: 0, extZ: HIGH, glow: 0, lamp: 0, hot: 0, wvis: false, wx: 0, wy: 0, wz: 0, wrot: 0 }),
    [],
  );
  const lampCol = useMemo(() => new THREE.Color('#ffc978'), []);

  useProgressFrame((p, t) => {
    simulate(p, R, f);
    // frog-leg kinematics: upper arms at th ± phi, forearms meet at the wrist
    const d = Math.max(0.01, f.d);
    const phi = Math.acos(Math.min(1, d / (ARM_A + ARM_B)));
    if (hub.current) hub.current.position.y = f.z - LOW;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const a = f.th + s * phi;
      const u = upper.current[i];
      if (u) u.rotation.y = a;
      const ex = Math.cos(a) * ARM_A;
      const ez = -Math.sin(a) * ARM_A;
      const wx = Math.cos(f.th) * d;
      const wz = -Math.sin(f.th) * d;
      const fo = fore.current[i];
      if (fo) {
        fo.position.x = (ex + wx) / 2;
        fo.position.z = (ez + wz) / 2;
        fo.rotation.y = Math.atan2(-(wz - ez), wx - ex);
      }
    }
    if (wrist.current) {
      wrist.current.position.x = Math.cos(f.th) * d;
      wrist.current.position.z = -Math.sin(f.th) * d;
      wrist.current.rotation.y = f.th;
    }
    if (heater.current) heater.current.position.y = lerp(HEAT_LO, HEAT_HI, f.heater);
    HEATER.emissiveIntensity = 0.16 * f.hot; // ~650 °C: a faint dull-red glow
    if (slitA.current) slitA.current.position.y = 0.992 - 0.1 * f.slit.A;
    if (slitLL.current) slitLL.current.position.y = 0.992 - 0.1 * f.slit.ll;
    if (door.current) door.current.position.y = 0.992 - 0.1 * f.door;
    if (ext.current) {
      ext.current.visible = f.ext > 0.01;
      ext.current.position.x = R_LL + (1 - f.ext) * EXT_LEN;
      ext.current.position.y = f.extZ - HIGH;
    }
    if (wafer.current) {
      wafer.current.visible = f.wvis;
      wafer.current.position.set(f.wx, f.wy, f.wz);
      wafer.current.rotation.y = f.wrot;
    }
    if (glowMat) {
      glowMat.uniforms.uI.value = f.glow * (1 + 0.03 * Math.sin(t * 21.3) + 0.02 * Math.sin(t * 47.1)) * 13;
      glowMat.uniforms.uTime.value = t;
    }
    if (lamp.current) lamp.current.color.copy(lampCol).multiplyScalar(2.4 * f.lamp);
  });

  return (
    <group>
      <CleanFloor size={12} />
      <TransferChamber />
      <FrogLeg hub={hub} upper={upper} fore={fore} wrist={wrist} />
      <ActiveChamber heater={heater} slit={slitA} showerTex={showerTex} rf={R.plasma !== null} glowMat={glowMat} />
      <ClosedChamber port="B" lamp={v === 'poly' ? lamp : undefined} />
      <ClosedChamber port="C" />
      <ClosedChamber port="D" />
      <LoadLocks door={door} slitLL={slitLL} ext={ext} />
      {placed && <FrontEnd />}
      {/* gas panel behind chamber B, feeding the active chamber's lid (in the bay: its gas cabinet) */}
      <StandaloneOnly>
        <Box size={[0.5, 1.5, 0.5]} position={[1.3, 0.75, -0.75]} m="panelWarm" radius={0.02} />
        <Status R={R} />
      </StandaloneOnly>
      <DepoWafer R={R} group={wafer} />
    </group>
  );
}
