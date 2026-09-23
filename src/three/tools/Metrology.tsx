/**
 * CD-SEM metrology (illustrative, no manufacturer's design), drawn as the inside of its bay
 * model (Fab.tsx, metrology) with the front and top cut away: a stainless vacuum chamber (its
 * own front cut away too) with an XY stage and electrostatic chuck, a tall electron column of
 * stacked lens sections rising through the roof with its gun, high-voltage cable and ion pumps,
 * a load lock with a magnetically coupled transfer arm, a small front end with two load ports
 * and a robot, an electronics rack, and the operator's monitor with the live SEM image.
 *
 * The stage carries the wafer to five measurement sites and pauses at each while the image
 * builds up. The image is computed from the simulated developed resist (bright edges on a dark
 * background, as secondary-electron images look), alternating NMOS and PMOS gate fields; the
 * CD readout is the process model's own measurement. The electron beam is invisible, so it is
 * drawn only as the optional beam-path overlay. Every motion is a pure function of progress.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Grid } from '../../sim/grid';
import { CUT_Y, LAYOUT } from '../../sim/layout';
import { M } from '../../sim/materials';
import { mulberry32 } from '../../sim/rng';
import { engine, useSimState } from '../../state/sim';
import { lerp, seg, smooth, useProgressBucket, useProgressFrame } from '../anim';
import { MAT } from '../materials';
import { Box, CleanFloor, Cyl, Lathe, LightTower, ScaraRobot, StandaloneOnly } from '../kit/parts';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';
import { useOverlay, useRunChoices } from '../../state/presentation';

type V3 = [number, number, number];

// ───────────────────────────── layout (metres) ─────────────────────────────
//
// Tool frame: the chamber at the origin; in the bay it stands 0.2 m right of and 0.15 m behind
// the housing's centre (poses/metrology.ts), so the housing's front (load ports, monitor arm) is
// at z = FRONT_Z and its cut plane, with the rear bulkhead, at z = BULKHEAD_Z.

const FRONT_Z = 1.15;
const BULKHEAD_Z = -0.6;
const PORT_X = [-1.15, -0.55];
const MONITOR: V3 = [0.8, 1.53, FRONT_Z + 0.25];
/** Scale of the column's section heights and radii: the gun rises through the housing's roof. */
const COL_S = 1.45;
const COL_R = 1.15;

const FLOOR_Y = 0.88; // chamber floor (inside)
const CHUCK_Y = 1.0; // wafer seat
const XFER_Y = 1.012; // transfer blade top
const PIN_LO = 0.99;
const PIN_UP = 1.024;
const TOP_Y = 1.22; // chamber top plate (underside)
const COL: [number, number] = [0.08, -0.02]; // electron column axis (x, z)
const TIP_Y = 1.035; // objective pole-piece tip
const LOAD_X = -0.12; // chuck centre at the load position
const LL_X = -0.7; // load-lock wafer centre
const COLLAR = 0.8; // transfer-arm drive collar sits this far behind the blade's wafer centre
const WT = 0.0016;

/** Measurement sites (mm on the wafer), in the order visited. */
const SITES: [number, number][] = [
  [0, 0],
  [70, 62],
  [-70, 62],
  [-70, -62],
  [70, -62],
];
const LOAD: [number, number] = [0.02, 0.14];
const MEASURE: [number, number] = [0.15, 0.845];
const UNLOAD: [number, number] = [0.865, 0.985];
const SITE_SPAN = (MEASURE[1] - MEASURE[0]) / SITES.length;
const MOVE_FRAC = 0.3; // of each site's span spent moving

// ───────────────────────────── timeline ─────────────────────────────

interface Frame {
  sx: number; // chuck centre
  sz: number;
  blade: number; // transfer blade: 0 at the load lock … 1 over the chuck
  pinsLL: number;
  pinsChuck: number;
  valve: number;
  wx: number;
  wy: number;
  wz: number;
  dwell: boolean;
}

/** Chuck centre that puts site k under the column (precomputed: no per-frame arrays). */
const CENTRES: [number, number][] = SITES.map(([x, y]) => [COL[0] - x / 1000, COL[1] + y / 1000]);
const LOAD_POS: [number, number] = [LOAD_X, 0];
const pinY = (v: number) => PIN_LO + (PIN_UP - PIN_LO) * v;
const bladeX = (b: number) => lerp(LL_X, LOAD_X, b);

