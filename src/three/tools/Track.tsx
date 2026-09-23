/**
 * Coater/developer track: a row of process modules (bake plate, coat cup, develop cup,
 * vapour-prime chamber) under yellow-filtered light. Motion is a pure function of the step
 * progress, so replay and scrubbing are exact. The resist film colours are computed from
 * the film thickness (thin-film interference), including the spin-speed experiment.
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { spinModel } from '../../sim/flow';
import { RESIST_RECIPES } from '../../sim/ops';
import { useSimState, useStep } from '../../state/sim';
import { ease, lerp, seg, smooth, useProgressBucket, useProgressFrame } from '../anim';
import { MAT } from '../materials';
import { Bowl, Box, Chuck, Cyl, LightTower, NozzleArm } from '../kit/parts';
import { Wafer } from '../wafer/Wafer';
import type { CoatOverride } from '../wafer/waferTexture';
import type { ToolProps } from './index';
import { useRunChoices } from '../../state/presentation';

const MOD_X = { bake: -0.7, coat: 0, develop: 0.7, prime: 1.4 } as const;
const DECK_Y = 0.88;

/** Spin angle (rad) at progress p for a spin profile: ramp up, hold, ramp down. */
function spinAngle(p: number, up0: number, up1: number, down0: number, down1: number, wMax: number, dur: number) {
  // integrate a trapezoidal speed profile analytically (time in seconds = p·dur)
  const t = p * dur;
  const a0 = up0 * dur,
    a1 = up1 * dur,
    b0 = down0 * dur,
    b1 = down1 * dur;
  let ang = 0;
  if (t > a0) ang += (Math.min(t, a1) - a0) ** 2 / (2 * (a1 - a0)) * wMax;
  if (t > a1) ang += (Math.min(t, b0) - a1) * wMax;
  if (t > b0) {
    const tt = Math.min(t, b1) - b0;
    ang += wMax * tt - (tt * tt * wMax) / (2 * (b1 - b0));
  }
  return ang;
}

function ModuleShell({ x, label }: { x: number; label: string }) {
  return (
    <group position={[x, 0, 0]}>
      {/* back wall, side walls and ceiling of the module cell (front cut away) */}
      <Box size={[0.64, 0.62, 0.02]} position={[0, DECK_Y + 0.26, -0.33]} m="steelSatin" radius={0.004} />
      <Box size={[0.02, 0.62, 0.66]} position={[-0.33, DECK_Y + 0.26, 0]} m="steel" radius={0.004} />
      <Box size={[0.64, 0.03, 0.66]} position={[0, DECK_Y + 0.58, 0]} m="panel" radius={0.006} />
      {/* exhaust grille */}
      {Array.from({ length: 7 }, (_, i) => (
        <Box key={i} size={[0.5, 0.006, 0.01]} position={[0, DECK_Y + 0.52 - i * 0.018, -0.318]} m="black" radius={0.002} castShadow={false} />
      ))}
      <Box size={[0.12, 0.028, 0.004]} position={[0.2, DECK_Y + 0.12, -0.318]} m="label" radius={0.002} castShadow={false} />
      <mesh position={[0.2, DECK_Y + 0.12, -0.315]}>
        <planeGeometry args={[0.11, 0.02]} />
        <meshBasicMaterial color="#e9e6dc" toneMapped={false} transparent opacity={0.0} />
      </mesh>
      <group userData={{ label }} />
    </group>
  );
}

