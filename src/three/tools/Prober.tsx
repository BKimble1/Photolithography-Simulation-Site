/**
 * Illustrative wafer prober (wafer sort), not any manufacturer's design:
 *  - a heavy test head (dark box) held by a manipulator, docked through a pogo tower to a
 *    round probe card; the card's needles converge on the pads of one die;
 *  - below, the wafer lies on a chuck carried by an XYZ stage that steps die by die:
 *    index under the needles, rise until the pads touch, test, drop, index to the next die;
 *  - a tester cabinet beside it, joined to the test head by thick cables; a loader with a
 *    FOUP on the left.
 * The card, pogo tower and holder ring are drawn in half section (front half cut away) so
 * the needles and the probe point are visible. The first few touchdowns are shown at a readable pace; then the stepping
 * fast-forwards (a real prober needs minutes to hours for a 300 mm wafer). The wafer map
 * fills in die by die in the tester's order, exactly in step with the stage.
 * Motion is a pure function of step progress p.
 * In the bay the scene stands in its bay model (Fab.tsx, prober), which keeps the tester
 * cabinet and the status towers and opens above the chassis in front of the tester.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { DIES, type Die } from '../../sim/dies';
import { useSimState, useWaferMap } from '../../state/sim';
import { clamp01, lerp, smooth, useProgressBucket, useProgressFrame } from '../anim';
import { Box, CleanFloor, Cyl, LightTower, mat, StandaloneOnly } from '../kit/parts';
import { MAT, type MatKey } from '../materials';
import { useWaferGeometry } from '../wafer/Wafer';
import { drawWafer, lookKey, makeCanvasTexture, type WaferLook } from '../wafer/waferTexture';
import type { ToolProps } from './index';
import { useRunChoices } from '../../state/presentation';

type V3 = [number, number, number];

// ───────────────────────────── geometry constants (metres) ─────────────────────────────

/** Probe point: centre of the needle tips (world x, z). */
const PX = 0;
const PZ = 0;
/** Needle-tip height = wafer top surface at contact. */
const TIP_Y = 0.985;
const WAFER_T = 0.0016;
/** Separation drop while indexing (exaggerated so it reads at tool scale). */
const SEP = 0.011;
/** Load / unload position of the chuck centre and its drop there. */
const LOAD = { x: PX, z: PZ + 0.225, drop: 0.034 };
const CARD_R = 0.12;
const CARD_Y = 0.998; // underside of the probe-card PCB
const CARD_T = 0.006;
const TOWER_TOP = 1.1;
/**
 * Section cut: the card, holder ring and pogo tower are drawn only behind the plane z = PZ
 * (world azimuths π/2 → 3π/2; azimuth 0 points to +z), so the probe point is visible.
 */
const KEEP0 = Math.PI / 2;
const KEEP1 = (Math.PI * 3) / 2;

// Bond pads of a die, relative to its centre (mm), matching the wafer texture.
const PAD_DX = [-4.95, -1.55, 1.85, 5.25];
const PAD_DY = 6.9;
const PAD_MX = (PAD_DX[0] + PAD_DX[3]) / 2;

// ───────────────────────────── probing schedule ─────────────────────────────

/** The tester's die order (serpentine by row), identical to the wafer-map reveal order. */
const ORDER: readonly Die[] = [...DIES].sort((a, b) => (a.row - b.row) * 100 + (a.row % 2 ? b.col - a.col : a.col - b.col));
/** Only complete dies are probed; partial edge dies are skipped. */
const SEQ = ORDER.map((d, i) => ({ d, i })).filter((o) => o.d.full);
const K = SEQ.length;

const P0 = 0.06; // first touchdown cycle starts
const NS = 5; // slow, readable touchdowns
const DS = 0.056; // progress per slow touchdown (~0.8 s)
const PS = P0 + NS * DS;
const WA = 0.12; // acceleration window
const P1 = 0.86; // last die finished
const R0 = 1 / DS;
const RMAX = (K - NS - (R0 * WA) / 2) / (WA / 2 + (P1 - PS - WA));

