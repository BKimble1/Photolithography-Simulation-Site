/**
 * Optical wafer inspection (illustrative, no manufacturer's design): a granite base with an
 * air-bearing XY stage and a vacuum chuck, an optical head on a gantry (objective, dark-field
 * collector ring, oblique illumination module) and a monitor with the live defect map.
 *
 *  - 'scan'   bare-wafer particle scan: the chuck spins while the stage carries it sideways,
 *             so the fixed illumination spot traces a spiral from the edge to the centre.
 *  - 'review' patterned-wafer inspection: serpentine swaths under the objective, then a small
 *             SEM review column visits each defect found.
 *  - 'plan'   the die map (step 'diemap'): the wafer rests on the stage at its load position,
 *             clear of the optics, with the planned die grid and your die outlined; the
 *             monitor shows the same map, and tapping a die names it.
 *
 * The map is drawn from the simulated wafer's particles (x, y in mm on the 300 mm wafer); a
 * particle appears once the scan has passed over it. The laser and electron beams are
 * invisible, so they are drawn only as the optional beam-path overlay. Every motion is a
 * pure function of step progress.
 *
 * In the fab this is the inside of the inspection tool's housing (`inspection` in Fab.tsx):
 * placed there, the housing provides the enclosure, the monitor sits on the housing's screen
 * arm, and a parked robot stands in the front end behind the load ports.
 */
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { DIES, FIELDS, WAFER, YOUR_DIE } from '../../sim/dies';
import type { Particle } from '../../sim/types';
import { useSimState, useStep } from '../../state/sim';
import { lerp, seg, smooth, useProgressBucket, useProgressFrame } from '../anim';
import { MAT } from '../materials';
import { Box, CleanFloor, Cyl, LightTower, ScaraRobot, StandaloneOnly } from '../kit/parts';
import { Label } from '../labels';
import { useStationEnv } from '../stage/context';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';
import { useOverlay } from '../../state/presentation';

type V3 = [number, number, number];
const TAU = Math.PI * 2;
const R_MM = WAFER.radius;

// ───────────────────────────── layout (metres) ─────────────────────────────

const GRANITE_TOP = 0.97;
const WAFER_Y = 1.062; // wafer bottom on the chuck
const SEM_X = 0.3; // review column, beside the optical head at x = 0
const SCAN: [number, number] = [0.05, 0.85]; // 'scan': spiral scan window
const SWATH: [number, number] = [0.05, 0.62]; // 'review': serpentine window
const REVIEW: [number, number] = [0.66, 0.93]; // 'review': SEM visits
const N_SWATH = 10;
const SWATH_MM = (2 * R_MM) / N_SWATH;
/** 'plan': where the stage parks the wafer (its load position, clear of the optical head). */
const PLAN_X = 0.28;
const PLAN_Z = 0.05;
/** In the bay: the housing's operator screen (Fab.tsx `inspection`), in this tool frame. */
const BAY_SCREEN: V3 = [0.82, 1.55, 1.77];

// ───────────────────────────── scan geometry (pure functions of progress) ─────────────────────────────

/** 'scan': radius (mm) of the illumination spot from the wafer centre. */
const spiralR = (p: number) => R_MM * (1 - seg(p, SCAN[0], SCAN[1]));

/** Integrated chuck spin (rad) for the spiral scan. */
function spinAngle(p: number, dur: number) {
  const w = 11; // visual rad/s (real scanners spin far faster)
  const a = SCAN[0] - 0.02;
  const b = SCAN[1] + 0.02;
  const r = 0.04;
  const t = Math.min(p, b) * dur;
  const t0 = a * dur;
  const t1 = (a + r) * dur;
  const t2 = (b - r) * dur;
  const t3 = b * dur;
  if (t <= t0) return 0;
  let ang = ((Math.min(t, t1) - t0) ** 2 / (2 * (t1 - t0))) * w;
  if (t > t1) ang += (Math.min(t, t2) - t1) * w;
  if (t > t2) {
    const tt = Math.min(t, t3) - t2;
    ang += w * tt - (tt * tt * w) / (2 * (t3 - t2));
  }
  return ang;
}

const chord = (yMm: number) => Math.sqrt(Math.max(0, R_MM * R_MM - yMm * yMm));

