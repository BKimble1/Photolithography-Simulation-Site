/**
 * Die attach and wire bond at workbench scale (illustrative, not any manufacturer's design).
 * Everything inside the scene group is in millimetres (the group is scaled 1/1000).
 *
 *  - A copper lead-frame strip lies on a heated work holder: each unit has a die paddle and
 *    four leads on one side (the die's four bond pads sit along the facing edge).
 *  - 'attach': a dispense needle puts a dot of silver-filled epoxy on the paddle while a
 *    rubber vacuum collet picks a known-good die off the dicing tape (an ejector lifts it
 *    from below) and presses it into the epoxy, which squeezes out into a small fillet.
 *  - 'bond': a ceramic capillary on an ultrasonic horn makes a ball bond on each pad, pays
 *    out a gold wire in a loop and stitches it to the lead — four wires, one by one; then
 *    a steel mould chase closes over the strip, epoxy compound fills the cavity and the
 *    chase lifts, leaving a black body with the leads sticking out.
 * Wires, loop height and bond sizes are exaggerated so they read at this scale.
 * Motion is a pure function of step progress p.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { filmsColor, toSrgb8 } from '../../sim/filmColor';
import { mulberry32 } from '../../sim/rng';
import type { WaferSummary } from '../../sim/types';
import { useSimState } from '../../state/sim';
import { lerp, seg, smooth, useProgressFrame } from '../anim';
import { MAT } from '../materials';
import type { ToolProps } from './index';

type V3 = [number, number, number];

// ───────────────────────────── dimensions (mm) ─────────────────────────────

const LF_T = 0.2; // lead-frame thickness; the frame lies on y ∈ [0, LF_T]
const PITCH = 28; // unit pitch along the strip
const PAD_W = 15.4; // die paddle
const PAD_D = 19;
const DIE_W = 13;
const DIE_D = 16.5;
const DIE_T = 0.775;
const GLUE_T = 0.03;
const DIE_Y = LF_T + GLUE_T; // die underside once attached
const DIE_TOP = DIE_Y + DIE_T;
const LEAD_X = [-4.8, -1.6, 1.6, 4.8];
const PAD_Z = -DIE_D / 2 + 0.95; // bond pads along the back edge of the die
const LEAD_TIP_Z = -11.0;
const BOND_Z = -11.8; // stitch position on the lead
const LEAD_END_Z = -24;
const BODY = { x0: -8.9, x1: 8.9, z0: -12.6, z1: 10.2, top: 3.3, bottom: -1.3 };
const LOOP_H = 0.95; // wire loop height above the die (exaggerated)
const WIRE_R = 0.085; // wire radius (a real gold wire is ~0.0125 mm)
const UNITS = [-PITCH, 0, PITCH];

// attach: pick position on the tape (die centre) and tape surface height
const PICK: V3 = [-80, 0.9, 2];
const TAPE_TOP = PICK[1];

// ───────────────────────────── materials ─────────────────────────────

const copperMat = new THREE.MeshStandardMaterial({ color: '#c8875a', metalness: 1, roughness: 0.3 });
const silverMat = new THREE.MeshStandardMaterial({ color: '#dfe2e6', metalness: 1, roughness: 0.2 });
const glueMat = new THREE.MeshStandardMaterial({ color: '#b4b7bb', metalness: 0.65, roughness: 0.5 });
const dieSideMat = new THREE.MeshStandardMaterial({ color: '#5a5e65', metalness: 0.45, roughness: 0.35 });
const tapeMat = new THREE.MeshPhysicalMaterial({ color: '#8fb3dc', roughness: 0.35, metalness: 0, transparent: true, opacity: 0.6, clearcoat: 0.5, depthWrite: false });
const moldMat = new THREE.MeshStandardMaterial({ color: '#17181b', metalness: 0.0, roughness: 0.62 });
const holderMat = new THREE.MeshStandardMaterial({ color: '#9fa5ad', metalness: 0.9, roughness: 0.42 });
const dimpleMat = new THREE.MeshStandardMaterial({ color: '#232428', metalness: 0.0, roughness: 0.35 });


// ───────────────────────────── die texture ─────────────────────────────

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB) => `rgb(${toSrgb8(c[0])},${toSrgb8(c[1])},${toSrgb8(c[2])})`;

/**
 * Top face of the die: the same tint and block layout the wafer texture uses for a die,
 * a seal ring and four bond pads along the back edge (canvas top = die back = −z).
 */
