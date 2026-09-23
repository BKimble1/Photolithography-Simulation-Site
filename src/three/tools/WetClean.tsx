/**
 * Single-wafer spin-clean chamber (illustrative, no manufacturer's design): the wafer is held
 * at its edge by six pins on a spin base inside a chemically resistant splash cup. Two swing
 * arms serve it in turn: a chemical arm (spray nozzle plus a megasonic transducer head) that
 * sweeps from centre to edge, then a DI-water rinse arm. A high-speed spin then dries it.
 * Skipping the clean (the learner's choice) leaves the arms parked and the wafer untouched.
 * Every motion is a pure function of the step progress p; only spray flicker uses the clock.
 *
 * The chamber is one of a stack: it sits in the upper tier (deck at 1.3 m) of the wet-clean
 * tool at its fab station (`wetClean` in Fab.tsx), whose housing provides the cabinet below
 * and the panels around; placed there, only the chamber itself is drawn.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimState } from '../../state/sim';
import { seg, smooth, useProgressFrame } from '../anim';
import { MAT } from '../materials';
import { Box, CleanFloor, Cyl, Lathe, LightTower, StandaloneOnly } from '../kit/parts';
import { Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';
import { useRunChoices } from '../../state/presentation';

const DUR = 11; // step length (s), for the spin integral
const DECK_Y = 1.3; // upper-tier chamber floor
const BASE_Y = DECK_Y + 0.07; // top of the spin base
const WAFER_Y = BASE_Y + 0.014; // wafer underside, resting on the chuck pins
const SURF_Y = WAFER_Y + 0.0016;
const CH = { x0: -0.52, x1: 0.52, z0: -0.46, z1: 0.46, top: DECK_Y + 0.86 };

// swing arms: pivot (x, z), arm height above the deck; nozzle reaches the wafer centre
const ARM_A = { x: -0.34, z: -0.27, h: 0.2 };
const ARM_B = { x: 0.34, z: -0.27, h: 0.235 };
const armLen = (a: { x: number; z: number }) => Math.hypot(a.x, a.z);
const armCentre = (a: { x: number; z: number }) => Math.atan2(a.z, -a.x); // rotation.y that points the arm at the origin
const LEN_A = armLen(ARM_A);
const LEN_B = armLen(ARM_B);
const PHI_A = armCentre(ARM_A);
const PHI_B = armCentre(ARM_B);
const SWEEP_A = 2 * Math.asin(0.135 / (2 * LEN_A)); // arm rotation that moves the nozzle from centre to edge
const SWEEP_B = 2 * Math.asin(0.07 / (2 * LEN_B));
const LIFT = 0.1; // arms rise this much before swinging over the cup lip

// ───────────────────────────── materials ─────────────────────────────

const WM = {
  pvdf: new THREE.MeshStandardMaterial({ color: '#e4e7ea', metalness: 0, roughness: 0.4 }),
  pvdfDark: new THREE.MeshStandardMaterial({ color: '#9aa1a8', metalness: 0, roughness: 0.4 }),
  pfa: new THREE.MeshPhysicalMaterial({ color: '#f4f6f7', metalness: 0, roughness: 0.25, transparent: true, opacity: 0.75, clearcoat: 0.5 }),
  inner: new THREE.MeshStandardMaterial({ color: '#d9dde1', metalness: 0.05, roughness: 0.45 }),
  deck: new THREE.MeshStandardMaterial({ color: '#949ba3', metalness: 0.1, roughness: 0.6 }),
};

/** Integrated spin angle (rad) for a piecewise-linear speed profile [p, ω rad/s]. */
function spinAngle(p: number, keys: [number, number][]) {
  let ang = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    const [p0, w0] = keys[i];
    const [p1, w1] = keys[i + 1];
    if (p <= p0) break;
    const q = Math.min(p, p1);
    const wq = w0 + ((w1 - w0) * (q - p0)) / (p1 - p0);
    ang += ((w0 + wq) / 2) * (q - p0) * DUR;
  }
  return ang;
}

// visual spin speeds (real tools spin far faster; these stay readable on screen)
const SPIN_CLEAN: [number, number][] = [
  [0.05, 0],
  [0.15, 5.5],
  [0.7, 5.5],
  [0.75, 13],
  [0.9, 13],
  [0.95, 0],
  [1, 0],
];

