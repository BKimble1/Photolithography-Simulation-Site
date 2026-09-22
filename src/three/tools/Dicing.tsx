/**
 * Illustrative dicing saw (blade dicing), not any manufacturer's design:
 *  - the wafer is mounted on translucent dicing tape stretched across a steel ring frame,
 *    held on a porous vacuum chuck table that can turn 90° (θ);
 *  - a spindle carries a thin diamond blade on a hub under a blade cover, with a shower
 *    nozzle and blade coolers spraying water at the cut;
 *  - the table feeds the wafer under the blade along one scribe street at a time (cutting in
 *    both directions), the spindle lifts and indexes to the next street; after the first
 *    direction the table turns 90° and the other streets are cut.
 * The cuts drawn here grow with the blade until the process model marks the wafer diced
 * (p = 0.5); from then on the wafer texture shows every cut. The first cuts run at a
 * readable pace, the rest fast-forward. Motion is a pure function of progress p (water
 * droplets use wall-clock time as idle motion).
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { WAFER } from '../../sim/dies';
import { useSimState } from '../../state/sim';
import { lerp, seg, smooth, useProgressFrame } from '../anim';
import { Box, CleanFloor, Cyl, LightTower, mat } from '../kit/parts';
import { MAT, type MatKey } from '../materials';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';

// ───────────────────────────── geometry (metres) ─────────────────────────────

const PAN_Y = 0.8; // drain pan (chamber floor)
const CHUCK_TOP = 0.915;
const TAPE_T = 0.0002;
const TAPE_Y = CHUCK_TOP; // tape underside
const WAFER_Y = TAPE_Y + TAPE_T; // wafer underside
const WAFER_T = 0.0016;
const TZ0 = 0.0; // table centre z
const BLADE_R = 0.029;
const BLADE_T = 0.0008; // exaggerated (a real blade is ~20–30 µm thick)
const BLADE_CUT_Y = TAPE_Y + 0.00005 + BLADE_R; // blade centre while cutting (just into the tape)
const LIFT = 0.012; // lift while indexing between streets
const PARK = 0.045; // raised clear of the wafer
const R = WAFER.radius / 1000;
const MARGIN = 0.012;

// ───────────────────────────── cut schedule ─────────────────────────────

interface Cut {
  ch: 0 | 1;
  /** street coordinate in wafer mm: y for channel 0 (cut along x), x for channel 1 */
  s: number;
  /** half chord of the wafer along this street (m) */
  hc: number;
}

const CH0: Cut[] = [];
for (let k = -9; k <= 9; k++) CH0.push({ ch: 0, s: k * WAFER.dieH, hc: Math.sqrt(Math.max(0, R * R - ((k * WAFER.dieH) / 1000) ** 2)) });
const CH1: Cut[] = [];
for (let k = -11; k <= 11; k++) CH1.push({ ch: 1, s: k * WAFER.dieW, hc: Math.sqrt(Math.max(0, R * R - ((k * WAFER.dieW) / 1000) ** 2)) });
const CUTS = [...CH0, ...CH1];

// progress windows
const C0 = [0.035, 0.265] as const; // channel 0
const ROT = [0.268, 0.3] as const; // turn the table 90°
const C1 = [0.305, 0.485] as const; // channel 1
const SLOW = 2; // the first cuts of channel 0 at a readable pace
const SLOW_SHARE = 0.42; // share of the channel-0 window for the slow cuts

/** Continuous cut cursor within a channel: integer = cut index, fraction = phase. */
function channelCursor(p: number, ch: 0 | 1): number {
  const n = ch === 0 ? CH0.length : CH1.length;
  const [a, b] = ch === 0 ? C0 : C1;
  const t = seg(p, a, b);
  if (ch === 1) return t * n;
  // channel 0: SLOW cuts take SLOW_SHARE of the window, the rest share the remainder
  if (t < SLOW_SHARE) return (t / SLOW_SHARE) * SLOW;
  return SLOW + ((t - SLOW_SHARE) / (1 - SLOW_SHARE)) * (n - SLOW);
}

