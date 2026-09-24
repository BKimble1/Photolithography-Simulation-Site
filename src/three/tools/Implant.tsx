/**
 * Medium-current ion implanter (illustrative, no manufacturer's design), laid out in an L:
 *  - an ion source inside a high-voltage terminal that stands on ribbed ceramic insulators;
 *  - an analyzer magnet that bends the beam 90°, so only ions of the chosen mass reach the
 *    resolving slit;
 *  - an acceleration column of stacked electrode rings;
 *  - an electrostatic scanner that sweeps the beam sideways, and a corrector magnet that turns
 *    the fan into a parallel ribbon;
 *  - an end station (cut away): a platen swings the wafer up to face the beam, tilted 7°, and
 *    moves it slowly up and down while the beam sweeps across; a load lock with a linear
 *    transfer arm brings the wafer in and takes it out again.
 * The wafer is only here during the two implant windows of each step; the rest of the time it
 * is away being masked in the lithography track, and the end station waits with an empty
 * platen. Ion beams are invisible: the violet path is an optional overlay (the "Beam path"
 * toggle). Everything that tells the story is a pure function of progress p.
 *
 * In the fab the scene is mounted a quarter turn round inside the implanter's housing
 * (`implanter` in Fab.tsx): the terminal stands in a closed high-voltage cage and the load lock
 * points at the tool's front end and load ports.
 */
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useSimState } from '../../state/sim';
import { lerp, seg, smooth, useProgressFrame } from '../anim';
import { MAT } from '../materials';
import { Box, CleanFloor, Cyl, Lathe, LightTower, StandaloneOnly } from '../kit/parts';
import { StationLight } from '../stage/StationLight';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';
import { useOverlay } from '../../state/presentation';

type V3 = [number, number, number];

// ───────────────────────────── layout (metres) ─────────────────────────────
// The beam leaves the source heading +x, the analyzer turns it to −z, and it travels
// away from the viewer down the final leg to the wafer, which faces +z.

const Y_B = 1.15; // beam height
const X_F = -0.3; // final leg runs along −z at this x
const R_M = 0.42; // analyzer bend radius
const Z_X = 0.86; // analyzer exit
const CX = X_F - R_M; // bend centre (x); its z is Z_X
const Z_EN = Z_X + R_M; // source leg runs along +x at this z
const X_EN = CX; // analyzer entry
const X_SRC = -1.62; // extraction aperture of the source
const SLIT_Z = 0.76;
const COL = { z0: 0.18, z1: 0.64 }; // acceleration column
const SCAN_Z = 0.02; // scanner deflection point
const CORR = { z0: -0.3, z1: -0.56 }; // corrector magnet: fan in, parallel ribbon out
const Z_W = -1.06; // wafer face / platen tilt axis
const HALF_SCAN = 0.175; // half-width of the scanned ribbon (overscans the wafer)
const TILT = (7 * Math.PI) / 180;
const ES = { x0: X_F - 0.5, x1: X_F + 0.48, z0: -1.62, z1: -0.6, y0: 0.6, y1: 1.74 }; // end-station chamber
const LL = { x0: ES.x1 + 0.04, x1: ES.x1 + 0.96, hw: 0.22, y0: Y_B - 0.17, y1: Y_B + 0.13 }; // load lock
const BLADE_OFF = 0.2;
const ROOT_IN = 0.76; // blade root, retracted inside the load lock (the blade points −x)
const ROOT_OUT = X_F + BLADE_OFF; // blade root with the wafer over the platen
const PIN_H = 0.02; // lift-pin stroke
const DUR = 15;

/** The two windows (progress) during which the wafer is in the implanter. */
const WINDOWS: [number, number][] = [
  [0.195, 0.405],
  [0.64, 0.83],
];

// ───────────────────────────── choreography ─────────────────────────────

interface EndState {
  present: boolean;
  gate: number; // slot valve: 0 closed … 1 open
  ext: number; // transfer arm extension 0…1
  bladeY: number; // blade top above the platen face while over it
  pins: number; // lift-pin height
  tilt: number; // platen rotation about x (0 = face up, ≈π/2 = facing the beam)
  dy: number; // mechanical scan offset
  beam: number; // 0…1 beam on the wafer
  onArm: boolean;
}

const IDLE: EndState = { present: false, gate: 0, ext: 0, bladeY: PIN_H + 0.009, pins: 0, tilt: 0, dy: 0, beam: 0, onArm: true };