function simulate(p: number, f: Frame) {
  // stage: load position → five sites → load position
  let x = LOAD_X;
  let z = 0;
  f.dwell = false;
  if (p >= MEASURE[0] && p < MEASURE[1] + 0.02) {
    const u = Math.min(SITES.length - 1e-6, (p - MEASURE[0]) / SITE_SPAN);
    const k = Math.floor(u);
    const w = u - k;
    const from = k === 0 ? LOAD_POS : CENTRES[k - 1];
    const to = CENTRES[k];
    const fx = from[0];
    const fz = from[1];
    const tx = to[0];
    const tz = to[1];
    const m = smooth(w, 0, MOVE_FRAC);
    x = lerp(fx, tx, m);
    z = lerp(fz, tz, m);
    f.dwell = w > MOVE_FRAC + 0.02 && p < MEASURE[1];
    if (p >= MEASURE[1]) {
      const t = smooth(p, MEASURE[1], MEASURE[1] + 0.02);
      const last = CENTRES[SITES.length - 1];
      x = lerp(last[0], LOAD_X, t);
      z = lerp(last[1], 0, t);
    }
  }
  f.sx = x;
  f.sz = z;
  f.blade = 0;
  f.pinsLL = 1;
  f.pinsChuck = 0;
  f.valve = 0;
  // default: on the chuck between the transfers, in the load lock before/after
  const onChuck = p >= LOAD[1] && p < UNLOAD[0];
  f.wx = onChuck ? x : LL_X;
  f.wz = onChuck ? z : 0;
  f.wy = onChuck ? CHUCK_Y : pinY(1);
  if (p >= LOAD[0] && p < LOAD[1]) {
    const u = seg(p, LOAD[0], LOAD[1]);
    f.valve = smooth(u, 0, 0.1) - smooth(u, 0.9, 1);
    f.pinsLL = 1 - smooth(u, 0.1, 0.2);
    f.blade = smooth(u, 0.2, 0.55) - smooth(u, 0.72, 0.9);
    f.pinsChuck = smooth(u, 0.58, 0.68) - smooth(u, 0.9, 1);
    if (u < 0.2) f.wy = Math.max(XFER_Y, pinY(f.pinsLL));
    else if (u < 0.58) {
      f.wx = bladeX(f.blade);
      f.wy = XFER_Y;
    } else {
      f.wx = LOAD_X;
      f.wy = u < 0.72 ? Math.max(XFER_Y, pinY(f.pinsChuck)) : Math.max(CHUCK_Y, pinY(f.pinsChuck));
    }
  } else if (p >= UNLOAD[0] && p < UNLOAD[1]) {
    const u = seg(p, UNLOAD[0], UNLOAD[1]);
    f.valve = smooth(u, 0, 0.1) - smooth(u, 0.9, 1);
    f.pinsChuck = smooth(u, 0.02, 0.1) - smooth(u, 0.3, 0.4);
    f.blade = smooth(u, 0.1, 0.28) - smooth(u, 0.42, 0.78);
    f.pinsLL = 1 - smooth(u, 0.02, 0.08) + smooth(u, 0.8, 0.9);
    if (u < 0.3) {
      f.wx = LOAD_X;
      f.wy = Math.max(CHUCK_Y, pinY(f.pinsChuck));
    } else if (u < 0.42) {
      f.wx = LOAD_X;
      f.wy = Math.max(XFER_Y, pinY(f.pinsChuck));
    } else if (u < 0.8) {
      f.wx = bladeX(f.blade);
      f.wy = XFER_Y;
    } else f.wy = Math.max(XFER_Y, pinY(f.pinsLL));
  }
}

// ───────────────────────────── SEM image ─────────────────────────────

/** Resist thickness per grid column (gu). */
function resistMap(g: Grid): Float32Array {
  const out = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const c = g.col(i, j);
      let t = 0;
      for (let k = 0; k < g.n[c]; k++) if (g.mat[c * g.K + k] === M.RES) t += g.thickness(c, k);
      out[j * g.nx + i] = t;
    }
  return out;
}

interface SemView {
  site: number; // 0-based, or −1 before the first site
  moving: boolean;
  done: boolean; // all sites measured (unloading)
  nmos: number; // CD relative to target
  pmos: number;
  residue: number;
}