/** Continuous die cursor c(p) ∈ [0, K]: integer part = die being probed, fraction = phase. */
function cursor(p: number): number {
  if (p <= P0) return 0;
  if (p < PS) return (p - P0) / DS;
  if (p < PS + WA) {
    const t = p - PS;
    return NS + R0 * t + ((RMAX - R0) * t * t) / (2 * WA);
  }
  if (p < P1) return NS + ((R0 + RMAX) / 2) * WA + RMAX * (p - PS - WA);
  return K;
}
/** Dies per unit progress at p (for blending the motion style). */
function rate(p: number): number {
  if (p < PS) return R0;
  if (p < PS + WA) return R0 + ((RMAX - R0) * (p - PS)) / WA;
  return RMAX;
}
/** Phase within a die cycle after which that die's result is on the map. */
const REVEAL_AT = 0.55;

/** How many dies (in ORDER) are shown on the wafer map at progress p. */
function revealCount(p: number): number {
  if (p >= P1) return ORDER.length;
  const c = cursor(p);
  const k = Math.min(K - 1, Math.floor(c));
  const f = c - k;
  if (f >= REVEAL_AT) return SEQ[k].i + 1;
  return k > 0 ? SEQ[k - 1].i + 1 : 0;
}

/** Wafer-centre position (world x, z) that puts die d's pad row under the needle tips. */
function centreFor(d: Die): [number, number] {
  return [PX - (d.x + PAD_MX) / 1000, PZ + (d.y + PAD_DY) / 1000];
}

interface StagePose {
  x: number;
  z: number;
  /** drop below contact height (m) */
  drop: number;
}

function stagePose(p: number): StagePose {
  const first = centreFor(SEQ[0].d);
  if (p < P0) {
    const t = smooth(p, 0.012, P0 - 0.004);
    return { x: lerp(LOAD.x, first[0], t), z: lerp(LOAD.z, first[1], t), drop: lerp(LOAD.drop, SEP, t) };
  }
  if (p >= P1) {
    const last = centreFor(SEQ[K - 1].d);
    const t = smooth(p, P1 + 0.012, 0.95);
    return { x: lerp(last[0], LOAD.x, t), z: lerp(last[1], LOAD.z, t), drop: lerp(SEP, LOAD.drop, t) };
  }
  const c = cursor(p);
  const k = Math.min(K - 1, Math.floor(c));
  const f = c - k;
  const r = rate(p);
  // At a readable pace the stage indexes, rises, tests and drops; in the fast-forward it
  // glides continuously and the touchdowns become a small, quick flutter.
  const fast = clamp01((r - 2 * R0) / (5 * R0));
  const cur = centreFor(SEQ[k].d);
  const prev = centreFor(SEQ[Math.max(0, k - 1)].d);
  const tMove = lerp(smooth(f, 0, 0.3), f, fast);
  const up = smooth(f, 0.3, 0.45) * (1 - smooth(f, 0.8, 0.98));
  const amp = lerp(1, 0.14, fast);
  return { x: lerp(prev[0], cur[0], tMove), z: lerp(prev[1], cur[1], tMove), drop: SEP * amp * (1 - up) };
}

// ───────────────────────────── small geometry helpers ─────────────────────────────

/**
 * An annular sector lying flat and extruded upward by h, spanning world azimuths a0→a1
 * (azimuth 0 points to +z, π/2 to +x). Used for the cut-away card, ring and tower.
 */
