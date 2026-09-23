/**
 * Illustrative 193 nm step-and-scan scanner (no manufacturer's design):
 *  - an ArF excimer laser in its own cabinet, with a beam-delivery tube to the illuminator;
 *  - a reticle stage holding a chrome-on-quartz reticle above a refractive projection lens;
 *  - two wafer stages on a granite frame: one measured under the alignment sensor while
 *    the other is exposed under the lens.
 * During a scan the reticle and wafer move in opposite directions, the reticle 4× faster
 * (the lens reduces 4×), while a slit of light sweeps the field; then the wafer steps to the
 * next field. The light path is an optional educational overlay: 193 nm UV is invisible.
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FIELDS, WAFER } from '../../sim/dies';
import { useSimState, useStep } from '../../state/sim';
import { lerp, seg, smooth, useProgressBucket, useProgressFrame } from '../anim';
import { MAT } from '../materials';
import { Box, Cyl, Lathe, LightTower, StandaloneOnly } from '../kit/parts';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';
import { useOverlay } from '../../state/presentation';

const GRANITE_TOP = 0.66;
const WAFER_Y = GRANITE_TOP + 0.075;
const LENS_X = 0.34;
const MEAS_X = -0.36;
const RETICLE_Y = 2.02;

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

function LensColumn() {
  // turned profile of a projection lens barrel (radius, height), bottom at 0
  const profile: [number, number][] = [
    [0.0, 0],
    [0.06, 0],
    [0.075, 0.02],
    [0.1, 0.05],
    [0.13, 0.08],
    [0.13, 0.2],
    [0.155, 0.21],
    [0.155, 0.235],
    [0.14, 0.245],
    [0.15, 0.45],
    [0.175, 0.46],
    [0.175, 0.49],
    [0.155, 0.5],
    [0.16, 0.78],
    [0.2, 0.79],
    [0.2, 0.83],
    [0.15, 0.84],
    [0.12, 0.98],
    [0.13, 1.0],
    [0.0, 1.0],
  ];
  return (
    <group position={[LENS_X, WAFER_Y + 0.07, 0]}>
      <Lathe profile={profile} m="steelSatin" seg={80} />
      {/* bright flange rings */}
      {[0.22, 0.475, 0.81].map((y) => (
        <Cyl key={y} r={0.19} h={0.012} position={[0, y, 0]} m="chrome" seg={80} />
      ))}
      {/* last lens element, visible at the bottom */}
      <mesh position={[0, 0.002, 0]} rotation={[Math.PI, 0, 0]}>
        <sphereGeometry args={[0.06, 32, 16, 0, Math.PI * 2, 0, 0.5]} />
        <meshPhysicalMaterial color="#e8f2fa" roughness={0.02} transmission={0.6} transparent opacity={0.7} clearcoat={1} />
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

/** Field positions (m) relative to the wafer centre, in exposure order. */
const FIELD_M = FIELDS.map((f) => ({ x: f.x / 1000, y: f.y / 1000, h: f.h / 1000 }));