/** 'review': the wafer point (mm) under the objective, the swath index and progress along it. */
function swathPoint(p: number, out: { x: number; y: number; k: number; along: number; active: boolean }) {
  const u = seg(p, SWATH[0], SWATH[1]) * N_SWATH;
  const k = Math.min(N_SWATH - 1, Math.floor(u));
  const w = u - k;
  const yk = R_MM - (k + 0.5) * SWATH_MM;
  const c = chord(yk) + 4;
  const dir = k % 2 === 0 ? 1 : -1;
  const along = Math.min(1, w / 0.85);
  out.k = k;
  out.along = along;
  out.active = p > SWATH[0] && p < SWATH[1];
  out.x = dir * lerp(-c, c, along);
  if (w > 0.85 && k < N_SWATH - 1) {
    const yn = R_MM - (k + 1.5) * SWATH_MM;
    const cn = chord(yn) + 4;
    out.x = lerp(dir * c, dir * cn, smooth(w, 0.85, 1));
    out.y = lerp(yk, yn, smooth(w, 0.85, 1));
  } else out.y = yk;
  if (p <= SWATH[0]) {
    out.x = -chord(R_MM - SWATH_MM / 2) - 4;
    out.y = R_MM - SWATH_MM / 2;
  }
}

/** Where the last swath ends (mm), precomputed so the frame loop allocates nothing. */
const SWATH_END = (() => {
  const o = { x: 0, y: 0, k: 0, along: 0, active: false };
  swathPoint(SWATH[1] - 1e-4, o);
  return o;
})();

/** 'review': has the swath scan passed particle q by progress p? */
function swathSeen(q: Particle, p: number) {
  const u = seg(p, SWATH[0], SWATH[1]) * N_SWATH;
  if (u >= N_SWATH) return true;
  const kq = Math.min(N_SWATH - 1, Math.max(0, Math.floor((R_MM - q.y) / SWATH_MM)));
  const k = Math.floor(u);
  if (kq < k) return true;
  if (kq > k) return false;
  const yk = R_MM - (k + 0.5) * SWATH_MM;
  const c = chord(yk) + 4;
  const dir = k % 2 === 0 ? 1 : -1;
  const x = dir * lerp(-c, c, Math.min(1, (u - k) / 0.85));
  return dir > 0 ? x >= q.x : x <= q.x;
}

