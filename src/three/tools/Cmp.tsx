/**
 * Chemical-mechanical polisher (illustrative, no manufacturer's design): one rotating platen
 * with a grooved polishing pad, a carrier head on a swing arm that presses the wafer face-down
 * onto the pad while it sweeps, a slurry arm dripping milky slurry, a pad conditioner (diamond
 * disk) sweeping across the pad, a load cup with an edge-gripping flipper, and a clean/dry
 * module whose linear blade brings the wafer in and takes it out.
 *
 * The wafer waits face-up in the load cup, is flipped face-down, picked up by the head,
 * polished during a window that ends at the step's CMP operation, returned and flipped
 * face-up again. Every motion is a pure function of step progress.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimState, useStep } from '../../state/sim';
import { ease, lerp, seg, smooth, useProgressBucket, useProgressFrame } from '../anim';
import { MAT, type MatKey } from '../materials';
import { Box, CleanFloor, Cyl, LightTower, mat } from '../kit/parts';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';

type V2 = [number, number];
type V3 = [number, number, number];
const TAU = Math.PI * 2;

// ───────────────────────────── layout (metres) ─────────────────────────────

const DECK = 0.8; // top of the polisher base
const PAD_Y = 0.917; // polishing pad surface
const R_PAD = 0.375; // 750 mm platen
const CUP_Y = 0.94; // wafer bottom when resting on the load-cup pins
const XFER_HI = 0.952; // handler blade top while carrying
const XFER_LO = 0.93; // handler blade top after setting the wafer down
const HEAD_UP = 1.1; // head bottom when raised for a swing
const WT = 0.0016; // drawn wafer thickness

const LC: V2 = [-0.72, 0.3]; // load cup
const H1: V2 = [-0.15, -0.06]; // head centre while polishing
const ARM_L = 0.72; // swing-arm length (pivot → head spindle)
const PIV: V2 = (() => {
  const mx = (H1[0] + LC[0]) / 2;
  const mz = (H1[1] + LC[1]) / 2;
  const vx = LC[0] - H1[0];
  const vz = LC[1] - H1[1];
  const half = Math.hypot(vx, vz) / 2;
  const t = Math.sqrt(ARM_L * ARM_L - half * half);
  // unit normal to H1→LC pointing to the back (−z), where the column stands
  const nx = -vz / (2 * half);
  const nz = vx / (2 * half);
  return [mx + nx * t, mz + nz * t];
})();
const angTo = (from: V2, to: V2) => Math.atan2(-(to[1] - from[1]), to[0] - from[0]);
const TH_PAD = angTo(PIV, H1);
const TH_CUP = angTo(PIV, LC);
const HANDLER_X = -1.0; // clean/dry module face (its slot)
const BLADE_OUT = 0.58; // handler blade travel (load cup → inside the module)
const COND: V2 = [0.5, 0.42]; // conditioner pivot
const COND_L = 0.55;
const SLURRY: V2 = [0.14, -0.55]; // slurry arm pivot
const NOZZLE: V2 = [0.0, -0.24]; // upstream of the head (the platen turns counter-clockwise)

// ───────────────────────────── local materials ─────────────────────────────

const SLURRY_MAT = new THREE.MeshPhysicalMaterial({ color: '#f7f7f4', roughness: 0.2, transparent: true, opacity: 0.93, clearcoat: 1 });
const RING = new THREE.MeshStandardMaterial({ color: '#2a2c30', metalness: 0.05, roughness: 0.55 });
const BACKSIDE = new THREE.MeshStandardMaterial({ color: '#8d9198', metalness: 0.6, roughness: 0.35 });
const DIAMOND = new THREE.MeshStandardMaterial({ color: '#4a4d52', metalness: 0.7, roughness: 0.3 });
const PLASTIC = new THREE.MeshStandardMaterial({ color: '#e7e9ec', metalness: 0, roughness: 0.45 });

// ───────────────────────────── textures ─────────────────────────────

/** Polyurethane pad: concentric grooves, a worn wafer track and a clear endpoint window. */
function padTexture() {
  const n = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const cx = n / 2;
  g.fillStyle = '#ddd2b6';
  g.fillRect(0, 0, n, n);
  // slightly glazed band where the wafer runs
  const track = g.createRadialGradient(cx, cx, n * 0.1, cx, cx, n * 0.5);
  track.addColorStop(0, 'rgba(255,255,255,0)');
  track.addColorStop(0.35, 'rgba(120,105,80,0.10)');
  track.addColorStop(0.75, 'rgba(120,105,80,0.06)');
  track.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = track;
  g.fillRect(0, 0, n, n);
  g.strokeStyle = 'rgba(96, 82, 56, 0.5)';
  g.lineWidth = 2.6;
  for (let r = 16; r < n / 2 - 4; r += 11) {
    g.beginPath();
    g.arc(cx, cx, r, 0, TAU);
    g.stroke();
  }
  // endpoint-detection window (a clear insert in the pad)
  g.save();
  g.translate(cx + n * 0.2, cx);
  g.fillStyle = '#6f8594';
  g.fillRect(-26, -12, 52, 24);
  g.strokeStyle = '#4c5a64';
  g.lineWidth = 2;
  g.strokeRect(-26, -12, 52, 24);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Milky slurry on the pad, seen in the lab frame: a thin film everywhere plus a brighter wake
 * that leaves the drip point and spirals outward as the pad carries it round (the pattern
 * stays put while the pad turns underneath). Alpha only.
 */
function slurryTexture() {
  const n = 512;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const k = n / 2 / R_PAD; // px per metre
  const px = (x: number) => n / 2 + x * k;
  const pz = (z: number) => n / 2 + z * k;
  g.clearRect(0, 0, n, n);
  const base = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  base.addColorStop(0, 'rgba(255,255,255,0.34)');
  base.addColorStop(0.85, 'rgba(255,255,255,0.26)');
  base.addColorStop(1, 'rgba(255,255,255,0.05)');
  g.fillStyle = base;
  g.fillRect(0, 0, n, n);
  // wake: rotate the drip point with the pad (rotation.y > 0) while it drifts outward
  const [x0, z0] = NOZZLE;
  for (let i = 0; i < 260; i++) {
    const th = (i / 260) * 5.2;
    const grow = 1 + th * 0.13;
    const x = (x0 * Math.cos(th) + z0 * Math.sin(th)) * grow;
    const z = (-x0 * Math.sin(th) + z0 * Math.cos(th)) * grow;
    if (Math.hypot(x, z) > R_PAD - 0.01) break;
    const w = (5 + 16 * (th / 5.2)) * k * 0.01;
    const a = 0.5 * (1 - th / 5.2) + 0.08;
    const grd = g.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), w * 3);
    grd.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(px(x), pz(z), w * 3, 0, TAU);
    g.fill();
  }
  // puddle under the nozzle
  const pd = g.createRadialGradient(px(x0), pz(z0), 0, px(x0), pz(z0), 0.035 * k);
  pd.addColorStop(0, 'rgba(255,255,255,0.9)');
  pd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = pd;
  g.beginPath();
  g.arc(px(x0), pz(z0), 0.035 * k, 0, TAU);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ───────────────────────────── geometry helpers ─────────────────────────────