interface SawPose {
  theta: number; // table rotation
  tx: number; // table x
  bz: number; // spindle (blade) z
  by: number; // blade centre height
  cutting: boolean;
  coolant: boolean;
  /** number of completed cuts (0..CUTS.length) and the current partial cut */
  done: number;
  partial: { cut: Cut; from: number; to: number } | null;
}

function strokePose(cut: Cut, idx: number, f: number) {
  // bidirectional cutting: even cuts feed one way, odd cuts the other
  const dir = idx % 2 === 0 ? 1 : -1;
  const L = cut.hc + MARGIN;
  const tf = smooth(f, 0.1, 0.9);
  const u = dir * lerp(-L, L, tf); // blade position along the street (local, m)
  const lift = f < 0.1 ? 1 - smooth(f, 0.0, 0.1) : f > 0.9 ? smooth(f, 0.9, 1.0) : 0;
  const cu = Math.max(-cut.hc, Math.min(cut.hc, u));
  const from = dir > 0 ? -cut.hc : cu;
  const to = dir > 0 ? cu : cut.hc;
  return { u, lift, from, to, dir };
}

/** Table x where the last stroke of a channel ends (tx = −u at the end of the stroke). */
function strokeEndX(list: Cut[]): number {
  const i = list.length - 1;
  const dir = i % 2 === 0 ? 1 : -1;
  return -dir * (list[i].hc + MARGIN);
}

/** Street offset in world z for a cut (blade must sit over the street). */
const streetZ = (cut: Cut) => TZ0 - cut.s / 1000;

function sawPose(p: number): SawPose {
  const park: SawPose = { theta: 0, tx: 0, bz: streetZ(CH0[0]), by: BLADE_CUT_Y + PARK, cutting: false, coolant: false, done: 0, partial: null };
  if (p < C0[0]) {
    // approach: table to the start of the first stroke, blade over the first street
    const t = smooth(p, 0.0, C0[0]);
    const L = CH0[0].hc + MARGIN;
    return { ...park, tx: lerp(0, L, t), by: BLADE_CUT_Y + lerp(PARK, LIFT, t), coolant: p > 0.02 };
  }
  if (p < C0[1] || (p >= C1[0] && p < C1[1])) {
    const ch: 0 | 1 = p < C0[1] ? 0 : 1;
    const list = ch === 0 ? CH0 : CH1;
    const c = Math.min(list.length - 1e-6, channelCursor(p, ch));
    const i = Math.floor(c);
    const f = c - i;
    const cut = list[i];
    const s = strokePose(cut, i, f);
    // index the spindle between streets while lifted
    const next = list[Math.min(list.length - 1, i + 1)];
    const zIdx = f > 0.9 ? smooth(f, 0.92, 1.0) : 0;
    const bz = lerp(streetZ(cut), streetZ(next), zIdx);
    const base = ch === 0 ? 0 : CH0.length;
    return {
      theta: ch === 0 ? 0 : Math.PI / 2,
      tx: -s.u,
      bz,
      by: BLADE_CUT_Y + LIFT * s.lift,
      cutting: s.lift < 0.5,
      coolant: true,
      done: base + i,
      partial: { cut, from: s.from, to: s.to },
    };
  }
  if (p < C1[0]) {
    // turn the table: lift, centre, rotate 90°, go to the first stroke of channel 1
    const txEnd = strokeEndX(CH0);
    const t1 = smooth(p, C0[1], ROT[0] + 0.004);
    const t2 = smooth(p, ROT[0], ROT[1]);
    const t3 = smooth(p, ROT[1], C1[0]);
    const firstL = CH1[0].hc + MARGIN;
    const tx = t3 > 0 ? lerp(0, firstL, t3) : lerp(txEnd, 0, t1);
    return {
      theta: (Math.PI / 2) * t2,
      tx,
      bz: lerp(streetZ(CH0[CH0.length - 1]), streetZ(CH1[0]), t2),
      by: BLADE_CUT_Y + lerp(LIFT, PARK * 0.6, t1) * (1 - t3) + LIFT * t3,
      cutting: false,
      coolant: true,
      done: CH0.length,
      partial: null,
    };
  }
  // finished: lift, stop water, bring the table back and turn it home
  const t1 = smooth(p, C1[1], 0.53);
  const t2 = smooth(p, 0.53, 0.64);
  return {
    theta: (Math.PI / 2) * (1 - t2),
    tx: lerp(strokeEndX(CH1), 0, t1),
    bz: lerp(streetZ(CH1[CH1.length - 1]), TZ0 - 0.21, smooth(p, 0.53, 0.66)),
    by: BLADE_CUT_Y + lerp(LIFT, PARK, t1),
    cutting: false,
    coolant: p < 0.5,
    done: CUTS.length,
    partial: null,
  };
}