function sectorGeometry(rIn: number, rOut: number, h: number, a0: number, a1: number, segs = 128): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const n = Math.max(6, Math.ceil((segs * (a1 - a0)) / (2 * Math.PI)));
  // shape (sx, sy) → world (sx, ·, −sy) after rotateX(−π/2); world dir(a) = (sin a, cos a)
  const at = (r: number, a: number): [number, number] => [r * Math.sin(a), -r * Math.cos(a)];
  for (let i = 0; i <= n; i++) {
    const [x, y] = at(rOut, a0 + ((a1 - a0) * i) / n);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  if (rIn > 0) {
    for (let i = n; i >= 0; i--) {
      const [x, y] = at(rIn, a0 + ((a1 - a0) * i) / n);
      shape.lineTo(x, y);
    }
  } else shape.lineTo(0, 0);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

function Sector({ rIn, rOut, h, y, a0 = KEEP0, a1 = KEEP1, m, castShadow = true }: { rIn: number; rOut: number; h: number; y: number; a0?: number; a1?: number; m: MatKey | THREE.Material; castShadow?: boolean }) {
  const geo = useMemo(() => sectorGeometry(rIn, rOut, h, a0, a1), [rIn, rOut, h, a0, a1]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} position={[0, y, 0]} material={mat(m)} castShadow={castShadow} receiveShadow />;
}

/** A straight round rod from a to b. */
function Rod({ a, b, r, m = 'steel', seg = 8 }: { a: V3; b: V3; r: number; m?: MatKey | THREE.Material; seg?: number }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    return { pos: va.add(vb).multiplyScalar(0.5), quat: q, len: d.length() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.join(','), b.join(',')]);
  return (
    <mesh position={pos} quaternion={quat} material={mat(m)} castShadow={false}>
      <cylinderGeometry args={[r, r, len, seg]} />
    </mesh>
  );
}

/** A flexible cable along a smooth curve through the given points. */
function Cable({ points, r, m = 'rubber' }: { points: V3[]; r: number; m?: MatKey }) {
  const geo = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      points.map((q) => new THREE.Vector3(...q)),
      false,
      'centripetal',
    );
    return new THREE.TubeGeometry(curve, 48, r, 10, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points), r]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={mat(m)} castShadow receiveShadow />;
}

// ───────────────────────────── the wafer with its map ─────────────────────────────

const edgeMat = new THREE.MeshStandardMaterial({ color: '#8f949c', metalness: 0.9, roughness: 0.25 });

/**
 * The simulated wafer with the wafer map revealed die by die. Drawn with the shared wafer
 * painter; the texture is repainted whenever the number of revealed dies changes.
 */
function MapWafer({ groupRef }: { groupRef: React.RefObject<THREE.Group | null> }) {
  const state = useSimState();
  const choices = useRunChoices();
  const map = useWaferMap(choices);
  const b = useProgressBucket(240);
  const n = revealCount(b);
  const size = 768;
  const look: WaferLook = useMemo(
    () => ({ summary: state.wafer, showParticles: true, map, mapReveal: map ? Math.min(1, (n + 0.5) / ORDER.length) : 0, highlightDie: true }),
    [state.wafer, map, n],
  );
  const geo = useWaferGeometry(0.15);
  const { canvas, tex } = useMemo(() => makeCanvasTexture(size), []);
  const topMat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.16, metalness: 0.55, envMapIntensity: 1.1 }), [tex]);
  const key = lookKey(look, size) + '|' + n;
  const last = useRef('');
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawWafer(ctx, size, look);
    tex.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(
    () => () => {
      tex.dispose();
      topMat.dispose();
    },
    [tex, topMat],
  );
  return (
    <group ref={groupRef}>
      <mesh geometry={geo} material={[topMat, edgeMat]} castShadow receiveShadow />
    </group>
  );
}

// ───────────────────────────── parts of the prober ─────────────────────────────

