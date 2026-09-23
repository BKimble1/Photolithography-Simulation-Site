/**
 * The stage: one persistent canvas for every mode (home, Learn, Explore, Watch).
 *
 * The world is the fab bay, in metres. Every machine stands at its station as a low-detail
 * proxy; the machines the story needs are also mounted as detailed models at the same place
 * and orientation, and the director hands over from proxy to model as the camera comes near.
 * The magnified cross-section lives in a separate device space (a portal scene) that the
 * director cross-fades to, anchored on your die. Nothing is torn down between steps or modes,
 * so camera moves are continuous and destination models are loaded before the camera leaves.
 */
import { CameraControls, ContactShadows, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { advance, Canvas, createPortal, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { DEMO_STEP, machineOfStep } from '../content/machines';
import { trackForIndex } from '../content/shots';
import { STEPS } from '../content/steps';
import { FLOW, STEP_INDEX } from '../sim/flow';
import { DEFAULT_CHOICES } from '../sim/types';
import { demoProgress, useDemo } from '../state/demo';
import type { MachineId } from '../state/nav';
import { fixedProgress, PresentationProvider, useLearnPresentation, type Presentation } from '../state/presentation';
import { useApp, useClock } from '../state/store';
import { useFilmPresentation } from '../watch/filmStage';
import { DeviceScene } from './device/DeviceScene';
import { LabelSpaceContext } from './labels';
import { readyStations, stationBoxes, stationCentre, stationGroups, toolMatrix } from './stage/anchors';
import { StationContext } from './stage/context';
import { BeatLabels } from './stage/BeatLabels';
import { Director } from './stage/Director';
import { stageFocus, useStageInfo } from './stage/info';
import { useExplore } from './stage/explore';
import { stageTime, TEST_HOOKS, VIRTUAL_TIME } from './stage/time';
import { toolComponent } from './tools';
import { cutAmount, cutOpen, FabScene, proxyHidden, type FabPicking } from './tools/Fab';

// ───────────────────────────── clocks ─────────────────────────────

/** Advances the lesson clock (Learn) and the demonstration clock (Explore). */
function ClockDriver() {
  useFrame((_, raw) => {
    const dt = stageTime.virtual ? stageTime.dt : Math.min(raw, 0.1);
    const a = useApp.getState();
    const speed = a.fast ? 6 : 1;
    if (a.mode === 'learn') {
      const c = useClock.getState();
      if (!c.playing) return;
      const dur = STEPS[FLOW[a.step].id].duration / speed;
      const p = Math.min(1, c.progress + dt / dur);
      useClock.setState({ progress: p, playing: p < 1 });
    } else if (a.mode === 'explore' && a.demo) {
      const d = useDemo.getState();
      if (!d.playing) return;
      if (d.progress >= 1) {
        // hold on the finished frame, then loop
        const hold = d.hold - dt;
        if (hold > 0) useDemo.setState({ hold });
        else useDemo.setState({ progress: 0, hold: 0 });
        return;
      }
      const dur = STEPS[FLOW[d.stepIndex].id].duration / speed;
      const p = Math.min(1, d.progress + dt / dur);
      useDemo.setState({ progress: p, hold: p >= 1 ? 2.5 : 0 });
    }
  });
  return null;
}

// ───────────────────────────── which machines are mounted ─────────────────────────────

interface Mount {
  id: MachineId;
  pres: Presentation;
  variant?: string;
}

const LRU_SIZE = 3;

const parkedCache = new Map<string, Presentation>();

/** An idle (or just-left) machine's presentation; cached so parked machines never re-render needlessly. */
function parkedPres(stepIndex: number, reducedMotion: boolean, progress = 0, parked = true): Presentation {
  const key = `${stepIndex}:${progress}:${parked}:${reducedMotion}`;
  let p = parkedCache.get(key);
  if (!p) parkedCache.set(key, (p = makeParked(stepIndex, reducedMotion, progress, parked)));
  return p;
}

function makeParked(stepIndex: number, reducedMotion: boolean, progress: number, parked: boolean): Presentation {
  return {
    kind: 'parked',
    stepIndex,
    choices: DEFAULT_CHOICES,
    progress: fixedProgress(progress),
    lightPath: false,
    xray: false,
    cutaway: true,
    finalInput: 0,
    reducedMotion,
    parked,
  };
}

/** The representative step a parked machine is shown at (its first lesson). */
function idleStep(id: MachineId): number {
  return STEP_INDEX[DEMO_STEP[id]];
}

function useDemoPresentation(): Presentation {
  const stepIndex = useDemo((s) => s.stepIndex);
  const reducedMotion = useApp((s) => s.reducedMotion);
  return useMemo(
    () => ({ kind: 'demo', stepIndex, choices: DEFAULT_CHOICES, progress: demoProgress, lightPath: false, xray: false, cutaway: true, finalInput: 1, reducedMotion }),
    [stepIndex, reducedMotion],
  );
}

/** Decide which detailed machines are mounted, and what each one shows. */
function useMounts(): { mounts: Mount[]; primary: Presentation | null; highlight: MachineId | undefined } {
  const mode = useApp((s) => s.mode);
  const step = useApp((s) => s.step);
  const machine = useApp((s) => s.machine);
  const demo = useApp((s) => s.demo);
  const reduced = useApp((s) => s.reducedMotion);
  const flying = useStageInfo((s) => s.flying);
  const learnPres = useLearnPresentation();
  const demoPres = useDemoPresentation();
  const film = useFilmPresentation();

  // The step we came from stays on show (at its end) until the camera has left it.
  const prev = useRef<{ step: number; mode: string } | null>(null);
  const cur = useRef({ step, mode });
  if (cur.current.step !== step || cur.current.mode !== mode) {
    prev.current = cur.current;
    cur.current = { step, mode };
  }
  const lru = useRef<MachineId[]>([]);

  return useMemo(() => {
    const out = new Map<MachineId, Mount>();
    let primary: Presentation | null = null;
    let highlight: MachineId | undefined;
    const add = (m: Mount) => {
      if (!out.has(m.id)) out.set(m.id, m);
    };
    if (mode === 'learn') {
      const st = machineOfStep(step);
      primary = learnPres;
      if (st) {
        add({ id: st, pres: learnPres, variant: STEPS[FLOW[step].id].variant });
        highlight = st;
      }
      const p = prev.current;
      if (flying && p && p.mode === 'learn') {
        const ps = machineOfStep(p.step);
        if (ps) add({ id: ps, pres: parkedPres(p.step, reduced, 1, false), variant: STEPS[FLOW[p.step].id].variant });
      }
      // preload the next lesson's machine
      if (step + 1 < FLOW.length) {
        const ns = machineOfStep(step + 1);
        if (ns) add({ id: ns, pres: parkedPres(step + 1, reduced), variant: STEPS[FLOW[step + 1].id].variant });
      }
    } else if (mode === 'explore') {
      if (machine) {
        const idx = demo ? demoPres.stepIndex : idleStep(machine);
        add({ id: machine, pres: demo ? demoPres : parkedPres(idx, reduced), variant: STEPS[FLOW[idx].id].variant });
        if (demo) primary = demoPres;
        highlight = machine;
      }
    } else if (mode === 'watch' && film) {
      primary = film.pres;
      for (const m of film.mounts) add(m);
      highlight = film.mounts[0]?.id;
    } else if (mode === 'home') {
      // warm up the machine the learner will start or resume at
      const st = machineOfStep(step);
      if (st) add({ id: st, pres: parkedPres(step, reduced), variant: STEPS[FLOW[step].id].variant });
    }
    // Recently used machines stay mounted (idle) so going back is instant.
    const keep = lru.current.filter((id) => !out.has(id));
    for (const id of out.keys()) lru.current = [id, ...lru.current.filter((x) => x !== id)].slice(0, LRU_SIZE + out.size);
    for (const id of keep.slice(0, LRU_SIZE)) add({ id, pres: parkedPres(idleStep(id), reduced), variant: STEPS[FLOW[idleStep(id)].id].variant });
    return { mounts: [...out.values()], primary, highlight };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, step, machine, demo, flying, learnPres, demoPres, film, reduced]);
}

/** Marks a station ready a couple of frames after its model has mounted (textures drawn). */
function Ready({ id }: { id: MachineId }) {
  const frames = useRef(0);
  useFrame(() => {
    if (frames.current < 3 && ++frames.current === 3) readyStations.add(id);
  });
  useEffect(
    () => () => {
      readyStations.delete(id);
    },
    [id],
  );
  return null;
}

function MountedStation({ id, pres, variant }: Mount) {
  const Tool = toolComponent(id);
  const placement = useMemo(() => {
    const m = toolMatrix(id);
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    m.decompose(pos, q, new THREE.Vector3());
    return { pos, q };
  }, [id]);
  const group = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    stationGroups.set(id, g);
    return () => {
      if (stationGroups.get(id) === g) stationGroups.delete(id);
    };
  }, [id]);
  const env = useMemo(() => ({ station: id, placed: true }), [id]);
  if (!Tool) return null;
  return (
    <group ref={group} position={placement.pos} quaternion={placement.q} visible={false}>
      <StationContext.Provider value={env}>
        <PresentationProvider value={pres}>
          <Suspense fallback={null}>
            <Tool variant={variant} />
            <Ready id={id} />
          </Suspense>
        </PresentationProvider>
      </StationContext.Provider>
    </group>
  );
}

