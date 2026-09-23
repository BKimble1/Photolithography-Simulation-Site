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
import { makeLiveCoat, Wafer } from '../wafer/Wafer';
import type { ToolProps } from './index';
import { useRunChoices } from '../../state/presentation';

const MOD_X = { bake: -0.7, coat: 0, develop: 0.7, prime: 1.4 } as const;
type Mod = keyof typeof MOD_X;
const DECK_Y = 0.88;
/** The carrier block (wafers come out of their pod here) and the scanner interface block. */
const CARRIER_X = 1.95;
const IFACE_X = -1.15;
/** Wafer centre on the retracted fork: the robot runs along the front of the modules. */
const FORK_Z = 0.3;
/** Wafer height at rest: on a hot plate's proximity pins, or on a spin chuck in its cup. */
const REST: Record<Mod, number> = { bake: DECK_Y + 0.031, prime: DECK_Y + 0.031, coat: DECK_Y + 0.052, develop: DECK_Y + 0.052 };
/** Wafer height for an exchange: lifted on pins, or the chuck raised above the cup's rim. */
const XCHG: Record<Mod, number> = { bake: REST.bake + 0.014, prime: REST.prime + 0.014, coat: REST.coat + 0.075, develop: REST.develop + 0.075 };

/** Where a lesson's wafer comes from and which module it is processed in. */
interface Route {
  /** Where the robot waits at the start (where the previous lesson here parked it). */
  start: number;
  /** x of the source: a module (the wafer lies there) or an end block (it arrives on the fork). */
  from: number;
  fromMod: Mod | null;
  to: Mod;
  /** Where the robot parks after placing the wafer (clear of the module's view). */
  park: number;
  /** Share of the lesson the transfer takes. */
  window: number;
}

/** After placing, the robot backs off to the side, out of the camera's way. */
const parkBy = (m: Mod) => MOD_X[m] - 0.42;

export const ROUTES: Partial<Record<StepId, Route>> = {
  prime: { start: CARRIER_X, from: CARRIER_X, fromMod: null, to: 'prime', park: parkBy('prime'), window: 0.12 },
  coat: { start: parkBy('prime'), from: MOD_X.prime, fromMod: 'prime', to: 'coat', park: parkBy('coat'), window: 0.11 },
  softbake: { start: parkBy('coat'), from: MOD_X.coat, fromMod: 'coat', to: 'bake', park: parkBy('bake'), window: 0.15 },
  peb: { start: IFACE_X, from: IFACE_X, fromMod: null, to: 'bake', park: parkBy('bake'), window: 0.14 },
  develop: { start: parkBy('bake'), from: MOD_X.bake, fromMod: 'bake', to: 'develop', park: parkBy('develop'), window: 0.12 },
};

const ramp = (u: number, a: number, b: number) => ease(seg(u, a, b));

/**
 * The robot and wafer at progress p of a lesson: carriage x, fork reach (z) and height, where
 * the wafer is, and how far each module's chuck or pins are raised for the exchange.
 */
interface XferFrame {
  x: number;
  forkZ: number;
  forkY: number;
  /** Wafer centre (bottom face) in the tool frame. */
  wafer: [number, number, number];
  onFork: boolean;
  lift: Record<Mod, number>;
}

function transfer(r: Route, p: number, out: XferFrame): XferFrame {
  const u = seg(p, 0, r.window);
  const dst = r.to;
  const lift = out.lift;
  lift.bake = lift.coat = lift.develop = lift.prime = 0;
  const park = ramp(u, 0.9, 1);
  if (r.fromMod) {
    const src = r.fromMod;
    // approach; pick: raise the wafer, slide the fork under it, lift it off, withdraw
    const approach = ramp(u, 0, 0.12);
    const up = ramp(u, 0.04, 0.14) * (1 - ramp(u, 0.43, 0.5));
    lift[src] = up;
    const reach1 = ramp(u, 0.14, 0.26) * (1 - ramp(u, 0.31, 0.43));
    const take = ramp(u, 0.26, 0.31);
    // carry (the fork's height follows to the next exchange height), then place
    const go = ramp(u, 0.43, 0.62);
    lift[dst] = ramp(u, 0.5, 0.6) * (1 - ramp(u, 0.86, 0.96));
    const reach2 = ramp(u, 0.62, 0.74) * (1 - ramp(u, 0.8, 0.9));
    const put = ramp(u, 0.74, 0.8);
    out.x = u < 0.43 ? lerp(r.start, r.from, approach) : u < 0.9 ? lerp(r.from, MOD_X[dst], go) : lerp(MOD_X[dst], r.park, park);
    out.forkZ = lerp(FORK_Z, 0, Math.max(reach1, reach2));
    const ySrc = XCHG[src] - 0.006 + 0.008 * take;
    const yDst = XCHG[dst] + 0.002 - 0.008 * put;
    out.forkY = u < 0.43 ? ySrc : u < 0.62 ? lerp(ySrc, XCHG[dst] + 0.002, go) : yDst;
    out.onFork = u >= 0.285 && u < 0.77;
    if (u < 0.285) out.wafer = [MOD_X[src], lerp(REST[src], XCHG[src], lift[src]), 0];
    else if (out.onFork) out.wafer = [out.x, out.forkY, out.forkZ];
    else out.wafer = [MOD_X[dst], lerp(REST[dst], XCHG[dst], lift[dst]), 0];
  } else {
    // the wafer arrives on the fork from the carrier block or the scanner interface
    const go = ramp(u, 0, 0.42);
    lift[dst] = ramp(u, 0.2, 0.38) * (1 - ramp(u, 0.8, 0.95));
    const reach = ramp(u, 0.42, 0.58) * (1 - ramp(u, 0.66, 0.8));
    const put = ramp(u, 0.58, 0.66);
    out.x = u < 0.9 ? lerp(r.from, MOD_X[dst], go) : lerp(MOD_X[dst], r.park, park);
    out.forkZ = lerp(FORK_Z, 0, reach);
    out.forkY = XCHG[dst] + 0.002 - 0.008 * put;
    out.onFork = u < 0.62;
    out.wafer = out.onFork ? [out.x, out.forkY, out.forkZ] : [MOD_X[dst], lerp(REST[dst], XCHG[dst], lift[dst]), 0];
  }
  return out;
}