/** End-station state at progress p (pure). u runs 0…1 across a window. */
function endStation(p: number): EndState {
  const w = WINDOWS.find(([a, b]) => p >= a && p <= b);
  if (!w) return IDLE;
  const u = seg(p, w[0], w[1]);
  const gate = smooth(u, 0, 0.04) * (1 - smooth(u, 0.26, 0.3)) + smooth(u, 0.72, 0.76) * (1 - smooth(u, 0.97, 1));
  const ext = smooth(u, 0.02, 0.13) * (1 - smooth(u, 0.16, 0.26)) + smooth(u, 0.75, 0.85) * (1 - smooth(u, 0.88, 0.98));
  const pins = PIN_H * (smooth(u, 0, 0.04) * (1 - smooth(u, 0.24, 0.28)) + smooth(u, 0.72, 0.76) * (1 - smooth(u, 0.96, 1)));
  // the blade brings the wafer in above the pins and sets it down; on the way out it slides in below and lifts
  const bladeY = u < 0.5 ? lerp(PIN_H + 0.009, PIN_H - 0.006, smooth(u, 0.13, 0.16)) : lerp(PIN_H - 0.006, PIN_H + 0.009, smooth(u, 0.85, 0.88));
  const up = smooth(u, 0.27, 0.36) * (1 - smooth(u, 0.66, 0.74));
  const tilt = (Math.PI / 2 - TILT) * up;
  const scanU = seg(u, 0.36, 0.66);
  const dy = 0.1 * Math.sin(scanU * Math.PI * 2) * Math.sin(scanU * Math.PI);
  const beam = smooth(u, 0.355, 0.37) * (1 - smooth(u, 0.645, 0.66));
  return { present: true, gate, ext, bladeY, pins, tilt, dy, beam, onArm: u < 0.15 || u > 0.87 };
}

/** Sideways beam scan position −1…1 (triangle wave, a few sweeps a second). */
function scanPos(p: number) {
  const x = p * DUR * 3.2;
  const f = x - Math.floor(x);
  return f < 0.5 ? 4 * f - 1 : 3 - 4 * f;
}

// ───────────────────────────── materials ─────────────────────────────

