/**
 * Illustrative 193 nm step-and-scan immersion scanner (no manufacturer's design), drawn as the
 * inside of its bay model (Fab.tsx, scanner) with the front and top of the enclosure cut away:
 *  - at the left end a wafer handler takes wafers from the track, pre-aligns them and sets
 *    them on the measure stage;
 *  - two wafer stages on a heavy base frame: one measured under the alignment sensor while
 *    the other is exposed under the projection lens, where an immersion hood holds a thin
 *    film of water between the last lens element and the wafer;
 *  - a refractive projection lens hanging in the metrology frame, the reticle stage above it
 *    and the illuminator on top, fed through the rear bulkhead by the beam-delivery duct from
 *    the ArF excimer laser behind the machine;
 *  - at the right end a reticle library and a handler that carries a reticle to the stage.
 * During a scan the reticle and wafer move in opposite directions, the reticle 4× faster
 * (the lens reduces 4×), while a slit of light sweeps the field; then the wafer steps to the
 * next field. The light path is an optional educational overlay: 193 nm UV is invisible.
 * Every motion is a pure function of step progress.
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FIELDS, WAFER } from '../../sim/dies';
import { useSimState, useStep } from '../../state/sim';
import { lerp, seg, smooth, useProgressFrame } from '../anim';
import { MAT, type MatKey } from '../materials';
import { Box, Cyl, Lathe, LightTower, ScaraRobot, StandaloneOnly } from '../kit/parts';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';
import { useOverlay } from '../../state/presentation';

// ───────────────────────────── layout (metres) ─────────────────────────────
//
// Tool frame: x across the machine (wafer handler at −x, reticle library at +x), z toward the
// aisle, the wafer-stage line at z = 0. In the bay the frame sits 0.25 m in front of the
// housing's centre (poses/scanner.ts), so the rear bulkhead is at the housing's cut plane.

const GRANITE_TOP = 0.66;
const WAFER_Y = GRANITE_TOP + 0.075;
const LENS_X = 0.3;
const MEAS_X = -0.4;
const RETICLE_Y = 2.02;
/** Underside of the last lens element (the water-filled gap is drawn far larger than it is). */
const LENS_Y0 = WAFER_Y + 0.02;
const LENS_TOP = LENS_Y0 + 1.0;
/** Illuminator module above the reticle stage (x0..x1, y0..y1, z0..z1). */
const ILLUM = { x0: LENS_X - 0.45, x1: LENS_X + 0.45, y0: 2.55, y1: 3.2, z0: -0.9, z1: 0.35 } as const;
const BEAM_Y = 3.0; // beam delivery into the illuminator
const BULKHEAD_Z = -1.0; // internal rear bulkhead (the housing's cut plane)
const LIB_X = 1.95; // reticle library
const HANDLER_X = -1.75; // wafer handler robot