function Turned({ profile, m = 'steelSatin', seg: segs = 96, position }: { profile: V2[]; m?: MatKey | THREE.Material; seg?: number; position?: V3 }) {
  const key = JSON.stringify(profile);
  const geo = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    const loop = [...profile, profile[0]];
    loop.forEach(([r, y], i) => {
      pts.push(new THREE.Vector2(r, y));
      if (i > 0 && i < loop.length - 1) pts.push(new THREE.Vector2(r, y));
    });
    return new THREE.LatheGeometry(pts, segs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, segs]);
  return <mesh geometry={geo} material={mat(m)} position={position} castShadow receiveShadow />;
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

function Pipe({ pts, r = 0.005, bend = 0.03, m = 'steel' }: { pts: V3[]; r?: number; bend?: number; m?: MatKey | THREE.Material }) {
  const key = JSON.stringify(pts) + r + bend;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geo = useMemo(() => pipeGeometry(pts, r, bend), [key]);
  return <mesh geometry={geo} material={mat(m)} castShadow receiveShadow />;
}

/** Handler end effector: a thin fork, top face at y = 0, wafer centre at x = 0.3. */
function bladeGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.05, -0.03);
  s.lineTo(0.17, -0.03);
  s.lineTo(0.23, -0.05);
  s.lineTo(0.43, -0.05);
  s.quadraticCurveTo(0.445, -0.05, 0.445, -0.036);
  s.lineTo(0.445, -0.026);
  s.lineTo(0.3, -0.022);
  s.lineTo(0.3, 0.022);
  s.lineTo(0.445, 0.026);
  s.lineTo(0.445, 0.036);
  s.quadraticCurveTo(0.445, 0.05, 0.43, 0.05);
  s.lineTo(0.23, 0.05);
  s.lineTo(0.17, 0.03);
  s.lineTo(-0.05, 0.03);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  return g;
}