/** Radial streak texture for liquid flung off the spinning wafer edge. */
function flingTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.translate(128, 128);
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + Math.sin(i * 12.9) * 0.03;
    const r0 = 90 + (i % 3) * 2;
    const r1 = 112 + ((i * 7) % 15);
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + ((i * 13) % 10) / 20})`;
    ctx.lineWidth = 1 + (i % 2);
    ctx.beginPath();
    // streaks leave tangentially and curve outward
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.quadraticCurveTo(Math.cos(a + 0.12) * (r0 + 10), Math.sin(a + 0.12) * (r0 + 10), Math.cos(a + 0.2) * r1, Math.sin(a + 0.2) * r1);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ───────────────────────────── parts ─────────────────────────────

function Cup() {
  // outer splash cup with an inward catch lip, and an inner guard ring (two collection levels)
  const outer: [number, number][] = [
    [0.05, 0],
    [0.245, 0],
    [0.252, 0.012],
    [0.252, 0.13],
    [0.244, 0.155],
    [0.212, 0.172],
    [0.19, 0.172],
    [0.186, 0.166],
    [0.2, 0.156],
    [0.232, 0.138],
    [0.24, 0.12],
    [0.24, 0.02],
    [0.05, 0.016],
  ];
  const guard: [number, number][] = [
    [0.206, 0.02],
    [0.212, 0.02],
    [0.212, 0.1],
    [0.19, 0.122],
    [0.182, 0.118],
    [0.204, 0.096],
    [0.206, 0.02],
  ];
  return (
    <group position={[0, DECK_Y, 0]}>
      {/* lathe seams turned to the back */}
      <Lathe profile={outer} m={WM.pvdf} seg={96} rotation={[0, Math.PI, 0]} />
      <Lathe profile={guard} m={WM.pvdfDark} seg={96} rotation={[0, Math.PI, 0]} />
      {/* drain and exhaust below the cup */}
      <Cyl r={0.035} h={0.3} position={[0.13, -0.15, -0.06]} m={WM.pvdfDark} seg={24} />
      <Cyl r={0.055} h={0.3} position={[-0.12, -0.15, 0.05]} m={WM.pvdf} seg={24} />
    </group>
  );
}

function SpinBase() {
  const base: [number, number][] = [
    [0, 0],
    [0.045, 0],
    [0.14, 0.009],
    [0.16, 0.012],
    [0.162, 0.016],
    [0, 0.016],
  ];
  const pins = useMemo(() => Array.from({ length: 6 }, (_, i) => (i / 6) * Math.PI * 2 + 0.26), []);
  return (
    <group>
      <Lathe profile={base} position={[0, -0.016, 0]} m="steelSatin" seg={72} />
      <Cyl r={0.05} h={0.004} position={[0, 0.001, 0]} m="black" seg={48} />
      {pins.map((a) => (
        <group key={a} position={[Math.cos(a) * 0.1535, 0, Math.sin(a) * 0.1535]} rotation={[0, -a, 0]}>
          <Cyl r={0.0065} h={0.014} position={[0, 0.007, 0]} m="black" seg={16} />
          <Box size={[0.012, 0.006, 0.01]} position={[0.004, 0.017, 0]} m="black" radius={0.002} castShadow={false} />
        </group>
      ))}
    </group>
  );
}

/** A swing arm on its column; local +x is the arm, the head at LEN. */
function SwingArm({ len, h, armRef, children }: { len: number; h: number; armRef: React.RefObject<THREE.Group | null>; children?: React.ReactNode }) {
  return (
    <group>
      <Cyl r={0.032} h={0.03} position={[0, 0.015, 0]} m="steelSatin" seg={32} />
      <Cyl r={0.019} h={h} position={[0, h / 2, 0]} m={WM.pvdf} seg={24} />
      <group ref={armRef} position={[0, h, 0]}>
        {/* inner rod: the arm lifts out of its column before it swings */}
        <Cyl r={0.013} h={0.16} position={[0, -0.08, 0]} m="steelSatin" seg={16} />
        <Cyl r={0.026} h={0.04} m={WM.pvdf} seg={32} />
        <Box size={[len, 0.022, 0.026]} position={[len / 2, 0, 0]} m={WM.pvdf} radius={0.009} />
        {/* supply tube running along the arm */}
        <mesh position={[len / 2, 0.015, 0.009]} rotation={[0, 0, Math.PI / 2]} material={WM.pfa}>
          <cylinderGeometry args={[0.0035, 0.0035, len, 10]} />
        </mesh>
        <group position={[len, 0, 0]}>{children}</group>
      </group>
    </group>
  );
}

// ───────────────────────────── scene ─────────────────────────────

export default function WetClean({ variant }: ToolProps) {
  void variant;
  const state = useSimState();
  const cleanOn = useRunChoices().clean;

  const spin = useRef<THREE.Group>(null);
  const armA = useRef<THREE.Group>(null);
  const armB = useRef<THREE.Group>(null);
  const spray = useRef<THREE.Mesh>(null);
  const mega = useRef<THREE.Mesh>(null);
  const stream = useRef<THREE.Mesh>(null);
  const splash = useRef<THREE.Mesh>(null);
  const film = useRef<THREE.Mesh>(null);
  const fling = useRef<THREE.Mesh>(null);

  const mats = useMemo(() => {
    const spray = new THREE.MeshBasicMaterial({ color: '#cde8f2', transparent: true, opacity: 0.36, depthWrite: false, side: THREE.DoubleSide });
    const streamM = new THREE.MeshPhysicalMaterial({ color: '#e8f6ff', roughness: 0.05, transparent: true, opacity: 0.55, clearcoat: 1, depthWrite: false });
    const filmM = (MAT.water as THREE.MeshPhysicalMaterial).clone();
    filmM.opacity = 0;
    const flingM = new THREE.MeshBasicMaterial({
      map: flingTexture(),
      color: '#eaf6ff',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return {
      spray,
      stream: streamM,
      film: filmM,
      fling: flingM,
      chem: new THREE.Color('#bfe8ef'),
      water: new THREE.Color('#e6f3ff'),
    };
  }, []);
  useEffect(
    () => () => {
      mats.fling.map?.dispose();
      [mats.spray, mats.stream, mats.film, mats.fling].forEach((m) => m.dispose());
    },
    [mats],
  );

  useProgressFrame((p, t) => {
    const on = cleanOn;
    // spin (pure function of p)
    if (spin.current) spin.current.rotation.y = on ? spinAngle(p, SPIN_CLEAN) : 0;

    // chemical arm: swing in (raised), lower, sweep centre ↔ edge, raise, swing out
    const inA = on ? smooth(p, 0.11, 0.165) * (1 - smooth(p, 0.435, 0.49)) : 0;
    const downA = on ? smooth(p, 0.165, 0.19) * (1 - smooth(p, 0.41, 0.435)) : 0;
    const sweepA = on ? 0.5 - 0.5 * Math.cos(seg(p, 0.19, 0.41) * Math.PI * 5) : 0;
    if (armA.current) {
      armA.current.rotation.y = PHI_A - (1 - inA) * 0.95 + sweepA * SWEEP_A;
      armA.current.position.y = ARM_A.h + LIFT * (1 - downA);
    }
    const sprayOn = on && p > 0.185 && p < 0.415;
    const flick = 0.85 + 0.15 * Math.sin(t * 37) * Math.sin(t * 23);
    if (spray.current) {
      spray.current.visible = sprayOn;
      mats.spray.opacity = 0.36 * flick;
    }
    if (mega.current) mega.current.visible = sprayOn;

    // rinse arm
    const inB = on ? smooth(p, 0.43, 0.48) * (1 - smooth(p, 0.7, 0.75)) : 0;
    const downB = on ? smooth(p, 0.47, 0.49) * (1 - smooth(p, 0.68, 0.7)) : 0;
    const sweepB = on ? 0.5 - 0.5 * Math.cos(seg(p, 0.5, 0.67) * Math.PI * 3) : 0;
    if (armB.current) {
      armB.current.rotation.y = PHI_B - (1 - inB) * 0.95 + sweepB * SWEEP_B;
      armB.current.position.y = ARM_B.h + LIFT * (1 - downB);
    }
    const rinseOn = on && p > 0.488 && p < 0.683;
    if (stream.current) stream.current.visible = rinseOn;
    if (splash.current) {
      splash.current.visible = rinseOn;
      splash.current.scale.setScalar(0.9 + 0.2 * flick);
    }

    // liquid film on the wafer: chemical (tinted) → DI water → spun dry from the centre out
    const wet = on ? smooth(p, 0.17, 0.21) * (1 - smooth(p, 0.72, 0.86)) : 0;
    if (film.current) {
      film.current.visible = wet > 0.01;
      mats.film.opacity = 0.42 * wet;
      mats.film.color.lerpColors(mats.chem, mats.water, smooth(p, 0.48, 0.56));
    }
    if (fling.current) {
      const f = on ? smooth(p, 0.18, 0.24) * (1 - smooth(p, 0.74, 0.84)) : 0;
      fling.current.visible = f > 0.01;
      mats.fling.opacity = 0.55 * f;
      fling.current.rotation.z = (spin.current?.rotation.y ?? 0) * 1.15;
    }
  });

  const sprayH = ARM_A.h - 0.069 - (SURF_Y - DECK_Y);
  const streamH = ARM_B.h - 0.065 - (SURF_Y - DECK_Y);
  return (
    <group>
      <CleanFloor size={12} />
      {/* base cabinet with chemical supply behind two doors (in the bay: the tool's lower tier) */}
      <StandaloneOnly>
        <Box size={[CH.x1 - CH.x0, 0.08, CH.z1 - CH.z0]} position={[0, 0.04, 0]} m="panelGray" radius={0.01} />
        <Box size={[CH.x1 - CH.x0, DECK_Y - 0.1, CH.z1 - CH.z0 - 0.02]} position={[0, 0.08 + (DECK_Y - 0.1) / 2, -0.01]} m="panel" radius={0.02} />
        {[-0.255, 0.255].map((x) => (
          <group key={x}>
            <Box size={[0.5, 0.66, 0.012]} position={[x, 0.47, CH.z1 - 0.01]} m="panelWarm" radius={0.008} />
            <Box size={[0.012, 0.16, 0.02]} position={[x + (x < 0 ? 0.21 : -0.21), 0.6, CH.z1 + 0.004]} m="steelSatin" radius={0.005} />
          </group>
        ))}
      </StandaloneOnly>
      {/* deck */}
      <Box size={[CH.x1 - CH.x0, 0.04, CH.z1 - CH.z0]} position={[0, DECK_Y - 0.02, 0]} m={WM.deck} radius={0.008} />
      {/* chamber: back, side walls and ceiling (front cut away) */}
      <Box size={[CH.x1 - CH.x0, CH.top - DECK_Y, 0.02]} position={[0, (CH.top + DECK_Y) / 2, CH.z0 + 0.01]} m={WM.inner} radius={0.004} />
      <Box size={[0.02, CH.top - DECK_Y, CH.z1 - CH.z0]} position={[CH.x0 + 0.01, (CH.top + DECK_Y) / 2, 0]} m={WM.inner} radius={0.004} />
      <Box size={[0.02, CH.top - DECK_Y, CH.z1 - CH.z0]} position={[CH.x1 - 0.01, (CH.top + DECK_Y) / 2, 0]} m={WM.inner} radius={0.004} />
      {/* roof over the rear half only (the front is cut away), with the filter face below it */}
      <Box size={[CH.x1 - CH.x0 + 0.02, 0.07, 0.46]} position={[0, CH.top + 0.035, CH.z0 + 0.22]} m="panel" radius={0.01} castShadow={false} />
      <Box size={[CH.x1 - CH.x0 - 0.04, 0.008, 0.4]} position={[0, CH.top - 0.004, CH.z0 + 0.22]} m="panelGray" radius={0.002} castShadow={false} />
      <Box size={[CH.x1 - CH.x0 + 0.02, 0.03, 0.03]} position={[0, CH.top + 0.015, 0]} m="steelSatin" radius={0.006} castShadow={false} />
      {/* wafer transfer shutter in the right wall */}
      <Box size={[0.012, 0.07, 0.36]} position={[CH.x1 - 0.022, DECK_Y + 0.13, 0.02]} m="steelSatin" radius={0.004} />
      <Box size={[0.006, 0.03, 0.32]} position={[CH.x1 - 0.029, DECK_Y + 0.13, 0.02]} m="black" radius={0.002} castShadow={false} />
      {/* chemical valve manifold on the back wall */}
      <Box size={[0.5, 0.05, 0.05]} position={[0, DECK_Y + 0.56, CH.z0 + 0.045]} m={WM.pvdf} radius={0.008} />
      <Cyl r={0.012} h={0.54} position={[0.3, DECK_Y + 0.29, CH.z0 + 0.045]} m={WM.pvdfDark} seg={16} />
      <Box size={[0.08, 0.03, 0.03]} position={[0.27, DECK_Y + 0.56, CH.z0 + 0.045]} m={WM.pvdfDark} radius={0.006} />
      {[-0.18, -0.06, 0.06, 0.18].map((x) => (
        <group key={x} position={[x, DECK_Y + 0.6, CH.z0 + 0.05]}>
          <Box size={[0.05, 0.04, 0.05]} m={WM.pvdf} radius={0.006} />
          <Cyl r={0.017} h={0.04} position={[0, 0.04, 0]} m="black" seg={20} />
          <mesh position={[0, -0.05, 0.012]} material={WM.pfa}>
            <cylinderGeometry args={[0.004, 0.004, 0.06, 8]} />
          </mesh>
        </group>
      ))}
      <StandaloneOnly>
        <LightTower position={[CH.x1 - 0.09, CH.top + 0.07, CH.z0 + 0.09]} on={cleanOn ? 'violet' : 'amber'} />
      </StandaloneOnly>

      <Cup />
      {/* spin base + wafer (spins together) */}
      <Cyl r={0.03} h={0.1} position={[0, DECK_Y + 0.02, 0]} m="steelDark" seg={24} />
      <group ref={spin} position={[0, BASE_Y, 0]}>
        <SpinBase />
        <Wafer anchor look={{ summary: state.wafer, showParticles: true }} position={[0, WAFER_Y - BASE_Y, 0]} size={768} />
        <mesh ref={film} position={[0, SURF_Y - BASE_Y + 0.0007, 0]} material={mats.film} visible={false}>
          <cylinderGeometry args={[0.1485, 0.1485, 0.0012, 72]} />
        </mesh>
      </group>
      <mesh ref={fling} position={[0, SURF_Y + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.fling} visible={false}>
        <ringGeometry args={[0.15, 0.215, 72, 1]} />
      </mesh>

      {/* chemical arm: spray nozzle and a megasonic transducer head */}
      <group position={[ARM_A.x, DECK_Y, ARM_A.z]}>
        <SwingArm len={LEN_A} h={ARM_A.h} armRef={armA}>
          <Box size={[0.05, 0.03, 0.034]} position={[-0.008, -0.004, 0]} m={WM.pvdf} radius={0.008} />
          <Cyl r={0.006} h={0.045} position={[0, -0.036, 0]} m="ceramic" seg={16} />
          <Cyl r={0.0035} h={0.012} position={[0, -0.063, 0]} m="black" seg={12} />
          <mesh ref={spray} position={[0, -0.069 - sprayH / 2, 0]} material={mats.spray} visible={false}>
            <cylinderGeometry args={[0.003, 0.032, sprayH, 28, 1, true]} />
          </mesh>
          {/* megasonic head trailing the nozzle, riding just above the liquid */}
          <group position={[-0.07, 0, 0.035]}>
            <Cyl r={0.006} h={ARM_A.h - (SURF_Y - DECK_Y) - 0.02} position={[0, -(ARM_A.h - (SURF_Y - DECK_Y)) / 2, 0]} m="steelSatin" seg={12} />
            <Box size={[0.06, 0.012, 0.03]} position={[0, -(ARM_A.h - (SURF_Y - DECK_Y)) + 0.012, 0]} m="black" radius={0.004} />
            <mesh ref={mega} position={[0, -(ARM_A.h - (SURF_Y - DECK_Y)) + 0.0035, 0]} material={MAT.water} visible={false}>
              <boxGeometry args={[0.07, 0.004, 0.04]} />
            </mesh>
          </group>
        </SwingArm>
      </group>
      {/* DI-water rinse arm */}
      <group position={[ARM_B.x, DECK_Y, ARM_B.z]}>
        <SwingArm len={LEN_B} h={ARM_B.h} armRef={armB}>
          <Box size={[0.04, 0.03, 0.03]} position={[-0.006, -0.004, 0]} m={WM.pvdf} radius={0.008} />
          <Cyl r={0.005} h={0.05} position={[0, -0.04, 0]} m="ceramic" seg={16} />
          <mesh ref={stream} position={[0, -0.065 - streamH / 2, 0]} material={mats.stream} visible={false}>
            <cylinderGeometry args={[0.0025, 0.0038, streamH, 12]} />
          </mesh>
          <mesh ref={splash} position={[0, -0.065 - streamH + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.spray} visible={false}>
            <ringGeometry args={[0.004, 0.02, 24]} />
          </mesh>
        </SwingArm>
      </group>
    </group>
  );
}