function reticleTexture(kind: 'poly' | 'contact'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  // chrome = dark reflective grey; clear quartz = light
  const chrome = '#3b3f46';
  const clear = '#dfe7ee';
  ctx.fillStyle = kind === 'contact' ? chrome : clear;
  ctx.fillRect(0, 0, 512, 512);
  // field border (chrome frame) with 2×2 dies
  ctx.fillStyle = chrome;
  const pad = 60;
  const fw = 512 - 2 * pad;
  ctx.fillRect(0, 0, 512, pad);
  ctx.fillRect(0, 512 - pad, 512, pad);
  ctx.fillRect(0, 0, pad, 512);
  ctx.fillRect(512 - pad, 0, pad, 512);
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      const x0 = pad + (i * fw) / 2 + 8;
      const y0 = pad + (j * fw) / 2 + 8;
      const w = fw / 2 - 16;
      // a fine, repeating die-scale texture (not literal transistors)
      for (let r = 0; r < 26; r++)
        for (let q = 0; q < 26; q++) {
          const x = x0 + (q / 26) * w;
          const y = y0 + (r / 26) * w;
          if (kind === 'poly') {
            ctx.fillStyle = chrome;
            if ((q + r) % 3 !== 0) ctx.fillRect(x + 2, y, 1.6, (w / 26) * 0.8);
          } else {
            ctx.fillStyle = clear;
            if ((q * 7 + r * 3) % 4 === 0) ctx.fillRect(x + 2, y + 2, 2.4, 2.4);
          }
        }
    }
  // alignment marks
  ctx.fillStyle = kind === 'contact' ? clear : chrome;
  for (const [x, y] of [
    [20, 20],
    [492, 492],
  ]) {
    ctx.fillRect(x - 12, y - 2, 24, 4);
    ctx.fillRect(x - 2, y - 12, 4, 24);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function Reticle({ kind }: { kind: 'poly' | 'contact' }) {
  const tex = useMemo(() => reticleTexture(kind), [kind]);
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[0.152, 0.0064, 0.152]} />
        <meshPhysicalMaterial map={tex} roughness={0.08} metalness={0.3} clearcoat={1} />
      </mesh>
      {/* pellicle frame + membrane */}
      <Box size={[0.12, 0.006, 0.145]} position={[0, -0.006, 0]} m="black" radius={0.001} />
      <mesh position={[0, -0.0092, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.glassClear}>
        <planeGeometry args={[0.116, 0.14]} />
      </mesh>
    </group>
  );
}

const glassMat = new THREE.MeshPhysicalMaterial({ color: '#e8f2fa', roughness: 0.02, transmission: 0.6, transparent: true, opacity: 0.7, clearcoat: 1 });
// the next wafer, measured on the other stage while yours is exposed (bare silicon look)
const nextWaferMat = new THREE.MeshStandardMaterial({ color: '#6f747c', metalness: 0.6, roughness: 0.22 });

/** Refractive projection lens: turned barrel with flange rings; the last element at the bottom. */
function LensColumn() {
  // turned profile of the barrel (radius, height), bottom at 0 (= LENS_Y0): a narrow nose
  // toward the wafer (it leaves room for the camera to come down past it to the wafer)
  const profile: [number, number][] = [
    [0.0, 0],
    [0.07, 0],
    [0.085, 0.02],
    [0.11, 0.08],
    [0.13, 0.2],
    [0.14, 0.3],
    [0.175, 0.305],
    [0.175, 0.33],
    [0.165, 0.335],
    [0.185, 0.5],
    [0.21, 0.505],
    [0.21, 0.53],
    [0.19, 0.535],
    [0.2, 0.78],
    [0.25, 0.79],
    [0.25, 0.83],
    [0.19, 0.84],
    [0.15, 0.98],
    [0.16, 1.0],
    [0.0, 1.0],
  ];
  return (
    <group position={[LENS_X, LENS_Y0, 0]}>
      <Lathe profile={profile} m="steelSatin" seg={80} />
      {/* bright flange rings */}
      {[
        [0.318, 0.18],
        [0.518, 0.22],
        [0.81, 0.26],
      ].map(([y, r]) => (
        <Cyl key={y} r={r} h={0.012} position={[0, y, 0]} m="chrome" seg={80} />
      ))}
      {/* last lens element, visible at the bottom */}
      <mesh position={[0, 0.002, 0]} rotation={[Math.PI, 0, 0]} material={glassMat}>
        <sphereGeometry args={[0.06, 32, 16, 0, Math.PI * 2, 0, 0.5]} />
      </mesh>
    </group>
  );
}

/** Immersion hood around the last element and the water film it keeps under the lens. */
function ImmersionHood() {
  const hood: [number, number][] = [
    [0.05, 0.004],
    [0.12, 0.004],
    [0.135, 0.012],
    [0.13, LENS_Y0 - WAFER_Y + 0.012],
    [0.08, LENS_Y0 - WAFER_Y + 0.012],
    [0.05, 0.012],
  ];
  return (
    <group position={[LENS_X, WAFER_Y, 0]}>
      <Lathe profile={[...hood, hood[0]]} m="steelDark" seg={64} />
      <mesh position={[0, (0.0016 + LENS_Y0 - WAFER_Y) / 2, 0]} material={MAT.water} renderOrder={2}>
        <cylinderGeometry args={[0.049, 0.049, LENS_Y0 - WAFER_Y - 0.0016, 48]} />
      </mesh>
    </group>
  );
}