function drawSem(ctx: CanvasRenderingContext2D, W: number, H: number, g: Grid, map: Float32Array, v: SemView) {
  ctx.fillStyle = '#0b0c0e';
  ctx.fillRect(0, 0, W, H);
  const S = H - 20; // square image
  const ox = 10;
  const oy = 10;
  const nmosSite = v.site < 0 || v.site % 2 === 0;
  const gate = nmosSite ? LAYOUT.nGate : LAYOUT.pGate;
  const gx = (gate[0] + gate[2]) / 2;
  const half = 19;
  const x0 = gx - half;
  const y0 = CUT_Y - half;
  const span = 2 * half;
  const thick = (xg: number, yg: number) => {
    const i = Math.min(g.nx - 1, Math.max(0, Math.floor(xg / g.dx)));
    const j = Math.min(g.ny - 1, Math.max(0, Math.floor(yg / g.dy)));
    return map[j * g.nx + i];
  };
  if (v.site >= 0) {
    const img = ctx.createImageData(S, S);
    const rand = mulberry32(17 + v.site * 101);
    // a small stage-placement offset per site, so each field looks freshly acquired
    const jx = (rand() - 0.5) * 1.2;
    const jy = (rand() - 0.5) * 1.2;
    for (let py = 0; py < S; py++) {
      const streak = (rand() - 0.5) * 10;
      for (let px = 0; px < S; px++) {
        const xg = x0 + jx + ((px + 0.5) / S) * span;
        const yg = y0 + jy + span - ((py + 0.5) / S) * span;
        const t = thick(xg, yg);
        const tx = thick(xg + 0.5, yg) - thick(xg - 0.5, yg);
        const ty = thick(xg, yg + 1) - thick(xg, yg - 1);
        const edge = Math.min(1, Math.hypot(tx, ty) / 3);
        let val = 34 + Math.min(1, t / 5) * 64 + edge * 150 + streak + (rand() - 0.5) * 46;
        if (v.moving) val = 18 + (rand() - 0.5) * 20;
        val = Math.max(0, Math.min(255, val));
        const i = (py * S + px) * 4;
        img.data[i] = val;
        img.data[i + 1] = val;
        img.data[i + 2] = val;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, ox, oy);
    if (!v.moving) {
      const X = (xg: number) => ox + ((xg - x0 - jx) / span) * S;
      // design edges (dashed) and the measured edges at half height along the cut
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      for (const e of [gate[0], gate[2]]) {
        ctx.beginPath();
        ctx.moveTo(X(e), oy + S * 0.3);
        ctx.lineTo(X(e), oy + S * 0.7);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      let ref = 0;
      for (let xg = gx - 1; xg <= gx + 1; xg += 0.5) ref = Math.max(ref, thick(xg, CUT_Y));
      if (ref > 0.5) {
        let l = gx;
        while (l > x0 && thick(l - 0.25, CUT_Y) >= ref / 2) l -= 0.25;
        let r = gx;
        while (r < x0 + span && thick(r + 0.25, CUT_Y) >= ref / 2) r += 0.25;
        const yMid = oy + S * 0.5;
        ctx.strokeStyle = '#9dff9d';
        ctx.lineWidth = 2;
        for (const e of [l, r]) {
          ctx.beginPath();
          ctx.moveTo(X(e), yMid - 30);
          ctx.lineTo(X(e), yMid + 30);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(X(l), yMid);
        ctx.lineTo(X(r), yMid);
        ctx.stroke();
      }
    }
  } else {
    ctx.fillStyle = '#151619';
    ctx.fillRect(ox, oy, S, S);
  }
  // side panel
  const tx = ox + S + 18;
  ctx.fillStyle = 'rgba(210, 214, 220, 0.6)';
  ctx.font = '600 13px sans-serif';
  ctx.fillText('CD-SEM · GATE LAYER', tx, 32);
  ctx.fillStyle = '#e9ecf0';
  ctx.font = '600 16px sans-serif';
  const siteTxt = v.site < 0 ? 'Loading wafer' : v.done ? `${SITES.length} sites measured` : `Site ${v.site + 1} of ${SITES.length}`;
  ctx.fillText(siteTxt, tx, 60);
  ctx.fillStyle = 'rgba(210, 214, 220, 0.65)';
  ctx.font = '13px sans-serif';
  ctx.fillText(v.site < 0 ? '' : nmosSite ? 'NMOS gate line' : 'PMOS gate line', tx, 80);
  if (v.site >= 0 && !v.moving) {
    const rel = nmosSite ? v.nmos : v.pmos;
    const ok = Math.abs(rel - 1) <= 0.1 && v.residue < 0.3;
    ctx.fillStyle = '#e9ecf0';
    ctx.font = '600 40px sans-serif';
    ctx.fillText(rel > 0 ? `${Math.round(rel * 100)}%` : '—', tx, 136);
    ctx.fillStyle = 'rgba(210, 214, 220, 0.65)';
    ctx.font = '13px sans-serif';
    ctx.fillText('CD of target', tx, 156);
    ctx.fillStyle = ok ? '#6ef0b0' : '#ff8a6a';
    ctx.font = '600 14px sans-serif';
    ctx.fillText(ok ? 'In spec (±10%)' : v.residue >= 0.3 ? 'Residue in openings' : 'Out of spec', tx, 186);
    if (v.done) {
      ctx.fillStyle = 'rgba(210, 214, 220, 0.65)';
      ctx.font = '13px sans-serif';
      ctx.fillText('Unloading wafer', tx, 214);
    }
  } else if (v.moving) {
    ctx.fillStyle = 'rgba(210, 214, 220, 0.65)';
    ctx.font = '14px sans-serif';
    ctx.fillText('Moving stage…', tx, 136);
  }
}

function SemScreen({ position, rotation }: { position: V3; rotation: V3 }) {
  const state = useSimState();
  const choices = useRunChoices();
  const b = useProgressBucket(90);
  const grid = state.grid;
  const map = useMemo(() => resistMap(grid), [grid]);
  const rg = engine.resistGates(choices);
  const residue = engine.resistResidue(choices);
  const { canvas, tex } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 320;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { canvas: c, tex: t };
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  const u = (b - MEASURE[0]) / SITE_SPAN;
  const site = b < MEASURE[0] ? -1 : Math.min(SITES.length - 1, Math.floor(u));
  const done = b >= MEASURE[1];
  const moving = !done && site >= 0 && u - site < MOVE_FRAC + 0.02;
  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawSem(ctx, canvas.width, canvas.height, grid, map, { site, moving, done, nmos: rg.nmos.rel, pmos: rg.pmos.rel, residue });
    tex.needsUpdate = true;
  }, [canvas, tex, grid, map, site, moving, done, rg, residue]);
  return (
    <group position={position} rotation={rotation}>
      <Box size={[0.61, 0.39, 0.03]} m="black" radius={0.01} />
      <mesh position={[0, 0, 0.0152]}>
        <planeGeometry args={[0.576, 0.36]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ───────────────────────────── parts ─────────────────────────────

function Chamber({ valve }: { valve: React.RefObject<THREE.Mesh | null> }) {
  const H = TOP_Y - FLOOR_Y;
  const yc = (TOP_Y + FLOOR_Y) / 2;
  return (
    <group>
      {/* anti-vibration table */}
      {[
        [-0.36, -0.3],
        [0.36, -0.3],
        [-0.36, 0.3],
        [0.36, 0.3],
      ].map(([x, z]) => (
        <group key={`${x}${z}`}>
          <Cyl r={0.05} h={0.5} position={[x, 0.25, z]} m="panelDark" />
          <Cyl r={0.065} h={0.06} position={[x, 0.53, z]} m="black" />
        </group>
      ))}
      <Box size={[0.92, 0.3, 0.8]} position={[0, 0.71, 0]} m="panel" radius={0.02} />
      {/* stainless chamber: floor, back and side walls, top plate; the front is cut away */}
      <Box size={[0.86, 0.03, 0.74]} position={[0, FLOOR_Y - 0.015, 0]} m="steelSatin" radius={0.006} />
      <Box size={[0.86, H, 0.035]} position={[0, yc, -0.352]} m="steelSatin" radius={0.006} />
      <Box size={[0.035, H, 0.74]} position={[0.412, yc, 0]} m="steelSatin" radius={0.006} />
      {/* left wall with the transfer slot */}
      <Box size={[0.035, 1.03 - FLOOR_Y - 0.02, 0.74]} position={[-0.412, (FLOOR_Y + 1.01) / 2, 0]} m="steelSatin" radius={0.006} />
      <Box size={[0.035, TOP_Y - 1.05, 0.74]} position={[-0.412, (TOP_Y + 1.05) / 2, 0]} m="steelSatin" radius={0.006} />
      <Box size={[0.035, 0.04, 0.2]} position={[-0.412, 1.03, 0.27]} m="steelSatin" radius={0.004} />
      <Box size={[0.035, 0.04, 0.2]} position={[-0.412, 1.03, -0.27]} m="steelSatin" radius={0.004} />
      <Box size={[0.86, 0.035, 0.74]} position={[0, TOP_Y + 0.0175, 0]} m="steelSatin" radius={0.006} />
      {/* front flange edge (the cut) */}
      <Box size={[0.86, 0.02, 0.02]} position={[0, TOP_Y + 0.01, 0.37]} m="steel" radius={0.004} />
      <Box size={[0.86, 0.02, 0.02]} position={[0, FLOOR_Y - 0.01, 0.37]} m="steel" radius={0.004} />
      {/* ports on the right wall and the back */}
      {[
        [0.43, 1.06, -0.12],
        [0.43, 1.12, 0.14],
      ].map(([x, y, z]) => (
        <group key={`${y}${z}`}>
          <Cyl r={0.035} h={0.04} position={[x + 0.02, y, z]} rotation={[0, 0, Math.PI / 2]} m="steel" />
          <Cyl r={0.045} h={0.012} position={[x + 0.042, y, z]} rotation={[0, 0, Math.PI / 2]} m="steelSatin" />
        </group>
      ))}
      <Cyl r={0.06} h={0.08} position={[-0.18, 1.05, -0.39]} rotation={[Math.PI / 2, 0, 0]} m="steel" />
      <Cyl r={0.08} h={0.14} position={[-0.18, 1.05, -0.49]} rotation={[Math.PI / 2, 0, 0]} m="aluminum" />
      <Cyl r={0.085} h={0.012} position={[-0.18, 1.05, -0.425]} rotation={[Math.PI / 2, 0, 0]} m="steelSatin" />
      {/* gate valve to the load lock */}
      <group position={[-0.47, 0, 0]}>
        <Box size={[0.08, 0.02, 0.36]} position={[0, 1.061, 0]} m="aluminum" radius={0.004} />
        <Box size={[0.08, 0.03, 0.36]} position={[0, 0.992, 0]} m="aluminum" radius={0.004} />
        <Box size={[0.08, 0.07, 0.03]} position={[0, 1.03, 0.165]} m="aluminum" radius={0.004} />
        <Box size={[0.08, 0.07, 0.03]} position={[0, 1.03, -0.165]} m="aluminum" radius={0.004} />
        <mesh ref={valve} position={[0, 1.03, 0]}>
          <boxGeometry args={[0.012, 0.05, 0.3]} />
          <meshStandardMaterial color="#aeb3ba" metalness={0.9} roughness={0.3} />
        </mesh>
        <Box size={[0.06, 0.08, 0.3]} position={[0, 0.93, 0]} m="black" radius={0.008} />
      </group>
    </group>
  );
}

function Column() {
  // turned sections: objective (with conical pole piece), scan coils, condenser, gun
  const objective: [number, number][] = [
    [0.0, TIP_Y],
    [0.022, TIP_Y],
    [0.07, TIP_Y + 0.06],
    [0.1, TIP_Y + 0.1],
    [0.1, TOP_Y],
    [0.0, TOP_Y],
  ];
  const y1 = TOP_Y + 0.035;
  // stacked sections (centre offset above y1, height, radius), scaled by COL_S / COL_R
  const s = (o: number) => y1 + o * COL_S;
  const r = (v: number) => v * COL_R;
  const gunY = s(0.612);
  const gunDome: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    gunDome.push([Math.cos(a) * r(0.085), gunY + Math.sin(a) * 0.06 * COL_S]);
  }
  gunDome.push([0, gunY + 0.06 * COL_S]);
  const top = gunY + 0.06 * COL_S;
  return (
    <group position={[COL[0], 0, COL[1]]}>
      <Lathe profile={objective} m="steelSatin" seg={64} />
      <Cyl r={r(0.125)} h={0.02} position={[0, y1 + 0.01, 0]} m="steel" />
      <Cyl r={r(0.095)} h={0.13 * COL_S} position={[0, s(0.085), 0]} m="steelSatin" />
      <Cyl r={r(0.108)} h={0.014} position={[0, s(0.157), 0]} m="chrome" />
      <Cyl r={r(0.088)} h={0.14 * COL_S} position={[0, s(0.234), 0]} m="steelSatin" />
      <Cyl r={r(0.1)} h={0.014} position={[0, s(0.311), 0]} m="chrome" />
      <Cyl r={r(0.078)} h={0.16 * COL_S} position={[0, s(0.398), 0]} m="steelSatin" />
      <Cyl r={r(0.092)} h={0.014} position={[0, s(0.485), 0]} m="chrome" />
      <Cyl r={r(0.085)} h={0.12 * COL_S} position={[0, s(0.552), 0]} m="panel" />
      <Lathe profile={gunDome} m="panel" seg={48} />
      {/* ion pumps on the column */}
      {[-1, 1].map((k) => (
        <group key={k} position={[k * 0.16, s(0.36), 0]}>
          <Box size={[0.11, 0.16, 0.12]} m="black" radius={0.008} />
          <Cyl r={0.022} h={0.06} position={[-k * 0.07, 0, 0]} rotation={[0, 0, Math.PI / 2]} m="steel" />
        </group>
      ))}
      {/* high-voltage cable from the gun, back down through the roof to the supply */}
      <mesh position={[0, 0, 0]}>
        <tubeGeometry
          args={[
            new THREE.CatmullRomCurve3([
              new THREE.Vector3(0, top - 0.005, 0),
              new THREE.Vector3(0, top + 0.05, -0.06),
              new THREE.Vector3(0, top - 0.02, -0.2),
              new THREE.Vector3(0.02, 1.85, -0.3),
              new THREE.Vector3(0.05, 1.3, -0.45),
              new THREE.Vector3(0.1, 0.9, -0.55),
            ]),
            48,
            0.014,
            10,
            false,
          ]}
        />
        <meshStandardMaterial color="#1c1d20" roughness={0.7} />
      </mesh>
    </group>
  );
}

function StageStack({ x, y, pins, children }: { x: React.RefObject<THREE.Group | null>; y: React.RefObject<THREE.Group | null>; pins: React.RefObject<THREE.Group | null>; children?: React.ReactNode }) {
  return (
    <group>
      {[-0.2, 0.2].map((z) => (
        <Box key={z} size={[0.74, 0.018, 0.03]} position={[0, FLOOR_Y + 0.009, z]} m="steel" radius={0.003} />
      ))}
      <group ref={x}>
        <Box size={[0.4, 0.04, 0.5]} position={[0, FLOOR_Y + 0.038, 0]} m="black" radius={0.008} />
        {[-0.12, 0.12].map((xx) => (
          <Box key={xx} size={[0.026, 0.012, 0.46]} position={[xx, FLOOR_Y + 0.064, 0]} m="steel" radius={0.003} />
        ))}
        <group ref={y}>
          <Box size={[0.36, 0.028, 0.36]} position={[0, FLOOR_Y + 0.084, 0]} m="panelDark" radius={0.006} />
          <Box size={[0.36, 0.024, 0.008]} position={[0, FLOOR_Y + 0.105, -0.184]} m="chrome" radius={0.002} />
          <Box size={[0.008, 0.024, 0.36]} position={[0.184, FLOOR_Y + 0.105, 0]} m="chrome" radius={0.002} />
          <Cyl r={0.152} h={CHUCK_Y - (FLOOR_Y + 0.098)} position={[0, (CHUCK_Y + FLOOR_Y + 0.098) / 2, 0]} m="ceramicGray" seg={96} />
          <group ref={pins}>
            {[0, 1, 2].map((i) => {
              // clear of the transfer fork, which enters along −x → +x
              const a = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 - (2 * Math.PI) / 3][i];
              return <Cyl key={i} r={0.003} h={0.05} position={[Math.sin(a) * 0.1, PIN_LO - 0.025, Math.cos(a) * 0.1]} m="ceramic" seg={10} />;
            })}
          </group>
          {children}
        </group>
      </group>
    </group>
  );
}

function bladeGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.06, -0.026);
  s.lineTo(0.18, -0.026);
  s.lineTo(0.23, -0.05);
  s.lineTo(0.43, -0.05);
  s.lineTo(0.43, -0.026);
  s.lineTo(0.3, -0.022);
  s.lineTo(0.3, 0.022);
  s.lineTo(0.43, 0.026);
  s.lineTo(0.43, 0.05);
  s.lineTo(0.23, 0.05);
  s.lineTo(0.18, 0.026);
  s.lineTo(-0.06, 0.026);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  return g;
}