// ───────────────────────────── process timeline ─────────────────────────────

interface Plan {
  /** Handler blade brings the wafer from the clean/dry module to the load cup. */
  arrive?: [number, number];
  /** Flip face-down, head picks the wafer up, swings over the pad. */
  load: [number, number];
  /** Head on the pad; ends at the step's CMP operation. */
  polish: [number, number];
  /** Swing back, set the wafer in the load cup, flip it face-up. */
  unload: [number, number];
  /** Handler takes the wafer to the cleaner (before a wet step elsewhere). */
  depart?: [number, number];
}

const PLANS: Record<string, Plan> = {
  // fill oxide deposited elsewhere at 0.2; polish to the nitride at 0.7; nitride strip (wet) at 0.9
  'sti-fill': { arrive: [0.22, 0.3], load: [0.42, 0.5], polish: [0.5, 0.7], unload: [0.7, 0.78], depart: [0.82, 0.89] },
  // tungsten deposited at 0.35; polish at 0.75
  'contact-fill': { arrive: [0.37, 0.45], load: [0.47, 0.55], polish: [0.55, 0.75], unload: [0.75, 0.83] },
  // litho/etch/strip elsewhere until 0.55; copper plated at 0.7 (while the wafer is in the head); polish at 0.85
  metal1: { arrive: [0.58, 0.64], load: [0.645, 0.71], polish: [0.71, 0.85], unload: [0.85, 0.915], depart: [0.93, 0.99] },
  // second level: strip at 0.72, copper at 0.84 (hidden, face-down), polish at 0.9
  metal2: { arrive: [0.722, 0.755], load: [0.755, 0.79], polish: [0.79, 0.9], unload: [0.9, 0.965] },
};

interface Frame {
  armTh: number; // swing-arm heading (rotation.y)
  headY: number; // head bottom
  headSpin: number;
  platen: number;
  flip: number; // 0 face-up … 1 face-down (in the cup)
  flipLift: number;
  bladeExt: number; // handler blade: 0 inside the module … 1 over the load cup
  bladeY: number;
  cond: number; // conditioner arm heading (rotation.y)
  condY: number; // conditioner disk lift
  condSpin: number;
  slurry: number; // stream on (0/1)
  wet: number; // slurry film on the pad
  // wafer
  wvis: boolean;
  wx: number;
  wy: number;
  wz: number;
  wrot: number;
  wflip: number;
}

/** Speed near w that turns a whole number of revolutions over the profile [a, b] (ramp r). */
function wholeTurns(a: number, b: number, w: number, dur: number, r = 0.025) {
  const span = (b - a - r) * dur;
  const k = Math.max(1, Math.round((w * span) / TAU));
  return (k * TAU) / span;
}

/** Angle travelled at progress p for a speed profile: ramp up over [a, a+r], hold, ramp down to b. */
function spinTo(p: number, a: number, b: number, w: number, dur: number, r = 0.025) {
  const t = Math.min(p, b) * dur;
  const t0 = a * dur;
  const t1 = (a + r) * dur;
  const t2 = (b - r) * dur;
  const t3 = b * dur;
  if (t <= t0) return 0;
  let ang = 0;
  ang += ((Math.min(t, t1) - t0) ** 2 / (2 * (t1 - t0))) * w;
  if (t > t1) ang += (Math.min(t, t2) - t1) * w;
  if (t > t2) {
    const tt = Math.min(t, t3) - t2;
    ang += w * tt - (tt * tt * w) / (2 * (t3 - t2));
  }
  return ang;
}

const CUP_ROT = 0; // wafer orientation in the cup (notch toward +z)
const COND_PARK = -(285 * Math.PI) / 180;
const COND_IN = -(228 * Math.PI) / 180;
const COND_OUT = -(248 * Math.PI) / 180;