const IM = {
  yoke: new THREE.MeshStandardMaterial({ color: '#40454d', metalness: 0.35, roughness: 0.45 }),
  coil: new THREE.MeshStandardMaterial({ color: '#b87645', metalness: 0.85, roughness: 0.32 }),
  coilCover: new THREE.MeshStandardMaterial({ color: '#2b2e33', metalness: 0.2, roughness: 0.5 }),
  porcelain: new THREE.MeshStandardMaterial({ color: '#efece6', metalness: 0, roughness: 0.28 }),
  terminal: new THREE.MeshStandardMaterial({ color: '#d7dadd', metalness: 0.3, roughness: 0.5 }),
  beam: new THREE.MeshBasicMaterial({ color: '#8e7cff', transparent: true, opacity: 0.5, depthWrite: false, depthTest: false }),
  envelope: new THREE.MeshBasicMaterial({ color: '#8e7cff', transparent: true, opacity: 0.07, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
  spot: new THREE.MeshBasicMaterial({ color: '#b9adff', transparent: true, opacity: 0.75, depthWrite: false, depthTest: false }),
};

// ───────────────────────────── geometry helpers ─────────────────────────────

/** Circular arc in a horizontal plane around c, from angle a0 to a1 (measured from +x toward +z). */
class Arc extends THREE.Curve<THREE.Vector3> {
  private r: number;
  private c: THREE.Vector3;
  private a0: number;
  private a1: number;
  constructor(r: number, c: V3, a0: number, a1: number) {
    super();
    this.r = r;
    this.c = new THREE.Vector3(...c);
    this.a0 = a0;
    this.a1 = a1;
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = this.a0 + (this.a1 - this.a0) * t;
    return target.set(this.c.x + Math.cos(a) * this.r, this.c.y, this.c.z + Math.sin(a) * this.r);
  }
}

/** Ribbed insulator profile (radius, height) along its axis. */
function ribbedProfile(len: number, r0: number, r1: number, pitch: number): [number, number][] {
  const pts: [number, number][] = [
    [0, 0],
    [r1 + 0.012, 0],
    [r1 + 0.012, 0.02],
    [r0, 0.028],
  ];
  const n = Math.floor((len - 0.07) / pitch);
  for (let i = 0; i < n; i++) {
    const y = 0.035 + i * pitch;
    pts.push([r0, y], [r1, y + pitch * 0.3], [r1, y + pitch * 0.45], [r0, y + pitch * 0.75]);
  }
  pts.push([r0, len - 0.028], [r1 + 0.012, len - 0.02], [r1 + 0.012, len], [0, len]);
  return pts;
}

/** Annular sector lying flat (x–z), centred on the origin, spanning angles a0…a1 (from +x toward +z). */
function sectorGeometry(rIn: number, rOut: number, a0: number, a1: number, h: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  // shape y = −z, so after rotateX(−π/2) positive angles land toward +z
  s.absarc(0, 0, rOut, -a0, -a1, true);
  s.absarc(0, 0, rIn, -a1, -a0, false);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 40 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -h / 2, 0);
  g.computeVertexNormals();
  return g;
}

/** Fork-shaped end effector lying flat, pointing along +x. */
function bladeGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const w0 = 0.034;
  const w1 = 0.058;
  const gap = 0.04;
  s.moveTo(-0.02, -w0);
  s.lineTo(0.09, -w0);
  s.lineTo(0.14, -w1);
  s.lineTo(0.31, -w1);
  s.quadraticCurveTo(0.325, -w1, 0.325, -w1 + 0.012);
  s.lineTo(0.325, -gap);
  s.lineTo(0.17, -gap);
  s.quadraticCurveTo(0.14, -gap, 0.14, -gap + 0.03);
  s.lineTo(0.14, gap - 0.03);
  s.quadraticCurveTo(0.14, gap, 0.17, gap);
  s.lineTo(0.325, gap);
  s.lineTo(0.325, w1 - 0.012);
  s.quadraticCurveTo(0.325, w1, 0.31, w1);
  s.lineTo(0.14, w1);
  s.lineTo(0.09, w0);
  s.lineTo(-0.02, w0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

const ALONG_X: V3 = [0, 0, Math.PI / 2]; // cylinder axis → x
const ALONG_Z: V3 = [Math.PI / 2, 0, 0]; // cylinder axis → z

// ───────────────────────────── beamline parts ─────────────────────────────

function Insulator({ position, rotation, len, r0, r1, pitch }: { position: V3; rotation?: V3; len: number; r0: number; r1: number; pitch: number }) {
  const profile = useMemo(() => ribbedProfile(len, r0, r1, pitch), [len, r0, r1, pitch]);
  return <Lathe profile={profile} position={position} rotation={rotation} m={IM.porcelain} seg={40} />;
}

/** High-voltage terminal holding the ion source, on insulator legs; the beam leaves along +x. */
function SourceTerminal() {
  const legY = 0.42;
  const box = { w: 0.6, h: 0.95, d: 0.66 };
  const cx = X_SRC - 0.52; // terminal centre: the source housing ends at the extraction aperture
  const face = cx + box.w / 2;
  return (
    <group>
      <Box size={[box.w + 0.1, 0.06, box.d + 0.1]} position={[cx, 0.03, Z_EN]} m="panelGray" radius={0.01} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <Insulator key={`${sx},${sz}`} position={[cx + sx * 0.22, 0.06, Z_EN + sz * 0.24]} len={legY - 0.06} r0={0.04} r1={0.062} pitch={0.036} />
        )),
      )}
      {/* terminal enclosure (a Faraday cage at the source potential) */}
      <Box size={[box.w, box.h, box.d]} position={[cx, legY + box.h / 2, Z_EN]} m={IM.terminal} radius={0.03} />
      <Box
        size={[0.01, 0.46, box.d - 0.14]}
        position={[cx - box.w / 2 - 0.004, legY + box.h / 2 + 0.06, Z_EN]}
        m="glassDark"
        radius={0.004}
        castShadow={false}
      />
      {/* source housing and extraction electrodes */}
      <Cyl r={0.15} h={0.2} position={[face + 0.1, Y_B, Z_EN]} rotation={ALONG_X} m="steelSatin" seg={48} />
      <Cyl r={0.19} h={0.03} position={[face + 0.215, Y_B, Z_EN]} rotation={ALONG_X} m="steel" seg={48} />
      {/* ribbed bushing: the terminal floats at high voltage above the grounded beamline */}
      <Insulator position={[face + 0.23, Y_B, Z_EN]} rotation={[0, 0, -Math.PI / 2]} len={0.3} r0={0.15} r1={0.18} pitch={0.045} />
      <Cyl r={0.2} h={0.03} position={[face + 0.545, Y_B, Z_EN]} rotation={ALONG_X} m="steel" seg={48} />
      {/* beam tube to the analyzer, with a turbo pump below */}
      <Cyl r={0.06} h={X_EN - (face + 0.56)} position={[(X_EN + face + 0.56) / 2, Y_B, Z_EN]} rotation={ALONG_X} m="steelSatin" seg={32} />
      <Cyl r={0.1} h={0.26} position={[face + 0.72, Y_B - 0.3, Z_EN]} m="steelSatin" seg={40} />
      <Cyl r={0.06} h={0.14} position={[face + 0.72, Y_B - 0.12, Z_EN]} m="steel" seg={32} />
      <Box size={[0.26, Y_B - 0.45, 0.26]} position={[face + 0.72, (Y_B - 0.45) / 2, Z_EN]} m="panelGray" radius={0.012} />
      {/* dopant gas cabinet behind the terminal */}
      <Box size={[0.5, 1.5, 0.42]} position={[cx, 0.75, Z_EN - 0.62]} m="panelDark" radius={0.02} />
      <Box size={[0.34, 0.5, 0.01]} position={[cx, 1.05, Z_EN - 0.62 + 0.214]} m="glassDark" radius={0.004} castShadow={false} />
      <StandaloneOnly>
        <LightTower position={[cx + 0.16, 1.5, Z_EN - 0.72]} on="violet" />
      </StandaloneOnly>
    </group>
  );
}

