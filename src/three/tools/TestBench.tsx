/**
 * Final test bench (illustrative): the moulded chip sits in an open test socket on a small
 * load board. A toggle switch drives the inverter's input and a green LED shows its output,
 * both driven by the electrical result of the simulated process (the same connectivity
 * test the device view uses). Click the switch to flip the input. Cables run to a small
 * bench tester that supplies VDD and reads the pins. Silkscreen marks name the switch and
 * the LED; nothing else is labelled.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { engine } from '../../state/sim';
import { useApp } from '../../state/store';
import { Box, Cyl } from '../kit/parts';
import { MAT } from '../materials';
import type { ToolProps } from './index';

type V3 = [number, number, number];

const BENCH_Y = 0.9; // ESD mat surface
const BOARD = { w: 0.22, d: 0.16, t: 0.0016, stand: 0.012 };
const BOARD_TOP = BENCH_Y + BOARD.stand + BOARD.t;
const LEAD_X = [-4.8, -1.6, 1.6, 4.8]; // mm, as on the package: VDD, IN, OUT, GND
const SW: V3 = [-0.068, BOARD_TOP, 0.042];
const LED: V3 = [0.068, BOARD_TOP, 0.042];
const SOCKET: V3 = [0, BOARD_TOP, -0.004];

// ───────────────────────────── load board artwork ─────────────────────────────

function boardTexture(): THREE.CanvasTexture {
  const W = 1100;
  const H = 800;
  const k = W / 220; // px per mm; board spans x ∈ [−110, 110], z ∈ [−80, 80]
  const X = (x: number) => (x + 110) * k;
  const Z = (z: number) => (z + 80) * k;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1d4636';
  ctx.fillRect(0, 0, W, H);
  // copper traces under the solder mask
  ctx.strokeStyle = '#24573f';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const trace = (pts: [number, number][], w = 1.6) => {
    ctx.lineWidth = w * k;
    ctx.beginPath();
    pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
    ctx.stroke();
  };
  // socket contacts at z = −32 (behind the package), x = lead positions
  trace([[-4.8, -34], [-4.8, -48], [-8, -56], [-8, -68]]); // VDD → connector
  trace([[4.8, -34], [4.8, -48], [8, -56], [8, -68]]); // GND → connector
  trace([[-1.6, -34], [-1.6, -42], [-30, -42], [-62, -10], [-62, 38], [-70, 45]]); // IN ← switch
  trace([[1.6, -34], [1.6, -40], [30, -40], [70, 0], [70, 14]]); // OUT → resistor
  trace([[70, 26], [70, 38]]); // resistor → LED
  trace([[-70, 52], [-70, 66], [-24, 66], [-12, -68]], 1.2); // switch pull-up to VDD
  trace([[70, 52], [70, 64], [16, 64], [4, -68]], 1.2); // LED return to GND
  // ground pour hatching near the connector
  ctx.fillStyle = 'rgba(45,106,80,0.5)';
  ctx.fillRect(X(-40), Z(-78), 80 * k, 6 * k);
  // exposed pads (gold)
  ctx.fillStyle = '#d4b066';
  for (const x of LEAD_X) ctx.fillRect(X(x - 0.9), Z(-35.5), 1.8 * k, 3 * k);
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 2; j++) {
      ctx.beginPath();
      ctx.arc(X(-10 + i * 5), Z(-70 + j * 5), 1.4 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  for (const [x, z] of [
    [-105, -75],
    [105, -75],
    [-105, 75],
    [105, 75],
  ]) {
    ctx.beginPath();
    ctx.arc(X(x), Z(z), 3.2 * k, 0, Math.PI * 2);
    ctx.fill();
  }
  // silkscreen
  ctx.strokeStyle = '#e6eee8';
  ctx.fillStyle = '#e6eee8';
  ctx.lineWidth = 0.5 * k;
  ctx.strokeRect(X(-22), Z(-30), 44 * k, 54 * k); // socket
  ctx.strokeRect(X(-78), Z(37), 16 * k, 16 * k); // switch
  ctx.beginPath();
  ctx.arc(X(70), Z(45), 4.2 * k, 0, Math.PI * 2); // LED
  ctx.stroke();
  ctx.strokeRect(X(66), Z(13), 8 * k, 14 * k); // resistor
  ctx.strokeRect(X(-14), Z(-74), 30 * k, 12 * k); // connector
  ctx.font = `600 ${7 * k}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('IN', X(-92), Z(45));
  ctx.fillText('OUT', X(70), Z(56));
  ctx.font = `600 ${4.2 * k}px Inter, Arial, sans-serif`;
  // switch positions: lever toward the front = 0, toward the back = 1
  ctx.fillText('0', X(-70), Z(59));
  ctx.fillText('1', X(-70), Z(24));
  ctx.fillText('VDD', X(-22), Z(-58));
  ctx.fillText('GND', X(24), Z(-58));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ───────────────────────────── parts ─────────────────────────────

const ledOff = new THREE.MeshPhysicalMaterial({ color: '#4f8f68', roughness: 0.12, metalness: 0, transparent: true, opacity: 0.8, clearcoat: 1 });
const ledOn = new THREE.MeshStandardMaterial({ color: '#b8ffd9', emissive: '#3ddc97', emissiveIntensity: 3.2, roughness: 0.2, toneMapped: false });
const glowMat = new THREE.MeshBasicMaterial({ color: '#3ddc97', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
const matMat = new THREE.MeshStandardMaterial({ color: '#5a6874', roughness: 0.92, metalness: 0 });
const moldMat = new THREE.MeshStandardMaterial({ color: '#17181b', roughness: 0.6, metalness: 0 });
const resistorMat = new THREE.MeshStandardMaterial({ color: '#d9c7a1', roughness: 0.6 });

function Cable({ points, r, m = 'rubber' }: { points: V3[]; r: number; m?: keyof typeof MAT | THREE.Material }) {
  const geo = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      points.map((q) => new THREE.Vector3(...q)),
      false,
      'centripetal',
    );
    return new THREE.TubeGeometry(curve, 64, r, 10, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points), r]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={typeof m === 'string' ? MAT[m] : m} castShadow receiveShadow />;
}

/** The moulded package (as it left the moulding step), leads trimmed, sitting in the socket. */
function Chip() {
  const body = useMemo(() => new RoundedBoxGeometry(0.0178, 0.0034, 0.0228, 2, 0.0005), []);
  useEffect(() => () => body.dispose(), [body]);
  return (
    <group>
      <mesh geometry={body} position={[0, 0.0017, 0]} material={moldMat} castShadow receiveShadow />
      <mesh position={[-0.0067, 0.00342, 0.0092]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.panelDark}>
        <circleGeometry args={[0.0009, 20]} />
      </mesh>
      {LEAD_X.map((x) => (
        <group key={x}>
          <mesh position={[x / 1000, 0.0011, -0.0114 - 0.0045]} material={MAT.steel} castShadow>
            <boxGeometry args={[0.0011, 0.0002, 0.009]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Open-top test socket with a hinged lid (open) and a row of spring contacts. */
function Socket() {
  return (
    <group position={SOCKET}>
      <Box size={[0.036, 0.006, 0.05]} position={[0, 0.003, -0.004]} m="black" radius={0.0012} />
      <Box size={[0.022, 0.0012, 0.027]} position={[0, 0.0061, 0.0]} m="panelDark" radius={0.0004} castShadow={false} />
      {/* contact block behind the package */}
      <Box size={[0.02, 0.004, 0.006]} position={[0, 0.008, -0.02]} m="panelDark" radius={0.0008} />
      {LEAD_X.map((x) => (
        <Box key={x} size={[0.0014, 0.0015, 0.004]} position={[x / 1000, 0.0105, -0.02]} m="gold" radius={0.0003} castShadow={false} />
      ))}
      {/* hinged lid, swung open toward the back */}
      <group position={[0, 0.006, -0.029]} rotation={[-1.95, 0, 0]}>
        <Box size={[0.036, 0.0035, 0.046]} position={[0, 0, 0.023]} m="black" radius={0.001} />
        <Box size={[0.016, 0.0015, 0.02]} position={[0, -0.0024, 0.025]} m="panelDark" radius={0.0005} castShadow={false} />
      </group>
      <Cyl r={0.0016} h={0.038} position={[0, 0.006, -0.029]} rotation={[0, 0, Math.PI / 2]} m="steel" seg={16} />
      {/* the chip in the nest, its leads over the contacts */}
      <group position={[0, 0.0062, 0.0]}>
        <Chip />
      </group>
    </group>
  );
}

/** PCB toggle switch; the bat lever tilts toward the selected input level. Clickable. */
function ToggleSwitch({ input }: { input: 0 | 1 }) {
  const lever = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    document.body.style.cursor = hover ? 'pointer' : '';
    return () => {
      document.body.style.cursor = '';
    };
  }, [hover]);
  // lever: 1 = tilted toward the back ("1" mark), 0 = toward the front ("0" mark)
  const target = input === 1 ? -0.42 : 0.42;
  useFrame((_, dt) => {
    if (!lever.current) return;
    const cur = lever.current.rotation.x;
    lever.current.rotation.x = cur + (target - cur) * Math.min(1, dt * 14);
  });
  const toggle = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const s = useApp.getState();
    s.setFinalInput(s.finalInput === 0 ? 1 : 0);
  };
  return (
    <group position={SW}>
      <Box size={[0.013, 0.009, 0.013]} position={[0, 0.0045, 0]} m="black" radius={0.001} />
      <Cyl r={0.0034} h={0.004} position={[0, 0.011, 0]} m="steel" seg={6} />
      <Cyl r={0.0026} h={0.004} position={[0, 0.015, 0]} m="steelSatin" seg={24} />
      <group ref={lever} position={[0, 0.0165, 0]} rotation={[target, 0, 0]}>
        <mesh position={[0, 0.0072, 0]} material={MAT.chrome} castShadow>
          <cylinderGeometry args={[0.0015, 0.0011, 0.0144, 16]} />
        </mesh>
        <mesh position={[0, 0.0146, 0]} material={MAT.chrome} castShadow>
          <sphereGeometry args={[0.0017, 16, 12]} />
        </mesh>
      </group>
      {/* generous invisible hit area */}
      <mesh
        position={[0, 0.014, 0]}
        onClick={toggle}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
      >
        <boxGeometry args={[0.03, 0.034, 0.034]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** 5 mm LED with a series resistor; lit only when the output is high. */
function OutputLed({ lit }: { lit: boolean }) {
  return (
    <group>
      <group position={LED}>
        <Cyl r={0.0029} h={0.001} position={[0, 0.0005, 0]} m={lit ? ledOn : ledOff} seg={24} />
        <mesh position={[0, 0.0035, 0]} material={lit ? ledOn : ledOff} castShadow>
          <cylinderGeometry args={[0.0025, 0.0025, 0.005, 24]} />
        </mesh>
        <mesh position={[0, 0.006, 0]} material={lit ? ledOn : ledOff} castShadow>
          <sphereGeometry args={[0.0025, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        {/* soft glow around the lit lens (no extra light: changing the light count would
            recompile every shader on each toggle) */}
        <mesh position={[0, 0.005, 0]} material={glowMat} visible={lit}>
          <sphereGeometry args={[0.0075, 20, 14]} />
        </mesh>
      </group>
      {/* series resistor */}
      <group position={[LED[0], BOARD_TOP, 0.02]}>
        <mesh position={[0, 0.0022, 0]} rotation={[Math.PI / 2, 0, 0]} material={resistorMat} castShadow>
          <cylinderGeometry args={[0.0017, 0.0017, 0.0068, 16]} />
        </mesh>
        {[-0.0022, -0.0008, 0.0006, 0.002].map((z, i) => (
          <mesh key={z} position={[0, 0.0022, z]} rotation={[Math.PI / 2, 0, 0]} material={i === 3 ? MAT.gold : MAT.panelDark}>
            <cylinderGeometry args={[0.00175, 0.00175, 0.0006, 16]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** A small bench tester (supply and pin monitor) behind the board. */
function Tester() {
  return (
    <group position={[0.25, BENCH_Y, -0.29]} rotation={[0, -0.3, 0]}>
      <Box size={[0.21, 0.085, 0.18]} position={[0, 0.0425, 0]} m="panel" radius={0.007} />
      <Box size={[0.2, 0.076, 0.006]} position={[0, 0.043, 0.09]} m="panelDark" radius={0.004} />
      <Box size={[0.08, 0.04, 0.004]} position={[-0.045, 0.052, 0.094]} m="screen" radius={0.002} castShadow={false} />
      {[0.022, 0.05, 0.078].map((x) => (
        <Cyl key={x} r={0.007} h={0.008} position={[x, 0.055, 0.096]} rotation={[Math.PI / 2, 0, 0]} m="steelSatin" seg={24} />
      ))}
      {[0.022, 0.05, 0.078].map((x) => (
        <Cyl key={x} r={0.0035} h={0.01} position={[x, 0.024, 0.096]} rotation={[Math.PI / 2, 0, 0]} m="black" seg={16} />
      ))}
      <Box size={[0.022, 0.009, 0.006]} position={[-0.07, 0.022, 0.095]} m="panelGray" radius={0.002} />
      <Box size={[0.022, 0.009, 0.006]} position={[-0.04, 0.022, 0.095]} m="panelGray" radius={0.002} />
    </group>
  );
}

// ───────────────────────────── scene ─────────────────────────────

export default function TestBench({ variant }: ToolProps) {
  void variant;
  const choices = useApp((s) => s.choices);
  const input = useApp((s) => s.finalInput);
  const e = useMemo(() => engine.electrical(choices), [choices]);
  const out = input === 0 ? e.out.in0 : e.out.in1;
  const lit = out === 1;
  const tex = useMemo(() => boardTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const lightTarget = useMemo(() => new THREE.Object3D(), []);

  return (
    <group>
      {/* floor and bench */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#e4e2dc" roughness={0.6} />
      </mesh>
      <Box size={[1.5, 0.04, 0.8]} position={[0, BENCH_Y - 0.024, -0.05]} m="panelWarm" radius={0.006} />
      {[-0.7, 0.7].map((x) => (
        <Box key={x} size={[0.05, BENCH_Y - 0.044, 0.7]} position={[x, (BENCH_Y - 0.044) / 2, -0.05]} m="steelSatin" radius={0.01} />
      ))}
      <mesh position={[0, BENCH_Y - 0.002, -0.05]} material={matMat} receiveShadow>
        <boxGeometry args={[1.2, 0.004, 0.66]} />
      </mesh>

      {/* local key light with a tight shadow frustum for these small parts */}
      <primitive object={lightTarget} position={[0, BENCH_Y, 0]} />
      <directionalLight
        position={[0.4, BENCH_Y + 0.9, 0.55]}
        target={lightTarget}
        intensity={0.9}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-0.4}
        shadow-camera-right={0.4}
        shadow-camera-top={0.4}
        shadow-camera-bottom={-0.4}
        shadow-camera-near={0.3}
        shadow-camera-far={2.2}
        shadow-bias={-0.0002}
        shadow-normalBias={0.0006}
      />

      {/* load board on standoffs */}
      {[
        [-0.1, -0.07],
        [0.1, -0.07],
        [-0.1, 0.07],
        [0.1, 0.07],
      ].map(([x, z]) => (
        <Cyl key={`${x},${z}`} r={0.003} h={BOARD.stand} position={[x, BENCH_Y + BOARD.stand / 2, z]} m="steel" seg={6} />
      ))}
      <mesh position={[0, BENCH_Y + BOARD.stand + BOARD.t / 2, 0]} material={MAT.pcb} castShadow receiveShadow>
        <boxGeometry args={[BOARD.w, BOARD.t, BOARD.d]} />
      </mesh>
      <mesh position={[0, BOARD_TOP + 0.00005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[BOARD.w, BOARD.d]} />
        <meshStandardMaterial map={tex} roughness={0.45} metalness={0.1} />
      </mesh>

      <Socket />
      <ToggleSwitch input={input} />
      <OutputLed lit={lit} />

      {/* connector with a ribbon cable to the tester, and two supply leads */}
      <Box size={[0.03, 0.009, 0.012]} position={[0.0, BOARD_TOP + 0.0045, -0.068]} m="black" radius={0.001} />
      <Cable points={[[0.0, BOARD_TOP + 0.009, -0.075], [0.03, BOARD_TOP + 0.02, -0.12], [0.1, BENCH_Y + 0.004, -0.19], [0.19, BENCH_Y + 0.025, -0.22]]} r={0.0022} m="panelGray" />
      <Cable points={[[-0.012, BOARD_TOP + 0.009, -0.074], [0.01, BOARD_TOP + 0.03, -0.13], [0.08, BENCH_Y + 0.006, -0.22], [0.18, BENCH_Y + 0.02, -0.235]]} r={0.0022} m="rubber" />
      <Tester />
    </group>
  );
}