function simulate(p: number, P: Plan, dur: number, f: Frame) {
  const [la, lb] = P.load;
  const [pa, pb] = P.polish;
  const [ua, ub] = P.unload;
  const uL = seg(p, la, lb);
  const uP = seg(p, pa, pb);
  const uU = seg(p, ua, ub);

  // swing arm: over the cup, over the pad during polishing (with a gentle sweep), back again
  const sweep = p > pa && p < pb ? 0.055 * Math.sin(((p - pa) * dur * TAU) / 2.4) * smooth(uP, 0.08, 0.18) * (1 - smooth(uP, 0.85, 0.95)) : 0;
  f.armTh = lerp(TH_CUP, TH_PAD, smooth(uL, 0.8, 1) - smooth(uU, 0, 0.25)) + sweep;

  // head height
  const toCup = CUP_Y + WT;
  const toPad = PAD_Y + WT;
  let hy = HEAD_UP;
  if (p >= la && p < lb) hy = lerp(HEAD_UP, toCup, smooth(uL, 0.3, 0.55) - smooth(uL, 0.65, 0.8));
  else if (p >= pa && p < pb) hy = lerp(HEAD_UP, toPad, smooth(uP, 0, 0.1) - smooth(uP, 0.9, 1));
  else if (p >= ua && p < ub) hy = lerp(HEAD_UP, toCup, smooth(uU, 0.25, 0.45) - smooth(uU, 0.55, 0.7));
  f.headY = hy;

  // rotations (integrated speed profiles)
  f.platen = spinTo(p, pa - 0.01, pb + 0.01, 5.2, dur);
  f.headSpin = spinTo(p, pa + 0.01, pb, wholeTurns(pa + 0.01, pb, 4.6, dur), dur);
  f.condSpin = spinTo(p, pa + 0.02, pb - 0.01, 7, dur);

  // conditioner: swings onto the pad and sweeps while polishing
  const on = smooth(uP, 0.02, 0.1) - smooth(uP, 0.92, 1);
  const osc = 0.5 - 0.5 * Math.cos(((p - pa) * dur * TAU) / 2.8);
  f.cond = lerp(COND_PARK, lerp(COND_IN, COND_OUT, osc), on);
  f.condY = 0.05 * (1 - smooth(uP, 0.08, 0.13) + smooth(uP, 0.9, 0.95));

  // slurry
  f.slurry = p > pa - 0.015 && p < pb - 0.02 ? 1 : 0;
  f.wet = 0.9 * smooth(p, pa - 0.01, pa + 0.06) * (1 - 0.45 * smooth(p, pb, pb + 0.1));

  // flip in the cup (load: face-up → face-down; unload: back to face-up)
  let flip = 0;
  if (p >= la) flip = ease(seg(uL, 0, 0.3));
  if (p >= ua) flip = 1 - ease(seg(uU, 0.7, 1));
  f.flip = flip;
  f.flipLift = 0.16 * Math.sin(Math.PI * flip);

  // handler blade and wafer location
  f.bladeExt = 0;
  f.bladeY = XFER_LO;
  const cupRot = CUP_ROT; // the head turns whole revolutions, so the notch comes back aligned
  const inHead = (p >= la + 0.6 * (lb - la) && p < pa) || (p >= pa && p < pb) || (p >= ua && p < ua + 0.5 * (ub - ua));

  // before arrival / after departure the wafer is elsewhere
  const arrived = !P.arrive || p >= P.arrive[0];
  const departed = P.depart ? p >= P.depart[0] : false;
  f.wvis = true;
  f.wrot = cupRot;
  f.wflip = flip;
  f.wx = LC[0];
  f.wz = LC[1];
  f.wy = CUP_Y + WT / 2 + f.flipLift;
  if (inHead) {
    const hx = PIV[0] + Math.cos(f.armTh) * ARM_L;
    const hz = PIV[1] - Math.sin(f.armTh) * ARM_L;
    f.wx = hx;
    f.wz = hz;
    f.wy = f.headY - WT / 2;
    f.wrot = CUP_ROT + (f.armTh - TH_CUP) + f.headSpin;
    f.wflip = 1;
  }
  if (P.arrive && p < P.arrive[1]) {
    const u = seg(p, P.arrive[0], P.arrive[1]);
    // blade carries the wafer out of the module, over the cup, then drops below the pins
    f.bladeExt = smooth(u, 0, 0.6) - smooth(u, 0.78, 1);
    f.bladeY = lerp(XFER_HI, XFER_LO, smooth(u, 0.6, 0.72));
    if (u < 0.6) {
      f.wx = LC[0] - (1 - f.bladeExt) * BLADE_OUT;
      f.wy = f.bladeY + WT / 2;
      f.wvis = arrived && f.bladeExt > 0.02;
    } else f.wy = Math.max(f.bladeY, CUP_Y) + WT / 2;
  }
  if (P.depart && departed) {
    const u = seg(p, P.depart[0], P.depart[1]);
    f.bladeExt = smooth(u, 0, 0.22) - smooth(u, 0.4, 1);
    f.bladeY = lerp(XFER_LO, XFER_HI, smooth(u, 0.26, 0.36));
    if (u >= 0.4) {
      f.wx = LC[0] - (1 - f.bladeExt) * BLADE_OUT;
      f.wy = f.bladeY + WT / 2;
      f.wvis = f.bladeExt > 0.02;
    } else f.wy = Math.max(f.bladeY, CUP_Y) + WT / 2;
  }
  if (!arrived) f.wvis = false;
}