/** 90° analyzer magnet: pole pieces above and below a curved flight tube, copper coils, C-yoke. */
function AnalyzerMagnet() {
  const geo = useMemo(() => {
    const pole = sectorGeometry(R_M - 0.13, R_M + 0.13, 0, Math.PI / 2, 0.1);
    const coil = sectorGeometry(R_M - 0.12, R_M + 0.16, -0.05, Math.PI / 2 + 0.05, 0.06);
    const cover = sectorGeometry(R_M - 0.115, R_M + 0.165, -0.04, Math.PI / 2 + 0.04, 0.012);
    // C-yoke on the inside of the bend (the gap stays visible from outside)
    const yoke = sectorGeometry(R_M - 0.3, R_M - 0.13, -0.08, Math.PI / 2 + 0.08, 0.5);
    const rect = new THREE.Shape();
    rect.moveTo(-0.035, -0.06);
    rect.lineTo(0.035, -0.06);
    rect.lineTo(0.035, 0.06);
    rect.lineTo(-0.035, 0.06);
    rect.closePath();
    const tube = new THREE.ExtrudeGeometry(rect, { steps: 40, bevelEnabled: false, extrudePath: new Arc(R_M, [0, 0, 0], 0, Math.PI / 2) });
    return { pole, coil, cover, yoke, tube };
  }, []);
  return (
    <group position={[CX, Y_B, Z_X]}>
      <mesh geometry={geo.tube} material={MAT.steelSatin} castShadow />
      {[1, -1].map((s) => (
        <group key={s} position={[0, s * 0.1, 0]}>
          <mesh geometry={geo.pole} material={IM.yoke} castShadow receiveShadow />
          <mesh geometry={geo.coil} position={[0, s * 0.08, 0]} material={IM.coil} castShadow />
          <mesh geometry={geo.cover} position={[0, s * 0.117, 0]} material={IM.coilCover} castShadow />
        </group>
      ))}
      <mesh geometry={geo.yoke} material={IM.yoke} castShadow receiveShadow />
      {/* pedestal under the middle of the bend */}
      <Box size={[0.4, Y_B - 0.25, 0.4]} position={[0.27, -0.25 - (Y_B - 0.25) / 2, 0.27]} m="panelGray" radius={0.02} />
    </group>
  );
}