function CoatModule({ active }: { active: boolean }) {
  const state = useSimState();
  const spin = useRunChoices().spin;
  const bucket = useProgressBucket(60);
  const { id } = useStep();
  const sp = spinModel(spin);
  const finalNm = RESIST_RECIPES.fine.nm * sp.tRel;
  const coating = active && id === 'coat';
  const arm = useRef<THREE.Group>(null);
  const ebr = useRef<THREE.Group>(null);
  const waferSpin = useRef<THREE.Group>(null);
  const stream = useRef<THREE.Mesh>(null);

  // Wafer look during the coat animation (recomputed at coarse steps).
  const coat: CoatOverride | null = useMemo(() => {
    if (!coating) return null;
    const p = bucket;
    if (p < 0.1) return { coverage: 0, nm: 0, edgeRise: 0, rim: 0, ebr: false };
    if (p < 0.22) return { coverage: 0.08 + 0.3 * seg(p, 0.1, 0.22), nm: 6000, edgeRise: 0, rim: 0, ebr: false };
    if (p < 0.32) {
      const t = seg(p, 0.22, 0.32);
      return { coverage: lerp(0.38, 1, ease(t)), nm: lerp(4000, 900, t), edgeRise: sp.edgeRise, rim: 1 - t * 0.4, ebr: false };
    }
    const t = seg(p, 0.32, 0.72);
    const nm = finalNm * (1 + 2.8 * (1 - t) ** 2);
    return { coverage: 1, nm, edgeRise: sp.edgeRise, rim: 0.6 * (1 - t), ebr: p > 0.8 };
  }, [coating, bucket, finalNm, sp.edgeRise]);

  useProgressFrame((p) => {
    const running = coating;
    if (arm.current) {
      const out = running ? smooth(p, 0.0, 0.1) * (1 - smooth(p, 0.2, 0.3)) : 0;
      arm.current.rotation.y = lerp(-1.25, 0, out);
    }
    if (ebr.current) {
      const out = running ? smooth(p, 0.7, 0.76) * (1 - smooth(p, 0.84, 0.9)) : 0;
      ebr.current.rotation.y = lerp(1.2, 0.05, out);
    }
    if (stream.current) {
      const on = running && p > 0.1 && p < 0.22;
      stream.current.visible = on;
    }
    if (waferSpin.current) {
      const w = 5 + 7 * sp.speedRel; // visual rad/s (real spin is far faster)
      waferSpin.current.rotation.y = running ? spinAngle(p, 0.2, 0.3, 0.84, 0.97, w, 12) : 0;
    }
  });

  return (
    <group>
      <Bowl r={0.215} h={0.1} position={[0, DECK_Y, 0]} />
      <group ref={waferSpin} position={[0, DECK_Y + 0.052, 0]}>
        <Chuck radius={0.06} position={[0, -0.008, 0]} />
        {active && <Wafer anchor look={{ summary: state.wafer, showParticles: true, coat }} position={[0, 0, 0]} size={768} />}
      </group>
      {/* dispense arm with resist nozzle */}
      <group position={[-0.26, DECK_Y + 0.05, -0.18]}>
        <group ref={arm}>
          <Cyl r={0.011} h={0.14} position={[0, 0.07, 0]} m="steelDark" />
          <group position={[0, 0.16, 0]} rotation={[0, -0.6, 0]}>
            <Box size={[0.33, 0.012, 0.016]} position={[0.165, 0, 0]} m="steel" radius={0.005} />
            <Box size={[0.05, 0.022, 0.03]} position={[0.3, -0.004, 0]} m="panel" radius={0.006} />
            <Cyl r={0.005} h={0.06} position={[0.318, -0.035, 0]} m="chrome" />
            <mesh ref={stream} position={[0.318, -0.1, 0]} material={MAT.resistLiquid}>
              <cylinderGeometry args={[0.0022, 0.0035, 0.11, 12]} />
            </mesh>
          </group>
        </group>
      </group>
      {/* edge-bead-removal nozzle */}
      <group position={[0.27, DECK_Y + 0.05, 0.12]}>
        <group ref={ebr}>
          <Cyl r={0.008} h={0.1} position={[0, 0.05, 0]} m="steelDark" />
          <group position={[0, 0.11, 0]} rotation={[0, Math.PI - 0.35, 0]}>
            <Box size={[0.13, 0.009, 0.012]} position={[0.065, 0, 0]} m="steel" radius={0.004} />
            <Cyl r={0.0035} h={0.03} position={[0.125, -0.02, 0]} m="chrome" />
          </group>
        </group>
      </group>
    </group>
  );
}