function LoadLock({ blade, pins, carriage }: { blade: React.RefObject<THREE.Group | null>; pins: React.RefObject<THREE.Group | null>; carriage: React.RefObject<THREE.Group | null> }) {
  const geo = useMemo(bladeGeometry, []);
  return (
    <group>
      <group position={[LL_X, 0, 0]}>
        <Box size={[0.4, 0.06, 0.46]} position={[0, 0.96, 0]} m="aluminum" radius={0.006} />
        <Box size={[0.4, 0.09, 0.03]} position={[0, 1.035, 0.215]} m="aluminum" radius={0.004} />
        <Box size={[0.4, 0.09, 0.03]} position={[0, 1.035, -0.215]} m="aluminum" radius={0.004} />
        <Box size={[0.03, 0.09, 0.46]} position={[-0.185, 1.035, 0]} m="aluminum" radius={0.004} />
        <Box size={[0.4, 0.012, 0.46]} position={[0, 1.086, 0]} m="glassDark" radius={0.003} castShadow={false} />
        <group ref={pins}>
          {[1, 3, 5, 7].map((k) => (
            <Cyl key={k} r={0.003} h={0.05} position={[Math.cos((k * Math.PI) / 4) * 0.1, PIN_LO - 0.025, Math.sin((k * Math.PI) / 4) * 0.1]} m="ceramic" seg={10} />
          ))}
        </group>
        <Box size={[0.3, 0.5, 0.3]} position={[0, 0.68, 0]} m="panelGray" radius={0.01} />
        <Cyl r={0.05} h={0.3} position={[0, 0.3, 0]} m="panelDark" />
      </group>
      {/* magnetically coupled transfer arm: a vacuum tube with an outer drive collar */}
      <Cyl r={0.022} h={0.68} position={[LL_X - 0.2 - 0.34, 1.03, 0]} rotation={[0, 0, Math.PI / 2]} m="glassClear" castShadow={false} />
      <Cyl r={0.03} h={0.02} position={[LL_X - 0.205, 1.03, 0]} rotation={[0, 0, Math.PI / 2]} m="steelSatin" />
      <Cyl r={0.026} h={0.02} position={[LL_X - 0.88, 1.03, 0]} rotation={[0, 0, Math.PI / 2]} m="steelSatin" />
      <group ref={carriage} position={[LL_X - COLLAR, 1.03, 0]}>
        <Cyl r={0.036} h={0.07} rotation={[0, 0, Math.PI / 2]} m="black" />
      </group>
      <group ref={blade} position={[LL_X, XFER_Y, 0]}>
        <mesh geometry={geo} material={MAT.ceramic} position={[-0.3, 0, 0]} />
        <Cyl r={0.008} h={0.5} position={[-0.55, 0.014, 0]} rotation={[0, 0, Math.PI / 2]} m="steel" />
      </group>
    </group>
  );
}