// ───────────────────────────── parts ─────────────────────────────

function Base() {
  return (
    <group>
      {/* polisher base: white panels, dark kick plate, service doors */}
      <Box size={[1.86, DECK - 0.1, 1.36]} position={[-0.2, 0.08 + (DECK - 0.1) / 2, 0.04]} m="panel" radius={0.02} />
      <Box size={[1.84, 0.08, 1.34]} position={[-0.2, 0.04, 0.04]} m="panelDark" radius={0.01} />
      {[-0.72, -0.1, 0.42].map((x) => (
        <Box key={x} size={[0.008, 0.62, 0.01]} position={[x, 0.46, 0.722]} m="panelGray" radius={0.002} castShadow={false} />
      ))}
      <Box size={[1.88, 0.022, 1.38]} position={[-0.2, DECK - 0.011, 0.04]} m="steelSatin" radius={0.006} />
    </group>
  );
}

function PlatenAssembly({ platen, film, filmMat }: { platen: React.RefObject<THREE.Group | null>; film: React.RefObject<THREE.Mesh | null>; filmMat: THREE.MeshBasicMaterial }) {
  const padTex = useMemo(padTexture, []);
  const padMat = useMemo(() => new THREE.MeshPhysicalMaterial({ map: padTex, roughness: 0.62, clearcoat: 0.35, clearcoatRoughness: 0.4 }), [padTex]);
  useEffect(() => () => {
    padTex.dispose();
    padMat.dispose();
  }, [padTex, padMat]);
  return (
    <group>
      {/* splash basin */}
      <Turned profile={[[0.2, DECK], [0.43, DECK], [0.43, 0.935], [0.412, 0.935], [0.412, 0.83], [0.2, 0.83]]} m={PLASTIC} />
      <Cyl r={0.12} h={0.04} position={[0, DECK + 0.03, 0]} m="steelDark" />
      <group ref={platen}>
        {/* platen table (stainless) and pad */}
        <Turned profile={[[0, 0.855], [0.365, 0.855], [0.378, 0.865], [0.378, 0.911], [0, 0.911]]} m="steel" />
        <mesh position={[0, (0.9112 + PAD_Y - 0.0004) / 2, 0]} material={MAT.black} castShadow receiveShadow>
          <cylinderGeometry args={[R_PAD, R_PAD, PAD_Y - 0.0004 - 0.9112, 96]} />
        </mesh>
        <mesh position={[0, PAD_Y + 0.0004, 0]} rotation={[-Math.PI / 2, 0, 0]} material={padMat} receiveShadow>
          <circleGeometry args={[R_PAD - 0.002, 128]} />
        </mesh>
      </group>
      {/* slurry film: stationary in the lab frame while the pad turns under it */}
      <mesh ref={film} position={[0, PAD_Y + 0.0014, 0]} rotation={[-Math.PI / 2, 0, 0]} material={filmMat} visible={false}>
        <circleGeometry args={[R_PAD - 0.004, 96]} />
      </mesh>
    </group>
  );
}