/** Head plate: the stage chamber's lid, with a semicircular seat for the card holder. */
function HeadPlate() {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    // shape (sx, sy) = world (x, −z); plate spans z ∈ [−0.55, 0]
    const R = 0.165;
    s.moveTo(-0.6, 0);
    s.lineTo(-R, 0);
    s.absarc(0, 0, R, Math.PI, 0, true);
    s.lineTo(0.6, 0);
    s.lineTo(0.6, 0.55);
    s.lineTo(-0.6, 0.55);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.032, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 48 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  return <mesh geometry={geo} position={[PX, 1.0, PZ]} material={MAT.panel} castShadow receiveShadow />;
}

/** Probe card with its holder, needles and the pogo tower of the docked test head. */
function ProbeCard() {
  // Needles: from the epoxy ring at the back half of the card window to each pad.
  const needles = useMemo(() => {
    const out: { a: V3; k: V3; t: V3 }[] = [];
    PAD_DX.forEach((dx, i) => {
      const tipX = PX + (dx - PAD_MX) / 1000;
      const az = Math.PI + (i - 1.5) * 0.36; // around the −z direction
      const ring: V3 = [PX + Math.sin(az) * 0.03, CARD_Y - 0.0055, PZ + Math.cos(az) * 0.03];
      const tip: V3 = [tipX, TIP_Y, PZ];
      // knee: 2.5 mm before the tip, 1.6 mm up, along the needle's approach
      const dir = new THREE.Vector3(tip[0] - ring[0], 0, tip[2] - ring[2]).normalize();
      const knee: V3 = [tip[0] - dir.x * 0.0025, TIP_Y + 0.0016, tip[2] - dir.z * 0.0025];
      out.push({ a: ring, k: knee, t: tip });
    });
    return out;
  }, []);
  return (
    <group>
      {/* holder ring with a lip carrying the card */}
      <Sector rIn={0.1215} rOut={0.165} h={0.036} y={CARD_Y - 0.004} m="steelSatin" />
      <Sector rIn={0.108} rOut={0.1225} h={0.004} y={CARD_Y - 0.004} m="steelDark" />
      {/* the card: PCB with a central window */}
      <Sector rIn={0.021} rOut={CARD_R} h={CARD_T} y={CARD_Y} m={pcbMat} />
      {/* gold landing pads for the pogo pins, and a steel stiffener round the window */}
      <Sector rIn={0.104} rOut={0.114} h={0.0012} y={CARD_Y + CARD_T} m="gold" castShadow={false} />
      <Sector rIn={0.021} rOut={0.05} h={0.008} y={CARD_Y + CARD_T} m="steel" />
      {/* epoxy ring holding the needles, under the window */}
      <Sector rIn={0.022} rOut={0.035} h={0.0045} y={CARD_Y - 0.0045} m={epoxyMat} />
      {needles.map((n, i) => (
        <group key={i}>
          <Rod a={n.a} b={n.k} r={0.00032} m="chrome" />
          <Rod a={n.k} b={n.t} r={0.00022} m="chrome" />
        </group>
      ))}
      {/* pogo tower between card and test head */}
      <Sector rIn={0.1} rOut={0.132} h={TOWER_TOP - CARD_Y - CARD_T} y={CARD_Y + CARD_T + 0.0012} m="panelDark" />
      <Sector rIn={0.1} rOut={0.133} h={0.006} y={CARD_Y + CARD_T + 0.0012} m="gold" castShadow={false} />
      {/* inner lining so the tower reads as hollow */}
      <Sector rIn={0.098} rOut={0.1} h={TOWER_TOP - CARD_Y - CARD_T} y={CARD_Y + CARD_T + 0.0012} m="black" castShadow={false} />
    </group>
  );
}

const pcbMat = new THREE.MeshStandardMaterial({ color: '#23463a', metalness: 0.15, roughness: 0.5 });
const epoxyMat = new THREE.MeshStandardMaterial({ color: '#2b2320', metalness: 0.05, roughness: 0.55 });
const headMat = new THREE.MeshStandardMaterial({ color: '#33373d', metalness: 0.35, roughness: 0.46 });
const headTopMat = new THREE.MeshStandardMaterial({ color: '#484d55', metalness: 0.3, roughness: 0.5 });
// wafer pods: the same pale grey as the bay model's
const podMat = new THREE.MeshStandardMaterial({ color: '#b4bcc5', metalness: 0.05, roughness: 0.45 });

