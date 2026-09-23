/**
 * Vertical batch furnace in cutaway (illustrative, no manufacturer's design). A quartz boat
 * holding a batch of wafers stands on a seal cap in the load area; an elevator lifts it into a
 * quartz process tube surrounded by a resistance-heated jacket (a quarter is cut away so the
 * tube, the heater coils and the boat are visible). The furnace idles at a standby
 * temperature, ramps up once the tube is sealed, and cools before the boat is lowered.
 *  - 'oxidize': dry oxidation (hot), then a cooler LPCVD nitride step with a different gas mix.
 *  - 'anneal': a shorter, calmer cycle in nitrogen.
 * Heater glow is real thermal emission, kept subtle. Motion is a pure function of progress p.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimState } from '../../state/sim';
import { clamp01, lerp, smooth, useProgressFrame } from '../anim';
import { MAT } from '../materials';
import { Box, CleanFloor, Cyl, Lathe, LightTower } from '../kit/parts';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';

type V3 = [number, number, number];

// ───────────────────────────── layout (metres) ─────────────────────────────

const AX = { x: 0, z: -0.12 }; // process-tube axis
const CAB = { x0: -0.6, x1: 0.6, z0: -0.75, z1: 0.65, top: 2.6 };
const FLANGE_Y = 1.33; // underside of the tube manifold: the seal cap closes against it
const CAP_UP = FLANGE_Y; // seal-cap top when the boat is in the tube
const CAP_DOWN = 0.3; // seal-cap top in the load area
const HEAT = { y0: 1.42, y1: 2.5, rIn: 0.25, rOut: 0.36 };
const TUBE_R = 0.2;
const N_WAFERS = 50;
const W_PITCH = 0.0115;
const W_Y0 = 0.27; // first wafer above the seal cap
const TOP_SLOT_Y = W_Y0 + (N_WAFERS - 1) * W_PITCH;
// cutaway wedge of the heater jacket, centred toward the camera (front-right)
const CUT_MID = Math.atan2(0.62, 0.78);
const CUT_HALF = Math.PI / 4;
const JACKET_START = CUT_MID + CUT_HALF;
const JACKET_LEN = Math.PI * 2 - 2 * CUT_HALF;

// ───────────────────────────── cycle profiles ─────────────────────────────

interface Cycle {
  dur: number;
  up: [number, number];
  down: [number, number];
  /** temperature keyframes [p, T] with T: 0 = cold, 0.25 standby, 1 = oxidation */
  temp: [number, number][];
  /** boat turns this many radians over the hot part of the cycle */
  turn: number;
  gas: [number, number][]; // [p, which line: 0 none, 1 O2, 2 DCS+NH3, 3 N2]
}

const CYCLES: Record<string, Cycle> = {
  oxidize: {
    dur: 11,
    up: [0.02, 0.28],
    down: [0.87, 0.99],
    temp: [
      [0, 0.28],
      [0.28, 0.28],
      [0.36, 1],
      [0.55, 1],
      [0.62, 0.74],
      [0.84, 0.74],
      [0.9, 0.3],
      [1, 0.28],
    ],
    turn: 2.4,
    gas: [
      [0.3, 1],
      [0.58, 3],
      [0.62, 2],
      [0.84, 3],
    ],
  },
  anneal: {
    dur: 8,
    up: [0.02, 0.28],
    down: [0.82, 0.98],
    temp: [
      [0, 0.28],
      [0.28, 0.28],
      [0.38, 0.86],
      [0.74, 0.86],
      [0.82, 0.32],
      [1, 0.28],
    ],
    turn: 1.2,
    gas: [[0.28, 3]],
  },
};

function keyed(p: number, keys: [number, number][]) {
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [p0, v0] = keys[i];
    const [p1, v1] = keys[i + 1];
    if (p <= p1) return lerp(v0, v1, smooth(p, p0, p1));
  }
  return keys[keys.length - 1][1];
}

function gasAt(p: number, keys: [number, number][]) {
  let g = 0;
  for (const [pk, v] of keys) if (p >= pk) g = v;
  return g;
}