function BakeModule({ active }: { active: boolean }) {
  const state = useSimState();
  const lid = useRef<THREE.Group>(null);
  useProgressFrame((p) => {
    if (!lid.current) return;
    const down = active ? smooth(p, 0.08, 0.22) * (1 - smooth(p, 0.8, 0.94)) : 0;
    lid.current.position.y = DECK_Y + lerp(0.34, 0.075, down);
  });
  return (
    <group position={[MOD_X.bake, 0, 0]}>
      <Cyl r={0.19} h={0.05} position={[0, DECK_Y + 0.0, 0]} m="aluminum" seg={72} />
      <Cyl r={0.2} h={0.02} position={[0, DECK_Y - 0.03, 0]} m="black" seg={72} />
      {/* proximity pins */}
      {[0, 2.1, 4.2].map((a) => (
        <Cyl key={a} r={0.004} h={0.006} position={[Math.cos(a) * 0.11, DECK_Y + 0.028, Math.sin(a) * 0.11]} m="ceramic" />
      ))}
      {active && <Wafer anchor look={{ summary: state.wafer, showParticles: true }} position={[0, DECK_Y + 0.031, 0]} size={768} />}
      <group ref={lid} position={[0, DECK_Y + 0.34, 0]}>
        <Cyl r={0.205} h={0.05} m="steelSatin" seg={72} />
        <Cyl r={0.03} h={0.06} position={[0, 0.05, 0]} m="steelDark" />
      </group>
      <Cyl r={0.012} h={0.5} position={[0, DECK_Y + 0.35, 0]} m="steelDark" />
    </group>
  );
}

function DevelopModule({ active }: { active: boolean }) {
  const state = useSimState();
  const { id } = useStep();
  const developing = active && id === 'develop';
  const bar = useRef<THREE.Group>(null);
  const puddle = useRef<THREE.Mesh>(null);
  const waferSpin = useRef<THREE.Group>(null);
  const rinse = useRef<THREE.Mesh>(null);
  useProgressFrame((p) => {
    if (bar.current) {
      const scan = developing ? seg(p, 0.08, 0.3) : 0;
      bar.current.position.z = lerp(-0.24, 0.24, scan);
      bar.current.visible = developing && p > 0.05 && p < 0.34;
    }
    if (puddle.current) {
      const grow = developing ? seg(p, 0.08, 0.3) : 0;
      const gone = developing ? smooth(p, 0.62, 0.8) : 1;
      puddle.current.visible = developing && grow > 0 && gone < 1;
      puddle.current.scale.set(1, 1, Math.max(0.001, grow));
      puddle.current.position.z = lerp(-0.075, 0, grow);
      (puddle.current.material as THREE.MeshPhysicalMaterial).opacity = 0.45 * (1 - gone);
    }
    if (rinse.current) rinse.current.visible = developing && p > 0.6 && p < 0.78;
    if (waferSpin.current) waferSpin.current.rotation.y = developing ? spinAngle(p, 0.58, 0.64, 0.9, 0.98, 10, 10) : 0;
  });
  return (
    <group position={[MOD_X.develop, 0, 0]}>
      <Bowl r={0.215} h={0.1} position={[0, DECK_Y, 0]} />
      <group ref={waferSpin} position={[0, DECK_Y + 0.052, 0]}>
        <Chuck radius={0.06} position={[0, -0.008, 0]} />
        {active && <Wafer anchor look={{ summary: state.wafer, showParticles: true, developedPattern: state.wafer.resist?.phase === 'developed' }} size={768} />}
      </group>
      <mesh ref={puddle} position={[0, DECK_Y + 0.056, 0]} rotation={[0, 0, 0]} visible={false} material={MAT.water.clone()}>
        <cylinderGeometry args={[0.15, 0.15, 0.004, 64]} />
      </mesh>
      {/* developer slit nozzle scanning across */}
      <group ref={bar} position={[0, DECK_Y + 0.085, -0.24]}>
        <Box size={[0.34, 0.018, 0.02]} m="panel" radius={0.006} />
        <Box size={[0.3, 0.004, 0.004]} position={[0, -0.011, 0]} m="black" radius={0.001} />
      </group>
      <NozzleArm position={[0.27, DECK_Y + 0.05, -0.16]} angle={Math.PI * 0.82} length={0.3} height={0.11} />
      <mesh ref={rinse} position={[0.0, DECK_Y + 0.1, 0.0]} visible={false} material={MAT.water}>
        <cylinderGeometry args={[0.002, 0.003, 0.09, 10]} />
      </mesh>
    </group>
  );
}

