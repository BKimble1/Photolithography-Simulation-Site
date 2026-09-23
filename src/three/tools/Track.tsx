/**
 * Coater/developer track: a row of process modules (bake plate, coat cup, develop cup,
 * vapour-prime chamber) under yellow-filtered light, served by one transfer robot running
 * along the front. Motion is a pure function of the step progress, so replay and scrubbing
 * are exact. The resist film colours are computed from the film thickness (thin-film
 * interference), including the spin-speed experiment.
 *
 * One wafer: the learner's wafer is a single object that the robot carries from module to
 * module. Each lesson starts where the previous one on this machine left it (prime → coat →
 * soft bake; post-exposure bake → develop), and arrives from the carrier block or the scanner
 * interface when it comes from another machine. Spin chucks rise above their cup for the
 * exchange and hot plates lift the wafer on pins; spins stop on a whole turn, so the wafer
 * is picked up exactly as it lies.
 *
 * Reference-informed schematic, not an OEM layout: production tracks (e.g. the TEL
 * CLEAN TRACK and SCREEN SOKUDO families) stack many modules around a central robot and
 * connect directly to the scanner through an interface block. See ACCURACY.md.
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { StepId } from '../../sim/flow';
import { spinModel } from '../../sim/flow';
import { RESIST_RECIPES } from '../../sim/ops';
import { useSimState, useStep } from '../../state/sim';
import { ease, lerp, seg, smooth, useProgressFrame } from '../anim';
import { MAT } from '../materials';
import { Bowl, Box, Chuck, Cyl, LightTower, NozzleArm, StandaloneOnly } from '../kit/parts';
import { makeLiveCoat, Wafer, WaferFraming } from '../wafer/Wafer';
import type { ToolProps } from './index';
import { useRunChoices } from '../../state/presentation';

import { CARRIER_X, DECK_Y, IFACE_X, makeFrame, MOD_X, REST, ROUTES, spinProfile, transfer, XCHG, type Mod, type Route } from './trackMotion';

function ModuleShell({ x, label }: { x: number; label: string }) {
  return (
    <group position={[x, 0, 0]}>
      {/* back wall, side wall and ceiling of the module cell (the front, where the robot
          reaches in, is open) */}
      <Box size={[0.64, 0.62, 0.02]} position={[0, DECK_Y + 0.26, -0.33]} m="steelSatin" radius={0.004} />
      <Box size={[0.02, 0.62, 0.4]} position={[-0.33, DECK_Y + 0.26, -0.13]} m="steel" radius={0.004} />
      <Box size={[0.64, 0.03, 0.66]} position={[0, DECK_Y + 0.58, 0]} m="panel" radius={0.006} />
      {/* exhaust grille */}
      {Array.from({ length: 7 }, (_, i) => (
        <Box key={i} size={[0.5, 0.006, 0.01]} position={[0, DECK_Y + 0.52 - i * 0.018, -0.318]} m="black" radius={0.002} castShadow={false} />
      ))}
      <Box size={[0.12, 0.028, 0.004]} position={[0.2, DECK_Y + 0.12, -0.318]} m="label" radius={0.002} castShadow={false} />
      <group userData={{ label }} />
    </group>
  );
}

/** The transfer robot: a carriage on a rail along the front, a lifting column and a fork. */
function Robot({ route }: { route: Route }) {
  const carriage = useRef<THREE.Group>(null);
  const fork = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Mesh>(null);
  const f = useMemo(makeFrame, []);
  useProgressFrame((p) => {
    transfer(route, p, f);
    if (carriage.current) carriage.current.position.x = f.x;
    if (fork.current) fork.current.position.set(0, f.forkY, f.forkZ);
    if (arm.current) {
      // the arm reaches from the column (z 0.39) to the back of the fork
      const back = f.forkZ + 0.115;
      const len = Math.max(0.02, 0.4 - back);
      arm.current.scale.z = len;
      arm.current.position.set(0, f.forkY - 0.004, back + len / 2);
    }
  });
  return (
    <>
      {/* rail along the deck's front edge */}
      <Box size={[3.26, 0.02, 0.05]} position={[0.4, DECK_Y - 0.02, 0.37]} m="steelDark" radius={0.004} />
      <group ref={carriage}>
        <Box size={[0.13, 0.035, 0.07]} position={[0, DECK_Y + 0.005, 0.37]} m="panelGray" radius={0.008} />
        <Box size={[0.035, 0.16, 0.035]} position={[0, DECK_Y + 0.1, 0.4]} m="panel" radius={0.005} />
        <mesh ref={arm} material={MAT.steelSatin} castShadow>
          <boxGeometry args={[0.05, 0.008, 1]} />
        </mesh>
        <group ref={fork}>
          {/* end effector: two ceramic tines under the wafer, a base block behind it */}
          <Box size={[0.13, 0.01, 0.03]} position={[0, -0.005, 0.105]} m="black" radius={0.003} />
          {[-0.045, 0.045].map((x) => (
            <Box key={x} size={[0.018, 0.004, 0.2]} position={[x, -0.002, 0]} m="ceramic" radius={0.0015} />
          ))}
        </group>
      </group>
    </>
  );
}