/** Straight part of the beamline from the analyzer exit to the end station (beam along −z). */
function FinalLeg() {
  const electrodes = useRef<THREE.InstancedMesh>(null);
  const ringGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.205, 0.205, 0.014, 56);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  const n = 9;
  useLayoutEffect(() => {
    const im = electrodes.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.makeTranslation(X_F, Y_B, COL.z0 + ((i + 0.5) / n) * (COL.z1 - COL.z0));
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  }, []);
  const fan = useMemo(() => {
    // flared duct from the scanner to the corrector: the scanned beam fans out inside
    const s = new THREE.Shape();
    const zA = SCAN_Z - 0.1;
    s.moveTo(X_F - 0.07, -zA);
    s.lineTo(X_F + 0.07, -zA);
    s.lineTo(X_F + HALF_SCAN + 0.06, -CORR.z0);
    s.lineTo(X_F - HALF_SCAN - 0.06, -CORR.z0);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.13, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, Y_B - 0.065, 0);
    return g;
  }, []);
  const corrMid = (CORR.z0 + CORR.z1) / 2;
  const corrLen = CORR.z0 - CORR.z1;
  return (
    <group>
      {/* resolving slit */}
      <Cyl r={0.06} h={Z_X - SLIT_Z - 0.02} position={[X_F, Y_B, (Z_X + SLIT_Z + 0.02) / 2]} rotation={ALONG_Z} m="steelSatin" seg={32} />
      <Box size={[0.3, 0.3, 0.05]} position={[X_F, Y_B, SLIT_Z]} m="steelSatin" radius={0.012} />
      <Box size={[0.018, 0.12, 0.052]} position={[X_F, Y_B, SLIT_Z]} m="black" radius={0.003} castShadow={false} />
      <Cyl r={0.06} h={SLIT_Z - COL.z1 - 0.04} position={[X_F, Y_B, (SLIT_Z + COL.z1 + 0.02) / 2]} rotation={ALONG_Z} m="steelSatin" seg={32} />
      {/* acceleration column: electrode rings on a ceramic insulator stack */}
      <Cyl r={0.17} h={COL.z1 - COL.z0} position={[X_F, Y_B, (COL.z0 + COL.z1) / 2]} rotation={ALONG_Z} m={IM.porcelain} seg={56} />
      <instancedMesh ref={electrodes} args={[ringGeo, MAT.steel, n]} castShadow frustumCulled={false} />
      {[COL.z0 - 0.015, COL.z1 + 0.015].map((z) => (
        <Cyl key={z} r={0.24} h={0.03} position={[X_F, Y_B, z]} rotation={ALONG_Z} m="steelSatin" seg={56} />
      ))}
      <Cyl r={0.06} h={0.07} position={[X_F, Y_B, COL.z0 - 0.06]} rotation={ALONG_Z} m="steelSatin" seg={32} />
      {/* electrostatic scanner with a viewport onto its deflection plates */}
      <Box size={[0.3, 0.26, 0.24]} position={[X_F, Y_B, SCAN_Z]} m="steelSatin" radius={0.02} />
      <Box size={[0.01, 0.14, 0.16]} position={[X_F + 0.152, Y_B, SCAN_Z]} m="glassDark" radius={0.004} castShadow={false} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.006, 0.12, 0.16]} position={[X_F + s * 0.055, Y_B, SCAN_Z]} m="chrome" radius={0.002} castShadow={false} />
      ))}
      <mesh geometry={fan} material={MAT.steelSatin} castShadow receiveShadow />
      {/* corrector magnet: turns the fan into a parallel ribbon */}
      {[1, -1].map((s) => (
        <group key={s}>
          <Box size={[2 * HALF_SCAN + 0.2, 0.07, corrLen]} position={[X_F, Y_B + s * 0.1, corrMid]} m={IM.yoke} radius={0.012} />
          <Box size={[2 * HALF_SCAN + 0.26, 0.05, corrLen + 0.06]} position={[X_F, Y_B + s * 0.16, corrMid]} m={IM.coil} radius={0.016} />
          <Box size={[2 * HALF_SCAN + 0.27, 0.012, corrLen + 0.07]} position={[X_F, Y_B + s * 0.191, corrMid]} m={IM.coilCover} radius={0.005} />
        </group>
      ))}
      <Box size={[0.08, 0.4, corrLen]} position={[X_F - HALF_SCAN - 0.14, Y_B, corrMid]} m={IM.yoke} radius={0.012} />
      {/* beamline base: one plinth under the column, scanner and corrector */}
      <Box
        size={[0.5, Y_B - 0.26, SLIT_Z + 0.05 - (CORR.z1 - 0.02)]}
        position={[X_F, (Y_B - 0.26) / 2, (CORR.z1 - 0.02 + SLIT_Z + 0.05) / 2]}
        m="panel"
        radius={0.03}
      />
      {(
        [
          [SLIT_Z, Y_B - 0.15],
          [(COL.z0 + COL.z1) / 2, Y_B - 0.2],
          [SCAN_Z, Y_B - 0.13],
          [corrMid, Y_B - 0.185],
        ] as const
      ).map(([z, top]) => (
        <Box key={z} size={[0.14, top - (Y_B - 0.28), 0.12]} position={[X_F, (top + Y_B - 0.28) / 2, z]} m="steelSatin" radius={0.01} />
      ))}
    </group>
  );
}

// ───────────────────────────── end station ─────────────────────────────