function drawDie(summary: WaferSummary): HTMLCanvasElement {
  const W = 390;
  const H = Math.round((W * DIE_D) / DIE_W);
  const k = W / DIE_W;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const base = filmsColor(summary.films) as RGB;
  const lvl = Math.min(12, summary.pattern);
  const tint = mix(base, [0.72, 0.74, 0.8], 0.25 + lvl * 0.02);
  ctx.fillStyle = css(mix(tint, [0.25, 0.27, 0.3], 0.45));
  ctx.fillRect(0, 0, W, H);
  // seal ring and die body
  ctx.fillStyle = css(mix(tint, [0.95, 0.95, 0.95], 0.35));
  ctx.fillRect(0.22 * k, 0.22 * k, W - 0.44 * k, H - 0.44 * k);
  ctx.fillStyle = css(tint);
  ctx.fillRect(0.38 * k, 0.38 * k, W - 0.76 * k, H - 0.76 * k);
  // functional blocks (die scale only; no transistors at this scale)
  const rng = mulberry32(99);
  const blocks = Array.from({ length: 9 }, () => ({ x: rng() * 0.8, y: rng() * 0.8, w: 0.12 + rng() * 0.3, h: 0.1 + rng() * 0.3, t: rng() }));
  const x0 = 0.6 * k;
  const y0 = 1.9 * k;
  const w = W - 1.2 * k;
  const h = H - 2.5 * k;
  for (const b of blocks.slice(0, 3 + Math.floor(lvl / 2))) {
    ctx.fillStyle = css(mix(tint, b.t > 0.5 ? [1, 1, 1] : [0.2, 0.22, 0.28], 0.12 + b.t * 0.12));
    ctx.fillRect(x0 + b.x * w, y0 + b.y * h, b.w * w, b.h * h);
    // a faint fine structure inside each block
    ctx.fillStyle = css(mix(tint, [0.15, 0.16, 0.2], 0.1));
    for (let yy = y0 + b.y * h + 2; yy < y0 + (b.y + b.h) * h - 2; yy += 3) ctx.fillRect(x0 + b.x * w + 2, yy, b.w * w - 4, 1);
  }
  // bond pads: aluminium squares with a passivation opening rim
  for (const lx of LEAD_X) {
    const cx = (lx + DIE_W / 2) * k;
    const cy = (PAD_Z + DIE_D / 2) * k;
    ctx.fillStyle = css(mix(tint, [0.1, 0.1, 0.12], 0.3));
    ctx.fillRect(cx - 0.55 * k, cy - 0.55 * k, 1.1 * k, 1.1 * k);
    ctx.fillStyle = '#d9d8d4';
    ctx.fillRect(cx - 0.45 * k, cy - 0.45 * k, 0.9 * k, 0.9 * k);
  }
  // pin-1 style corner mark (a small triangle), as dies often carry
  ctx.fillStyle = css(mix(tint, [1, 1, 1], 0.45));
  ctx.beginPath();
  ctx.moveTo(W - 0.6 * k, H - 0.6 * k);
  ctx.lineTo(W - 1.4 * k, H - 0.6 * k);
  ctx.lineTo(W - 0.6 * k, H - 1.4 * k);
  ctx.fill();
  return c;
}

function useDieMaterials(summary: WaferSummary) {
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(drawDie(summary));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
    // the die look only depends on the finished films and pattern level
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.films.map((f) => `${f.mat}:${Math.round(f.nm)}`).join(','), summary.pattern]);
  const mats = useMemo(() => {
    const top = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.35, roughness: 0.28 });
    return [dieSideMat, dieSideMat, top, dieSideMat, dieSideMat, dieSideMat];
  }, [tex]);
  useEffect(
    () => () => {
      mats[2].dispose();
      tex.dispose();
    },
    [mats, tex],
  );
  return mats;
}