/** The learner's wafer, wherever the robot has it; spinning with the chuck in a cup. */
function TrackWafer({ route, stepId }: { route: Route; stepId: StepId }) {
  const state = useSimState();
  const spin = useRunChoices().spin;
  const sp = spinModel(spin);
  const finalNm = RESIST_RECIPES.fine.nm * sp.tRel;
  const coating = stepId === 'coat';
  const developing = stepId === 'develop';
  const live = useMemo(makeLiveCoat, []);
  const coatSpin = useMemo(() => spinProfile(0.31, 0.39, 0.84, 0.97, 5 + 7 * sp.speedRel, 12), [sp.speedRel]);
  const devSpin = useMemo(() => spinProfile(0.58, 0.64, 0.9, 0.98, 10, 10), []);
  const place = useRef<THREE.Group>(null);
  const turn = useRef<THREE.Group>(null);
  const f = useMemo(makeFrame, []);
  useProgressFrame((p) => {
    transfer(route, p, f);
    place.current?.position.set(f.wafer[0], f.wafer[1], f.wafer[2]);
    if (turn.current) turn.current.rotation.y = coating ? coatSpin(p) : developing ? devSpin(p) : 0;
    // the coat going on (presentation interpolation between the process model's states; it
    // ends on the simulated film at the coat operation, p = 0.72)
    live.on = coating;
    if (!coating) return;
    if (p < 0.23) Object.assign(live, { coverage: 0, nm: 0, edgeRise: 0, rim: 0, ebr: false });
    else if (p < 0.32) Object.assign(live, { coverage: 0.08 + 0.3 * seg(p, 0.23, 0.32), nm: 6000, edgeRise: 0, rim: 0, ebr: false });
    else if (p < 0.4) {
      const t = seg(p, 0.32, 0.4);
      Object.assign(live, { coverage: lerp(0.38, 1, ease(t)), nm: lerp(4000, 900, t), edgeRise: sp.edgeRise, rim: 1 - t * 0.4, ebr: false });
    } else {
      const t = seg(p, 0.4, 0.72);
      Object.assign(live, { coverage: 1, nm: finalNm * (1 + 2.8 * (1 - t) ** 2), edgeRise: sp.edgeRise, rim: 0.6 * (1 - t), ebr: p > 0.8 });
    }
  });
  // while the coat is going on, the texture shows the surface beneath it (the shader adds the film)
  const summary = coating ? { ...state.wafer, resist: null } : state.wafer;
  return (
    <group ref={place}>
      {/* shots frame the wafer where it is, but do not turn with the spin */}
      <WaferFraming />
      <group ref={turn}>
        <Wafer anchor look={{ summary, showParticles: true, developedPattern: developing && state.wafer.resist?.phase === 'developed' }} live={coating ? live : undefined} size={768} />
      </group>
    </group>
  );
}

/** A spin chuck that rises above its cup for an exchange and turns with the wafer. */
function useChuck(mod: 'coat' | 'develop', route: Route, spinAt: ((p: number) => number) | null) {
  const g = useRef<THREE.Group>(null);
  const f = useMemo(makeFrame, []);
  useProgressFrame((p) => {
    transfer(route, p, f);
    if (!g.current) return;
    g.current.position.y = lerp(REST[mod], XCHG[mod], f.lift[mod]);
    g.current.rotation.y = spinAt ? spinAt(p) : 0;
  });
  return g;
}