function Stage({ children, position }: { children?: React.ReactNode; position?: [number, number, number] }) {
  return (
    <group position={position}>
      <Box size={[0.42, 0.05, 0.42]} position={[0, GRANITE_TOP + 0.025, 0]} m="black" radius={0.01} />
      <Box size={[0.36, 0.012, 0.36]} position={[0, GRANITE_TOP + 0.056, 0]} m="ceramicGray" radius={0.004} />
      {/* interferometer mirrors on two sides */}
      <Box size={[0.42, 0.03, 0.01]} position={[0, GRANITE_TOP + 0.04, -0.215]} m="chrome" radius={0.002} />
      <Box size={[0.01, 0.03, 0.42]} position={[-0.215, GRANITE_TOP + 0.04, 0]} m="chrome" radius={0.002} />
      <Cyl r={0.155} h={0.01} position={[0, GRANITE_TOP + 0.066, 0]} m="ceramic" seg={72} />
      {children}
    </group>
  );
}

/** A flat rectangular frame (w × d, h thick) around a square opening, centred at height y. */
function Frame({ w, d, hole, h, y, m }: { w: number; d: number; hole: number; h: number; y: number; m: MatKey }) {
  const side = (w - hole) / 2;
  const end = (d - hole) / 2;
  return (
    <group>
      {[-1, 1].map((k) => (
        <Box key={`x${k}`} size={[side, h, d]} position={[(k * (hole + side)) / 2, y, 0]} m={m} radius={0.006} />
      ))}
      {[-1, 1].map((k) => (
        <Box key={`z${k}`} size={[hole, h, end]} position={[0, y, (k * (hole + end)) / 2]} m={m} radius={0.004} />
      ))}
    </group>
  );
}

/** A rectangular frustum between two horizontal slits (for the light-path overlay). */
function SlitFrustum({ x, y0, y1, w0, w1, d }: { x: number; y0: number; y1: number; w0: number; w1: number; d: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const a = w0 / 2;
    const b = w1 / 2;
    const h = d / 2;
    // top rectangle at y0 (half-width a), bottom at y1 (half-width b)
    const v = [
      [-a, y0, -h], [a, y0, -h], [a, y0, h], [-a, y0, h],
      [-b, y1, -h], [b, y1, -h], [b, y1, h], [-b, y1, h],
    ].flat();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    g.computeVertexNormals();
    return g;
  }, [y0, y1, w0, w1, d]);
  return <mesh geometry={geo} position={[x, 0, 0]} material={MAT.beam} />;
}

/** Base frame on vibration isolators, and the metrology frame the lens hangs from. */
function Frames() {
  return (
    <group>
      {[-0.8, 0.8].flatMap((x) => [-0.45, 0.45].map((z) => <Cyl key={`${x},${z}`} r={0.07} h={0.26} position={[x, 0.13, z]} m="panelDark" />))}
      <Box size={[2.0, 0.38, 1.2]} position={[0, GRANITE_TOP - 0.19 - 0.02, 0]} m="granite" radius={0.02} />
      {/* metrology frame: rear columns, a frame plate behind the lens and arms holding its mount */}
      {[-0.75, 0.9].map((x) => (
        <Box key={x} size={[0.12, LENS_TOP + 0.08 - GRANITE_TOP, 0.12]} position={[x, (LENS_TOP + 0.08 + GRANITE_TOP) / 2, -0.5]} m="steelSatin" radius={0.015} />
      ))}
      <Box size={[1.8, 0.08, 0.36]} position={[0.08, LENS_TOP + 0.04, -0.42]} m="aluminum" radius={0.015} />
      {[-0.3, 0.3].map((dx) => (
        <Box key={dx} size={[0.1, 0.08, 0.5]} position={[LENS_X + dx, LENS_TOP + 0.04, -0.12]} m="aluminum" radius={0.012} />
      ))}
      <Cyl r={0.28} h={0.05} position={[LENS_X, LENS_TOP + 0.025, 0]} m="aluminum" seg={64} />
      {/* bridge carrying the reticle stage */}
      <Box size={[1.0, 0.05, 0.56]} position={[LENS_X, RETICLE_Y - 0.1, -0.08]} m="aluminum" radius={0.012} />
      {[-0.45, 0.45].map((dx) => (
        <Box key={dx} size={[0.08, RETICLE_Y - 0.1 - LENS_TOP - 0.08, 0.08]} position={[LENS_X + dx, (RETICLE_Y - 0.1 + LENS_TOP + 0.08) / 2, -0.3]} m="steelSatin" radius={0.01} />
      ))}
    </group>
  );
}