function TestHead() {
  return (
    <group>
      {/* docking plate */}
      <Box size={[0.52, 0.03, 0.46]} position={[PX, TOWER_TOP + 0.015, PZ - 0.1]} m="steelDark" radius={0.006} />
      {/* main body */}
      <Box size={[0.78, 0.28, 0.6]} position={[PX + 0.01, TOWER_TOP + 0.03 + 0.14, PZ - 0.22]} m={headMat} radius={0.028} />
      <Box size={[0.72, 0.022, 0.54]} position={[PX + 0.01, TOWER_TOP + 0.316, PZ - 0.22]} m={headTopMat} radius={0.01} />
      {/* ventilation slats on the right flank */}
      {Array.from({ length: 6 }, (_, i) => (
        <Box key={i} size={[0.006, 0.012, 0.42]} position={[PX + 0.403, TOWER_TOP + 0.09 + i * 0.03, PZ - 0.24]} m="black" radius={0.002} castShadow={false} />
      ))}
      {/* front handle */}
      <Box size={[0.28, 0.02, 0.02]} position={[PX + 0.01, TOWER_TOP + 0.19, PZ + 0.105]} m="steel" radius={0.008} />
      {[-0.12, 0.14].map((x) => (
        <Box key={x} size={[0.02, 0.02, 0.03]} position={[PX + x, TOWER_TOP + 0.19, PZ + 0.09]} m="steel" radius={0.006} />
      ))}
      {/* manipulator cradle: side arms with pivot hubs */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <Box size={[0.03, 0.13, 0.46]} position={[PX + 0.01 + sx * 0.42, TOWER_TOP + 0.17, PZ - 0.36]} m="steelSatin" radius={0.008} />
          <Cyl r={0.045} h={0.04} position={[PX + 0.01 + sx * 0.45, TOWER_TOP + 0.17, PZ - 0.22]} rotation={[0, 0, Math.PI / 2]} m="steelDark" />
        </group>
      ))}
      <Box size={[0.92, 0.12, 0.08]} position={[PX + 0.01, TOWER_TOP + 0.17, PZ - 0.6]} m="steelSatin" radius={0.01} />
    </group>
  );
}

/** Test-head manipulator: a column behind the prober carrying the cradle beam. */
function Manipulator() {
  return (
    <group position={[PX, 0, PZ - 0.76]}>
      <Box size={[0.5, 0.08, 0.5]} position={[0, 0.04, 0]} m="panelGray" radius={0.01} />
      <Box size={[0.26, 1.5, 0.26]} position={[0, 0.83, 0]} m="panel" radius={0.02} />
      <Box size={[0.2, 0.2, 0.2]} position={[0, 1.27, 0.1]} m="steelSatin" radius={0.015} />
    </group>
  );
}

/** Loader: a load port with a FOUP; wafers are handed to the stage inside. */
function Loader() {
  return (
    <group position={[-0.95, 0, 0]}>
      <Box size={[0.66, 1.28, 1.1]} position={[0, 0.64, 0]} m="panel" radius={0.02} />
      <Box size={[0.66, 0.08, 1.1]} position={[0, 0.04, 0]} m="panelGray" radius={0.01} />
      <Box size={[0.5, 0.2, 0.012]} position={[0, 1.06, 0.552]} m="glassDark" radius={0.004} castShadow={false} />
      {/* load port shelf and FOUP */}
      <Box size={[0.48, 0.05, 0.36]} position={[0, 0.88, 0.72]} m="panelGray" radius={0.008} />
      <Box size={[0.52, 0.5, 0.04]} position={[0, 1.0, 0.56]} m="panelGray" radius={0.008} />
      <group position={[0, 0.905, 0.73]}>
        <Box size={[0.39, 0.3, 0.33]} position={[0, 0.15, 0]} m={podMat} radius={0.03} />
        <Box size={[0.37, 0.28, 0.02]} position={[0, 0.15, -0.17]} m="panelGray" radius={0.006} />
        <Box size={[0.2, 0.02, 0.14]} position={[0, 0.315, 0]} m="panelGray" radius={0.006} />
      </group>
      <StandaloneOnly>
        <LightTower position={[0.22, 1.28, -0.4]} on="green" />
      </StandaloneOnly>
    </group>
  );
}