// ───────────────────────────── scene ─────────────────────────────

export default function Metrology({ variant }: ToolProps) {
  void variant;
  const state = useSimState();
  const lightPath = useOverlay('lightPath');
  const stageX = useRef<THREE.Group>(null);
  const stageY = useRef<THREE.Group>(null);
  const chuckPins = useRef<THREE.Group>(null);
  const llPins = useRef<THREE.Group>(null);
  const blade = useRef<THREE.Group>(null);
  const carriage = useRef<THREE.Group>(null);
  const valve = useRef<THREE.Mesh>(null);
  const wafer = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  const f = useMemo<Frame>(() => ({ sx: LOAD_X, sz: 0, blade: 0, pinsLL: 1, pinsChuck: 0, valve: 0, wx: LL_X, wy: PIN_UP, wz: 0, dwell: false }), []);

  useProgressFrame((p) => {
    simulate(p, f);
    if (stageX.current) stageX.current.position.x = f.sx;
    if (stageY.current) stageY.current.position.z = f.sz;
    const bx = bladeX(f.blade);
    if (blade.current) blade.current.position.x = bx;
    if (carriage.current) carriage.current.position.x = bx - COLLAR;
    if (valve.current) valve.current.position.y = 1.03 - 0.075 * f.valve;
    if (chuckPins.current) chuckPins.current.position.y = pinY(f.pinsChuck) - PIN_LO;
    if (llPins.current) llPins.current.position.y = pinY(f.pinsLL) - PIN_LO;
    if (wafer.current) wafer.current.position.set(f.wx, f.wy, f.wz);
    if (beam.current) beam.current.visible = lightPath && f.dwell;
  });

  return (
    <group>
      <CleanFloor size={12} />
      <Chamber valve={valve} />
      <StageStack x={stageX} y={stageY} pins={chuckPins} />
      <Column />
      <LoadLock blade={blade} pins={llPins} carriage={carriage} />
      {/* the electron beam is invisible: optional overlay only */}
      <mesh ref={beam} position={[COL[0], (TIP_Y + CHUCK_Y + WT) / 2, COL[1]]} material={MAT.beam} visible={false}>
        <cylinderGeometry args={[0.004, 0.0004, TIP_Y - CHUCK_Y - WT, 16, 1, true]} />
      </mesh>
      {/* electronics rack beside the chamber */}
      <Box size={[0.5, 1.7, 0.6]} position={[0.95, 0.85, -0.25]} m="panelWarm" radius={0.02} />
      <Box size={[0.36, 0.5, 0.012]} position={[0.95, 1.2, 0.056]} m="glassDark" radius={0.004} castShadow={false} />
      {/* front end: load ports with a pod, and the robot that feeds the load lock */}
      {PORT_X.map((x, i) => (
        <LoadPort key={x} x={x} pod={i === 0} />
      ))}
      <Box size={[0.3, 0.74, 0.3]} position={[LL_X - 0.05, 0.37, 0.62]} m="panelGray" radius={0.012} />
      <ScaraRobot position={[LL_X - 0.05, 0.74, 0.62]} base={2.17} elbow={-1.8} wrist={1.2} />
      {/* rear bulkhead at the housing's cut */}
      <Box size={[2.86, 1.82, 0.03]} position={[-0.2, 0.12 + 0.91, BULKHEAD_Z]} m="panelGray" radius={0.01} />
      {/* the operator's monitor on its arm, where the bay model has it: the live SEM image */}
      <Box size={[0.036, 0.036, 0.23]} position={[MONITOR[0], MONITOR[1] - 0.1, FRONT_Z + 0.115]} m="steelDark" radius={0.008} />
      <SemScreen position={MONITOR} rotation={[0, 0, 0]} />
      <StandaloneOnly>
        <LightTower position={[1.1, 1.7, -0.45]} on="green" />
      </StandaloneOnly>
      <group ref={wafer} position={[LL_X, PIN_UP, 0]}>
        <Wafer anchor look={{ summary: state.wafer, showParticles: true }} size={768} />
      </group>
    </group>
  );
}

const podMat = new THREE.MeshStandardMaterial({ color: '#b4bcc5', metalness: 0.05, roughness: 0.45 });

/** A load port on the housing's front, just inside the bay model's (which it replaces when opened). */
function LoadPort({ x, pod }: { x: number; pod: boolean }) {
  const zf = FRONT_Z;
  return (
    <group>
      <Box size={[0.49, 0.61, 0.033]} position={[x, 1.06, zf + 0.018]} m="steelSatin" radius={0.01} />
      <Box size={[0.496, 0.056, 0.436]} position={[x, 0.87, zf + 0.22]} m="panelGray" radius={0.01} />
      <Box size={[0.416, 0.796, 0.056]} position={[x, 0.43, zf + 0.1]} m="panelGray" radius={0.01} />
      {pod && (
        <group position={[x, 0.9, zf + 0.24]}>
          <Box size={[0.386, 0.306, 0.416]} position={[0, 0.155, 0]} m={podMat} radius={0.035} />
          <Box size={[0.216, 0.026, 0.146]} position={[0, 0.325, 0]} m="panelGray" radius={0.008} />
        </group>
      )}
    </group>
  );
}