export default function Scanner({ variant }: ToolProps) {
  const state = useSimState();
  const { id } = useStep();
  const lightPath = useOverlay('lightPath');
  const bucket = useProgressBucket(80);
  const v = variant ?? 'expose';
  const exposing = v === 'expose';
  const aligning = v === 'align';
  const kind: 'poly' | 'contact' = id.startsWith('contact') ? 'contact' : 'poly';

  const exposeStage = useRef<THREE.Group>(null);
  const measStage = useRef<THREE.Group>(null);
  const reticleStage = useRef<THREE.Group>(null);
  const reticleHand = useRef<THREE.Group>(null);
  const slit = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Group>(null);
  const alignSpot = useRef<THREE.Mesh>(null);

  // Exposure schedule: fields exposed over p ∈ [0.08, 0.86]
  const nF = FIELD_M.length;
  const fieldsDone = exposing ? Math.floor(seg(bucket, 0.08, 0.86) * nF) : 0;

  useProgressFrame((p, t) => {
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
        const prev = FIELD_M[Math.max(0, i - 1)];
        const sx = lerp(prev.x, fld.x, i === 0 ? 1 : smooth(stepT, 0, 1));
        const sy = lerp(prev.y, fld.y, i === 0 ? 1 : smooth(stepT, 0, 1));
        scanFrac = within < 0.3 ? 0 : (within - 0.3) / 0.7;
        scanning = within >= 0.3 && p > 0.08 && p < 0.86;
        const dir = i % 2 === 0 ? 1 : -1;
        const scanOffset = scanning ? (scanFrac - 0.5) * fld.h * dir : 0;
        // The stage moves so that the point under the lens is (field centre + scan offset)
        x = -sx;
        z = sy + scanOffset;
        if (reticleStage.current) reticleStage.current.position.z = -scanOffset * 4 * 0.25; // 4× faster, drawn at 1/4 scale travel
      } else if (aligning) {
        // measure marks at a few positions under the alignment sensor
        const marks = [
          [0.1, 0.08],
          [-0.1, 0.09],
          [-0.09, -0.1],
          [0.11, -0.08],
        ];
        const k = Math.min(3, Math.floor(seg(p, 0.1, 0.8) * 4));
        const [mx, my] = marks[k];
        const prev = marks[Math.max(0, k - 1)];
        const tt = smooth(seg(p, 0.1, 0.8) * 4 - k, 0, 0.5);
        x = -lerp(prev[0], mx, k === 0 ? 1 : tt);
        z = lerp(prev[1], my, k === 0 ? 1 : tt);
      }
      exposeStage.current.position.set(x, 0, z);
      if (slit.current) {
        slit.current.visible = scanning;
      }
      if (beam.current) beam.current.visible = lightPath && (exposing ? scanning || p < 0.08 || p > 0.86 : true);
    }
    if (measStage.current) {
      measStage.current.position.x = Math.sin(t * 0.7) * 0.02;
    }
    if (alignSpot.current) {
      alignSpot.current.visible = aligning && Math.floor(t * 4) % 2 === 0 && p > 0.1 && p < 0.85;
    }
    // ── reticle load ──
    if (reticleHand.current) {
      const inT = v === 'reticle' ? smooth(p, 0.15, 0.7) : 1;
      reticleHand.current.position.x = lerp(1.1, 0, inT);
      reticleHand.current.position.y = lerp(0.12, 0, smooth(p, 0.62, 0.75) * (v === 'reticle' ? 1 : 0)) + (v === 'reticle' ? 0 : 0);
    }
  });

  // The exposure stage carries the wafer; in 'align' view it sits under the sensor.
  const stageBase: [number, number, number] = aligning ? [MEAS_X, 0, 0] : [LENS_X, 0, 0];
  return (
    <group>
      {/* floor */}
      <StandaloneOnly>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[16, 16]} />
          <meshStandardMaterial color="#e2dfd6" roughness={0.55} />
        </mesh>
      </StandaloneOnly>
      {/* vibration isolators and granite base */}
      {[-0.55, 0.55].flatMap((x) => [-0.38, 0.38].map((z) => <Cyl key={`${x},${z}`} r={0.06} h={0.28} position={[x, 0.14, z]} m="panelDark" />))}
      <Box size={[1.5, 0.36, 1.0]} position={[0, GRANITE_TOP - 0.18 - 0.02, 0]} m="granite" radius={0.02} />
      {/* metrology frame: two rear columns carrying a dark frame plate the lens hangs from */}
      {[-0.66, 0.7].map((x) => (
        <Box key={x} size={[0.09, 1.66, 0.09]} position={[x, GRANITE_TOP + 0.82, -0.4]} m="steelSatin" radius={0.012} />
      ))}
      <Box size={[1.46, 0.06, 0.5]} position={[0.02, GRANITE_TOP + 1.12, -0.2]} m="panelGray" radius={0.015} />
      <Box size={[0.7, 0.045, 0.42]} position={[LENS_X, RETICLE_Y - 0.1, -0.12]} m="panelGray" radius={0.012} />
      <LensColumn />
      {/* alignment sensor over the measure side */}
      <group position={[MEAS_X, WAFER_Y + 0.2, 0]}>
        <Cyl r={0.045} h={0.28} position={[0, 0.14, 0]} m="steelSatin" />
        <Cyl r={0.02} h={0.04} position={[0, -0.01, 0]} m="black" />
        <mesh ref={alignSpot} position={[0, -0.12, 0]} visible={false}>
          <cylinderGeometry args={[0.004, 0.012, 0.19, 12, 1, true]} />
          <meshBasicMaterial color="#ffd27a" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      </group>
      {/* wafer stages */}
      <group position={stageBase}>
        <group ref={exposeStage}>
          <Stage>
            <Wafer anchor look={{ summary: state.wafer, showParticles: true, exposedFields: exposing ? fieldsDone : 0, fields: FIELDS }} position={[0, WAFER_Y, 0]} size={768} />
          </Stage>
        </group>
      </group>
      <group position={aligning ? [LENS_X, 0, 0] : [MEAS_X, 0, 0]}>
        <group ref={measStage}>
          <Stage />
        </group>
      </group>
      {/* slit of light on the wafer during a scan (the resist is being exposed there) */}
      <mesh ref={slit} position={[LENS_X, WAFER_Y + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <planeGeometry args={[WAFER.dieW * 2 / 1000, 0.006]} />
        <meshBasicMaterial color="#cfc8ff" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      {/* reticle stage */}
      <group position={[LENS_X, RETICLE_Y, 0]}>
        <Box size={[0.5, 0.05, 0.3]} position={[0, -0.03, 0]} m="black" radius={0.01} />
        <group ref={reticleStage}>
          <Box size={[0.24, 0.03, 0.24]} position={[0, 0.005, 0]} m="ceramicGray" radius={0.006} />
          <group ref={reticleHand} position={[0, 0, 0]}>
            <group position={[0, 0.026, 0]}>
              <Reticle kind={kind} />
            </group>
          </group>
        </group>
      </group>
      {/* reticle pod / library for the load animation */}
      <group position={[LENS_X + 1.15, RETICLE_Y - 0.05, 0]}>
        <Box size={[0.3, 0.12, 0.26]} m="polycarbonate" radius={0.02} />
        <Box size={[0.32, 0.04, 0.28]} position={[0, -0.08, 0]} m="panelGray" radius={0.01} />
      </group>
      {/* illuminator above */}
      <group position={[LENS_X, RETICLE_Y + 0.32, 0]}>
        <Box size={[0.5, 0.36, 0.42]} m="panel" radius={0.03} />
        <Box size={[0.22, 0.1, 0.22]} position={[0, -0.22, 0]} m="steelSatin" radius={0.01} />
      </group>
      {/* excimer laser cabinet and beam delivery */}
      <group position={[1.75, 0, -0.1]}>
        <Box size={[0.8, 1.35, 0.7]} position={[0, 0.675, 0]} m="panelWarm" radius={0.03} />
        <Box size={[0.5, 0.16, 0.012]} position={[-0.05, 1.05, 0.352]} m="glassDark" radius={0.004} />
        <LightTower position={[0.28, 1.35, -0.25]} on="violet" />
      </group>
      <Box size={[0.9, 0.12, 0.12]} position={[1.25, RETICLE_Y + 0.32, -0.1]} m="steelSatin" radius={0.03} />
      <Box size={[0.12, 1.0, 0.12]} position={[1.72, 1.85, -0.1]} m="steelSatin" radius={0.03} />
      {/* educational light path overlay (193 nm UV is invisible in reality) */}
      <group ref={beam} visible={false}>
        <mesh position={[1.72, 1.85, -0.1]} material={MAT.beam}>
          <boxGeometry args={[0.024, 1.0, 0.024]} />
        </mesh>
        <mesh position={[1.25, RETICLE_Y + 0.32, -0.1]} rotation={[0, 0, Math.PI / 2]} material={MAT.beam}>
          <boxGeometry args={[0.024, 0.9, 0.024]} />
        </mesh>
        {/* shaped slit of light onto the reticle (drawn 4× the printed slit) */}
        <mesh position={[LENS_X, RETICLE_Y + 0.12, 0]} material={MAT.beam}>
          <boxGeometry args={[0.104, 0.2, 0.012]} />
        </mesh>
        {/* from the reticle into the lens, and out of the lens onto the wafer: 4× smaller */}
        <SlitFrustum x={LENS_X} y0={RETICLE_Y - 0.01} y1={WAFER_Y + 1.07} w0={0.104} w1={0.07} d={0.012} />
        <SlitFrustum x={LENS_X} y0={WAFER_Y + 0.07} y1={WAFER_Y + 0.004} w0={0.05} w1={0.026} d={0.006} />
      </group>
      {/* enclosure: back wall and side glass (front cut away) */}
      <Box size={[3.2, 2.7, 0.04]} position={[0.5, 1.35, -0.64]} m="panel" radius={0.01} />
      <Box size={[0.04, 2.7, 1.2]} position={[-1.05, 1.35, -0.02]} m="glassClear" radius={0.005} castShadow={false} />
    </group>
  );
}