// ───────────────────────────── static geometry ─────────────────────────────

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** The copper strip (paddles, leads, dam bars, tie bars, rails) and its silver plating. */
function useLeadFrameGeometry() {
  return useMemo(() => {
    const cu: THREE.BufferGeometry[] = [];
    const ag: THREE.BufferGeometry[] = [];
    const holes: THREE.BufferGeometry[] = [];
    const y = LF_T / 2;
    // rails along the strip with index holes
    cu.push(boxAt(PITCH * 3.4, LF_T, 3, 0, y, LEAD_END_Z - 1.5));
    cu.push(boxAt(PITCH * 3.4, LF_T, 3, 0, y, BODY.z1 + 4.5));
    for (let i = -6; i <= 6; i++) {
      const hole = new THREE.CylinderGeometry(0.7, 0.7, 0.02, 16);
      hole.translate(i * (PITCH / 2), LF_T + 0.011, BODY.z1 + 4.5);
      holes.push(hole);
    }
    for (const ux of UNITS) {
      cu.push(boxAt(PAD_W, LF_T, PAD_D, ux, y, 0));
      // tie bars from the paddle to the front rail
      for (const tx of [-5, 5]) cu.push(boxAt(1, LF_T, BODY.z1 + 3 - PAD_D / 2, ux + tx, y, (PAD_D / 2 + BODY.z1 + 3) / 2));
      for (const lx of LEAD_X) {
        cu.push(boxAt(1.1, LF_T, LEAD_TIP_Z - LEAD_END_Z, ux + lx, y, (LEAD_TIP_Z + LEAD_END_Z) / 2));
        ag.push(boxAt(1.1, 0.012, 2.2, ux + lx, LF_T + 0.006, LEAD_TIP_Z - 1.1));
      }
      // dam bar across the leads, outside the mould body
      cu.push(boxAt(LEAD_X[3] - LEAD_X[0] + 3, LF_T, 0.8, ux, y, BODY.z0 - 3.2));
      // side rails joining the units
      for (const sx of [-1, 1]) cu.push(boxAt(1.2, LF_T, BODY.z1 + 3 - LEAD_END_Z, ux + sx * (PITCH / 2), y, (BODY.z1 + 3 + LEAD_END_Z) / 2));
    }
    return { copper: mergeGeometries(cu), plating: mergeGeometries(ag), holes: mergeGeometries(holes) };
  }, []);
}