function SwingArm({ arm, head, headSpin, spindle }: { arm: React.RefObject<THREE.Group | null>; head: React.RefObject<THREE.Group | null>; headSpin: React.RefObject<THREE.Group | null>; spindle: React.RefObject<THREE.Mesh | null> }) {
  const ARM_Y = 1.42;
  return (
    <group position={[PIV[0], 0, PIV[1]]}>
      {/* column */}
      <Cyl r={0.062} h={ARM_Y - DECK} position={[0, (ARM_Y + DECK) / 2, 0]} m="steelSatin" />
      <Cyl r={0.08} h={0.05} position={[0, DECK + 0.025, 0]} m="panelDark" />
      <group ref={arm} position={[0, ARM_Y, 0]}>
        <Cyl r={0.085} h={0.1} position={[0, 0.04, 0]} m="panel" />
        <Box size={[ARM_L + 0.1, 0.1, 0.14]} position={[ARM_L / 2, 0.05, 0]} m="panel" radius={0.03} />
        <Box size={[ARM_L - 0.1, 0.012, 0.142]} position={[ARM_L / 2, 0.02, 0]} m="panelGray" radius={0.004} castShadow={false} />
        {/* spindle drive housing at the head end */}
        <Cyl r={0.085} h={0.16} position={[ARM_L, 0.06, 0]} m="panel" />
        <Cyl r={0.06} h={0.03} position={[ARM_L, 0.155, 0]} m="black" />
        <group position={[ARM_L, 0, 0]}>
          <mesh ref={spindle} position={[0, -0.1, 0]} material={MAT.steel} castShadow>
            <cylinderGeometry args={[0.028, 0.028, 0.42, 24]} />
          </mesh>
          <group ref={head}>
            <group ref={headSpin}>
              {/* carrier head: housing, gimbal, retaining ring */}
              <Turned
                profile={[
                  [0.03, 0.02],
                  [0.172, 0.02],
                  [0.172, 0.05],
                  [0.165, 0.065],
                  [0.13, 0.08],
                  [0.03, 0.08],
                ]}
                m="steelSatin"
              />
              <Turned profile={[[0.152, 0], [0.172, 0], [0.172, 0.02], [0.152, 0.02]]} m={RING} />
              <Cyl r={0.151} h={0.004} position={[0, 0.006, 0]} m="panelDark" />
              <Cyl r={0.07} h={0.04} position={[0, 0.1, 0]} m="steelSatin" />
              {Array.from({ length: 8 }, (_, i) => (
                <Cyl key={i} r={0.006} h={0.008} position={[Math.cos((i / 8) * TAU) * 0.11, 0.084, Math.sin((i / 8) * TAU) * 0.11]} m="chrome" seg={10} />
              ))}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function Conditioner({ arm, disk, lift }: { arm: React.RefObject<THREE.Group | null>; disk: React.RefObject<THREE.Group | null>; lift: React.RefObject<THREE.Group | null> }) {
  const Y = 0.99;
  return (
    <group position={[COND[0], 0, COND[1]]}>
      <Cyl r={0.05} h={Y - DECK + 0.03} position={[0, (Y + DECK) / 2, 0]} m="panel" />
      <group ref={arm} position={[0, Y, 0]}>
        <Cyl r={0.058} h={0.06} m="steelSatin" />
        <Box size={[COND_L + 0.04, 0.05, 0.07]} position={[COND_L / 2, 0.005, 0]} m="panel" radius={0.02} />
        <group ref={lift} position={[COND_L, 0, 0]}>
          <Cyl r={0.035} h={0.05} position={[0, 0.0, 0]} m="black" />
          <Cyl r={0.012} h={0.05} position={[0, -0.04, 0]} m="steel" />
          <group ref={disk} position={[0, PAD_Y - Y, 0]}>
            <Cyl r={0.052} h={0.018} position={[0, 0.012, 0]} m="steelSatin" />
            <Cyl r={0.05} h={0.004} position={[0, 0.002, 0]} m={DIAMOND} />
            <Box size={[0.07, 0.004, 0.01]} position={[0, 0.0215, 0]} m="black" radius={0.001} castShadow={false} />
          </group>
        </group>
      </group>
    </group>
  );
}

function SlurryArm({ stream }: { stream: React.RefObject<THREE.Mesh | null> }) {
  const Y = 1.0;
  const dx = NOZZLE[0] - SLURRY[0];
  const dz = NOZZLE[1] - SLURRY[1];
  const L = Math.hypot(dx, dz);
  const th = Math.atan2(-dz, dx);
  return (
    <group>
      <group position={[SLURRY[0], 0, SLURRY[1]]}>
        <Cyl r={0.035} h={Y - DECK} position={[0, (Y + DECK) / 2, 0]} m="panel" />
        <group position={[0, Y, 0]} rotation={[0, th, 0]}>
          <Cyl r={0.04} h={0.04} m="steelSatin" />
          <Box size={[L + 0.03, 0.03, 0.045]} position={[L / 2, 0.005, 0]} m="panel" radius={0.012} />
          {/* slurry and DI-water lines along the arm */}
          <Cyl r={0.004} h={L} position={[L / 2, 0.026, 0.012]} rotation={[0, 0, Math.PI / 2]} m={SLURRY_MAT} seg={8} />
          <Cyl r={0.004} h={L} position={[L / 2, 0.026, -0.012]} rotation={[0, 0, Math.PI / 2]} m="steel" seg={8} />
          <Cyl r={0.008} h={0.04} position={[L, -0.025, 0]} m="black" />
        </group>
      </group>
      <mesh ref={stream} position={[NOZZLE[0], (PAD_Y + Y - 0.045) / 2, NOZZLE[1]]} material={SLURRY_MAT} visible={false}>
        <cylinderGeometry args={[0.0032, 0.0042, Y - 0.045 - PAD_Y, 12]} />
      </mesh>
    </group>
  );
}

function LoadCup({ clamps }: { clamps: React.RefObject<THREE.Group | null> }) {
  // support pins clear of the handler fork, which enters from −x
  const pins = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 - (2 * Math.PI) / 3];
  return (
    <group position={[LC[0], 0, LC[1]]}>
      <Turned profile={[[0.03, DECK], [0.195, DECK], [0.2, 0.9], [0.2, 0.925], [0.185, 0.925], [0.185, 0.87], [0.03, 0.87]]} m={PLASTIC} />
      <Cyl r={0.045} h={0.05} position={[0, 0.895, 0]} m="steelSatin" />
      {pins.map((a) => (
        <Cyl key={a} r={0.006} h={CUP_Y - 0.87} position={[Math.sin(a) * 0.12, (CUP_Y + 0.87) / 2, Math.cos(a) * 0.12]} m="ceramic" seg={12} />
      ))}
      {/* DI rinse nozzles */}
      {[0.8, 2.9, 5.0].map((a) => (
        <Cyl key={a} r={0.005} h={0.02} position={[Math.sin(a) * 0.17, 0.93, Math.cos(a) * 0.17]} m="steel" seg={10} />
      ))}
      {/* flipper: two edge grippers on the flip axis (z), clear of the handler fork */}
      <group ref={clamps}>
        {[-1, 1].map((s) => (
          <group key={s} position={[0, 0, s * 0.158]}>
            <Box size={[0.05, 0.02, 0.026]} m="black" radius={0.004} />
            <Box size={[0.03, 0.03, 0.012]} position={[0, -0.02, s * 0.02]} m="steelSatin" radius={0.003} />
          </group>
        ))}
      </group>
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, s * 0.235]}>
          <Box size={[0.06, 0.2, 0.04]} position={[0, DECK + 0.1, 0]} m="panelGray" radius={0.008} />
        </group>
      ))}
    </group>
  );
}