// ───────────────────────────── helpers ─────────────────────────────

/** Ring frame for tape mounting: an annulus with two flats, lying flat, 1.2 mm thick. */
function useRingFrameGeometry() {
  return useMemo(() => {
    const ro = 0.2;
    const ri = 0.176;
    const flat = 0.188; // x position of the side flats
    const s = new THREE.Shape();
    const n = 96;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let x = Math.cos(a) * ro;
      const y = Math.sin(a) * ro;
      if (Math.abs(x) > flat) x = Math.sign(x) * flat;
      pts.push(new THREE.Vector2(x, y));
    }
    s.setFromPoints(pts);
    const hole = new THREE.Path();
    hole.absarc(0, 0, ri, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.0012, bevelEnabled: false, curveSegments: 64 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
}

const tapeMat = new THREE.MeshPhysicalMaterial({ color: '#8fb3dc', roughness: 0.35, metalness: 0, transparent: true, opacity: 0.62, clearcoat: 0.6, depthWrite: false });
const chuckMat = new THREE.MeshStandardMaterial({ color: '#4a4d52', roughness: 0.85, metalness: 0.05 });
const bladeMat = new THREE.MeshStandardMaterial({ color: '#a7abb1', roughness: 0.5, metalness: 0.8 });
const bladeEdgeMat = new THREE.MeshStandardMaterial({ color: '#5d6168', roughness: 0.85, metalness: 0.4 });
const kerfMat = new THREE.MeshStandardMaterial({ color: '#25272b', roughness: 0.5, metalness: 0.2 });
const bellowsMat = new THREE.MeshStandardMaterial({ color: '#3b3e44', roughness: 0.8, metalness: 0.1 });
const sprayMat = new THREE.MeshBasicMaterial({ color: '#e9f5ff', transparent: true, opacity: 0.32, depthWrite: false });
const dropMat = new THREE.MeshBasicMaterial({ color: '#f2f9ff', transparent: true, opacity: 0.7, depthWrite: false });

/** Accordion (bellows) cover over the X axis on one side of the table. */
function Bellows({ side, groupRef }: { side: -1 | 1; groupRef: React.RefObject<THREE.Group | null> }) {
  const pleats = 22;
  return (
    <group ref={groupRef}>
      <mesh position={[side * 0.5, -0.004, 0]} material={MAT.black} castShadow={false} receiveShadow>
        <boxGeometry args={[1, 0.008, 0.3]} />
      </mesh>
      {Array.from({ length: pleats }, (_, i) => (
        <mesh key={i} position={[side * (i + 0.5) / pleats, 0.002, 0]} material={bellowsMat} castShadow={false} receiveShadow>
          <boxGeometry args={[0.45 / pleats, 0.008, 0.3]} />
        </mesh>
      ))}
    </group>
  );
}

/** A thin straight tube between two points (nozzles, water streams). */
function Tube({ a, b, r, m }: { a: [number, number, number]; b: [number, number, number]; r: number; m: MatKey | THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va);
    return {
      pos: va.clone().add(vb).multiplyScalar(0.5),
      quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()),
      len: d.length(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.join(','), b.join(',')]);
  return (
    <mesh position={pos} quaternion={quat} material={mat(m)} castShadow={false}>
      <cylinderGeometry args={[r, r, len, 10]} />
    </mesh>
  );
}

// ───────────────────────────── spindle ─────────────────────────────

const N_DROPS = 36;

function Spindle({ groupRef, bladeRef, waterRef, dropsRef }: {
  groupRef: React.RefObject<THREE.Group | null>;
  bladeRef: React.RefObject<THREE.Group | null>;
  waterRef: React.RefObject<THREE.Group | null>;
  dropsRef: React.RefObject<THREE.InstancedMesh | null>;
}) {
  // blade cover: back plate and a curved hood over the top, open toward the viewer
  const hood = useMemo(() => {
    // after the rotation a cylinder angle θ sits at height −cos θ: θ ∈ (π/2, 3π/2) is the top half
    const g = new THREE.CylinderGeometry(0.037, 0.037, 0.022, 40, 1, true, Math.PI * 0.62, Math.PI * 0.62);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  return (
    <group ref={groupRef}>
      {/* origin = blade centre; spindle axis along z, housing extends toward −z */}
      <group ref={bladeRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={bladeMat} castShadow>
          <cylinderGeometry args={[BLADE_R - 0.002, BLADE_R - 0.002, BLADE_T, 72]} />
        </mesh>
        <mesh material={bladeEdgeMat}>
          <torusGeometry args={[BLADE_R - 0.001, 0.0011, 6, 96]} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.002]} material={MAT.aluminum} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.004, 48]} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.0025]} material={MAT.steel}>
          <cylinderGeometry args={[0.011, 0.011, 0.004, 32]} />
        </mesh>
        {[0, 2.1, 4.2].map((a) => (
          <mesh key={a} rotation={[Math.PI / 2, 0, 0]} position={[Math.cos(a) * 0.0065, Math.sin(a) * 0.0065, 0.0047]} material={MAT.black}>
            <cylinderGeometry args={[0.0015, 0.0015, 0.001, 12]} />
          </mesh>
        ))}
      </group>
      {/* spindle housing and motor */}
      <Cyl r={0.013} h={0.02} position={[0, 0, -0.012]} rotation={[Math.PI / 2, 0, 0]} m="steel" seg={32} />
      <Cyl r={0.033} h={0.2} position={[0, 0, -0.12]} rotation={[Math.PI / 2, 0, 0]} m="aluminum" seg={48} />
      <Cyl r={0.035} h={0.01} position={[0, 0, -0.03]} rotation={[Math.PI / 2, 0, 0]} m="black" seg={48} />
      <Box size={[0.085, 0.085, 0.11]} position={[0, 0.004, -0.27]} m="panel" radius={0.012} />
      {/* Z slide and Y carriage up to the overhead beam */}
      <Box size={[0.06, 0.24, 0.024]} position={[0, 0.14, -0.2]} m="steelSatin" radius={0.006} />
      <Box size={[0.012, 0.22, 0.028]} position={[0, 0.14, -0.2]} m="black" radius={0.003} castShadow={false} />
      <Box size={[0.12, 0.036, 0.12]} position={[0, 0.262, -0.2]} m="panelGray" radius={0.008} />
      {/* blade cover */}
      <mesh geometry={hood} position={[0, 0, -0.005]} material={MAT.aluminum} castShadow />
      <mesh position={[0, 0.02, -0.016]} material={MAT.aluminum} castShadow>
        <boxGeometry args={[0.07, 0.036, 0.002]} />
      </mesh>
      {/* shower nozzle (front) and blade coolers (either side of the blade) */}
      <Tube a={[0.03, 0.03, -0.012]} b={[0.05, 0.012, 0.022]} r={0.0022} m="steel" />
      <Tube a={[0.05, 0.012, 0.022]} b={[0.034, -0.012, 0.03]} r={0.0022} m="steel" />
      {[-1, 1].map((sz) => (
        <group key={sz}>
          <Tube a={[-0.052, 0.006, sz * 0.0055]} b={[0.03, -0.016, sz * 0.0055]} r={0.0016} m="steel" />
        </group>
      ))}
      {/* water: streams onto the blade and the cut, and a thin fan of spray */}
      <group ref={waterRef}>
        <Tube a={[0.034, -0.012, 0.03]} b={[0.006, -BLADE_R + 0.0015, 0.004]} r={0.0022} m={sprayMat} />
        {[-1, 1].map((sz) => (
          <Tube key={sz} a={[0.03, -0.016, sz * 0.0055]} b={[0.012, -BLADE_R + 0.004, sz * 0.001]} r={0.0016} m={sprayMat} />
        ))}
        <mesh position={[-0.02, -BLADE_R + 0.004, 0]} rotation={[0, 0, 0.35]} material={sprayMat}>
          <coneGeometry args={[0.012, 0.04, 16, 1, true]} />
        </mesh>
      </group>
      <instancedMesh ref={dropsRef} args={[undefined, undefined, N_DROPS]} material={dropMat} frustumCulled={false}>
        <sphereGeometry args={[0.0011, 6, 4]} />
      </instancedMesh>
    </group>
  );
}