/** Illuminator: beam-shaping module on top, condenser above the reticle, duct through the bulkhead. */
function Illuminator() {
  const { x0, x1, y0, y1, z0, z1 } = ILLUM;
  return (
    <group>
      <Box size={[x1 - x0, y1 - y0, z1 - z0]} position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]} m="panel" radius={0.03} />
      <Box size={[x1 - x0 + 0.01, 0.05, z1 - z0 + 0.01]} position={[(x0 + x1) / 2, y0 + 0.14, (z0 + z1) / 2]} m="steelSatin" radius={0.01} />
      <Box size={[0.3, 0.18, 0.012]} position={[(x0 + x1) / 2, y0 + 0.36, z1 + 0.004]} m="glassDark" radius={0.004} castShadow={false} />
      <Box size={[0.36, y0 - RETICLE_Y - 0.11, 0.36]} position={[LENS_X, (y0 + RETICLE_Y + 0.11) / 2, 0]} m="steelSatin" radius={0.02} />
      <Box size={[0.2, 0.02, 0.2]} position={[LENS_X, RETICLE_Y + 0.1, 0]} m="black" radius={0.004} />
      <Box size={[0.22, 0.22, z0 - BULKHEAD_Z]} position={[LENS_X, BEAM_Y, (z0 + BULKHEAD_Z) / 2]} m="steelSatin" radius={0.02} />
    </group>
  );
}

/** Wafer handler at the left end: robot and pre-aligner between the track interface and the stages. */
function WaferHandler() {
  return (
    <group>
      <Box size={[0.34, 0.44, 0.34]} position={[HANDLER_X, 0.22, 0.05]} m="panelGray" radius={0.012} />
      <ScaraRobot position={[HANDLER_X, 0.44, 0.05]} base={0.4} elbow={-1.9} wrist={1.35} />
      {/* pre-aligner: spin chuck and notch sensor */}
      <group position={[-1.25, 0, 0.42]}>
        <Box size={[0.22, 0.66, 0.22]} position={[0, 0.33, 0]} m="panelGray" radius={0.01} />
        <Cyl r={0.025} h={0.05} position={[0, 0.685, 0]} m="steelSatin" />
        <Cyl r={0.06} h={0.01} position={[0, 0.715, 0]} m="ceramicGray" />
        <Box size={[0.06, 0.07, 0.09]} position={[0.1, 0.72, 0]} m="black" radius={0.006} />
      </group>
      {/* track interface: the wafer port in the end wall */}
      <Box size={[0.08, 0.3, 0.5]} position={[-2.62, 0.78, 0.05]} m="panelGray" radius={0.01} />
      <Box size={[0.02, 0.08, 0.36]} position={[-2.575, 0.78, 0.05]} m="black" radius={0.004} castShadow={false} />
      {/* electronics cabinet against the bulkhead */}
      <Box size={[0.7, 1.9, 0.4]} position={[-2.2, 1.07, BULKHEAD_Z + 0.22]} m="panelWarm" radius={0.02} />
      <Box size={[0.5, 0.4, 0.012]} position={[-2.2, 1.55, BULKHEAD_Z + 0.426]} m="glassDark" radius={0.004} castShadow={false} />
    </group>
  );
}