/** Tester mainframe behind and beside the prober (the bay model draws it when placed). */
const TESTER: V3 = [1.4, 0, -1.5];

function Tester() {
  return (
    <group position={TESTER} rotation={[0, -0.45, 0]}>
      <Box size={[0.78, 0.08, 0.74]} position={[0, 0.04, 0]} m="panelGray" radius={0.01} />
      <Box size={[0.78, 1.4, 0.74]} position={[0, 0.78, 0]} m="panel" radius={0.025} />
      {/* instrument slots behind a narrow dark window */}
      <Box size={[0.5, 0.74, 0.012]} position={[-0.04, 0.8, 0.372]} m="glassDark" radius={0.004} castShadow={false} />
      {Array.from({ length: 9 }, (_, i) => (
        <Box key={i} size={[0.01, 0.66, 0.006]} position={[-0.24 + i * 0.05, 0.8, 0.36]} m="black" radius={0.002} castShadow={false} />
      ))}
      {/* exhaust grille and a status screen */}
      {Array.from({ length: 5 }, (_, i) => (
        <Box key={i} size={[0.6, 0.008, 0.008]} position={[0, 1.3 + i * 0.022, 0.372]} m="black" radius={0.002} castShadow={false} />
      ))}
      <Box size={[0.12, 0.08, 0.012]} position={[0.29, 0.8, 0.374]} m="screen" radius={0.004} castShadow={false} />
      <LightTower position={[0.28, 1.48, -0.26]} on="green" />
    </group>
  );
}

// ───────────────────────────── scene ─────────────────────────────