/** A gold wire from pad i to lead i of the unit at ux. */
function wireCurve(ux: number, i: number): THREE.CatmullRomCurve3 {
  const x = ux + LEAD_X[i];
  const L = PAD_Z - BOND_Z;
  const pts = [
    [x, DIE_TOP + 0.05, PAD_Z],
    [x, DIE_TOP + 0.55 * LOOP_H, PAD_Z + 0.02],
    [x, DIE_TOP + LOOP_H, PAD_Z - 0.2 * L],
    [x, DIE_TOP + 0.78 * LOOP_H, PAD_Z - 0.55 * L],
    [x, LF_T + 0.32 * LOOP_H + 0.1, PAD_Z - 0.86 * L],
    [x, LF_T + 0.05, BOND_Z],
  ].map(([a, b, c]) => new THREE.Vector3(a, b, c));
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

const TUBE_SEG = 60;
const TUBE_RAD = 8;

/**
 * Mould chase (upper half) drawn in section: only the half behind the dies' centre line
 * (top plate, back wall where the leads pass under, left end wall), so the compound can be
 * seen filling the front half of each cavity.
 */
function useChaseGeometry() {
  return useMemo(() => {
    const len = PITCH * 3.2;
    const zBack = BODY.z0 - 3;
    const zCut = 0;
    const d = zCut - zBack;
    const zc = (zBack + zCut) / 2;
    const wallH = BODY.top - LF_T;
    const parts = [
      boxAt(len, 6, d, 0, BODY.top + 3, zc),
      boxAt(len, wallH, 3, 0, LF_T + wallH / 2, zBack + 1.5),
      boxAt(3, wallH, d, -len / 2 + 1.5, LF_T + wallH / 2, zc),
    ];
    return mergeGeometries(parts);
  }, []);
}

// ───────────────────────────── moving parts ─────────────────────────────

/** Vacuum pick-up collet on its bond head; origin = underside of the rubber tip. */
function Collet({ groupRef }: { groupRef: React.RefObject<THREE.Group | null> }) {
  return (
    <group ref={groupRef}>
      <mesh position={[0, 0.75, 0]} material={MAT.rubber} castShadow>
        <boxGeometry args={[10, 1.5, 13]} />
      </mesh>
      <mesh position={[0, 2.2, 0]} material={MAT.steel} castShadow>
        <boxGeometry args={[11, 1.4, 14]} />
      </mesh>
      <mesh position={[0, 12, 0]} material={MAT.steel} castShadow>
        <cylinderGeometry args={[2.2, 2.6, 18, 24]} />
      </mesh>
      <mesh position={[0, 30, 0]} material={MAT.black} castShadow>
        <boxGeometry args={[16, 20, 16]} />
      </mesh>
      <mesh position={[0, 40, -24]} material={MAT.panelGray} castShadow>
        <boxGeometry args={[10, 8, 44]} />
      </mesh>
    </group>
  );
}

/** Epoxy dispense syringe; origin = needle tip. */
function Dispenser({ groupRef }: { groupRef: React.RefObject<THREE.Group | null> }) {
  return (
    <group ref={groupRef}>
      <mesh position={[0, 5, 0]} material={MAT.steel} castShadow>
        <cylinderGeometry args={[0.35, 0.35, 10, 12]} />
      </mesh>
      <mesh position={[0, 10.8, 0]} material={MAT.panelGray} castShadow>
        <cylinderGeometry args={[1.2, 1.6, 1.6, 16]} />
      </mesh>
      <mesh position={[0, 27, 0]} material={MAT.polycarbonate} castShadow>
        <cylinderGeometry args={[4.5, 4.5, 30, 24]} />
      </mesh>
      <mesh position={[0, 20, 0]} material={glueMat}>
        <cylinderGeometry args={[4.0, 4.0, 14, 20]} />
      </mesh>
      <mesh position={[0, 43, 0]} material={MAT.black} castShadow>
        <cylinderGeometry args={[5.2, 5.2, 3, 24]} />
      </mesh>
      <mesh position={[9, 30, 0]} material={MAT.panel} castShadow>
        <boxGeometry args={[12, 26, 12]} />
      </mesh>
    </group>
  );
}

/** Capillary on its ultrasonic horn; origin = capillary tip. */
function BondHead({ groupRef }: { groupRef: React.RefObject<THREE.Group | null> }) {
  return (
    <group ref={groupRef}>
      <mesh position={[0, 4.6, 0]} material={MAT.ceramic} castShadow>
        <cylinderGeometry args={[0.8, 0.09, 9.2, 24]} />
      </mesh>
      {/* gold wire feeding down into the capillary */}
      <mesh position={[0, 16, 0]} material={MAT.gold}>
        <cylinderGeometry args={[0.05, 0.05, 14, 6]} />
      </mesh>
      <mesh position={[0, 12.6, 0]} material={MAT.black} castShadow>
        <boxGeometry args={[3, 2.2, 3.4]} />
      </mesh>
      {/* horn: thin end at the capillary, thick end at the transducer (to the left) */}
      <mesh position={[-21.4, 8.2, 0]} rotation={[0, 0, Math.PI / 2]} material={MAT.steel} castShadow>
        <cylinderGeometry args={[3.2, 1.1, 42, 24]} />
      </mesh>
      <mesh position={[-43, 9, 0]} rotation={[0, 0, Math.PI / 2]} material={MAT.steelSatin} castShadow>
        <cylinderGeometry args={[6, 6, 4, 32]} />
      </mesh>
      <mesh position={[-52, 9, 0]} material={MAT.panelDark} castShadow>
        <boxGeometry args={[14, 18, 18]} />
      </mesh>
    </group>
  );
}

// ───────────────────────────── scene ─────────────────────────────

export default function Package({ variant }: ToolProps) {
  const v = variant === 'bond' ? 'bond' : 'attach';
  const state = useSimState();
  const dieMats = useDieMaterials(state.wafer);
  const lf = useLeadFrameGeometry();
  const chaseGeo = useChaseGeometry();
  const dieGeo = useMemo(() => new THREE.BoxGeometry(DIE_W, DIE_T, DIE_D), []);

  // wires: the centre unit's four grow; neighbours' are complete
  const wires = useMemo(
    () =>
      [-PITCH, 0].flatMap((ux) =>
        LEAD_X.map((_, i) => {
          const curve = wireCurve(ux, i);
          const geo = new THREE.TubeGeometry(curve, TUBE_SEG, WIRE_R, TUBE_RAD, false);
          return { ux, i, curve, geo };
        }),
      ),
    [],
  );

  // refs
  const pickDie = useRef<THREE.Mesh>(null);
  const collet = useRef<THREE.Group>(null);
  const dispenser = useRef<THREE.Group>(null);
  const dot = useRef<THREE.Mesh>(null);
  const fillet = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const chase = useRef<THREE.Group>(null);
  const fills = useRef<(THREE.Mesh | null)[]>([]);
  const dimples = useRef<THREE.Group>(null);

  const wireMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const balls = useRef<(THREE.Mesh | null)[]>([]);
  const stitches = useRef<(THREE.Mesh | null)[]>([]);

  // own key light with a tight shadow frustum: the stage light's shadows are sized for
  // metre-scale tools and cannot resolve millimetre parts
  const lightTarget = useMemo(() => new THREE.Object3D(), []);
  const centre: V3 = v === 'attach' ? [-0.035, 1.0, 0] : [0, 1.0, -0.004];

  useLayoutEffect(() => {
    wires.forEach((_w, k) => {
      const m = wireMeshes.current[k];
      if (m) m.geometry.setDrawRange(0, Infinity);
    });
  }, [wires]);
  useEffect(
    () => () => {
      wires.forEach((w) => w.geo.dispose());
      [dieGeo, chaseGeo, lf.copper, lf.plating, lf.holes].forEach((g) => g.dispose());
    },
    [wires, dieGeo, chaseGeo, lf],
  );

  useProgressFrame((p) => {
    // ── attach ──
    if (v === 'attach') {
      // dispenser: in, down, dispense, up, out
      const dIn = smooth(p, 0.02, 0.08);
      const dDown = smooth(p, 0.07, 0.1) * (1 - smooth(p, 0.15, 0.18));
      const dOut = smooth(p, 0.17, 0.24);
      if (dispenser.current) {
        const x = lerp(lerp(40, 0, dIn), 40, dOut);
        const z = lerp(lerp(-30, 0, dIn), -30, dOut);
        dispenser.current.position.set(x, lerp(14, LF_T + 1.2, dDown), z);
      }
      // epoxy dot grows while dispensing, then is squeezed flat by the die
      const grow = smooth(p, 0.09, 0.15);
      const press = smooth(p, 0.488, 0.5);
      if (dot.current) {
        dot.current.visible = grow > 0.01 && press < 0.999;
        const r = lerp(0.3, 1, grow) * (1 + press * 0.9);
        dot.current.scale.set(r, Math.max(0.01, 0.2 * grow * (1 - press)), r * (1 + press * 0.3));
      }
      if (fillet.current) {
        fillet.current.visible = press > 0.02;
        fillet.current.scale.setScalar(Math.max(0.001, press));
      }
      // collet: down to the die, pick, travel, place, release, return
      const reach = smooth(p, 0.08, 0.14); // down onto the die
      const lift = smooth(p, 0.15, 0.21);
      const travel = smooth(p, 0.21, 0.4);
      const place = smooth(p, 0.4, 0.5);
      const away = smooth(p, 0.58, 0.72);
      const eject = smooth(p, 0.09, 0.14) * (1 - lift);
      const pickY = TAPE_TOP + DIE_T + 0.3 * eject; // top of the die on the tape
      const hover = 16;
      let cx = PICK[0];
      let cz = PICK[2];
      let cy = pickY + hover * (1 - reach);
      let carrying = false;
      if (p >= 0.15) {
        carrying = p < 0.52;
        const liftY = lerp(pickY, pickY + 12, lift);
        cx = lerp(PICK[0], 0, travel);
        cz = lerp(PICK[2], 0, travel);
        const high = Math.sin(Math.PI * travel) * 4;
        cy = liftY + high;
        if (p >= 0.4) cy = lerp(pickY + 12, DIE_TOP, place);
        if (p >= 0.52) {
          const up = smooth(p, 0.52, 0.58);
          cy = lerp(DIE_TOP, DIE_TOP + 14, up);
          cx = lerp(0, PICK[0] + 13.5, away);
          cz = lerp(0, PICK[2], away);
          cy = lerp(cy, TAPE_TOP + DIE_T + hover, away);
        }
      }
      if (collet.current) collet.current.position.set(cx, cy, cz);
      if (pickDie.current) {
        if (carrying) pickDie.current.position.set(cx, cy - DIE_T / 2, cz);
        else if (p < 0.15) pickDie.current.position.set(PICK[0], TAPE_TOP + DIE_T / 2 + 0.3 * eject, PICK[2]);
        else pickDie.current.position.set(0, DIE_Y + DIE_T / 2, 0);
      }
    }

    // ── bond ──
    if (v === 'bond') {
      const W0 = 0.05;
      const WL = 0.1;
      const park = new THREE.Vector3(-6, DIE_TOP + 9, -2);
      let tip = park.clone();
      for (let k = 0; k < 4; k++) {
        const w = seg(p, W0 + k * WL, W0 + (k + 1) * WL);
        const wire = wires.find((x) => x.ux === 0 && x.i === k)!;
        const mesh = wireMeshes.current[wires.indexOf(wire)];
        const pad = wire.curve.getPointAt(0);
        const lead = wire.curve.getPointAt(1);
        const u = smooth(w, 0.34, 0.8);
        if (mesh) {
          const n = Math.round(u * TUBE_SEG);
          mesh.visible = n > 0;
          mesh.geometry.setDrawRange(0, n * TUBE_RAD * 6);
        }
        const b = balls.current[k];
        if (b) b.visible = w >= 0.3;
        const st = stitches.current[k];
        if (st) st.visible = w >= 0.84;
        if (p >= W0 + k * WL && p < W0 + (k + 1) * WL) {
          const prevAbove = k === 0 ? park : wires.find((x) => x.ux === 0 && x.i === k - 1)!.curve.getPointAt(1).clone().add(new THREE.Vector3(0, 2.5, 0));
          const above = pad.clone().add(new THREE.Vector3(0, 2.5, 0));
          if (w < 0.18) tip = prevAbove.clone().lerp(above, smooth(w, 0, 0.18));
          else if (w < 0.28) tip = above.clone().lerp(pad, smooth(w, 0.18, 0.28));
          else if (w < 0.34) tip = pad.clone().add(new THREE.Vector3(0, -0.04 * Math.sin(seg(w, 0.28, 0.34) * Math.PI), 0));
          else if (w < 0.8) tip = wire.curve.getPointAt(u);
          else if (w < 0.88) tip = lead.clone().add(new THREE.Vector3(0, -0.03 * Math.sin(seg(w, 0.8, 0.88) * Math.PI), 0));
          else tip = lead.clone().lerp(lead.clone().add(new THREE.Vector3(0, 2.5, 0)), smooth(w, 0.88, 1));
        }
      }
      const endBond = W0 + 4 * WL;
      if (p >= endBond) {
        const last = wires.find((x) => x.ux === 0 && x.i === 3)!.curve.getPointAt(1).clone().add(new THREE.Vector3(0, 2.5, 0));
        tip = last.lerp(new THREE.Vector3(-30, DIE_TOP + 18, -4), smooth(p, endBond, 0.56));
      }
      if (head.current) head.current.position.copy(tip);
      // mould: chase down, compound fills, chase up
      const down = smooth(p, 0.74, 0.83) * (1 - smooth(p, 0.92, 0.985));
      if (chase.current) {
        chase.current.position.y = lerp(70, 0, down);
        chase.current.visible = down > 0.001;
      }
      const fill = smooth(p, 0.84, 0.91);
      fills.current.forEach((m) => {
        if (!m) return;
        m.visible = fill > 0.001;
        m.scale.y = Math.max(0.001, fill);
      });
      if (dimples.current) dimples.current.visible = fill >= 0.999;
    }
  });

  // neighbours: in 'attach' the left unit already carries a die; in 'bond' the left one is
  // bonded and the right one attached; the strip is moulded all at once.
  const attachedUnits = v === 'attach' ? [-PITCH] : [-PITCH, PITCH, 0];

  return (
    <group>
      {/* bench and machine base (metres) */}
      <mesh position={[0, 0.94, 0]} material={MAT.panelWarm} receiveShadow>
        <boxGeometry args={[1.4, 0.03, 0.8]} />
      </mesh>
      <mesh position={[0, 0.47, 0]} material={MAT.panel} receiveShadow>
        <boxGeometry args={[1.36, 0.92, 0.76]} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#e4e2dc" roughness={0.6} />
      </mesh>
      <primitive object={lightTarget} position={centre} />
      <directionalLight
        position={[centre[0] + 0.22, centre[1] + 0.5, centre[2] + 0.3]}
        target={lightTarget}
        intensity={1.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-0.14}
        shadow-camera-right={0.14}
        shadow-camera-top={0.14}
        shadow-camera-bottom={-0.14}
        shadow-camera-near={0.2}
        shadow-camera-far={1.2}
        shadow-bias={-0.0002}
        shadow-normalBias={0.0003}
      />

      {/* ── millimetre world ── */}
      <group position={[0, 1.0, 0]} scale={0.001}>
        {/* heated work holder with a steel base */}
        <mesh position={[0, -4, -4]} material={holderMat} receiveShadow castShadow>
          <boxGeometry args={[PITCH * 3.6, 8, 58]} />
        </mesh>
        <mesh position={[0, -30, -4]} material={MAT.panelGray} receiveShadow>
          <boxGeometry args={[230, 44, 100]} />
        </mesh>
        {/* lead-frame strip */}
        <mesh geometry={lf.copper} material={copperMat} castShadow receiveShadow />
        <mesh geometry={lf.plating} material={silverMat} receiveShadow />
        <mesh geometry={lf.holes} material={MAT.black} />

        {/* dies already attached on neighbouring units (and the centre one when bonding) */}
        {attachedUnits.map((ux) => (
          <group key={ux}>
            <mesh geometry={dieGeo} material={dieMats} position={[ux, DIE_Y + DIE_T / 2, 0]} castShadow receiveShadow />
            <Fillet x={ux} />
          </group>
        ))}

        {v === 'attach' && (
          <>
            {/* the die being placed */}
            <mesh ref={pickDie} geometry={dieGeo} material={dieMats} position={[PICK[0], TAPE_TOP + DIE_T / 2, PICK[2]]} castShadow receiveShadow />
            {/* silver epoxy dot and the fillet it squeezes out */}
            <mesh ref={dot} position={[0, LF_T, 0]} material={glueMat} visible={false} castShadow>
              <sphereGeometry args={[3.2, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
            <group ref={fillet} visible={false}>
              <Fillet x={0} />
            </group>
            <Collet groupRef={collet} />
            <Dispenser groupRef={dispenser} />
            <TapeWithDies dieGeo={dieGeo} dieMats={dieMats} />
          </>
        )}

        {v === 'bond' && (
          <>
            {wires.map((w, k) => (
              <mesh
                key={k}
                ref={(m) => {
                  wireMeshes.current[k] = m;
                }}
                geometry={w.geo}
                material={MAT.gold}
                visible={w.ux !== 0}
                castShadow
              />
            ))}
            {/* ball and stitch bonds: neighbours complete, centre unit appears in turn */}
            {wires.map((w, k) => {
              const pad = w.curve.getPointAt(0);
              const lead = w.curve.getPointAt(1);
              const centreUnit = w.ux === 0;
              return (
                <group key={k}>
                  <mesh
                    ref={(m) => {
                      if (centreUnit) balls.current[w.i] = m;
                    }}
                    position={[pad.x, DIE_TOP + 0.05, pad.z]}
                    scale={[1, 0.5, 1]}
                    material={MAT.gold}
                    visible={!centreUnit}
                  >
                    <sphereGeometry args={[0.2, 16, 8]} />
                  </mesh>
                  <mesh
                    ref={(m) => {
                      if (centreUnit) stitches.current[w.i] = m;
                    }}
                    position={[lead.x, LF_T + 0.03, lead.z + 0.05]}
                    scale={[1.1, 0.3, 1.5]}
                    material={MAT.gold}
                    visible={!centreUnit}
                  >
                    <sphereGeometry args={[0.2, 16, 8]} />
                  </mesh>
                </group>
              );
            })}
            <BondHead groupRef={head} />
            {/* mould: compound fills each cavity, then the chase lifts */}
            {UNITS.map((ux, i) => (
              <mesh
                key={ux}
                ref={(m) => {
                  fills.current[i] = m;
                }}
                position={[ux + (BODY.x0 + BODY.x1) / 2, BODY.bottom, (BODY.z0 + BODY.z1) / 2]}
                visible={false}
                castShadow
                receiveShadow
                material={moldMat}
              >
                <MoldBodyGeometry />
              </mesh>
            ))}
            <group ref={dimples} visible={false}>
              {UNITS.map((ux) => (
                <mesh key={ux} position={[ux + BODY.x0 + 2.2, BODY.top + 0.004, BODY.z1 - 2.2]} rotation={[-Math.PI / 2, 0, 0]} material={dimpleMat}>
                  <circleGeometry args={[0.9, 24]} />
                </mesh>
              ))}
            </group>
            <group ref={chase} visible={false}>
              <mesh geometry={chaseGeo} material={MAT.steelSatin} castShadow receiveShadow />
            </group>

          </>
        )}
      </group>
    </group>
  );
}

/** Silver-epoxy fillet squeezed out along the die edges (unit at x). */
function Fillet({ x }: { x: number }) {
  const t = 0.22;
  const h = 0.24;
  const y = LF_T + h / 2;
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, y, DIE_D / 2 + t / 2]} material={glueMat}>
        <boxGeometry args={[DIE_W + 2 * t, h, t]} />
      </mesh>
      <mesh position={[0, y, -DIE_D / 2 - t / 2]} material={glueMat}>
        <boxGeometry args={[DIE_W + 2 * t, h, t]} />
      </mesh>
      <mesh position={[DIE_W / 2 + t / 2, y, 0]} material={glueMat}>
        <boxGeometry args={[t, h, DIE_D]} />
      </mesh>
      <mesh position={[-DIE_W / 2 - t / 2, y, 0]} material={glueMat}>
        <boxGeometry args={[t, h, DIE_D]} />
      </mesh>
    </group>
  );
}