/** Reticle library (pods on shelves) at the right end, with the handler's rail to the stage. */
function ReticleLibrary() {
  // the handler lifts reticles in and out at the travel height (reticle seat + 0.1)
  const slots = [1.8, 1.98, 2.16, 2.34];
  return (
    <group>
      {/* cabinet below the library */}
      <Box size={[0.62, 1.52, 0.62]} position={[LIB_X, 0.86, -0.12]} m="panelWarm" radius={0.02} />
      <Box size={[0.4, 0.3, 0.012]} position={[LIB_X, 1.2, 0.195]} m="glassDark" radius={0.004} castShadow={false} />
      {/* shelf frame */}
      {[-0.28, 0.28].map((dx) => (
        <Box key={dx} size={[0.03, 0.78, 0.5]} position={[LIB_X + dx, 2.02, -0.1]} m="steelSatin" radius={0.006} />
      ))}
      <Box size={[0.6, 0.03, 0.52]} position={[LIB_X, 2.42, -0.1]} m="panelGray" radius={0.006} />
      {slots.map((y, i) => (
        <group key={y}>
          <Box size={[0.53, 0.012, 0.46]} position={[LIB_X, y - 0.05, -0.1]} m="panelGray" radius={0.003} />
          {/* reticle pods; the third slot's reticle is the one in use */}
          {i !== 2 && <Box size={[0.26, 0.07, 0.26]} position={[LIB_X, y - 0.008, -0.1]} m="polycarbonate" radius={0.012} />}
        </group>
      ))}
      {/* handler rail from the library to the reticle stage, behind the reticle's path */}
      <Box size={[LIB_X - LENS_X + 0.25, 0.05, 0.06]} position={[(LENS_X + LIB_X + 0.35) / 2, RETICLE_Y + 0.27, -0.26]} m="steelSatin" radius={0.01} />
    </group>
  );
}

/** Field positions (m) relative to the wafer centre, in exposure order. */
const FIELD_M = FIELDS.map((f) => ({ x: f.x / 1000, y: f.y / 1000, h: f.h / 1000 }));

/** Alignment marks visited under the sensor (wafer-centre offsets, m) and the measure schedule. */
const MARKS: [number, number][] = [
  [0.1, 0.08],
  [-0.1, 0.09],
  [-0.09, -0.1],
  [0.11, -0.08],
];
/**
 * The stage offset while marks are measured over p ∈ [a, b]: from the home position (wafer
 * centre under the sensor) to each mark in turn, and back home afterwards (by b + 0.13), so
 * the stage is where the next lesson finds it.
 */
function markPose(p: number, a: number, b: number): { x: number; z: number; dwell: boolean } {
  const u = seg(p, a, b) * MARKS.length;
  const k = Math.min(MARKS.length - 1, Math.floor(u));
  const [mx, my] = MARKS[k];
  const prev: [number, number] = k === 0 ? [0, 0] : MARKS[k - 1];
  const tt = smooth(u - k, 0, 0.5);
  const home = smooth(p, b + 0.02, b + 0.13);
  return { x: -lerp(prev[0], mx, tt) * (1 - home), z: lerp(prev[1], my, tt) * (1 - home), dwell: p > a && p < b && u - k > 0.55 };
}

/**
 * The dual-stage exchange: the scanner measures a wafer on one chuck while it exposes another
 * on the second, then the two swap places, passing around each other. Our wafer is measured
 * (and waits during the reticle load) on the measure side, and is swapped under the lens at the
 * start of the exposure. Returns the two chucks' positions at progress p of a lesson.
 */
function stageBases(v: string, p: number, ours: THREE.Vector3, other: THREE.Vector3) {
  const swap = v === 'expose' ? smooth(p, 0, 0.07) : 0;
  const around = Math.sin(Math.PI * swap) * 0.32;
  ours.set(lerp(MEAS_X, LENS_X, swap), 0, around);
  other.set(lerp(LENS_X, MEAS_X, swap), 0, -around);
}