export default function Prober({ variant }: ToolProps) {
  void variant;
  const chuck = useRef<THREE.Group>(null);
  const xCarriage = useRef<THREE.Group>(null);
  const yCarriage = useRef<THREE.Group>(null);
  const wafer = useRef<THREE.Group>(null);

  useProgressFrame((p) => {
    const s = stagePose(p);
    const top = TIP_Y - WAFER_T - s.drop; // chuck top surface
    if (yCarriage.current) yCarriage.current.position.z = s.z;
    if (xCarriage.current) xCarriage.current.position.set(s.x, 0, s.z);
    if (chuck.current) chuck.current.position.set(s.x, top, s.z);
    if (wafer.current) wafer.current.position.set(s.x, top, s.z);
  });

  const chuckGrooves = useMemo(() => [0.04, 0.075, 0.11, 0.145], []);

  return (
    <group>
      <CleanFloor size={12} />
      {/* ── prober chassis ── */}
      <Box size={[1.2, 0.08, 1.1]} position={[PX, 0.04, PZ]} m="panelGray" radius={0.01} />
      <Box size={[1.2, 0.62, 1.1]} position={[PX, 0.39, PZ]} m="panel" radius={0.02} />
      <Box size={[1.12, 0.012, 0.01]} position={[PX, 0.52, PZ + 0.552]} m="panelGray" radius={0.002} castShadow={false} />
      <Box size={[1.2, 0.02, 0.02]} position={[PX, 0.69, PZ + 0.545]} m="black" radius={0.004} castShadow={false} />
      <Box size={[0.02, 0.02, 1.1]} position={[PX + 0.595, 0.69, PZ]} m="black" radius={0.004} castShadow={false} />
      <Box size={[0.26, 0.16, 0.012]} position={[PX - 0.36, 0.3, PZ + 0.553]} m="panelWarm" radius={0.006} castShadow={false} />
      {/* stage chamber: back and left walls; front and right cut away */}
      <Box size={[1.2, 0.3, 0.03]} position={[PX, 0.85, PZ - 0.535]} m="panel" radius={0.008} />
      <Box size={[0.03, 0.3, 1.1]} position={[PX - 0.585, 0.85, PZ]} m="panel" radius={0.008} />
      <Box size={[0.03, 0.3, 0.5]} position={[PX + 0.585, 0.85, PZ - 0.3]} m="panel" radius={0.008} />
      {/* granite stage base and rails */}
      <Box size={[1.1, 0.06, 1.0]} position={[PX, 0.73, PZ]} m="panelGray" radius={0.01} />
      {[-0.3, 0.3].map((x) => (
        <Box key={x} size={[0.03, 0.02, 0.9]} position={[PX + x, 0.77, PZ]} m="steel" radius={0.004} />
      ))}
      {/* Y carriage (moves in z) with X rails */}
      <group ref={yCarriage}>
        <Box size={[0.74, 0.04, 0.4]} position={[PX, 0.8, 0]} m="aluminum" radius={0.008} />
        {[-0.34, 0.34].map((x) => (
          <Box key={x} size={[0.05, 0.05, 0.42]} position={[PX + x, 0.8, 0]} m="black" radius={0.006} />
        ))}
        {[-0.13, 0.13].map((z) => (
          <Box key={z} size={[0.7, 0.014, 0.022]} position={[PX, 0.827, z]} m="steel" radius={0.003} />
        ))}
      </group>
      {/* X carriage (moves in x and z) with the Z-lift housing */}
      <group ref={xCarriage}>
        <Box size={[0.38, 0.04, 0.36]} position={[0, 0.854, 0]} m="panelGray" radius={0.008} />
        <Cyl r={0.095} h={0.03} position={[0, 0.889, 0]} m="steelDark" seg={48} />
      </group>
      {/* chuck on its Z column: chuck top surface at the group origin */}
      <group ref={chuck}>
        <Cyl r={0.07} h={0.1} position={[0, -0.07, 0]} m="steelSatin" seg={48} />
        <Cyl r={0.155} h={0.022} position={[0, -0.011, 0]} m="aluminum" seg={96} />
        <Cyl r={0.158} h={0.004} position={[0, -0.02, 0]} m="steelDark" seg={96} />
        {chuckGrooves.map((r) => (
          <mesh key={r} position={[0, 0.0003, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.steelDark}>
            <ringGeometry args={[r, r + 0.0018, 96]} />
          </mesh>
        ))}
      </group>
      <MapWafer groupRef={wafer} />
      {/* head plate, probe card and pogo tower */}
      <HeadPlate />
      <ProbeCard />
      <TestHead />
      <Manipulator />
      <Loader />
      <StandaloneOnly>
        <Tester />
        <LightTower position={[PX - 0.5, 1.03, PZ - 0.45]} on="violet" />
      </StandaloneOnly>
      {/* cable bundle: test head → tester */}
      <Cable points={[[0.3, 1.24, -0.54], [0.56, 1.0, -0.84], [0.82, 0.72, -1.3], [1.08, 0.9, -1.62]]} r={0.028} />
      <Cable points={[[0.2, 1.28, -0.54], [0.5, 0.96, -0.94], [0.8, 0.66, -1.42], [1.09, 1.02, -1.66]]} r={0.024} />
      <Cable points={[[0.36, 1.2, -0.5], [0.62, 1.0, -0.8], [0.88, 0.8, -1.24], [1.07, 1.14, -1.58]]} r={0.018} />
    </group>
  );
}