function Handler({ blade }: { blade: React.RefObject<THREE.Group | null> }) {
  const geo = useMemo(bladeGeometry, []);
  const x0 = HANDLER_X;
  return (
    <group>
      {/* clean / dry module with its transfer slot (brush boxes behind the window) */}
      <Box size={[0.56, 1.42, 0.8]} position={[x0 - 0.28, 0.71, 0.3]} m="panel" radius={0.02} />
      <Box size={[0.56, 0.08, 0.8]} position={[x0 - 0.28, 1.46, 0.3]} m="panelGray" radius={0.02} />
      <Box size={[0.02, 0.09, 0.44]} position={[x0 + 0.006, 0.945, 0.3]} m="steelSatin" radius={0.006} />
      <Box size={[0.012, 0.04, 0.37]} position={[x0 + 0.012, 0.945, 0.3]} m="black" radius={0.003} castShadow={false} />
      <Box size={[0.3, 0.34, 0.012]} position={[x0 - 0.28, 1.08, 0.701]} m="glassDark" radius={0.004} castShadow={false} />
      {[0, 1].map((i) => (
        <Cyl key={i} r={0.03} h={0.26} position={[x0 - 0.33 + i * 0.1, 1.08, 0.68]} rotation={[0, 0, Math.PI / 2]} m="ceramic" />
      ))}
      <Box size={[0.36, 0.3, 0.012]} position={[x0 - 0.28, 0.45, 0.701]} m="panelGray" radius={0.004} castShadow={false} />
      <LightTower position={[x0 - 0.1, 1.5, 0.05]} on="green" />
      {/* the linear blade that shuttles wafers between the module and the load cup */}
      <group ref={blade} position={[LC[0], XFER_LO, LC[1]]} visible={false}>
        <mesh geometry={geo} material={MAT.ceramic} position={[-0.3, 0, 0]} castShadow />
        <Box size={[0.4, 0.012, 0.05]} position={[-0.55, -0.01, 0]} m="steelSatin" radius={0.004} />
      </group>
    </group>
  );
}

function Tower({ P, position }: { P: Plan; position: V3 }) {
  const b = useProgressBucket(100);
  const busy = b >= P.load[0] && b < P.unload[1];
  return <LightTower position={position} on={busy ? 'violet' : 'green'} />;
}

// ───────────────────────────── scene ─────────────────────────────