export default function Scanner({ variant }: ToolProps) {
  const state = useSimState();
  const { id } = useStep();
  const lightPath = useOverlay('lightPath');
  const v = variant ?? 'expose';
  const exposing = v === 'expose';
  const aligning = v === 'align';
  const kind: 'poly' | 'contact' = id.startsWith('contact') ? 'contact' : 'poly';

  const exposeStage = useRef<THREE.Group>(null);
  const measStage = useRef<THREE.Group>(null);
  const ourBase = useRef<THREE.Group>(null);
  const otherBase = useRef<THREE.Group>(null);
  const bases = useMemo(() => ({ ours: new THREE.Vector3(), other: new THREE.Vector3() }), []);
  const reticleStage = useRef<THREE.Group>(null);
  const reticleHand = useRef<THREE.Group>(null);
  const fork = useRef<THREE.Group>(null);
  const slit = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Group>(null);
  const alignSpot = useRef<THREE.Mesh>(null);

  // Exposure schedule: fields exposed over p ∈ [0.08, 0.86]; the wafer shows each field as
  // the slit sweeps it (live, in its shader: no repaint per field)
  const nF = FIELD_M.length;
  const liveFields = useMemo(() => ({ on: false, done: 0 }), []);
  const libDx = LIB_X - LENS_X;

  useProgressFrame((p) => {
    stageBases(v, p, bases.ours, bases.other);
    ourBase.current?.position.copy(bases.ours);
    otherBase.current?.position.copy(bases.other);
    liveFields.on = exposing;
    // ── exposure: step and scan ──
    if (exposeStage.current) {
      let x = 0,
        z = 0,
        scanFrac = 0,
        scanning = false;
      if (exposing) {
        const f = seg(p, 0.08, 0.86) * nF;
        const i = Math.min(nF - 1, Math.floor(f));
        const within = f - i;
        const fld = FIELD_M[i];
        // step (first 30% of each field period), then scan (70%)
        const stepT = Math.min(1, within / 0.3);
        // (the first step starts from the home position the exchange delivered the wafer to)
        const prev = i === 0 ? { x: 0, y: 0 } : FIELD_M[i - 1];
        const sx = lerp(prev.x, fld.x, p < 0.08 ? 0 : smooth(stepT, 0, 1));
        const sy = lerp(prev.y, fld.y, p < 0.08 ? 0 : smooth(stepT, 0, 1));
        scanFrac = within < 0.3 ? 0 : (within - 0.3) / 0.7;
        scanning = within >= 0.3 && p > 0.08 && p < 0.86;
        const dir = i % 2 === 0 ? 1 : -1;
        const scanOffset = scanning ? (scanFrac - 0.5) * fld.h * dir : 0;
        liveFields.done = p >= 0.86 ? nF : p < 0.08 ? 0 : i + scanFrac;
        // The stage moves so that the point under the lens is (field centre + scan offset)
        x = -sx;
        z = sy + scanOffset;
        if (reticleStage.current) reticleStage.current.position.z = -scanOffset * 4 * 0.25; // 4× faster, drawn at 1/4 scale travel
      } else if (aligning) {
        // measure marks at a few positions under the alignment sensor
        const m = markPose(p, 0.1, 0.8);
        x = m.x;
        z = m.z;
        if (alignSpot.current) alignSpot.current.visible = m.dwell;
      }
      exposeStage.current.position.set(x, 0, z);
      if (slit.current) {
        slit.current.visible = scanning;
      }
      if (beam.current) beam.current.visible = lightPath && (exposing ? scanning || p < 0.08 || p > 0.86 : true);
    }
    // the other stage measures the next wafer while yours is exposed
    if (measStage.current) {
      const m = exposing ? markPose(p, 0.12, 0.84) : { x: 0, z: 0 };
      measStage.current.position.set(m.x, 0, m.z);
    }
    // ── reticle load: the handler carries it from the library, lowers it and withdraws ──
    const loading = v === 'reticle';
    const inT = loading ? smooth(p, 0.15, 0.62) : 1;
    const down = loading ? smooth(p, 0.62, 0.72) : 1;
    const back = loading ? smooth(p, 0.76, 0.95) : 1;
    if (reticleHand.current) {
      reticleHand.current.position.x = lerp(libDx, 0, inT);
      reticleHand.current.position.y = lerp(0.1, 0, down);
    }
    if (fork.current) {
      fork.current.position.x = back > 0 ? lerp(0, libDx, back) : lerp(libDx, 0, inT);
      fork.current.position.y = back > 0 ? lerp(-0.012, 0.1, back) : lerp(0.1, -0.012, down);
    }
  });

  return (
    <group>
      {/* floor */}
      <StandaloneOnly>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[16, 16]} />
          <meshStandardMaterial color="#e2dfd6" roughness={0.55} />
        </mesh>
      </StandaloneOnly>
      {/* rear bulkhead: the enclosure behind the cut, with service ribs, a cable tray, and the
          closing panel of the roof housing behind it */}
      <Box size={[5.34, 2.74, 0.04]} position={[0, 0.14 + 1.37, BULKHEAD_Z]} m="panelGray" radius={0.01} />
      <Box size={[2.36, 0.42, 0.04]} position={[0.37, 3.1, BULKHEAD_Z]} m="steelSatin" radius={0.01} />
      {[-1.9, -0.9, 1.35, 2.3].map((x) => (
        <Box key={x} size={[0.05, 2.6, 0.03]} position={[x, 1.5, BULKHEAD_Z + 0.035]} m="panelGray" radius={0.006} castShadow={false} />
      ))}
      <Box size={[5.2, 0.06, 0.16]} position={[0, 1.34, BULKHEAD_Z + 0.1]} m="steelSatin" radius={0.01} />
      <Frames />
      <LensColumn />
      <ImmersionHood />
      {/* alignment sensor over the measure side */}
      <group position={[MEAS_X, WAFER_Y + 0.2, 0]}>
        <Cyl r={0.05} h={0.3} position={[0, 0.15, 0]} m="steelSatin" />
        <Cyl r={0.02} h={0.04} position={[0, -0.01, 0]} m="black" />
        <Box size={[0.05, 0.05, 0.36]} position={[0, 0.26, -0.2]} m="steelSatin" radius={0.008} />
        <mesh ref={alignSpot} position={[0, -0.12, 0]} visible={false}>
          <cylinderGeometry args={[0.004, 0.012, 0.19, 12, 1, true]} />
          <meshBasicMaterial color="#ffd27a" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      </group>
      {/* wafer stages (see stageBases) */}
      <group ref={ourBase} position={[MEAS_X, 0, 0]}>
        <group ref={exposeStage}>
          <Stage>
            <Wafer anchor look={{ summary: state.wafer, showParticles: true }} liveFields={liveFields} fieldRects={FIELDS} position={[0, WAFER_Y, 0]} size={768} />
          </Stage>
        </group>
      </group>
      <group ref={otherBase} position={[LENS_X, 0, 0]}>
        <group ref={measStage}>
          <Stage>
            {exposing && (
              <mesh position={[0, WAFER_Y + 0.0008, 0]} material={nextWaferMat} castShadow>
                <cylinderGeometry args={[0.15, 0.15, 0.0016, 96]} />
              </mesh>
            )}
          </Stage>
        </group>
      </group>
      {/* slit of light on the wafer during a scan (the resist is being exposed there) */}
      <mesh ref={slit} position={[LENS_X, WAFER_Y + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <planeGeometry args={[WAFER.dieW * 2 / 1000, 0.006]} />
        <meshBasicMaterial color="#cfc8ff" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      {/* reticle stage: a frame with an opening under the reticle for the light */}
      <group position={[LENS_X, RETICLE_Y, 0]}>
        <Frame w={0.7} d={0.46} hole={0.15} h={0.06} y={-0.035} m="black" />
        <group ref={reticleStage}>
          <Frame w={0.24} d={0.24} hole={0.13} h={0.03} y={0.005} m="ceramicGray" />
          <group ref={reticleHand} position={[0, 0, 0]}>
            <group position={[0, 0.026, 0]}>
              <Reticle kind={kind} />
            </group>
          </group>
        </group>
        {/* handler fork, hanging from its carriage on the rail behind the reticle's path */}
        <group ref={fork}>
          <Box size={[0.08, 0.05, 0.08]} position={[0.1, 0.22, -0.26]} m="panelGray" radius={0.01} />
          <Box size={[0.03, 0.2, 0.03]} position={[0.1, 0.11, -0.26]} m="steelSatin" radius={0.006} />
          <Box size={[0.03, 0.008, 0.18]} position={[0.1, 0.017, -0.17]} m="ceramicGray" radius={0.002} />
          <Box size={[0.13, 0.008, 0.02]} position={[0.035, 0.017, -0.09]} m="ceramicGray" radius={0.002} />
          {[-0.05, 0.05].map((dx) => (
            <Box key={dx} size={[0.012, 0.008, 0.16]} position={[dx, 0.017, -0.01]} m="ceramicGray" radius={0.002} />
          ))}
        </group>
      </group>
      <ReticleLibrary />
      <Illuminator />
      <WaferHandler />
      {/* operator screen on its arm (where the bay model has it) */}
      <group position={[2.4, 1.45, 1.35]}>
        <Box size={[0.036, 0.036, 0.2]} position={[0, -0.05, 0.1]} m="steelDark" radius={0.008} />
        <Box size={[0.41, 0.27, 0.036]} position={[0, 0.08, 0.225]} m="panelDark" radius={0.01} />
        <Box size={[0.37, 0.23, 0.006]} position={[0, 0.08, 0.245]} m="screen" radius={0.003} castShadow={false} />
      </group>
      {/* excimer laser and beam delivery behind the machine (the bay model has its own) */}
      <StandaloneOnly>
        <group position={[0.6, 0, -2.9]}>
          <Box size={[3.0, 1.9, 1.1]} position={[0, 0.95, 0]} m="panelWarm" radius={0.03} />
          <Box size={[1.4, 0.26, 0.012]} position={[-0.4, 1.45, 0.556]} m="glassDark" radius={0.004} />
          <LightTower position={[1.3, 1.9, -0.35]} on="violet" />
        </group>
        <Box size={[0.3, 1.2, 0.3]} position={[LENS_X, 2.5, -2.8]} m="steelSatin" radius={0.03} />
        <Box size={[0.3, 0.3, 1.9]} position={[LENS_X, BEAM_Y, -1.95]} m="steelSatin" radius={0.03} />
      </StandaloneOnly>
      {/* educational light path overlay (193 nm UV is invisible in reality) */}
      <group ref={beam} visible={false}>
        <mesh position={[LENS_X, BEAM_Y, (BULKHEAD_Z + ILLUM.z0) / 2]} rotation={[Math.PI / 2, 0, 0]} material={MAT.beam}>
          <boxGeometry args={[0.024, ILLUM.z0 - BULKHEAD_Z, 0.024]} />
        </mesh>
        {/* shaped slit of light onto the reticle (drawn 4× the printed slit) */}
        <mesh position={[LENS_X, RETICLE_Y + 0.06, 0]} material={MAT.beam}>
          <boxGeometry args={[0.104, 0.08, 0.012]} />
        </mesh>
        {/* from the reticle into the lens, and out of the lens onto the wafer: 4× smaller */}
        <SlitFrustum x={LENS_X} y0={RETICLE_Y - 0.01} y1={LENS_TOP} w0={0.104} w1={0.07} d={0.012} />
        <SlitFrustum x={LENS_X} y0={LENS_Y0} y1={WAFER_Y + 0.004} w0={0.034} w1={0.026} d={0.006} />
      </group>
    </group>
  );
}