function EndStation({
  platen,
  pins,
  gate,
  arm,
}: {
  platen: RefObject<THREE.Group | null>;
  pins: RefObject<THREE.Group | null>;
  gate: RefObject<THREE.Group | null>;
  arm: RefObject<THREE.Group | null>;
}) {
  const blade = useMemo(() => bladeGeometry(), []);
  const W = ES.x1 - ES.x0;
  const H = ES.y1 - ES.y0;
  const D = ES.z1 - ES.z0;
  const xc = (ES.x0 + ES.x1) / 2;
  const zc = (ES.z0 + ES.z1) / 2;
  const t = 0.03;
  const slotW = 2 * HALF_SCAN + 0.08;
  return (
    <group>
      {/* chamber in cutaway: floor, back and left walls; the beam wall and the right wall are cut low */}
      <Box size={[W, t, D]} position={[xc, ES.y0 + t / 2, zc]} m="panelGray" radius={0.006} />
      <Box size={[W, H, t]} position={[xc, ES.y0 + H / 2, ES.z0 + t / 2]} m="panelGray" radius={0.006} />
      <Box size={[t, H, D]} position={[ES.x0 + t / 2, ES.y0 + H / 2, zc]} m="panelGray" radius={0.006} />
      {/* right wall: low at the front; full height behind, with the transfer slot */}
      <Box size={[t, Y_B - 0.12 - ES.y0, D]} position={[ES.x1 - t / 2, (ES.y0 + Y_B - 0.12) / 2, zc]} m="panelGray" radius={0.006} />
      <Box size={[t, 0.1, Z_W + 0.26 - ES.z0]} position={[ES.x1 - t / 2, Y_B - 0.08, (ES.z0 + Z_W + 0.26) / 2]} m="panelGray" radius={0.006} />
      <Box
        size={[t, ES.y1 - Y_B - 0.07, Z_W + 0.26 - ES.z0]}
        position={[ES.x1 - t / 2, (Y_B + 0.07 + ES.y1) / 2, (ES.z0 + Z_W + 0.26) / 2]}
        m="aluminum"
        radius={0.006}
      />
      <Box size={[t, 0.1, Z_W - 0.22 - ES.z0]} position={[ES.x1 - t / 2, Y_B + 0.02, (ES.z0 + Z_W - 0.22) / 2]} m="panelGray" radius={0.006} />
      <Box size={[0.05, ES.y1 - Y_B + 0.12, 0.05]} position={[ES.x1 - 0.025, (Y_B - 0.12 + ES.y1) / 2, Z_W + 0.26]} m="steel" radius={0.008} />
      {/* beam wall: only the part below the beam slot remains, plus a flange around the slot */}
      <Box size={[W, Y_B - 0.1 - ES.y0, t]} position={[xc, (ES.y0 + Y_B - 0.1) / 2, ES.z1 - t / 2]} m="panelGray" radius={0.006} />
      {[-1, 1].map((sy) => (
        <Box key={sy} size={[slotW + 0.08, 0.03, 0.06]} position={[X_F, Y_B + sy * 0.085, ES.z1 + 0.01]} m="steel" radius={0.006} />
      ))}
      {[-1, 1].map((sx) => (
        <Box key={sx} size={[0.04, 0.2, 0.06]} position={[X_F + sx * (slotW / 2 + 0.02), Y_B, ES.z1 + 0.01]} m="steel" radius={0.006} />
      ))}
      {/* cut edges of the walls */}
      <Box size={[W + 0.02, 0.05, 0.05]} position={[xc, ES.y1, ES.z0 + 0.025]} m="steel" radius={0.008} />
      <Box size={[0.05, 0.05, D]} position={[ES.x0 + 0.025, ES.y1, zc]} m="steel" radius={0.008} />
      {/* support stand and cryopump */}
      <Box size={[W - 0.1, ES.y0 - 0.02, D - 0.14]} position={[xc, (ES.y0 - 0.02) / 2, zc]} m="panel" radius={0.02} />
      <Cyl r={0.13} h={0.3} position={[xc - 0.2, ES.y0 - 0.2, zc + 0.3]} m="steelSatin" seg={40} castShadow={false} />
      {/* soft fill light inside the chamber, so the upright (mirror-like) wafer stays readable */}
      <StationLight position={[X_F + 0.25, Y_B + 0.45, Z_W + 0.55]} intensity={1.4} distance={1.6} decay={2} color="#f4f6ff" />
      {/* platen drive: vertical scan slide on the left wall and the tilt shaft (axis along x) */}
      <Box size={[0.04, 0.62, 0.22]} position={[ES.x0 + 0.05, Y_B, Z_W]} m="black" radius={0.01} />
      <group ref={platen} position={[0, Y_B, Z_W]}>
        <Cyl r={0.045} h={0.24} position={[ES.x0 + 0.18, 0, 0]} rotation={ALONG_X} m="steel" seg={32} />
        <Cyl r={0.07} h={0.06} position={[ES.x0 + 0.09, 0, 0]} rotation={ALONG_X} m="steelDark" seg={32} />
        {/* yoke from the shaft end to the back of the platen */}
        <Box size={[0.07, 0.07, 0.07]} position={[ES.x0 + 0.3, -0.03, 0]} m="steelDark" radius={0.01} />
        <Box size={[X_F - ES.x0 - 0.3, 0.03, 0.07]} position={[(X_F + ES.x0 + 0.3) / 2, -0.058, 0]} m="steelDark" radius={0.008} />
        {/* electrostatic chuck */}
        <group position={[X_F, 0, 0]}>
          <Cyl r={0.168} h={0.036} position={[0, -0.02, 0]} m="steelSatin" seg={64} />
          <Cyl r={0.155} h={0.004} position={[0, -0.0025, 0]} m="black" seg={64} />
          <group ref={pins}>
            {[0.5, 2.594, 4.689].map((a) => (
              <Cyl key={a} r={0.004} h={0.02} position={[Math.cos(a) * 0.08, -0.01, Math.sin(a) * 0.08]} m="ceramic" seg={10} castShadow={false} />
            ))}
          </group>
        </group>
      </group>
      {/* load lock with a linear transfer arm, and the slot valve into the chamber: a hollow box
          with a viewport lid, so the waiting blade and the arriving wafer can be seen inside */}
      <Box size={[LL.x1 - LL.x0, 0.03, 2 * LL.hw]} position={[(LL.x0 + LL.x1) / 2, LL.y0 + 0.015, Z_W]} m="steelSatin" radius={0.008} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[LL.x1 - LL.x0, LL.y1 - LL.y0, 0.03]} position={[(LL.x0 + LL.x1) / 2, (LL.y0 + LL.y1) / 2, Z_W + s * (LL.hw - 0.015)]} m="steelSatin" radius={0.008} />
      ))}
      <Box size={[0.03, LL.y1 - LL.y0, 2 * LL.hw]} position={[LL.x1 - 0.015, (LL.y0 + LL.y1) / 2, Z_W]} m="steelSatin" radius={0.008} />
      {/* the end toward the chamber, with the transfer slot left open */}
      {(
        [
          [LL.y0, Y_B - 0.04],
          [Y_B + 0.06, LL.y1],
        ] as const
      ).map(([a, b]) => (
        <Box key={a} size={[0.03, b - a, 2 * LL.hw]} position={[LL.x0 + 0.015, (a + b) / 2, Z_W]} m="steelSatin" radius={0.006} />
      ))}
      <Box size={[LL.x1 - LL.x0, 0.02, 2 * LL.hw]} position={[(LL.x0 + LL.x1) / 2, LL.y1 + 0.01, Z_W]} m="glassClear" radius={0.006} castShadow={false} receiveShadow={false} />
      <Box size={[0.06, 0.22, 0.4]} position={[LL.x1 + 0.02, Y_B - 0.02, Z_W]} m="panelGray" radius={0.012} />
      <Box size={[LL.x1 - LL.x0 - 0.1, LL.y0 - 0.05, 2 * LL.hw - 0.06]} position={[(LL.x0 + LL.x1) / 2, (LL.y0 - 0.05) / 2, Z_W]} m="panel" radius={0.02} />
      {/* slot-valve body: a frame around the transfer slot */}
      {[-1, 1].map((sy) => (
        <Box key={sy} size={[0.07, 0.07, 0.46]} position={[ES.x1 + 0.02, Y_B + 0.02 + sy * 0.085, Z_W]} m="steelSatin" radius={0.01} />
      ))}
      {[-1, 1].map((sz) => (
        <Box key={sz} size={[0.07, 0.24, 0.05]} position={[ES.x1 + 0.02, Y_B + 0.02, Z_W + sz * 0.205]} m="steelSatin" radius={0.01} />
      ))}
      <group ref={gate}>
        <Box size={[0.012, 0.06, 0.38]} position={[ES.x1 - 0.03, Y_B + 0.022, Z_W]} m="steelDark" radius={0.003} castShadow={false} />
      </group>
      {/* transfer arm (points −x): a slide bar with a fork blade */}
      <group ref={arm} position={[ROOT_IN, Y_B, Z_W]} rotation={[0, Math.PI, 0]}>
        <Box size={[0.36, 0.014, 0.05]} position={[-0.18, -0.012, 0]} m="steelDark" radius={0.004} />
        <mesh geometry={blade} position={[0, -0.003, 0]} material={MAT.ceramic} castShadow />
      </group>
    </group>
  );
}