function CoatModule({ route, active }: { route: Route; active: boolean }) {
  const { id } = useStep();
  const spin = useRunChoices().spin;
  const sp = spinModel(spin);
  const coating = active && id === 'coat';
  const coatSpin = useMemo(() => spinProfile(0.31, 0.39, 0.84, 0.97, 5 + 7 * sp.speedRel, 12), [sp.speedRel]);
  const chuck = useChuck('coat', route, coating ? coatSpin : null);
  const arm = useRef<THREE.Group>(null);
  const ebr = useRef<THREE.Group>(null);
  const stream = useRef<THREE.Mesh>(null);

  useProgressFrame((p) => {
    if (arm.current) {
      const out = coating ? smooth(p, 0.19, 0.24) * (1 - smooth(p, 0.32, 0.38)) : 0;
      arm.current.rotation.y = lerp(-1.25, 0, out);
    }
    if (ebr.current) {
      const out = coating ? smooth(p, 0.7, 0.76) * (1 - smooth(p, 0.84, 0.9)) : 0;
      ebr.current.rotation.y = lerp(1.2, 0.05, out);
    }
    if (stream.current) stream.current.visible = coating && p > 0.23 && p < 0.32;
  });

  return (
    <group>
      <Bowl r={0.215} h={0.1} position={[0, DECK_Y, 0]} />
      <group ref={chuck} position={[0, REST.coat, 0]}>
        <Chuck radius={0.06} position={[0, -0.008, 0]} />
      </group>
      {/* dispense arm with resist nozzle */}
      <group position={[-0.26, DECK_Y + 0.05, -0.18]}>
        <group ref={arm}>
          <Cyl r={0.011} h={0.14} position={[0, 0.07, 0]} m="steelDark" />
          <group position={[0, 0.16, 0]} rotation={[0, -0.6, 0]}>
            <Box size={[0.33, 0.012, 0.016]} position={[0.165, 0, 0]} m="steel" radius={0.005} />
            <Box size={[0.05, 0.022, 0.03]} position={[0.3, -0.004, 0]} m="panel" radius={0.006} />
            <Cyl r={0.005} h={0.06} position={[0.318, -0.035, 0]} m="chrome" />
            <mesh ref={stream} position={[0.318, -0.1, 0]} material={MAT.resistLiquid} visible={false}>
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

/** Three ceramic lift pins that raise the wafer off a hot plate for the robot. */
function LiftPins({ mod, route }: { mod: 'bake' | 'prime'; route: Route }) {
  const g = useRef<THREE.Group>(null);
  const f = useMemo(makeFrame, []);
  useProgressFrame((p) => {
    transfer(route, p, f);
    if (g.current) g.current.position.y = lerp(REST[mod] - 0.014, XCHG[mod] - 0.014, f.lift[mod]);
  });
  return (
    <group ref={g} position={[0, REST[mod] - 0.014, 0]}>
      {[0.5, 2.6, 4.7].map((a) => (
        <Cyl key={a} r={0.0035} h={0.014} position={[Math.cos(a) * 0.07, 0.007, Math.sin(a) * 0.07]} m="ceramic" seg={12} />
      ))}
    </group>
  );
}

function BakeModule({ route, active }: { route: Route; active: boolean }) {
  const { id } = useStep();
  const lid = useRef<THREE.Group>(null);
  // soft bake closes as soon as the wafer is down; the post-exposure bake waits until the
  // camera has gone into the layers
  const [down0, down1] = id === 'peb' ? [0.3, 0.42] : [0.27, 0.39];
  useProgressFrame((p) => {
    if (!lid.current) return;
    const down = active ? smooth(p, down0, down1) * (1 - smooth(p, 0.8, 0.94)) : 0;
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
      <LiftPins mod="bake" route={route} />
      <group ref={lid} position={[0, DECK_Y + 0.34, 0]}>
        <Cyl r={0.205} h={0.05} m="steelSatin" seg={72} />
        <Cyl r={0.03} h={0.06} position={[0, 0.05, 0]} m="steelDark" />
      </group>
      <Cyl r={0.012} h={0.5} position={[0, DECK_Y + 0.35, 0]} m="steelDark" />
    </group>
  );
}

function DevelopModule({ route, active }: { route: Route; active: boolean }) {
  const { id } = useStep();
  const developing = active && id === 'develop';
  const devSpin = useMemo(() => spinProfile(0.58, 0.64, 0.9, 0.98, 10, 10), []);
  const chuck = useChuck('develop', route, developing ? devSpin : null);
  const bar = useRef<THREE.Group>(null);
  const puddle = useRef<THREE.Mesh>(null);
  const rinse = useRef<THREE.Mesh>(null);
  const water = useMemo(() => MAT.water.clone(), []);
  useProgressFrame((p) => {
    if (bar.current) {
      const scan = developing ? seg(p, 0.23, 0.43) : 0;
      bar.current.position.z = lerp(-0.24, 0.24, scan);
      bar.current.visible = developing && p > 0.22 && p < 0.46;
    }
    if (puddle.current) {
      const grow = developing ? seg(p, 0.23, 0.43) : 0;
      const gone = developing ? smooth(p, 0.62, 0.8) : 1;
      puddle.current.visible = developing && grow > 0 && gone < 1;
      puddle.current.scale.set(1, 1, Math.max(0.001, grow));
      puddle.current.position.z = lerp(-0.075, 0, grow);
      water.opacity = 0.45 * (1 - gone);
    }
    if (rinse.current) rinse.current.visible = developing && p > 0.6 && p < 0.78;
  });
  return (
    <group position={[MOD_X.develop, 0, 0]}>
      <Bowl r={0.215} h={0.1} position={[0, DECK_Y, 0]} />
      <group ref={chuck} position={[0, REST.develop, 0]}>
        <Chuck radius={0.06} position={[0, -0.008, 0]} />
      </group>
      <mesh ref={puddle} position={[0, DECK_Y + 0.056, 0]} visible={false} material={water}>
        <cylinderGeometry args={[0.15, 0.15, 0.004, 64]} />
      </mesh>
      {/* developer slit nozzle scanning across */}
      <group ref={bar} position={[0, DECK_Y + 0.085, -0.24]} visible={false}>
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

function PrimeModule({ route, active }: { route: Route; active: boolean }) {
  const lid = useRef<THREE.Group>(null);
  const haze = useRef<THREE.Mesh>(null);
  useProgressFrame((p) => {
    if (lid.current) {
      const down = active ? smooth(p, 0.17, 0.29) * (1 - smooth(p, 0.82, 0.95)) : 0;
      lid.current.position.y = DECK_Y + lerp(0.3, 0.06, down);
    }
    if (haze.current) {
      const a = active ? seg(p, 0.3, 0.44) * (1 - seg(p, 0.7, 0.82)) : 0;
      haze.current.visible = a > 0.01;
      (haze.current.material as THREE.MeshBasicMaterial).opacity = 0.18 * a;
    }
  });
  return (
    <group position={[MOD_X.prime, 0, 0]}>
      <Cyl r={0.19} h={0.05} position={[0, DECK_Y, 0]} m="aluminum" seg={72} />
      <Cyl r={0.2} h={0.02} position={[0, DECK_Y - 0.03, 0]} m="black" seg={72} />
      <LiftPins mod="prime" route={route} />
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
  const { id } = useStep();
  const active = (variant ?? 'coat') as Mod;
  // a lesson at another machine (the track idle) keeps the robot where the coat lesson starts
  const route = ROUTES[id] ?? ROUTES.coat!;
  return (
    <group>
      {/* deck, plinth and module row */}
      <Box size={[3.26, 0.06, 0.8]} position={[0.4, DECK_Y - 0.06, 0]} m="steelSatin" radius={0.01} />
      <Box size={[3.26, DECK_Y - 0.09, 0.78]} position={[0.4, (DECK_Y - 0.09) / 2, 0]} m="panel" radius={0.02} />
      {Array.from({ length: 4 }, (_, i) => (
        <Box key={i} size={[0.6, 0.5, 0.01]} position={[-0.7 + i * 0.7, 0.42, 0.395]} m="panelWarm" radius={0.01} />
      ))}
      <ModuleShell x={MOD_X.bake} label="Bake" />
      <ModuleShell x={MOD_X.coat} label="Coat" />
      <ModuleShell x={MOD_X.develop} label="Develop" />
      <ModuleShell x={MOD_X.prime} label="Prime" />
      <Box size={[0.02, 0.62, 0.4]} position={[1.73, DECK_Y + 0.26, -0.13]} m="steel" radius={0.004} />
      {/* carrier block (right) and scanner interface (left): where wafers enter and leave */}
      <Box size={[0.3, 0.1, 0.5]} position={[CARRIER_X, DECK_Y + 0.02, -0.12]} m="panelGray" radius={0.01} />
      <Box size={[0.2, 0.34, 0.5]} position={[IFACE_X - 0.06, DECK_Y + 0.14, -0.12]} m="panelGray" radius={0.01} />
      <CoatModule route={route} active={active === 'coat'} />
      <BakeModule route={route} active={active === 'bake'} />
      <DevelopModule route={route} active={active === 'develop'} />
      <PrimeModule route={route} active={active === 'prime'} />
      <Robot route={route} />
      {ROUTES[id] && <TrackWafer route={route} stepId={id} />}
      <LightTower position={[1.6, DECK_Y + 0.6, -0.3]} on="violet" />
      {/* floor */}
      <StandaloneOnly>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[14, 14]} />
          <meshStandardMaterial color="#e4e1d8" roughness={0.5} />
        </mesh>
      </StandaloneOnly>
    </group>
  );
}