const makeFrame = (): XferFrame => ({ x: 0, forkZ: FORK_Z, forkY: DECK_Y + 0.06, wafer: [0, 0, 0], onFork: false, lift: { bake: 0, coat: 0, develop: 0, prime: 0 } });

/**
 * A spin profile (ramp up, hold, ramp down) as an angle at progress p, integrated analytically
 * (time in seconds = p·dur). The top speed is nudged (by less than a few per cent) so the
 * spin stops on a whole number of turns: the robot then picks the wafer up exactly as it lay
 * before the spin, and the next lesson starts from the same picture.
 */
function spinProfile(up0: number, up1: number, down0: number, down1: number, w: number, dur: number) {
  const a0 = up0 * dur,
    a1 = up1 * dur,
    b0 = down0 * dur,
    b1 = down1 * dur;
  const total = (a1 - a0) / 2 + (b0 - a1) + (b1 - b0) / 2;
  const turns = Math.max(1, Math.round((w * total) / (Math.PI * 2)));
  const wMax = (turns * Math.PI * 2) / total;
  return (p: number) => {
    const t = p * dur;
    let ang = 0;
    if (t > a0) ang += ((Math.min(t, a1) - a0) ** 2 / (2 * (a1 - a0))) * wMax;
    if (t > a1) ang += (Math.min(t, b0) - a1) * wMax;
    if (t > b0) {
      const tt = Math.min(t, b1) - b0;
      ang += wMax * tt - (tt * tt * wMax) / (2 * (b1 - b0));
    }
    return ang;
  };
}

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
  const coatSpin = useMemo(() => spinProfile(0.2, 0.3, 0.84, 0.97, 5 + 7 * sp.speedRel, 12), [sp.speedRel]);
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
    if (p < 0.14) Object.assign(live, { coverage: 0, nm: 0, edgeRise: 0, rim: 0, ebr: false });
    else if (p < 0.235) Object.assign(live, { coverage: 0.08 + 0.3 * seg(p, 0.14, 0.235), nm: 6000, edgeRise: 0, rim: 0, ebr: false });
    else if (p < 0.32) {
      const t = seg(p, 0.235, 0.32);
      Object.assign(live, { coverage: lerp(0.38, 1, ease(t)), nm: lerp(4000, 900, t), edgeRise: sp.edgeRise, rim: 1 - t * 0.4, ebr: false });
    } else {
      const t = seg(p, 0.32, 0.72);
      Object.assign(live, { coverage: 1, nm: finalNm * (1 + 2.8 * (1 - t) ** 2), edgeRise: sp.edgeRise, rim: 0.6 * (1 - t), ebr: p > 0.8 });
    }
  });
  // while the coat is going on, the texture shows the surface beneath it (the shader adds the film)
  const summary = coating ? { ...state.wafer, resist: null } : state.wafer;
  return (
    <group ref={place}>
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
  const coatSpin = useMemo(() => spinProfile(0.2, 0.3, 0.84, 0.97, 5 + 7 * sp.speedRel, 12), [sp.speedRel]);
  const chuck = useChuck('coat', route, coating ? coatSpin : null);
  const arm = useRef<THREE.Group>(null);
  const ebr = useRef<THREE.Group>(null);
  const stream = useRef<THREE.Mesh>(null);

  useProgressFrame((p) => {
    if (arm.current) {
      const out = coating ? smooth(p, 0.1, 0.15) * (1 - smooth(p, 0.23, 0.3)) : 0;
      arm.current.rotation.y = lerp(-1.25, 0, out);
    }
    if (ebr.current) {
      const out = coating ? smooth(p, 0.7, 0.76) * (1 - smooth(p, 0.84, 0.9)) : 0;
      ebr.current.rotation.y = lerp(1.2, 0.05, out);
    }
    if (stream.current) stream.current.visible = coating && p > 0.14 && p < 0.235;
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
  const [down0, down1] = id === 'peb' ? [0.3, 0.42] : [0.17, 0.29];
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
      const scan = developing ? seg(p, 0.14, 0.34) : 0;
      bar.current.position.z = lerp(-0.24, 0.24, scan);
      bar.current.visible = developing && p > 0.125 && p < 0.37;
    }
    if (puddle.current) {
      const grow = developing ? seg(p, 0.14, 0.34) : 0;
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
      const down = active ? smooth(p, 0.13, 0.25) * (1 - smooth(p, 0.82, 0.95)) : 0;
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