// ───────────────────────────── beam overlay ─────────────────────────────

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Point a unit cylinder (height 1 along y) from a to b. */
function span(m: THREE.Mesh | null, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  if (!m) return;
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  _d.subVectors(_b, _a);
  const len = _d.length();
  m.position.addVectors(_a, _b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _d.divideScalar(len || 1));
  m.scale.set(1, Math.max(len, 1e-4), 1);
}

const STATIC_SEGS: [number, number, number, number, number, number][] = [
  [X_SRC, Y_B, Z_EN, X_EN, Y_B, Z_EN],
  [X_F, Y_B, Z_X, X_F, Y_B, SCAN_Z],
];

function BeamOverlay({
  group,
  fanLine,
  ribbonLine,
  spot,
}: {
  group: RefObject<THREE.Group | null>;
  fanLine: RefObject<THREE.Mesh | null>;
  ribbonLine: RefObject<THREE.Mesh | null>;
  spot: RefObject<THREE.Mesh | null>;
}) {
  const geo = useMemo(() => {
    const unit = new THREE.CylinderGeometry(0.0045, 0.0045, 1, 8, 1, true);
    const bend = new THREE.TubeGeometry(new Arc(R_M, [CX, Y_B, Z_X], Math.PI / 2, 0), 48, 0.0045, 8, false);
    // envelope of the scanned beam: the fan, then the parallel ribbon down to the wafer
    const zw = Z_W + 0.003;
    const env = new THREE.BufferGeometry();
    // prettier-ignore
    const v = [
      X_F, Y_B, SCAN_Z, X_F - HALF_SCAN, Y_B, CORR.z0, X_F + HALF_SCAN, Y_B, CORR.z0,
      X_F - HALF_SCAN, Y_B, CORR.z0, X_F - HALF_SCAN, Y_B, zw, X_F + HALF_SCAN, Y_B, zw,
      X_F - HALF_SCAN, Y_B, CORR.z0, X_F + HALF_SCAN, Y_B, zw, X_F + HALF_SCAN, Y_B, CORR.z0,
    ];
    env.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return { unit, bend, env };
  }, []);
  const segRefs = useRef<(THREE.Mesh | null)[]>([]);
  useLayoutEffect(() => {
    STATIC_SEGS.forEach((q, i) => span(segRefs.current[i], q[0], q[1], q[2], q[3], q[4], q[5]));
  }, []);
  return (
    <group ref={group} visible={false}>
      {STATIC_SEGS.map((_, i) => (
        <mesh key={i} ref={(m) => void (segRefs.current[i] = m)} geometry={geo.unit} material={IM.beam} renderOrder={20} />
      ))}
      <mesh geometry={geo.bend} material={IM.beam} renderOrder={20} />
      <mesh geometry={geo.env} material={IM.envelope} renderOrder={19} />
      <mesh ref={fanLine} geometry={geo.unit} material={IM.beam} renderOrder={20} />
      <mesh ref={ribbonLine} geometry={geo.unit} material={IM.beam} renderOrder={20} />
      <mesh ref={spot} material={IM.spot} renderOrder={21}>
        <circleGeometry args={[0.013, 20]} />
      </mesh>
    </group>
  );
}