/** Particles in the order the swath scan finds them (the SEM reviews them in this order). */
function detectionOrder(parts: readonly Particle[]): number[] {
  const first = (q: Particle) => {
    let lo = SWATH[0];
    let hi = SWATH[1];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (swathSeen(q, mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  return parts
    .map((q, i) => ({ i, t: first(q) }))
    .sort((a, b) => a.t - b.t)
    .map((o) => o.i);
}

// ───────────────────────────── defect map display ─────────────────────────────

interface MapState {
  mode: 'scan' | 'review';
  parts: readonly Particle[];
  seen: boolean[];
  scanR: number; // 'scan': unscanned core radius (mm)
  swathK: number; // 'review': current swath
  swathAlong: number;
  swathDone: boolean;
  reviewing: number; // index into parts, or −1
  phase: 'idle' | 'scanning' | 'review' | 'done';
}

function drawMap(ctx: CanvasRenderingContext2D, W: number, H: number, s: MapState) {
  ctx.fillStyle = '#0c111b';
  ctx.fillRect(0, 0, W, H);
  const pad = 22;
  const rPx = (H - 2 * pad) / 2;
  const cx = pad + rPx;
  const cy = H / 2;
  const X = (mm: number) => cx + (mm / R_MM) * rPx;
  const Y = (mm: number) => cy - (mm / R_MM) * rPx;
  // wafer disc and die grid
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rPx, 0, TAU);
  ctx.clip();
  ctx.fillStyle = '#10151f';
  ctx.fillRect(cx - rPx, cy - rPx, 2 * rPx, 2 * rPx);
  // scanned area
  ctx.fillStyle = '#243553';
  if (s.mode === 'scan') {
    if (s.scanR < R_MM) {
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, TAU);
      ctx.arc(cx, cy, (s.scanR / R_MM) * rPx, 0, TAU, true);
      ctx.fill('evenodd');
    }
  } else {
    for (let k = 0; k < N_SWATH; k++) {
      const y0 = R_MM - k * SWATH_MM;
      if (s.swathDone || k < s.swathK) ctx.fillRect(cx - rPx, Y(y0), 2 * rPx, (SWATH_MM / R_MM) * rPx);
      else if (k === s.swathK) {
        const w = 2 * rPx * s.swathAlong;
        const x0 = k % 2 === 0 ? cx - rPx : cx + rPx - w;
        ctx.fillRect(x0, Y(y0), w, (SWATH_MM / R_MM) * rPx);
      }
    }
  }
  ctx.strokeStyle = 'rgba(160, 180, 210, 0.16)';
  ctx.lineWidth = 1;
  for (const d of DIES) ctx.strokeRect(X(d.x - WAFER.dieW / 2), Y(d.y + WAFER.dieH / 2), (WAFER.dieW / R_MM) * rPx, (WAFER.dieH / R_MM) * rPx);
  ctx.restore();
  ctx.strokeStyle = 'rgba(200, 215, 235, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, rPx, Math.PI / 2 + 0.035, Math.PI / 2 + TAU - 0.035);
  ctx.stroke();
  // scan front
  if (s.phase === 'scanning' && s.mode === 'scan') {
    ctx.strokeStyle = 'rgba(122, 108, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, (s.scanR / R_MM) * rPx), 0, TAU);
    ctx.stroke();
  }
  // defects (enormously enlarged, as on any defect map)
  let n = 0;
  s.parts.forEach((q, i) => {
    if (!s.seen[i]) return;
    n++;
    const active = i === s.reviewing;
    ctx.fillStyle = active ? '#ffffff' : '#ffb35c';
    ctx.beginPath();
    ctx.arc(X(q.x), Y(q.y), 3.2 + q.sizeUm * 3, 0, TAU);
    ctx.fill();
    if (active) {
      ctx.strokeStyle = '#7a6cff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(q.x), Y(q.y), 11, 0, TAU);
      ctx.stroke();
    }
  });
  // side panel
  const x0 = 2 * rPx + 2 * pad + 6;
  ctx.fillStyle = 'rgba(200, 212, 230, 0.55)';
  ctx.font = '600 13px sans-serif';
  ctx.fillText(s.mode === 'scan' ? 'PARTICLE SCAN' : 'DEFECT INSPECTION', x0, 40);
  ctx.fillStyle = '#e8edf5';
  ctx.font = '600 44px sans-serif';
  ctx.fillText(String(n), x0, 96);
  ctx.fillStyle = 'rgba(200, 212, 230, 0.7)';
  ctx.font = '14px sans-serif';
  ctx.fillText(n === 1 ? 'defect found' : 'defects found', x0, 118);
  const status = s.phase === 'idle' ? 'Ready' : s.phase === 'scanning' ? 'Scanning…' : s.phase === 'review' ? 'SEM review' : 'Complete';
  ctx.fillStyle = s.phase === 'done' ? '#6ef0b0' : '#b9b0ff';
  ctx.font = '600 14px sans-serif';
  ctx.fillText(status, x0, 150);
  // SEM thumbnail of the defect under review
  if (s.mode === 'review' && s.reviewing >= 0) {
    const tx = x0;
    const ty = 170;
    const tw = W - x0 - 18;
    const th = H - ty - 20;
    const rnd = (i: number) => {
      const v = Math.sin(i * 12.9898 + s.reviewing * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    ctx.fillStyle = '#2a2d31';
    ctx.fillRect(tx, ty, tw, th);
    // wiring lines under the particle, then the particle with a bright edge
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(150,150,150,0.55)';
      ctx.fillRect(tx, ty + 8 + i * (th / 6), tw, th / 14);
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(rnd(i) * 0.12).toFixed(3)})`;
      ctx.fillRect(tx + rnd(i + 999) * tw, ty + rnd(i + 1999) * th, 1.5, 1.5);
    }
    const pr = Math.min(tw, th) * (0.16 + 0.1 * (s.parts[s.reviewing]?.sizeUm ?? 0.3));
    const g = ctx.createRadialGradient(tx + tw / 2, ty + th / 2, pr * 0.3, tx + tw / 2, ty + th / 2, pr);
    g.addColorStop(0, '#6f7378');
    g.addColorStop(0.85, '#d9dcdf');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(tx + tw / 2, ty + th / 2, pr, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,212,230,0.5)';
    ctx.strokeRect(tx, ty, tw, th);
    ctx.fillStyle = 'rgba(200, 212, 230, 0.75)';
    ctx.font = '12px sans-serif';
    ctx.fillText('SEM image', tx + 6, ty + th - 8);
  } else if (s.mode === 'review' && s.phase !== 'idle' && s.phase !== 'scanning' && n === 0) {
    ctx.fillStyle = 'rgba(200, 212, 230, 0.7)';
    ctx.font = '14px sans-serif';
    ctx.fillText('Nothing to review', x0, 180);
  }
}

/** The planned die map ('plan'): complete and partial dies, exposure fields, your die. */
function drawPlan(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = '#0c111b';
  ctx.fillRect(0, 0, W, H);
  const pad = 22;
  const rPx = (H - 2 * pad) / 2;
  const cx = pad + rPx;
  const cy = H / 2;
  const k = rPx / R_MM;
  const X = (mm: number) => cx + mm * k;
  const Y = (mm: number) => cy - mm * k;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rPx, 0, TAU);
  ctx.clip();
  ctx.fillStyle = '#1a2436';
  ctx.fillRect(cx - rPx, cy - rPx, 2 * rPx, 2 * rPx);
  ctx.lineWidth = 1;
  for (const d of DIES) {
    ctx.strokeStyle = d.full ? 'rgba(200, 215, 235, 0.55)' : 'rgba(160, 180, 210, 0.2)';
    ctx.strokeRect(X(d.x - WAFER.dieW / 2) + 0.5, Y(d.y + WAFER.dieH / 2) + 0.5, WAFER.dieW * k - 1, WAFER.dieH * k - 1);
  }
  ctx.strokeStyle = 'rgba(122, 108, 255, 0.55)';
  ctx.lineWidth = 1.5;
  for (const f of FIELDS) ctx.strokeRect(X(f.x - f.w / 2), Y(f.y + f.h / 2), f.w * k, f.h * k);
  const you = DIES[YOUR_DIE];
  ctx.fillStyle = '#7a6cff';
  ctx.fillRect(X(you.x - WAFER.dieW / 2), Y(you.y + WAFER.dieH / 2), WAFER.dieW * k, WAFER.dieH * k);
  ctx.restore();
  ctx.strokeStyle = 'rgba(200, 215, 235, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, rPx, Math.PI / 2 + 0.035, Math.PI / 2 + TAU - 0.035);
  ctx.stroke();
  const x0 = 2 * rPx + 2 * pad + 6;
  ctx.fillStyle = 'rgba(200, 212, 230, 0.55)';
  ctx.font = '600 13px sans-serif';
  ctx.fillText('DIE MAP', x0, 40);
  ctx.fillStyle = '#e8edf5';
  ctx.font = '600 44px sans-serif';
  ctx.fillText(String(DIES.filter((d) => d.full).length), x0, 96);
  ctx.fillStyle = 'rgba(200, 212, 230, 0.7)';
  ctx.font = '14px sans-serif';
  ctx.fillText('complete dies', x0, 118);
  ctx.fillText(`${DIES.length} die sites`, x0, 150);
  ctx.fillText(`${FIELDS.length} fields`, x0, 172);
  ctx.fillStyle = '#b9b0ff';
  ctx.font = '600 14px sans-serif';
  ctx.fillText('Your die', x0, 210);
}

function MapScreen({ mode, position, rotation }: { mode: 'scan' | 'review' | 'plan'; position: V3; rotation: V3 }) {
  const state = useSimState();
  const b = useProgressBucket(120);
  const parts = state.wafer.particles;
  const { canvas, tex } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 320;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: c, tex: t };
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  const ms = useMemo<MapState | null>(() => {
    if (mode === 'plan') return null;
    const scanR = mode === 'scan' ? spiralR(b) : R_MM;
    const seen = parts.map((q) => (mode === 'scan' ? Math.hypot(q.x, q.y) >= scanR - 0.5 && b > SCAN[0] : swathSeen(q, b) && b > SWATH[0]));
    const sp = { x: 0, y: 0, k: 0, along: 0, active: false };
    swathPoint(b, sp);
    const found = detectionOrder(parts).filter((i) => seen[i]);
    let reviewing = -1;
    if (mode === 'review' && b >= REVIEW[0] && b < REVIEW[1] && found.length) {
      reviewing = found[Math.min(found.length - 1, Math.floor(seg(b, REVIEW[0], REVIEW[1]) * found.length))];
    }
    const win = mode === 'scan' ? SCAN : SWATH;
    const phase: MapState['phase'] = b <= win[0] ? 'idle' : b < win[1] ? 'scanning' : mode === 'review' && b < REVIEW[1] && found.length ? 'review' : 'done';
    return { mode, parts, seen, scanR, swathK: sp.k, swathAlong: sp.along, swathDone: b >= SWATH[1], reviewing, phase };
  }, [mode, parts, b]);
  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (ms) drawMap(ctx, canvas.width, canvas.height, ms);
    else drawPlan(ctx, canvas.width, canvas.height);
    tex.needsUpdate = true;
  }, [ms, canvas, tex]);
  return (
    <group position={position} rotation={rotation}>
      <Box size={[0.5, 0.33, 0.03]} m="black" radius={0.01} />
      <mesh position={[0, 0.005, 0.0152]}>
        <planeGeometry args={[0.47, 0.294]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <Box size={[0.06, 0.1, 0.05]} position={[0, -0.1, -0.035]} m="steelDark" radius={0.01} />
    </group>
  );
}

// ───────────────────────────── parts ─────────────────────────────

function Base() {
  return (
    <group>
      <Box size={[1.4, 0.83, 0.95]} position={[0.1, 0.415 + 0.04, 0]} m="panel" radius={0.02} />
      <Box size={[1.38, 0.08, 0.93]} position={[0.1, 0.04, 0]} m="panelDark" radius={0.01} />
      {[-0.35, 0.1, 0.55].map((x) => (
        <Box key={x} size={[0.008, 0.62, 0.01]} position={[x, 0.46, 0.476]} m="panelGray" radius={0.002} castShadow={false} />
      ))}
      {/* vibration-isolated granite */}
      <Box size={[1.2, 0.1, 0.78]} position={[0.1, GRANITE_TOP - 0.05, -0.02]} m="granite" radius={0.012} />
      {[-0.42, 0.62].map((x) => (
        <Cyl key={x} r={0.04} h={0.04} position={[x, 0.89, -0.02]} m="black" />
      ))}
      {/* X-axis rails */}
      {[-0.2, 0.2].map((z) => (
        <Box key={z} size={[1.05, 0.016, 0.03]} position={[0.1, GRANITE_TOP + 0.008, z]} m="steel" radius={0.003} />
      ))}
    </group>
  );
}

function StageStack({ x, y, spin, wafer }: { x: React.RefObject<THREE.Group | null>; y: React.RefObject<THREE.Group | null>; spin: React.RefObject<THREE.Group | null>; wafer: React.ReactNode }) {
  return (
    <group ref={x}>
      {/* X carriage with its Y rails */}
      <Box size={[0.42, 0.034, 0.5]} position={[0, GRANITE_TOP + 0.033, 0]} m="black" radius={0.008} />
      {[-0.12, 0.12].map((xx) => (
        <Box key={xx} size={[0.026, 0.012, 0.46]} position={[xx, GRANITE_TOP + 0.056, 0]} m="steel" radius={0.003} />
      ))}
      <group ref={y}>
        <Box size={[0.36, 0.02, 0.36]} position={[0, GRANITE_TOP + 0.072, 0]} m="panelDark" radius={0.006} />
        {/* interferometer mirrors */}
        <Box size={[0.36, 0.024, 0.008]} position={[0, GRANITE_TOP + 0.086, -0.184]} m="chrome" radius={0.002} />
        <Box size={[0.008, 0.024, 0.36]} position={[-0.184, GRANITE_TOP + 0.086, 0]} m="chrome" radius={0.002} />
        <group ref={spin}>
          <Cyl r={0.05} h={0.01} position={[0, WAFER_Y - 0.017, 0]} m="steelSatin" />
          <Cyl r={0.152} h={0.01} position={[0, WAFER_Y - 0.005, 0]} m="ceramicGray" seg={96} />
          {[0.05, 0.09, 0.13].map((r) => (
            <mesh key={r} position={[0, WAFER_Y - 0.0002, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.steelDark}>
              <ringGeometry args={[r, r + 0.0018, 72]} />
            </mesh>
          ))}
          {wafer}
        </group>
      </group>
    </group>
  );
}

function OpticalHead() {
  const Y0 = WAFER_Y + 0.024; // objective tip
  return (
    <group>
      {/* gantry */}
      {[-0.48, 0.68].map((x) => (
        <Box key={x} size={[0.07, 0.56, 0.1]} position={[x, GRANITE_TOP + 0.28, -0.3]} m="panel" radius={0.012} />
      ))}
      <Box size={[1.26, 0.1, 0.12]} position={[0.1, GRANITE_TOP + 0.6, -0.3]} m="panel" radius={0.015} />
      <Box size={[0.2, 0.08, 0.34]} position={[0, GRANITE_TOP + 0.6, -0.14]} m="black" radius={0.012} />
      {/* optics housing, objective barrel, dark-field collector ring */}
      <Box size={[0.17, 0.2, 0.17]} position={[0, Y0 + 0.36, 0]} m="panelWarm" radius={0.016} />
      <Cyl r={0.05} h={0.08} position={[0, Y0 + 0.22, 0]} m="black" />
      <Cyl r={0.03} h={0.15} position={[0, Y0 + 0.1, 0]} m="black" />
      <Cyl r={0.034} h={0.008} position={[0, Y0 + 0.13, 0]} m="chrome" />
      <Cyl r={0.018} h={0.025} rTop={0.026} position={[0, Y0 + 0.0125, 0]} m="steelSatin" />
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * TAU + 0.3;
        return (
          <group key={i} position={[Math.cos(a) * 0.075, Y0 + 0.055, Math.sin(a) * 0.075]} rotation={[0, -a, 0]}>
            <group rotation={[0, 0, 0.75]}>
              <Cyl r={0.014} h={0.06} m="black" seg={16} />
              <Cyl r={0.011} h={0.004} position={[0, -0.031, 0]} m="glassDark" seg={16} />
            </group>
          </group>
        );
      })}
      {/* collector mounting ring: just wide enough for the lenses, so it hides little of the wafer */}
      <Cyl r={0.095} h={0.01} position={[0, Y0 + 0.095, 0]} m="steelSatin" seg={48} />
      {/* oblique illumination module */}
      <group position={[-0.24, Y0 + 0.2, 0]}>
        <Box size={[0.14, 0.1, 0.12]} m="panelWarm" radius={0.012} />
        <group rotation={[0, 0, -0.62]}>
          <Cyl r={0.018} h={0.16} position={[0.02, -0.1, 0]} rotation={[0, 0, Math.PI / 2]} m="steelDark" />
        </group>
      </group>
      <Box size={[0.08, 0.3, 0.06]} position={[0, Y0 + 0.47 + 0.07, -0.1]} m="steelSatin" radius={0.01} />
    </group>
  );
}

function SemColumn() {
  const Y0 = WAFER_Y + 0.03;
  return (
    <group position={[SEM_X, 0, 0]}>
      {/* compact review column with a local vacuum skirt */}
      <Cyl r={0.035} h={0.02} rTop={0.02} position={[0, Y0 + 0.01, 0]} m="steelDark" />
      <Cyl r={0.05} h={0.12} position={[0, Y0 + 0.08, 0]} m="steelSatin" />
      <Cyl r={0.056} h={0.012} position={[0, Y0 + 0.146, 0]} m="chrome" />
      <Cyl r={0.045} h={0.14} position={[0, Y0 + 0.22, 0]} m="steelSatin" />
      <Cyl r={0.05} h={0.012} position={[0, Y0 + 0.296, 0]} m="chrome" />
      <Cyl r={0.038} h={0.1} position={[0, Y0 + 0.35, 0]} m="panel" />
      <Cyl r={0.026} h={0.03} position={[0, Y0 + 0.415, 0]} m="black" />
      <Box size={[0.1, 0.07, 0.07]} position={[0.08, Y0 + 0.08, 0]} m="black" radius={0.008} />
    </group>
  );
}

/**
 * 'plan': tap (or point at) a die to name it; your die is outlined in violet. Lives in the
 * wafer's frame (origin at the wafer's underside centre): the tool is mounted in the bay, so
 * the world-space hit is brought into this frame before it is compared with the die grid.
 */
function DiePicker({ position }: { position: V3 }) {
  const ref = useRef<THREE.Group>(null);
  const [hit, setHit] = useState<{ id: number; pos: V3 } | null>(null);
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const g = ref.current;
    if (!g) return;
    e.stopPropagation();
    const local = g.worldToLocal(e.point.clone());
    const x = local.x * 1000;
    const y = -local.z * 1000; // mm on the wafer, notch at −y
    const d = DIES.find((dd) => Math.abs(dd.x - x) <= WAFER.dieW / 2 && Math.abs(dd.y - y) <= WAFER.dieH / 2);
    if (!d) {
      setHit(null);
      return;
    }
    const w = g.localToWorld(new THREE.Vector3(d.x / 1000, 0.01, -d.y / 1000));
    setHit((h) => (h && h.id === d.id ? h : { id: d.id, pos: [w.x, w.y, w.z] }));
  };
  const d = hit ? DIES[hit.id] : null;
  return (
    <group ref={ref} position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0022, 0]} onPointerMove={pick} onClick={pick} onPointerOut={() => setHit(null)}>
        <circleGeometry args={[WAFER.radius / 1000, 64]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {d && hit && (
        <Label pos={hit.pos} tone="chip" priority={3}>
          <b>{d.id === YOUR_DIE ? 'Your die' : `Die ${d.col}, ${d.row}`}</b> · {d.full ? 'complete' : 'partial edge die (not tested)'}
        </Label>
      )}
    </group>
  );
}

/** In the bay: the front end's wafer robot, parked behind the load ports. */
function FrontEndRobot() {
  return (
    <group position={[0.1, 0, 1.18]}>
      <Box size={[0.24, 0.78, 0.24]} position={[0, 0.39, 0]} m="panelGray" radius={0.012} />
      <ScaraRobot position={[0, 0.78, 0]} base={2.4} elbow={-2.5} wrist={2.2} lift={0.02} />
    </group>
  );
}

// ───────────────────────────── scene ─────────────────────────────

export default function Inspect({ variant }: ToolProps) {
  const { id, content } = useStep();
  const mode: 'scan' | 'review' | 'plan' = variant === 'diemap' || id === 'diemap' ? 'plan' : variant === 'review' || id === 'inspect' ? 'review' : 'scan';
  const dur = content.duration;
  const { placed } = useStationEnv();
  const state = useSimState();
  const lightPath = useOverlay('lightPath');
  const parts = state.wafer.particles;

  const stageX = useRef<THREE.Group>(null);
  const stageY = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const beams = useRef<THREE.Group>(null);
  const laser = useRef<THREE.Group>(null);
  const semBeam = useRef<THREE.Mesh>(null);
  const sp = useMemo(() => ({ x: 0, y: 0, k: 0, along: 0, active: false }), []);

  // particles in detection order, for the SEM review
  const order = useMemo(() => detectionOrder(parts), [parts]);

  useProgressFrame((p) => {
    let sx = 0;
    let sz = 0;
    let ang = 0;
    let scanning = false;
    let semOn = false;
    if (mode === 'plan') {
      // the wafer rests at the stage's load position while its die grid is laid out
      sx = PLAN_X;
      sz = PLAN_Z;
    } else if (mode === 'scan') {
      // spot fixed at the origin; the chuck centre travels along +x as the radius shrinks
      sx = (spiralR(p) / 1000) * (p < SCAN[0] ? smooth(p, 0, SCAN[0]) : 1);
      ang = spinAngle(p, dur);
      scanning = p > SCAN[0] && p < SCAN[1];
    } else {
      swathPoint(p, sp);
      // the wafer point (mm) under the objective at the origin: centre = −point
      let wx = -sp.x / 1000;
      let wz = sp.y / 1000;
      scanning = sp.active;
      if (p >= SWATH[1]) {
        // after the swaths: visit each defect under the SEM column, then park
        const n = order.length;
        const park = smooth(p, 0.94, 1);
        if (n > 0 && p >= REVIEW[0] && p < REVIEW[1] + 0.01) {
          const u = seg(p, REVIEW[0], REVIEW[1]) * n;
          const k = Math.min(n - 1, Math.floor(u));
          const w = u - k;
          const q = parts[order[k]];
          const prev = k === 0 ? null : parts[order[k - 1]];
          const tx = SEM_X - q.x / 1000;
          const tz = q.y / 1000;
          const fx = prev ? SEM_X - prev.x / 1000 : wx;
          const fz = prev ? prev.y / 1000 : wz;
          const m = smooth(w, 0, 0.45);
          wx = lerp(fx, tx, m);
          wz = lerp(fz, tz, m);
          semOn = w > 0.45;
        } else if (n > 0 && p >= REVIEW[1]) {
          const q = parts[order[n - 1]];
          wx = lerp(SEM_X - q.x / 1000, 0, park);
          wz = lerp(q.y / 1000, 0, park);
        } else {
          const t = smooth(p, SWATH[1], SWATH[1] + 0.06);
          wx = lerp(-SWATH_END.x / 1000, 0, t);
          wz = lerp(SWATH_END.y / 1000, 0, t);
        }
      } else if (p < SWATH[0]) {
        const t = smooth(p, 0, SWATH[0]);
        wx = lerp(0, wx, t);
        wz = lerp(0, wz, t);
      }
      sx = wx;
      sz = wz;
    }
    if (stageX.current) stageX.current.position.x = sx;
    if (stageY.current) stageY.current.position.z = sz;
    if (spin.current) spin.current.rotation.y = ang;
    if (beams.current) beams.current.visible = lightPath;
    if (laser.current) laser.current.visible = scanning;
    if (semBeam.current) semBeam.current.visible = semOn;
  });

  const beamY = WAFER_Y + 0.0017;
  const laserFrom = new THREE.Vector3(-0.2, WAFER_Y + 0.17, 0);
  const laserLen = laserFrom.distanceTo(new THREE.Vector3(0, beamY, 0));
  const laserAng = Math.atan2(laserFrom.y - beamY, -laserFrom.x);

  return (
    <group>
      <CleanFloor size={12} />
      <Base />
      <StageStack
        x={stageX}
        y={stageY}
        spin={spin}
        wafer={
          mode === 'plan' ? (
            <>
              <Wafer anchor look={{ summary: state.wafer, showParticles: true, highlightDie: true, planGrid: true, fields: FIELDS }} position={[0, WAFER_Y, 0]} size={1024} metalness={0.82} roughness={0.12} />
              <DiePicker position={[0, WAFER_Y, 0]} />
            </>
          ) : (
            <Wafer anchor look={{ summary: state.wafer, showParticles: true }} position={[0, WAFER_Y, 0]} size={768} />
          )
        }
      />
      <OpticalHead />
      {mode === 'review' && <SemColumn />}
      {/* optional beam-path overlay: the illumination is UV, the review beam is electrons */}
      <group ref={beams} visible={false}>
        <group ref={laser} visible={false}>
          {mode === 'scan' ? (
            <mesh position={[laserFrom.x / 2, (laserFrom.y + beamY) / 2, 0]} rotation={[0, 0, Math.PI / 2 - laserAng]} material={MAT.beam}>
              <cylinderGeometry args={[0.0025, 0.0025, laserLen, 8, 1, true]} />
            </mesh>
          ) : (
            <mesh position={[0, (WAFER_Y + 0.024 + beamY) / 2, 0]} material={MAT.beam}>
              <cylinderGeometry args={[0.004, 0.016, WAFER_Y + 0.024 - beamY, 16, 1, true]} />
            </mesh>
          )}
          <mesh position={[0, beamY + 0.0003, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.beam}>
            <circleGeometry args={[0.006, 20]} />
          </mesh>
        </group>
        <mesh ref={semBeam} position={[SEM_X, (WAFER_Y + 0.03 + beamY) / 2, 0]} material={MAT.beam} visible={false}>
          <cylinderGeometry args={[0.001, 0.008, WAFER_Y + 0.03 - beamY, 12, 1, true]} />
        </mesh>
      </group>
      {placed ? (
        <>
          {/* the live map on the housing's operator screen, and the arm above the cut */}
          <MapScreen mode={mode} position={BAY_SCREEN} rotation={[-0.08, 0, 0]} />
          <Box size={[0.046, 0.36, 0.046]} position={[BAY_SCREEN[0], 1.27, BAY_SCREEN[2] - 0.03]} m="steelDark" radius={0.006} />
          <FrontEndRobot />
        </>
      ) : (
        <>
          <MapScreen mode={mode} position={[0.84, 1.36, 0.3]} rotation={[-0.06, -0.12, 0]} />
          <Box size={[0.04, 0.5, 0.04]} position={[0.84, 1.05, 0.26]} m="steelSatin" radius={0.006} />
        </>
      )}
      <StandaloneOnly>
        <LightTower position={[0.72, GRANITE_TOP + 0.66, -0.36]} on="green" />
        {/* enclosure back panel */}
        <Box size={[1.6, 1.6, 0.03]} position={[0.1, 0.8, -0.62]} m="panelWarm" radius={0.01} />
      </StandaloneOnly>
    </group>
  );
}