// ───────────────────────────── world ─────────────────────────────

const WORLD_BG = '#eef0f2';
const WARM = new THREE.Color('#fff1d6');
const COOL = new THREE.Color('#ffffff');
const LITHO_BAY: MachineId[] = ['track', 'scanner'];

/** Key light and shadows follow the machine in focus; the litho bay is lit yellow. */
function WorldLighting() {
  const key = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const c = useMemo(() => new THREE.Vector3(), []);
  const warmth = useRef(0);
  const lastFocus = useRef<string>('');
  useFrame((_, dt) => {
    const k = key.current;
    if (!k) return;
    const f = stageFocus.station;
    if ((f ?? '') !== lastFocus.current) {
      lastFocus.current = f ?? '';
      if (f) stationCentre(f, c);
      else c.set(0, 0, 0);
      k.position.set(c.x + 3, 6, c.z + 4);
      target.position.set(c.x, 0.8, c.z);
      target.updateMatrixWorld();
      k.shadow.needsUpdate = true;
    }
    const want = f && LITHO_BAY.includes(f) ? 1 : 0;
    warmth.current += (want - warmth.current) * Math.min(1, dt * 2.5);
    k.color.copy(COOL).lerp(WARM, warmth.current);
    hemi.current?.color.copy(COOL).lerp(WARM, warmth.current * 0.8);
  });
  return (
    <>
      <primitive object={target} />
      <ambientLight intensity={0.12} />
      <hemisphereLight ref={hemi} args={['#ffffff', '#6b6f78', 0.35]} />
      <directionalLight
        ref={key}
        target={target}
        position={[3, 6, 4]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-4, 3, -2]} intensity={0.5} color="#dfe8ff" />
      {/* Studio environment: bright softboxes on a dark surround, so steel shows crisp
          reflections instead of a flat grey. */}
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#565a62']} />
        <Lightformer form="rect" intensity={3.4} color="#ffffff" position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[9, 9, 1]} />
        <Lightformer form="rect" intensity={2.4} color="#ffffff" position={[-5, 1.8, 1.5]} rotation={[0, Math.PI / 2, 0]} scale={[1.6, 7, 1]} />
        <Lightformer form="rect" intensity={2.0} color="#ffffff" position={[5, 2.2, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[1.6, 7, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#f2f4ff" position={[0, 1.6, 6]} rotation={[0, Math.PI, 0]} scale={[7, 1.2, 1]} />
        <Lightformer form="rect" intensity={1.0} color="#ffffff" position={[0, 1.2, -6]} rotation={[0, 0, 0]} scale={[8, 1.5, 1]} />
        <Lightformer form="ring" intensity={1.2} color="#ffffff" position={[3, 3.5, -4]} scale={1.6} />
      </Environment>
    </>
  );
}

function World({ mounts, highlight }: { mounts: Mount[]; highlight?: MachineId }) {
  const mode = useApp((s) => s.mode);
  const machine = useApp((s) => s.machine);
  const hovered = useExplore((s) => s.hovered);
  const picking = useMemo<FabPicking | undefined>(
    () =>
      mode === 'explore'
        ? {
            hovered,
            selected: machine,
            onHover: (id) => useExplore.getState().setHovered(id as MachineId | null),
            onSelect: (id) => {
              if (id === useApp.getState().machine) return;
              useApp.getState().navigate({ mode: 'explore', machine: id as MachineId });
            },
          }
        : undefined,
    [mode, hovered, machine],
  );
  return (
    <>
      <color attach="background" args={[WORLD_BG]} />
      <fog attach="fog" args={[WORLD_BG, 34, 110]} />
      <WorldLighting />
      <Suspense fallback={null}>
        <FabScene highlight={mode === 'home' ? undefined : highlight} hero={mode === 'home'} picking={picking} />
      </Suspense>
      {mounts.map((m) => (
        <MountedStation key={m.id} {...m} />
      ))}
    </>
  );
}

// ───────────────────────────── device space ─────────────────────────────

const DEVICE_BG = '#f0f0ee';

function DeviceLighting() {
  return (
    <>
      <color attach="background" args={[DEVICE_BG]} />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#ffffff', '#6b6f78', 0.5]} />
      <directionalLight
        position={[3, 6, 4]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={0.5}
        shadow-camera-far={24}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-4, 3, -2]} intensity={0.5} color="#dfe8ff" />
      <directionalLight position={[-2.5, 2.2, 7]} intensity={1.1} color="#ffffff" />
      <Environment resolution={128} frames={1}>
        <color attach="background" args={['#8a8d93']} />
        <Lightformer form="rect" intensity={3.4} position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[9, 9, 1]} />
        <Lightformer form="rect" intensity={2.4} position={[-5, 1.8, 1.5]} rotation={[0, Math.PI / 2, 0]} scale={[1.6, 7, 1]} />
        <Lightformer form="rect" intensity={2.0} position={[5, 2.2, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[1.6, 7, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#f2f4ff" position={[0, 1.6, 6]} rotation={[0, Math.PI, 0]} scale={[7, 1.2, 1]} />
        <Lightformer form="ring" intensity={1.6} color="#cfc8ff" position={[3, 3.5, -4]} scale={1.6} />
      </Environment>
    </>
  );
}

/** Whether a presentation's step ever shows the cross-section (so it is built in advance). */
function wantsDevice(stepIndex: number): boolean {
  return trackForIndex(stepIndex).some((k) => k.cam.kind === 'device');
}

function DeviceSpace({ scene, pres }: { scene: THREE.Scene; pres: Presentation | null }) {
  const override = useApp((s) => s.scaleOverride);
  const mode = useApp((s) => s.mode);
  const space = useStageInfo((s) => s.space);
  const show = !!pres && (space === 'device' || wantsDevice(pres.stepIndex) || (mode === 'learn' && override === 'device'));
  return createPortal(
    <LabelSpaceContext.Provider value="device">
      <DeviceLighting />
      {show && pres && (
        <PresentationProvider value={pres}>
          <Suspense fallback={null}>
            <DeviceScene />
          </Suspense>
          {/* the block's footprint never changes within a step: bake its soft ground shadow once */}
          <ContactShadows key={pres.stepIndex} frames={1} position={[0, -0.9, 0]} opacity={0.35} scale={12} blur={2.6} far={3} resolution={512} />
        </PresentationProvider>
      )}
    </LabelSpaceContext.Provider>,
    scene,
  );
}

// ───────────────────────────── the canvas ─────────────────────────────

export function Stage() {
  const deviceScene = useMemo(() => new THREE.Scene(), []);
  const controlsRef = useRef<CameraControls>(null);
  const { mounts, primary, highlight } = useMounts();
  // Start sharp; drop the pixel ratio on devices that can't hold the frame rate.
  const maxDpr = Math.min(2, window.devicePixelRatio || 1);
  const [dpr, setDpr] = useState(maxDpr);
  return (
    <Canvas
      shadows="percentage"
      frameloop={VIRTUAL_TIME ? 'never' : 'always'}
      dpr={dpr}
      gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      camera={{ fov: 34, near: 0.05, far: 400, position: [18.8, 2.3, 1.6] }}
      onCreated={({ gl }) => {
        // cutaway housings clip their own materials
        gl.localClippingEnabled = true;
      }}
      aria-hidden
    >
      <ClockDriver />
      <World mounts={mounts} highlight={highlight} />
      <DeviceSpace scene={deviceScene} pres={primary} />
      {primary && primary.kind !== 'watch' && (
        <PresentationProvider value={primary}>
          <BeatLabels />
        </PresentationProvider>
      )}
      <CameraControls
        ref={controlsRef}
        makeDefault
        smoothTime={0.35}
        draggingSmoothTime={0.12}
        maxPolarAngle={Math.PI * 0.49}
        dollySpeed={0.6}
        truckSpeed={0.8}
      />
      <Director deviceScene={deviceScene} controlsRef={controlsRef} />
      <PerformanceMonitor onDecline={() => setDpr(Math.max(1, maxDpr * 0.66))} onIncline={() => setDpr(maxDpr)} flipflops={3} onFallback={() => setDpr(1)} />
      {TEST_HOOKS && <DevHook deviceScene={deviceScene} />}
    </Canvas>
  );
}

/** Development and test harness only: expose the renderer and scenes for measurement scripts. */
function DevHook({ deviceScene }: { deviceScene: THREE.Scene }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    (window as unknown as { __fab: unknown }).__fab = { gl, scene, deviceScene, camera, THREE, readyStations, stationGroups, cutOpen, cutAmount, proxyHidden, stageFocus, useStageInfo, stationBoxes };
  }, [gl, scene, camera, deviceScene]);
  return null;
}

// Test and recording harness: render n frames of exactly 1/30 s each (only with ?virt=1).
if (VIRTUAL_TIME) {
  (window as unknown as { __fabAdvance: (n?: number) => number }).__fabAdvance = (n = 1) => {
    for (let i = 0; i < n; i++) {
      stageTime.t += stageTime.dt;
      stageTime.beforeFrame?.();
      advance(stageTime.t * 1000);
    }
    return stageTime.t;
  };
}