export default function Cmp({ variant }: ToolProps) {
  void variant;
  const state = useSimState();
  const { id, content } = useStep();
  const P = PLANS[id] ?? PLANS['contact-fill'];
  const dur = content.duration;

  const platen = useRef<THREE.Group>(null);
  const film = useRef<THREE.Mesh>(null);
  const arm = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const headSpin = useRef<THREE.Group>(null);
  const spindle = useRef<THREE.Mesh>(null);
  const condArm = useRef<THREE.Group>(null);
  const condDisk = useRef<THREE.Group>(null);
  const condLift = useRef<THREE.Group>(null);
  const stream = useRef<THREE.Mesh>(null);
  const clamps = useRef<THREE.Group>(null);
  const blade = useRef<THREE.Group>(null);
  const wafer = useRef<THREE.Group>(null);
  const waferFlip = useRef<THREE.Group>(null);

  const slurryTex = useMemo(slurryTexture, []);
  const filmMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: slurryTex, color: '#f6f4ee', transparent: true, opacity: 0, depthWrite: false }),
    [slurryTex],
  );
  useEffect(() => () => {
    slurryTex.dispose();
    filmMat.dispose();
  }, [slurryTex, filmMat]);

  const f = useMemo<Frame>(
    () => ({ armTh: TH_CUP, headY: HEAD_UP, headSpin: 0, platen: 0, flip: 0, flipLift: 0, bladeExt: 0, bladeY: XFER_LO, cond: COND_PARK, condY: 0.05, condSpin: 0, slurry: 0, wet: 0, wvis: false, wx: 0, wy: 0, wz: 0, wrot: 0, wflip: 0 }),
    [],
  );

  useProgressFrame((p) => {
    simulate(p, P, dur, f);
    if (platen.current) platen.current.rotation.y = f.platen;
    if (film.current) {
      film.current.visible = f.wet > 0.01;
      filmMat.opacity = f.wet;
    }
    if (arm.current) arm.current.rotation.y = f.armTh;
    // the arm group sits at ARM_Y = 1.42; the head hangs below it
    if (head.current) head.current.position.y = f.headY - 1.42;
    if (spindle.current) spindle.current.position.y = f.headY - 1.42 + 0.12 + 0.21;
    if (headSpin.current) headSpin.current.rotation.y = f.headSpin;
    if (condArm.current) condArm.current.rotation.y = f.cond;
    if (condLift.current) condLift.current.position.y = f.condY;
    if (condDisk.current) condDisk.current.rotation.y = f.condSpin;
    if (stream.current) stream.current.visible = f.slurry > 0;
    if (clamps.current) {
      clamps.current.position.y = CUP_Y + WT / 2 + f.flipLift;
      clamps.current.rotation.z = Math.PI * f.flip;
    }
    if (blade.current) {
      blade.current.visible = f.bladeExt > 0.01;
      blade.current.position.x = LC[0] - (1 - f.bladeExt) * BLADE_OUT;
      blade.current.position.y = f.bladeY;
    }
    if (wafer.current) {
      wafer.current.visible = f.wvis;
      wafer.current.position.set(f.wx, f.wy, f.wz);
      wafer.current.rotation.y = f.wrot;
    }
    if (waferFlip.current) waferFlip.current.rotation.z = Math.PI * f.wflip;
  });

  return (
    <group>
      <CleanFloor size={12} />
      <Base />
      <PlatenAssembly platen={platen} film={film} filmMat={filmMat} />
      <SwingArm arm={arm} head={head} headSpin={headSpin} spindle={spindle} />
      <Conditioner arm={condArm} disk={condDisk} lift={condLift} />
      <SlurryArm stream={stream} />
      <LoadCup clamps={clamps} />
      <Handler blade={blade} />
      {/* slurry supply and drain lines under the deck edge */}
      <Pipe pts={[[SLURRY[0], DECK + 0.01, SLURRY[1] - 0.02], [SLURRY[0], DECK + 0.01, -0.64], [SLURRY[0] + 0.3, DECK + 0.01, -0.64]]} r={0.006} m={SLURRY_MAT} />
      {/* back wall with the slurry delivery cabinet */}
      <Box size={[0.5, 1.5, 0.35]} position={[0.45, 0.75, -0.82]} m="panelWarm" radius={0.02} />
      <Box size={[0.3, 0.4, 0.012]} position={[0.45, 1.1, -0.643]} m="glassDark" radius={0.004} castShadow={false} />
      <Tower P={P} position={[0.62, 1.5, -0.9]} />
      {/* the simulated wafer: face-up in the cup, face-down in the head */}
      <group ref={wafer} visible={false}>
        <group ref={waferFlip}>
          <group position={[0, -WT / 2, 0]}>
            <Wafer anchor look={{ summary: state.wafer, showParticles: true }} size={768} />
            <mesh position={[0, -0.0002, 0]} rotation={[Math.PI / 2, 0, 0]} material={BACKSIDE}>
              <circleGeometry args={[0.1495, 96]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}