// ───────────────────────────── scene ─────────────────────────────

export default function Dicing({ variant }: ToolProps) {
  void variant;
  const state = useSimState();
  const frameGeo = useRingFrameGeometry();
  const table = useRef<THREE.Group>(null);
  const rot = useRef<THREE.Group>(null);
  const spindle = useRef<THREE.Group>(null);
  const blade = useRef<THREE.Group>(null);
  const water = useRef<THREE.Group>(null);
  const drops = useRef<THREE.InstancedMesh>(null);
  const kerf = useRef<THREE.InstancedMesh>(null);
  const bellowsL = useRef<THREE.Group>(null);
  const bellowsR = useRef<THREE.Group>(null);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), yAxis: new THREE.Vector3(0, 1, 0) }), []);

  useLayoutEffect(() => {
    if (kerf.current) kerf.current.count = 0;
  }, []);

  useProgressFrame((p, t) => {
    const s = sawPose(p);
    if (table.current) table.current.position.x = s.tx;
    if (rot.current) rot.current.rotation.y = s.theta;
    if (spindle.current) spindle.current.position.set(0, s.by, s.bz);
    // blade spin: fast while the process runs, spinning down at the end
    const spinRate = 60 * (1 - smooth(p, 0.62, 0.9));
    if (blade.current) blade.current.rotation.z = -(t * spinRate) % (Math.PI * 2);
    if (water.current) water.current.visible = s.coolant;
    // bellows compress / extend with the table
    const half = 0.6 - 0.22;
    if (bellowsL.current) {
      const len = Math.max(0.02, half + s.tx);
      bellowsL.current.scale.x = len;
      bellowsL.current.position.x = s.tx - 0.22;
    }
    if (bellowsR.current) {
      const len = Math.max(0.02, half - s.tx);
      bellowsR.current.scale.x = len;
      bellowsR.current.position.x = s.tx + 0.22;
    }
    // cuts: completed ones full length, the current one up to the blade
    const k = kerf.current;
    if (k) {
      let n = 0;
      if (p < 0.5) {
        const put = (cut: Cut, from: number, to: number) => {
          if (to - from < 0.0005) return;
          const mid = (from + to) / 2;
          const street = cut.ch === 0 ? -cut.s / 1000 : cut.s / 1000;
          if (cut.ch === 0) {
            tmp.p.set(mid, WAFER_Y + WAFER_T + 0.00012, street);
            tmp.q.identity();
          } else {
            // channel 1 streets run along local z (x = const)
            tmp.p.set(street, WAFER_Y + WAFER_T + 0.00012, mid);
            tmp.q.setFromAxisAngle(tmp.yAxis, Math.PI / 2);
          }
          tmp.s.set(to - from, 1, 1);
          tmp.m.compose(tmp.p, tmp.q, tmp.s);
          k.setMatrixAt(n++, tmp.m);
        };
        for (let i = 0; i < s.done && i < CUTS.length; i++) put(CUTS[i], -CUTS[i].hc, CUTS[i].hc);
        // the stroke coordinate u is local x (channel 0) or local z (channel 1)
        if (s.partial) put(s.partial.cut, s.partial.from, s.partial.to);
      }
      k.count = n;
      k.instanceMatrix.needsUpdate = true;
    }
    // droplets thrown off where the blade leaves the cut (idle motion by wall-clock time)
    const d = drops.current;
    if (d) {
      d.visible = s.cutting && s.coolant;
      if (d.visible) {
        for (let i = 0; i < N_DROPS; i++) {
          const life = 0.35 + (i % 5) * 0.05;
          const tau = (t * 1.3 + i * 0.137) % life;
          const ang = 0.25 + ((i * 7) % 11) * 0.06;
          const sp = 0.5 + ((i * 3) % 7) * 0.06;
          const side = i % 2 === 0 ? -1 : 1;
          tmp.p.set(
            -0.012 - Math.cos(ang) * sp * tau,
            -BLADE_R + 0.002 + Math.sin(ang) * sp * tau - 4.9 * tau * tau,
            side * (0.002 + ((i * 5) % 9) * 0.0012) * (1 + tau * 6),
          );
          tmp.q.identity();
          tmp.s.setScalar(1 - tau / life);
          tmp.m.compose(tmp.p, tmp.q, tmp.s);
          d.setMatrixAt(i, tmp.m);
        }
        d.instanceMatrix.needsUpdate = true;
      }
    }
  });

  return (
    <group>
      <CleanFloor size={12} />
      {/* ── machine body ── */}
      <Box size={[1.3, 0.08, 1.0]} position={[0, 0.04, 0]} m="panelGray" radius={0.01} />
      <Box size={[1.3, PAN_Y - 0.08, 1.0]} position={[0, 0.08 + (PAN_Y - 0.08) / 2, 0]} m="panel" radius={0.02} />
      <Box size={[1.22, 0.012, 0.01]} position={[0, 0.52, 0.502]} m="panelGray" radius={0.002} castShadow={false} />
      <Box size={[1.3, 0.022, 0.022]} position={[0, PAN_Y - 0.01, 0.49]} m="black" radius={0.004} castShadow={false} />
      {/* drain pan / chamber floor */}
      <Box size={[1.24, 0.02, 0.94]} position={[0, PAN_Y + 0.01, 0]} m="steelSatin" radius={0.006} />
      {/* chamber: back wall, left wall and a roof strip at the back; front and right cut away */}
      <Box size={[1.3, 0.7, 0.03]} position={[0, PAN_Y + 0.35, -0.485]} m="panel" radius={0.008} />
      <Box size={[0.03, 0.7, 1.0]} position={[-0.635, PAN_Y + 0.35, 0]} m="panel" radius={0.008} />
      <Box size={[1.3, 0.03, 0.34]} position={[0, PAN_Y + 0.7, -0.33]} m="panel" radius={0.008} />
      <Box size={[0.5, 0.18, 0.012]} position={[-0.3, PAN_Y + 0.44, -0.468]} m="glassDark" radius={0.004} castShadow={false} />
      {/* overhead beam carrying the spindle (Y axis along z), fixed to the back wall */}
      <Box size={[0.13, 0.07, 0.52]} position={[0, BLADE_CUT_Y + 0.33, -0.23]} m="panel" radius={0.012} />
      {[-0.04, 0.04].map((x) => (
        <Box key={x} size={[0.014, 0.012, 0.5]} position={[x, BLADE_CUT_Y + 0.29, -0.23]} m="steel" radius={0.003} />
      ))}
      {/* X-axis rail cover and bellows */}
      <Box size={[1.2, 0.03, 0.5]} position={[0, PAN_Y + 0.035, 0]} m="steelDark" radius={0.006} />
      <group position={[0, PAN_Y + 0.062, 0]}>
        <Bellows side={-1} groupRef={bellowsL} />
        <Bellows side={1} groupRef={bellowsR} />
      </group>
      {/* ── chuck table (feeds in x, turns in θ) ── */}
      <group ref={table} position={[0, 0, TZ0]}>
        <Box size={[0.44, 0.05, 0.46]} position={[0, PAN_Y + 0.075, 0]} m="steelDark" radius={0.008} />
        <group ref={rot}>
          <Cyl r={0.21} h={0.04} position={[0, CHUCK_TOP - 0.035, 0]} m="steelSatin" seg={96} />
          <mesh position={[0, CHUCK_TOP - 0.0075, 0]} material={chuckMat} receiveShadow>
            <cylinderGeometry args={[0.162, 0.162, 0.015, 96]} />
          </mesh>
          {/* frame clamps */}
          {[0.785, 2.356, 3.927, 5.498].map((a) => (
            <Box key={a} size={[0.03, 0.012, 0.022]} position={[Math.sin(a) * 0.205, TAPE_Y + 0.004, Math.cos(a) * 0.205]} rotation={[0, a, 0]} m="black" radius={0.003} />
          ))}
          {/* tape, frame and wafer */}
          <mesh position={[0, TAPE_Y + TAPE_T / 2, 0]} material={tapeMat} renderOrder={2}>
            <cylinderGeometry args={[0.196, 0.196, TAPE_T, 96]} />
          </mesh>
          <mesh geometry={frameGeo} position={[0, TAPE_Y + TAPE_T, 0]} material={MAT.steel} castShadow receiveShadow />
          <Wafer look={{ summary: state.wafer, showParticles: true }} position={[0, WAFER_Y, 0]} size={768} />
          <instancedMesh ref={kerf} args={[undefined, undefined, CUTS.length]} material={kerfMat} frustumCulled={false}>
            <boxGeometry args={[1, 0.0004, 0.0007]} />
          </instancedMesh>
        </group>
      </group>
      {/* ── spindle ── */}
      <Spindle groupRef={spindle} bladeRef={blade} waterRef={water} dropsRef={drops} />
      {/* spinner (clean / dry) station at the left, lid closed */}
      <group position={[-0.47, 0, -0.3]}>
        <Cyl r={0.1} h={0.07} position={[0, PAN_Y + 0.055, 0]} m="steelSatin" seg={64} />
        <Cyl r={0.104} h={0.01} position={[0, PAN_Y + 0.095, 0]} m="polycarbonate" seg={64} />
      </group>
      {/* operator panel on an arm */}
      <group position={[0.78, 0, 0.36]}>
        <Box size={[0.04, 0.5, 0.04]} position={[0, PAN_Y + 0.25, 0]} m="steelSatin" radius={0.01} />
        <group position={[0, PAN_Y + 0.56, 0]} rotation={[-0.2, -0.5, 0]}>
          <Box size={[0.32, 0.22, 0.03]} m="panelDark" radius={0.01} />
          <Box size={[0.28, 0.18, 0.004]} position={[0, 0, 0.016]} m="screen" radius={0.003} castShadow={false} />
        </group>
      </group>
      <LightTower position={[-0.52, PAN_Y + 0.7, -0.38]} on="violet" />
    </group>
  );
}