/** Moulded body: bottom at the mesh origin, grows upward when scaled in y. */
function MoldBodyGeometry() {
  const geo = useMemo(() => {
    const w = BODY.x1 - BODY.x0;
    const d = BODY.z1 - BODY.z0;
    const h = BODY.top - BODY.bottom;
    const g = new RoundedBoxGeometry(w, h, d, 2, 0.45);
    g.translate(0, h / 2, 0);
    return g;
  }, []);
  return <primitive object={geo} attach="geometry" />;
}

/** A patch of the diced wafer on its tape: a grid of dies, some already picked. */
function TapeWithDies({ dieGeo, dieMats }: { dieGeo: THREE.BufferGeometry; dieMats: THREE.Material[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const slots = useMemo(() => {
    const picked = new Set(['1,0', '2,0', '-2,1', '0,1', '1,1', '2,1']);
    const out: [number, number][] = [];
    for (let r = -2; r <= 2; r++)
      for (let c = -3; c <= 2; c++) {
        if (c === 0 && r === 0) continue; // the die being picked is drawn separately
        if (picked.has(`${c},${r}`)) continue;
        out.push([PICK[0] + c * (DIE_W + 0.5), PICK[2] - r * (DIE_D + 0.5)]);
      }
    return out;
  }, []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    slots.forEach(([x, z], i) => {
      m.makeTranslation(x, TAPE_TOP + DIE_T / 2, z);
      ref.current?.setMatrixAt(i, m);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [slots]);
  return (
    <group>
      <instancedMesh ref={ref} args={[dieGeo, dieMats, slots.length]} castShadow receiveShadow />
      {/* tape on its expander ring */}
      <mesh position={[PICK[0] - 10, TAPE_TOP - 0.05, PICK[2]]} material={tapeMat} renderOrder={2}>
        <cylinderGeometry args={[62, 62, 0.1, 96]} />
      </mesh>
      <mesh position={[PICK[0] - 10, TAPE_TOP - 3.2, PICK[2]]} material={MAT.steelSatin} receiveShadow>
        <cylinderGeometry args={[63.5, 63.5, 6, 96, 1, true]} />
      </mesh>
      <mesh position={[PICK[0] - 10, TAPE_TOP - 6.5, PICK[2]]} material={MAT.panelGray} receiveShadow>
        <cylinderGeometry args={[70, 70, 1, 96]} />
      </mesh>
    </group>
  );
}