// ───────────────────────────── scene ─────────────────────────────

export default function Implant({ variant }: ToolProps) {
  void variant;
  const state = useSimState();
  const beamPath = useOverlay('lightPath');

  const platen = useRef<THREE.Group>(null);
  const pins = useRef<THREE.Group>(null);
  const gate = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Group>(null);
  const wafer = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Group>(null);
  const fanLine = useRef<THREE.Mesh>(null);
  const ribbonLine = useRef<THREE.Mesh>(null);
  const spot = useRef<THREE.Mesh>(null);

  useProgressFrame((p) => {
    const e = endStation(p);
    const rootX = lerp(ROOT_IN, ROOT_OUT, e.ext);
    if (arm.current) arm.current.position.set(rootX, Y_B + e.bladeY, Z_W);
    if (gate.current) gate.current.position.y = -0.075 * e.gate;
    if (pins.current) pins.current.position.y = e.pins;
    if (platen.current) {
      platen.current.position.y = Y_B + e.dy;
      platen.current.rotation.x = e.tilt;
    }
    const w = wafer.current;
    if (w) {
      w.visible = e.present;
      if (!e.present) {
        // away being masked: the (hidden) wafer waits on the retracted blade in the load lock,
        // where it will reappear, so wafer framings look at the load lock rather than the floor
        w.position.set(ROOT_IN - BLADE_OFF, Y_B + IDLE.bladeY, Z_W);
        w.rotation.set(0, 0, 0);
      } else {
        if (e.onArm) {
          // riding on the blade (wafer centre BLADE_OFF ahead of the root, toward −x)
          w.position.set(rootX - BLADE_OFF, Y_B + Math.max(e.bladeY, e.ext > 0.999 ? e.pins : 0), Z_W);
          w.rotation.set(0, 0, 0);
        } else {
          // on the pins or the chuck, turning with the platen about its tilt axis
          const lift = Math.max(e.pins, e.ext > 0.999 ? e.bladeY : 0);
          w.position.set(X_F, Y_B + e.dy + Math.cos(e.tilt) * lift, Z_W + Math.sin(e.tilt) * lift);
          w.rotation.set(e.tilt, 0, 0);
        }
      }
    }
    // beam overlay: only with the "Beam path" toggle, and only while the wafer is being implanted
    const b = beam.current;
    if (b) {
      const on = beamPath && e.beam > 0.02;
      b.visible = on;
      if (on) {
        const x = X_F + scanPos(p) * HALF_SCAN;
        // the wafer face is tilted 7°, so where the beam meets it shifts slightly with the scan height
        const zs = Z_W + Math.tan(TILT) * e.dy + 0.003;
        span(fanLine.current, X_F, Y_B, SCAN_Z, x, Y_B, CORR.z0);
        span(ribbonLine.current, x, Y_B, CORR.z0, x, Y_B, zs);
        if (spot.current) {
          spot.current.position.set(x, Y_B, zs + 0.001);
          spot.current.visible = Math.abs(x - X_F) < 0.15;
        }
        IM.beam.opacity = 0.5 * e.beam;
        IM.envelope.opacity = 0.07 * e.beam;
      }
    }
  });

  return (
    <group>
      <CleanFloor size={16} />
      <SourceTerminal />
      <AnalyzerMagnet />
      <FinalLeg />
      <EndStation platen={platen} pins={pins} gate={gate} arm={arm} />
      <group ref={wafer} visible={false}>
        <Wafer anchor look={{ summary: state.wafer, showParticles: true }} size={768} />
      </group>
      <BeamOverlay group={beam} fanLine={fanLine} ribbonLine={ribbonLine} spot={spot} />
    </group>
  );
}