// ───────────────────────────── materials ─────────────────────────────

const FM = {
  quartz: (() => {
    const m = (MAT.quartz as THREE.MeshPhysicalMaterial).clone();
    m.side = THREE.DoubleSide;
    m.opacity = 0.14;
    return m;
  })(),
  quartzSolid: new THREE.MeshPhysicalMaterial({ color: '#eef3f6', roughness: 0.12, transparent: true, opacity: 0.42, clearcoat: 1, depthWrite: false }),
  insulation: new THREE.MeshStandardMaterial({ color: '#e7ddcc', roughness: 0.92, metalness: 0 }),
  insulationCut: new THREE.MeshStandardMaterial({ color: '#efe6d6', roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
  si: new THREE.MeshStandardMaterial({ color: '#9aa1ad', metalness: 0.72, roughness: 0.14, emissive: '#ff7a1c', emissiveIntensity: 0 }),
};

// ───────────────────────────── helpers ─────────────────────────────

/** Tube along a polyline with rounded corners (for gas lines). */
function pipeGeometry(points: V3[], r: number, bend = 0.04): THREE.TubeGeometry {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const P = points.map((q) => new THREE.Vector3(...q));
  let start = P[0].clone();
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1];
    const b = P[i];
    const c = P[i + 1];
    const d1 = b.clone().sub(a);
    const d2 = c.clone().sub(b);
    const k = Math.min(bend, d1.length() / 2, d2.length() / 2);
    const p1 = b.clone().sub(d1.normalize().multiplyScalar(k));
    const p2 = b.clone().add(d2.normalize().multiplyScalar(k));
    path.add(new THREE.LineCurve3(start, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
    start = p2;
  }
  path.add(new THREE.LineCurve3(start, P[P.length - 1]));
  return new THREE.TubeGeometry(path, Math.max(24, points.length * 16), r, 10, false);
}

function Pipe({ points, r = 0.006, m = 'steel' as const }: { points: V3[]; r?: number; m?: 'steel' | 'steelSatin' | 'chrome' }) {
  const geo = useMemo(() => pipeGeometry(points, r), [points, r]);
  return <mesh geometry={geo} material={MAT[m]} castShadow />;
}

function Valve({ position, rot = 0 }: { position: V3; rot?: number }) {
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <Box size={[0.034, 0.034, 0.034]} m="steel" radius={0.004} />
      <Cyl r={0.013} h={0.04} position={[0, 0.036, 0]} m="black" seg={20} />
      <Cyl r={0.014} h={0.006} position={[0, 0.058, 0]} m="steelSatin" seg={20} />
    </group>
  );
}

// ───────────────────────────── furnace parts ─────────────────────────────

function HeaterJacket({ glowMat, coilMat }: { glowMat: THREE.Material; coilMat: THREE.Material }) {
  const h = HEAT.y1 - HEAT.y0;
  const coilRef = useRef<THREE.InstancedMesh>(null);
  const coils = 28;
  const coilGeo = useMemo(() => {
    const g = new THREE.TorusGeometry(HEAT.rIn - 0.004, 0.0045, 6, 72, JACKET_LEN);
    // torus arc starts at +x in its plane; lay it flat and align the arc with the jacket
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  useLayoutEffect(() => {
    const im = coilRef.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    // after rotateX(π/2) the arc spans jacket angles [π/2 − len, π/2] (angle a ↔ direction
    // (sin a, cos a)); turning it about y by β shifts that range to [start, start + len].
    const rotY = new THREE.Matrix4().makeRotationY(JACKET_START + JACKET_LEN - Math.PI / 2);
    for (let i = 0; i < coils; i++) {
      m.copy(rotY);
      m.setPosition(0, 0.05 + (i / (coils - 1)) * (h - 0.1), 0);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  }, [h]);
  // cut faces of the insulation at the two edges of the wedge
  const faces = [JACKET_START, JACKET_START + JACKET_LEN].map((a) => ({
    a,
    x: Math.sin(a) * ((HEAT.rIn + HEAT.rOut) / 2),
    z: Math.cos(a) * ((HEAT.rIn + HEAT.rOut) / 2),
  }));
  return (
    <group position={[AX.x, HEAT.y0, AX.z]}>
      {/* stainless outer shell (water-cooled) */}
      <mesh position={[0, h / 2, 0]} material={MAT.steelSatin} castShadow receiveShadow>
        <cylinderGeometry args={[HEAT.rOut + 0.012, HEAT.rOut + 0.012, h + 0.06, 72, 1, true, JACKET_START, JACKET_LEN]} />
      </mesh>
      <mesh position={[0, h / 2, 0]} material={FM.insulation}>
        <cylinderGeometry args={[HEAT.rOut, HEAT.rOut, h, 72, 1, true, JACKET_START, JACKET_LEN]} />
      </mesh>
      {/* inner hot face: glows when the furnace is hot */}
      <mesh position={[0, h / 2, 0]} material={glowMat}>
        <cylinderGeometry args={[HEAT.rIn, HEAT.rIn, h, 72, 1, true, JACKET_START, JACKET_LEN]} />
      </mesh>
      <instancedMesh ref={coilRef} args={[coilGeo, coilMat, coils]} frustumCulled={false} />
      {faces.map((f) => (
        <mesh key={f.a} position={[f.x, h / 2, f.z]} rotation={[0, f.a - Math.PI / 2, 0]} material={FM.insulationCut}>
          <planeGeometry args={[HEAT.rOut - HEAT.rIn + 0.012, h]} />
        </mesh>
      ))}
      {/* top and bottom rings */}
      <mesh position={[0, h + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.steelSatin}>
        <ringGeometry args={[0.06, HEAT.rOut + 0.012, 72, 1, JACKET_START - Math.PI / 2, JACKET_LEN]} />
      </mesh>
      <Cyl r={HEAT.rOut + 0.02} h={0.05} position={[0, h + 0.055, 0]} m="panelGray" seg={72} />
      <mesh position={[0, -0.001, 0]} rotation={[Math.PI / 2, 0, 0]} material={MAT.steelSatin}>
        <ringGeometry args={[TUBE_R + 0.03, HEAT.rOut + 0.012, 72, 1, -(JACKET_START - Math.PI / 2) - JACKET_LEN, JACKET_LEN]} />
      </mesh>
    </group>
  );
}

function ProcessTube() {
  // bell-jar quartz tube (outer surface), open at the bottom flange
  const profile: [number, number][] = [
    [TUBE_R + 0.035, 0],
    [TUBE_R + 0.035, 0.018],
    [TUBE_R, 0.022],
    [TUBE_R, 0.98],
    [TUBE_R - 0.01, 1.02],
    [TUBE_R - 0.04, 1.055],
    [TUBE_R - 0.09, 1.078],
    [0, 1.09],
  ];
  const y0 = FLANGE_Y + 0.07;
  return (
    <group position={[AX.x, y0, AX.z]}>
      <Lathe profile={profile} m={FM.quartz} seg={72} />
      {/* gas injector running up inside the tube wall */}
      <mesh position={[-0.15, 0.5, -0.1]} material={FM.quartzSolid}>
        <cylinderGeometry args={[0.006, 0.006, 0.96, 10]} />
      </mesh>
    </group>
  );
}

function Manifold() {
  const profile: [number, number][] = [
    [TUBE_R - 0.005, 0],
    [0.28, 0],
    [0.28, 0.02],
    [0.255, 0.024],
    [0.255, 0.05],
    [0.28, 0.054],
    [0.28, 0.07],
    [TUBE_R - 0.005, 0.07],
  ];
  return (
    <group position={[AX.x, FLANGE_Y, AX.z]}>
      <Lathe profile={profile} m="steelSatin" seg={72} />
      {/* gas inlet and exhaust ports */}
      <Cyl r={0.012} h={0.06} position={[0.27, 0.036, -0.1]} rotation={[0, 0, Math.PI / 2]} m="steel" seg={16} />
      <Cyl r={0.012} h={0.06} position={[0.24, 0.036, -0.16]} rotation={[0, 0.6, Math.PI / 2]} m="steel" seg={16} />
      <Cyl r={0.035} h={0.12} position={[-0.3, 0.036, -0.02]} rotation={[0, 0, Math.PI / 2]} m="steelSatin" seg={24} />
    </group>
  );
}

/** Quartz boat on its heat-insulating pedestal, standing on the seal cap (origin = cap top). */
function Boat({ waferMat, children }: { waferMat: THREE.Material; children?: React.ReactNode }) {
  const wafers = useRef<THREE.InstancedMesh>(null);
  const fins = useRef<THREE.InstancedMesh>(null);
  const waferGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.15, 0.15, 0.0008, 64);
    g.translate(0, 0.0004, 0);
    return g;
  }, []);
  const finGeo = useMemo(() => new THREE.CylinderGeometry(0.155, 0.155, 0.004, 48), []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    if (wafers.current) {
      for (let i = 0; i < N_WAFERS - 1; i++) {
        m.makeTranslation(0, W_Y0 + i * W_PITCH, 0);
        wafers.current.setMatrixAt(i, m);
      }
      wafers.current.instanceMatrix.needsUpdate = true;
    }
    if (fins.current) {
      for (let i = 0; i < 6; i++) {
        m.makeTranslation(0, 0.035 + i * 0.034, 0);
        fins.current.setMatrixAt(i, m);
      }
      fins.current.instanceMatrix.needsUpdate = true;
    }
  }, []);
  const rods = [195, 245, 295, 345].map((d) => (d * Math.PI) / 180);
  const boatTop = TOP_SLOT_Y + 0.022;
  return (
    <group>
      {/* pedestal with quartz heat shields */}
      <Cyl r={0.06} h={0.23} position={[0, 0.115, 0]} m={FM.quartzSolid} seg={32} />
      <instancedMesh ref={fins} args={[finGeo, FM.quartzSolid, 6]} frustumCulled={false} />
      {/* boat end plates and slotted rods (open toward the loading side, +z) */}
      <Cyl r={0.17} h={0.012} position={[0, 0.246, 0]} m={FM.quartzSolid} seg={64} />
      <Cyl r={0.17} h={0.012} position={[0, boatTop, 0]} m={FM.quartzSolid} seg={64} />
      {rods.map((a) => (
        <Cyl key={a} r={0.009} h={boatTop - 0.246} position={[Math.cos(a) * 0.158, (boatTop + 0.246) / 2, Math.sin(a) * 0.158]} m={FM.quartzSolid} seg={12} />
      ))}
      <instancedMesh ref={wafers} args={[waferGeo, waferMat, N_WAFERS - 1]} castShadow frustumCulled={false} />
      {children}
    </group>
  );
}

function Elevator({ carriageRef }: { carriageRef: React.RefObject<THREE.Group | null> }) {
  const x = -0.44;
  const z = AX.z - 0.02;
  return (
    <group>
      <Box size={[0.1, 1.2, 0.12]} position={[x - 0.02, 0.7, z]} m="panelGray" radius={0.01} />
      <Cyl r={0.011} h={1.12} position={[x + 0.045, 0.7, z]} m="chrome" seg={16} />
      <Box size={[0.02, 1.14, 0.03]} position={[x + 0.04, 0.7, z + 0.05]} m="steelDark" radius={0.004} />
      <Box size={[0.02, 1.14, 0.03]} position={[x + 0.04, 0.7, z - 0.05]} m="steelDark" radius={0.004} />
      <group ref={carriageRef} position={[0, CAP_DOWN, 0]}>
        <Box size={[0.1, 0.14, 0.16]} position={[x + 0.07, -0.1, z]} m="steelDark" radius={0.012} />
        <Box size={[0.36, 0.05, 0.1]} position={[x + 0.25, -0.1, AX.z]} m="steelSatin" radius={0.012} />
      </group>
    </group>
  );
}

function SealCap() {
  return (
    <group>
      <Cyl r={0.27} h={0.032} position={[0, -0.016, 0]} m="steelSatin" seg={72} />
      <mesh position={[0, 0.001, 0]} rotation={[Math.PI / 2, 0, 0]} material={MAT.rubber}>
        <torusGeometry args={[0.235, 0.005, 8, 72]} />
      </mesh>
      {/* boat-rotation drive below the cap */}
      <Cyl r={0.055} h={0.08} position={[0, -0.075, 0]} m="black" seg={32} />
    </group>
  );
}

function Cabinet() {
  const W = CAB.x1 - CAB.x0;
  const D = CAB.z1 - CAB.z0;
  const zc = (CAB.z0 + CAB.z1) / 2;
  const deck = useMemo(() => {
    // horizontal plate between the load area and the furnace, with a hole for the tube
    const s = new THREE.Shape();
    s.moveTo(CAB.x0 + 0.03, -(CAB.z0 + 0.03));
    s.lineTo(CAB.x1 - 0.03, -(CAB.z0 + 0.03));
    s.lineTo(CAB.x1 - 0.03, -(CAB.z1 - 0.03));
    s.lineTo(CAB.x0 + 0.03, -(CAB.z1 - 0.03));
    s.closePath();
    const hole = new THREE.Path();
    hole.absarc(AX.x, -AX.z, 0.29, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false, curveSegments: 48 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  return (
    <group>
      <Box size={[W, 0.1, D]} position={[0, 0.05, zc]} m="panelGray" radius={0.01} />
      <Box size={[W, CAB.top - 0.1, 0.03]} position={[0, 0.1 + (CAB.top - 0.1) / 2, CAB.z0 + 0.015]} m="panel" radius={0.008} />
      <Box size={[0.03, CAB.top - 0.1, D]} position={[CAB.x0 + 0.015, 0.1 + (CAB.top - 0.1) / 2, zc]} m="panel" radius={0.008} />
      <Box size={[W + 0.02, 0.07, D + 0.02]} position={[0, CAB.top + 0.035, zc]} m="panel" radius={0.012} castShadow={false} />
      {/* corner posts (the front-right corner is cut away) */}
      {(
        [
          [CAB.x0, CAB.z1],
          [CAB.x1, CAB.z0],
        ] as const
      ).map(([x, z]) => (
        <Box
          key={`${x},${z}`}
          size={[0.04, CAB.top, 0.04]}
          position={[x - Math.sign(x) * 0.02, CAB.top / 2, z - Math.sign(z) * 0.02]}
          m="steelSatin"
          radius={0.006}
          castShadow={false}
        />
      ))}
      <Box size={[0.04, 0.04, D]} position={[CAB.x1 - 0.02, CAB.top - 0.02, zc]} m="steelSatin" radius={0.006} castShadow={false} />
      <Box size={[W, 0.04, 0.04]} position={[0, CAB.top - 0.02, CAB.z1 - 0.02]} m="steelSatin" radius={0.006} castShadow={false} />
      <mesh geometry={deck} position={[0, FLANGE_Y - 0.045, 0]} material={MAT.panelGray} castShadow={false} receiveShadow />
      {/* exhaust scavenger on the roof */}
      <Box size={[0.4, 0.14, 0.3]} position={[-0.2, CAB.top + 0.14, CAB.z0 + 0.25]} m="panel" radius={0.02} />
      <Cyl r={0.07} h={0.3} position={[-0.2, CAB.top + 0.35, CAB.z0 + 0.25]} m="steelSatin" seg={32} />
      {/* control screen on the left wall inside the load area, facing out */}
      <Box size={[0.012, 0.2, 0.28]} position={[CAB.x0 + 0.036, 1.05, 0.38]} m="screen" radius={0.006} castShadow={false} />
      <LightTower position={[CAB.x0 + 0.1, CAB.top + 0.07, CAB.z1 - 0.12]} on="violet" />
    </group>
  );
}

const EXHAUST: V3[] = [
  [AX.x - 0.36, FLANGE_Y + 0.036, AX.z - 0.02],
  [-0.5, FLANGE_Y + 0.036, AX.z - 0.02],
  [-0.5, FLANGE_Y + 0.036, CAB.z0 + 0.06],
  [-0.5, CAB.top - 0.05, CAB.z0 + 0.06],
];

/** Gas panel on the back wall: three lines (O₂, N₂, DCS + NH₃) with valves, rising to the manifold. */
function GasSystem({ leds }: { leds: THREE.Material[] }) {
  const lines = useMemo(() => {
    const z0 = CAB.z0 + 0.06;
    const inlet: V3 = [AX.x + 0.3, FLANGE_Y + 0.036, AX.z - 0.1];
    return [0.46, 0.4, 0.34].map((x, i) => {
      const pts: V3[] = [
        [x, 0.62, z0],
        [x, 1.22 - i * 0.03, z0],
        [x, 1.22 - i * 0.03, AX.z - 0.1 - 0.02 * i],
        [inlet[0] + 0.05, 1.22 - i * 0.03, AX.z - 0.1 - 0.02 * i],
        [inlet[0], inlet[1], inlet[2]],
      ];
      return pts;
    });
  }, []);
  return (
    <group>
      <Box size={[0.3, 0.5, 0.05]} position={[0.4, 0.62, CAB.z0 + 0.045]} m="steelSatin" radius={0.01} />
      {lines.map((pts, i) => (
        <group key={i}>
          <Pipe points={pts} />
          <Valve position={[pts[0][0], 0.8 + i * 0.05, pts[0][2] + 0.012]} />
          <Valve position={[pts[0][0], 1.02 - i * 0.04, pts[0][2] + 0.012]} />
          {/* open-valve indicator */}
          <Cyl r={0.006} h={0.004} position={[pts[0][0], 1.02 - i * 0.04 + 0.063, pts[0][2] + 0.012]} m={leds[i]} seg={12} castShadow={false} />
        </group>
      ))}
      {/* mass-flow controllers */}
      {[0.46, 0.4, 0.34].map((x) => (
        <Box key={x} size={[0.04, 0.09, 0.05]} position={[x, 0.68, CAB.z0 + 0.09]} m="panelGray" radius={0.006} />
      ))}
      {/* exhaust line to the back */}
      <Pipe points={EXHAUST} r={0.03} m="steelSatin" />
    </group>
  );
}

/** Batch wafer-transfer robot at the front of the load area (idle, parked beside the boat). */
function LoadAreaRobot() {
  return (
    <group position={[0.34, 0.1, 0.34]}>
      <Box size={[0.2, 0.06, 0.2]} position={[0, 0.03, 0]} m="panelGray" radius={0.01} />
      <Cyl r={0.08} h={0.58} position={[0, 0.35, 0]} m="panel" seg={40} />
      <Cyl r={0.081} h={0.012} position={[0, 0.64, 0]} m="black" seg={40} />
      <Cyl r={0.062} h={0.2} position={[0, 0.74, 0]} m="steelSatin" seg={40} />
      <group position={[0, 0.86, 0]} rotation={[0, 2.25, 0]}>
        <Cyl r={0.06} h={0.045} position={[0, 0.0, 0]} m="panel" seg={32} />
        <Box size={[0.24, 0.045, 0.1]} position={[0.12, 0, 0]} m="panel" radius={0.018} />
        <group position={[0.24, 0.04, 0]} rotation={[0, -2.4, 0]}>
          <Cyl r={0.045} h={0.035} m="panel" seg={32} />
          <Box size={[0.2, 0.035, 0.08]} position={[0.1, 0, 0]} m="panel" radius={0.014} />
          {/* five thin blades for batch transfer */}
          <group position={[0.2, 0.03, 0]}>
            <Box size={[0.05, 0.06, 0.07]} position={[0.02, 0.02, 0]} m="black" radius={0.008} />
            {[0, 1, 2, 3, 4].map((i) => (
              <Box key={i} size={[0.2, 0.0025, 0.06]} position={[0.14, i * 0.0115, 0]} m="steelSatin" radius={0.001} castShadow={false} />
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

// ───────────────────────────── scene ─────────────────────────────

export default function Furnace({ variant }: ToolProps) {
  const state = useSimState();
  const cyc = CYCLES[variant === 'anneal' ? 'anneal' : 'oxidize'];

  const boat = useRef<THREE.Group>(null);
  const boatSpin = useRef<THREE.Group>(null);
  const carriage = useRef<THREE.Group>(null);

  const mats = useMemo(() => {
    const glow = new THREE.MeshStandardMaterial({
      color: '#4a3a30',
      roughness: 0.9,
      metalness: 0,
      emissive: '#ff5a14',
      emissiveIntensity: 0,
      side: THREE.BackSide,
    });
    const coil = new THREE.MeshStandardMaterial({ color: '#6b5b50', roughness: 0.6, metalness: 0.3, emissive: '#ff6a1f', emissiveIntensity: 0 });
    const wafer = FM.si.clone();
    const leds = [0, 1, 2].map(() => new THREE.MeshStandardMaterial({ color: '#c9d4e3', emissive: '#e8f0ff', emissiveIntensity: 0, roughness: 0.3 }));
    return { glow, coil, wafer, leds, cold: new THREE.Color('#ff3a08'), hot: new THREE.Color('#ff9a3a') };
  }, []);

  useProgressFrame((p, t) => {
    const lift = smooth(p, cyc.up[0], cyc.up[1]) * (1 - smooth(p, cyc.down[0], cyc.down[1]));
    const capY = lerp(CAP_DOWN, CAP_UP, lift);
    if (boat.current) boat.current.position.y = capY;
    if (carriage.current) carriage.current.position.y = capY;
    // the boat turns slowly while the tube is sealed and hot
    if (boatSpin.current) boatSpin.current.rotation.y = cyc.turn * smooth(p, cyc.up[1], cyc.down[0]);

    // thermal glow: radiance rises steeply with temperature; a faint flicker is only cosmetic
    const T = keyed(p, cyc.temp);
    const g = Math.pow(clamp01((T - 0.18) / 0.82), 1.8);
    const flick = 1 + 0.02 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
    mats.glow.emissiveIntensity = 2.4 * g * flick;
    mats.glow.emissive.lerpColors(mats.cold, mats.hot, clamp01(T));
    mats.coil.emissiveIntensity = 3.2 * g * flick;
    mats.coil.emissive.copy(mats.glow.emissive);
    // wafers only glow while inside the hot zone
    const inside = smooth(p, cyc.up[1] - 0.04, cyc.up[1]) * (1 - smooth(p, cyc.down[0], cyc.down[0] + 0.05));
    mats.wafer.emissiveIntensity = 0.3 * g * inside;
    // which gas line is open: 1 O₂ → line 0, 3 N₂ → line 1, 2 DCS + NH₃ → line 2
    const gas = gasAt(p, cyc.gas);
    const open = gas === 1 ? 0 : gas === 3 ? 1 : gas === 2 ? 2 : -1;
    mats.leds.forEach((m, i) => (m.emissiveIntensity = i === open && lift > 0.99 ? 1.6 : 0));
  });

  return (
    <group>
      <CleanFloor size={14} />
      <Cabinet />
      <GasSystem leds={mats.leds} />
      <HeaterJacket glowMat={mats.glow} coilMat={mats.coil} />
      <ProcessTube />
      <Manifold />
      <Elevator carriageRef={carriage} />
      <group ref={boat} position={[AX.x, CAP_DOWN, AX.z]}>
        <SealCap />
        <group ref={boatSpin}>
          <Boat waferMat={mats.wafer}>
            {/* the wafer we follow rides in the top slot */}
            <Wafer look={{ summary: state.wafer, showParticles: true }} position={[0, TOP_SLOT_Y, 0]} rotation={[0, 0, 0]} size={512} />
          </Boat>
        </group>
      </group>
      <LoadAreaRobot />
    </group>
  );
}