function PrimeModule({ active }: { active: boolean }) {
  const state = useSimState();
  const lid = useRef<THREE.Group>(null);
  const haze = useRef<THREE.Mesh>(null);
  useProgressFrame((p) => {
    if (lid.current) {
      const down = active ? smooth(p, 0.06, 0.2) * (1 - smooth(p, 0.82, 0.95)) : 0;
      lid.current.position.y = DECK_Y + lerp(0.3, 0.06, down);
    }
    if (haze.current) {
      const a = active ? seg(p, 0.25, 0.4) * (1 - seg(p, 0.7, 0.82)) : 0;
      haze.current.visible = a > 0.01;
      (haze.current.material as THREE.MeshBasicMaterial).opacity = 0.18 * a;
    }
  });
  return (
    <group position={[MOD_X.prime, 0, 0]}>
      <Cyl r={0.19} h={0.05} position={[0, DECK_Y, 0]} m="aluminum" seg={72} />
      <Cyl r={0.2} h={0.02} position={[0, DECK_Y - 0.03, 0]} m="black" seg={72} />
      {active && <Wafer anchor look={{ summary: state.wafer, showParticles: true }} position={[0, DECK_Y + 0.031, 0]} size={768} />}
      <mesh ref={haze} position={[0, DECK_Y + 0.06, 0]} visible={false}>
        <cylinderGeometry args={[0.18, 0.18, 0.05, 48]} />
        <meshBasicMaterial color="#fff3d6" transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={lid} position={[0, DECK_Y + 0.3, 0]}>
        <Cyl r={0.21} h={0.07} m="panel" seg={72} />
        <Cyl r={0.012} h={0.1} position={[0.14, 0.07, 0]} m="steelDark" />
      </group>
      <Cyl r={0.012} h={0.5} position={[0, DECK_Y + 0.35, 0]} m="steelDark" />
    </group>
  );
}

export default function Track({ variant }: ToolProps) {
  const active = (variant ?? 'coat') as keyof typeof MOD_X;
  return (
    <group>
      {/* deck, plinth and module row */}
      <Box size={[3.1, 0.06, 0.8]} position={[0.35, DECK_Y - 0.06, 0]} m="steelSatin" radius={0.01} />
      <Box size={[3.1, DECK_Y - 0.09, 0.78]} position={[0.35, (DECK_Y - 0.09) / 2, 0]} m="panel" radius={0.02} />
      {Array.from({ length: 4 }, (_, i) => (
        <Box key={i} size={[0.6, 0.5, 0.01]} position={[-0.7 + i * 0.7, 0.42, 0.395]} m="panelWarm" radius={0.01} />
      ))}
      <ModuleShell x={MOD_X.bake} label="Bake" />
      <ModuleShell x={MOD_X.coat} label="Coat" />
      <ModuleShell x={MOD_X.develop} label="Develop" />
      <ModuleShell x={MOD_X.prime} label="Prime" />
      <Box size={[0.02, 0.62, 0.66]} position={[1.73, DECK_Y + 0.26, 0]} m="steel" radius={0.004} />
      <group position={[MOD_X.coat, 0, 0]}>
        <CoatModule active={active === 'coat'} />
      </group>
      <BakeModule active={active === 'bake'} />
      <DevelopModule active={active === 'develop'} />
      <PrimeModule active={active === 'prime'} />
      <LightTower position={[1.6, DECK_Y + 0.6, -0.3]} on="violet" />
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color="#e4e1d8" roughness={0.5} />
      </mesh>
    </group>
  );
}
