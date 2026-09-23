/**
 * The stage: one persistent canvas for every mode (home, Learn, Explore, Watch).
 *
 * The world is the fab bay, in metres. Every machine stands at its station as a low-detail
 * proxy; the machines the story needs are also mounted as detailed models at the same place
 * and orientation, and the director hands over from proxy to model as the camera comes near.
 * The magnified cross-section lives in a separate device space (a portal scene) that the
 * director cross-fades to, anchored on your die. Nothing is torn down between steps or modes,
 * so camera moves are continuous and destination models are loaded before the camera leaves.
 *
 * A machine the story leaves keeps showing exactly what it showed (its lesson, choices,
 * overlays and progress, frozen) until it is out of view; see stage/handover.ts.
 */
import { CameraControls, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { advance, Canvas, createPortal, useFrame, useThree } from '@react-three/fiber';
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { filmPlayer, useFilm } from '../watch/film';
import { gapStats, useFilmPresentation } from '../watch/filmStage';
import { DeviceScene } from './device/DeviceScene';
import { deviceMeshes } from './device/deviceGeometry';
import { LabelSpaceContext } from './labels';
import { failedStations, readyStations, stationBoxes, stationCentre, stationGroups, toolMatrix, waferRegistry } from './stage/anchors';
import { StationContext } from './stage/context';
import { BeatLabels } from './stage/BeatLabels';
import { Director } from './stage/Director';
import { handover, remount, useMountEpoch } from './stage/handover';
import { stageFocus, useStageInfo } from './stage/info';
import { useExplore } from './stage/explore';
import { DIAG, initialTier, quality, stepTier, TIERS, useQuality } from './stage/quality';
import { stageTime, TEST_HOOKS, VIRTUAL_TIME } from './stage/time';
import { toolComponent } from './tools';
import { cutAmount, cutOpen, FabScene, proxyHidden, type FabPicking } from './tools/Fab';

// ───────────────────────────── clocks ─────────────────────────────

/**
 * Advances the lesson clock (Learn) and the demonstration clock (Explore), and sets the
 * decorative time for the frame. Progress is measured from when playback (re)started on the
 * stage clock, not accumulated frame by frame, so a slow frame never slows a lesson down and
 * a hidden page resumes where it was.
 */
function ClockDriver() {
  const base = useRef({ learn: { p: -1, t: 0, dur: 0, wrote: -1 }, demo: { p: -1, t: 0, dur: 0, wrote: -1 } });
  useFrame(() => {
    const now = stageTime.clock() / 1000;
    const a = useApp.getState();
    // decorative motion: the film's own time while the film is on screen, else the stage clock
    const film = a.mode === 'watch' ? filmPlayer() : null;
    stageTime.decor = film ? film.now() : now;
    const speed = a.fast ? 6 : 1;
    const b = base.current;
    if (a.mode === 'learn') {
      const c = useClock.getState();
      const L = b.learn;
      if (!c.playing) {
        L.p = -1;
        return;
      }
      const dur = STEPS[FLOW[a.step].id].duration / speed;
      // (re)anchor when playback starts, the learner scrubs, the step or the speed changes
      if (L.p < 0 || c.progress !== L.wrote || dur !== L.dur) {
        L.p = c.progress;
        L.t = now;
        L.dur = dur;
      }
      const p = Math.min(1, L.p + (now - L.t) / dur);
      L.wrote = p;
      useClock.setState({ progress: p, playing: p < 1 });
    } else if (a.mode === 'explore' && a.demo) {
      const d = useDemo.getState();
      const D = b.demo;
      if (!d.playing) {
        D.p = -1;
        return;
      }
      const dur = STEPS[FLOW[d.stepIndex].id].duration / speed;
      if (d.progress >= 1) {
        // hold on the finished frame, then loop
        if (D.p !== 1) {
          D.p = 1;
          D.t = now;
        }
        if (now - D.t >= 2.5) {
          D.p = -1;
          useDemo.setState({ progress: 0, hold: 0 });
        }
        return;
      }
      if (D.p < 0 || D.p === 1 || d.progress !== D.wrote || dur !== D.dur) {
        D.p = d.progress;
        D.t = now;
        D.dur = dur;
      }
      const p = Math.min(1, D.p + (now - D.t) / dur);
      D.wrote = p;
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
/** At most this many machines are held frozen at once (the oldest is released first). */
const MAX_FROZEN = 2;

const parkedCache = new Map<string, Presentation>();

/** An idle machine's presentation; cached so parked machines never re-render needlessly. */
function parkedPres(stepIndex: number, reducedMotion: boolean): Presentation {
  const key = `${stepIndex}:${reducedMotion}`;
  let p = parkedCache.get(key);
  if (!p)
    parkedCache.set(
      key,
      (p = {
        kind: 'parked',
        stepIndex,
        choices: DEFAULT_CHOICES,
        progress: fixedProgress(0),
        lightPath: false,
        xray: false,
        cutaway: true,
        finalInput: 0,
        reducedMotion,
        parked: true,
      }),
    );
  return p;
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

/** What each mounted machine showed in the last rendered frame: its presentation and progress. */
const shownState = new Map<MachineId, { pres: Presentation; p: number }>();

/** Machines the story has left, frozen on the last frame they showed until out of view. */
const frozen = new Map<MachineId, Mount>();

function shownProgress(m: Mount): number {
  const s = shownState.get(m.id);
  return s && s.pres === m.pres ? s.p : m.pres.progress.get();
}

/** The presentation a machine showed, held still: the same lesson, run, overlays and progress. */
function freeze(m: Mount): Mount {
  if (m.pres.frozen) return m;
  return { id: m.id, variant: m.variant, pres: { ...m.pres, progress: fixedProgress(shownProgress(m)), setFinalInput: undefined, frozen: true } };
}

/**
 * Whether a machine can go from showing `prev` to showing `next` without a visible jump: the
 * same lesson carrying on (a choice or overlay changed), the film's own timeline, or the next
 * lesson on the same machine after this one finished (each tool ends one lesson where the
 * next one starts). Anything else is dissolved by the director.
 */
function continuous(prev: Mount, next: Mount): boolean {
  const a = prev.pres;
  const b = next.pres;
  if (a.kind !== b.kind) return false;
  if (b.kind === 'watch') return true;
  const pa = shownProgress(prev);
  const pb = b.progress.get();
  if (a.stepIndex === b.stepIndex) return Math.abs(pa - pb) < 0.02;
  return b.kind === 'learn' && b.stepIndex === a.stepIndex + 1 && pa >= 0.999 && pb <= 0.001;
}

/** Decide which detailed machines are mounted, and what each one shows. */
function useMounts(): { mounts: Mount[]; primary: Presentation | null; highlight: MachineId | undefined } {
  const mode = useApp((s) => s.mode);
  const step = useApp((s) => s.step);
  const machine = useApp((s) => s.machine);
  const demo = useApp((s) => s.demo);
  const reduced = useApp((s) => s.reducedMotion);
  const epoch = useMountEpoch((s) => s.n);
  const learnPres = useLearnPresentation();
  const demoPres = useDemoPresentation();
  const film = useFilmPresentation();

  /** The machines presenting the story at the last computation (not idle ones). */
  const live = useRef(new Map<MachineId, Mount>());
  const lru = useRef<MachineId[]>([]);

  return useMemo(() => {
    const now = new Map<MachineId, Mount>();
    const idle = new Map<MachineId, Mount>();
    let primary: Presentation | null = null;
    let highlight: MachineId | undefined;
    const addLive = (m: Mount) => {
      if (!now.has(m.id)) now.set(m.id, m);
    };
    const addIdle = (id: MachineId, stepIndex: number) => {
      if (!idle.has(id)) idle.set(id, { id, pres: parkedPres(stepIndex, reduced), variant: STEPS[FLOW[stepIndex].id].variant });
    };
    if (mode === 'learn') {
      const st = machineOfStep(step);
      primary = learnPres;
      if (st) {
        addLive({ id: st, pres: learnPres, variant: STEPS[FLOW[step].id].variant });
        highlight = st;
      }
      // preload the next lesson's machine
      if (step + 1 < FLOW.length) {
        const ns = machineOfStep(step + 1);
        if (ns) addIdle(ns, step + 1);
      }
    } else if (mode === 'explore') {
      if (machine) {
        if (demo) {
          addLive({ id: machine, pres: demoPres, variant: STEPS[FLOW[demoPres.stepIndex].id].variant });
          primary = demoPres;
        } else addIdle(machine, idleStep(machine));
        highlight = machine;
      }
    } else if (mode === 'watch' && film) {
      primary = film.pres;
      for (const m of film.mounts) addLive(m);
      highlight = film.mounts[0]?.id;
    } else if (mode === 'home') {
      // warm up the machine the learner will start or resume at
      const st = machineOfStep(step);
      if (st) addIdle(st, step);
    }

    // ── hand-overs ──
    const before = live.current;
    live.current = now;
    for (const [id, m] of before) {
      const next = now.get(id);
      if (next && next.pres === m.pres && next.variant === m.variant) continue;
      if (!next) frozen.set(id, freeze(m));
      else if (!continuous(m, next)) {
        // the same machine must show something else: hold its last frame until the director
        // has captured it, then dissolve (see Director)
        frozen.set(id, freeze(m));
        handover.swap = { id, captured: false, committed: false };
      }
    }
    // a machine taken up again after being left (from home, say) is dissolved too
    for (const [id, next] of now) {
      const f = frozen.get(id);
      if (!f) continue;
      const gated = handover.swap?.id === id && !handover.swap.captured;
      if (gated) continue;
      if (!before.has(id) && !continuous(f, next) && !handover.swap) {
        handover.swap = { id, captured: false, committed: false };
        continue;
      }
      frozen.delete(id);
    }
    while (frozen.size > MAX_FROZEN) frozen.delete(frozen.keys().next().value as MachineId);

    const out = new Map<MachineId, Mount>();
    for (const [id, m] of now) out.set(id, frozen.get(id) ?? m);
    for (const [id, m] of frozen) if (!out.has(id)) out.set(id, m);
    for (const [id, m] of idle) if (!out.has(id)) out.set(id, m);
    // Recently used machines stay mounted (idle) so going back is instant.
    const keep = lru.current.filter((id) => !out.has(id));
    for (const id of out.keys()) lru.current = [id, ...lru.current.filter((x) => x !== id)].slice(0, LRU_SIZE + out.size);
    for (const id of keep.slice(0, LRU_SIZE)) out.set(id, { id, pres: parkedPres(idleStep(id), reduced), variant: STEPS[FLOW[idleStep(id)].id].variant });
    return { mounts: [...out.values()], primary, highlight };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, step, machine, demo, learnPres, demoPres, film, reduced, epoch]);
}

/** Releases frozen machines once they are out of view and the camera has settled. */
function FrozenRelease() {
  const camera = useThree((s) => s.camera);
  const t = useMemo(() => ({ frustum: new THREE.Frustum(), m: new THREE.Matrix4() }), []);
  useFrame(() => {
    if (!frozen.size) return;
    const info = useStageInfo.getState();
    if (info.flying || handover.swap) return;
    const inDevice = info.space === 'device';
    t.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    t.frustum.setFromProjectionMatrix(t.m);
    let changed = false;
    for (const id of [...frozen.keys()]) {
      const g = stationGroups.get(id);
      const box = stationBoxes.get(id);
      const inView = !inDevice && !!g?.visible && (!box || t.frustum.intersectsBox(box));
      if (!inView) {
        frozen.delete(id);
        changed = true;
      }
    }
    if (changed) remount();
  });
  return null;
}

// ───────────────────────────── readiness ─────────────────────────────

let prewarmChain: Promise<unknown> = Promise.resolve();

/**
 * Prepare a mounted model for the GPU before the camera goes to it: compile its shader
 * programs (in parallel where the browser can) and upload its textures, one model at a time.
 */
function prewarm(gl: THREE.WebGLRenderer, group: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene, sync: boolean): Promise<void> | void {
  const uploads = () =>
    group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      for (const m of Array.isArray(mat) ? mat : [mat])
        for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture && !(v as THREE.Texture).isRenderTargetTexture) gl.initTexture(v as THREE.Texture);
    });
  if (sync) {
    gl.compile(group, camera, scene);
    uploads();
    return;
  }
  const run = async () => {
    await gl.compileAsync(group, camera, scene);
    uploads();
  };
  const p = prewarmChain.then(run);
  prewarmChain = p.catch(() => {});
  return p;
}

/**
 * Marks a station ready once its model has mounted, drawn its textures and been prepared for
 * the GPU. (In the frame-stepped harness this happens on a fixed frame, synchronously.)
 */
function Ready({ id, group }: { id: MachineId; group: React.RefObject<THREE.Group | null> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const frames = useRef(0);
  const started = useRef(false);
  const done = useRef(false);
  useFrame(() => {
    if (done.current || started.current || ++frames.current < 2 || !group.current) return;
    started.current = true;
    const finish = () => {
      if (done.current) return;
      done.current = true;
      readyStations.add(id);
    };
    try {
      const p = prewarm(gl, group.current, camera, scene, stageTime.virtual);
      if (p) p.then(finish, finish);
      else finish();
    } catch {
      finish();
    }
  });
  useEffect(() => {
    // (a remount starts over: React's development double-mount runs this twice)
    frames.current = 0;
    started.current = false;
    done.current = false;
    return () => {
      done.current = true;
      readyStations.delete(id);
    };
  }, [id]);
  return null;
}

/** A model that throws (a module that failed to load, say) is reported, not fatal. */
class ToolBoundary extends Component<{ id: MachineId; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn(`The ${this.props.id} model could not be loaded:`, error);
    failedStations.add(this.props.id);
    remount();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
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
  // What this machine shows each frame (a machine the story leaves is frozen on exactly this),
  // and whether anything that casts shadows may have moved.
  const drawnNew = useRef(false);
  useLayoutEffect(() => {
    drawnNew.current = true;
    quality.invalidate('world');
  }, [pres]);
  useFrame(() => {
    const p = pres.progress.get();
    const last = shownState.get(id);
    if (!last || last.p !== p || last.pres !== pres) {
      shownState.set(id, { pres, p });
      quality.invalidate('world');
    }
    if (drawnNew.current) {
      drawnNew.current = false;
      const g = handover.swap;
      if (g && g.id === id && g.captured && !pres.frozen) g.committed = true;
    }
  });
  useEffect(
    () => () => {
      shownState.delete(id);
    },
    [id],
  );
  const env = useMemo(() => ({ station: id, placed: true }), [id]);
  if (!Tool) return null;
  return (
    <group ref={group} position={placement.pos} quaternion={placement.q} visible={false}>
      <StationContext.Provider value={env}>
        <PresentationProvider value={pres}>
          <ToolBoundary id={id}>
            <Suspense fallback={null}>
              <Tool variant={variant} />
              <Ready id={id} group={group} />
            </Suspense>
          </ToolBoundary>
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

/** A shadow-casting light whose map size follows the quality tier. */
function useShadowSize(light: React.RefObject<THREE.DirectionalLight | null>) {
  const tier = useQuality((s) => s.tier);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    const n = TIERS[tier].shadowMap;
    if (l.shadow.mapSize.x === n) return;
    l.shadow.mapSize.set(n, n);
    l.shadow.map?.dispose();
    l.shadow.map = null;
    quality.invalidate();
  }, [tier, light]);
}

/** Key light and shadows follow the machine in focus; the litho bay is lit yellow. */
function WorldLighting() {
  const key = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const c = useMemo(() => new THREE.Vector3(), []);
  const warmth = useRef(0);
  const lastFocus = useRef<string>('');
  const lastT = useRef(0);
  useShadowSize(key);
  useFrame(() => {
    const k = key.current;
    if (!k) return;
    const now = stageTime.clock() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - lastT.current));
    lastT.current = now;
    const f = stageFocus.station;
    if ((f ?? '') !== lastFocus.current) {
      lastFocus.current = f ?? '';
      if (f) stationCentre(f, c);
      else c.set(0, 0, 0);
      k.position.set(c.x + 3, 6, c.z + 4);
      target.position.set(c.x, 0.8, c.z);
      target.updateMatrixWorld();
      quality.invalidate('world');
    }
    const want = f && LITHO_BAY.includes(f) ? 1 : 0;
    warmth.current += (want - warmth.current) * Math.min(1, dt * 2.5);
    k.color.copy(COOL).lerp(WARM, warmth.current);
    hemi.current?.color.copy(COOL).lerp(WARM, warmth.current * 0.8);
  });
  const n = TIERS[useQuality.getState().tier].shadowMap;
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
        shadow-mapSize={[n, n]}
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
      <FrozenRelease />
    </>
  );
}

// ───────────────────────────── device space ─────────────────────────────

const DEVICE_BG = '#f0f0ee';

function DeviceLighting() {
  const key = useRef<THREE.DirectionalLight>(null);
  useShadowSize(key);
  const n = TIERS[useQuality.getState().tier].shadowMap;
  return (
    <>
      <color attach="background" args={[DEVICE_BG]} />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#ffffff', '#6b6f78', 0.5]} />
      <directionalLight
        ref={key}
        position={[3, 6, 4]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[n, n]}
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
        </PresentationProvider>
      )}
    </LabelSpaceContext.Provider>,
    scene,
  );
}

// ───────────────────────────── quality ─────────────────────────────

/** Picks the starting tier from the device, and steps it from measured frame rates. */
function QualityControl({ onDpr }: { onDpr: (dpr: number) => void }) {
  const gl = useThree((s) => s.gl);
  const tier = useQuality((s) => s.tier);
  useEffect(() => {
    const ctx = gl.getContext();
    const ext = ctx.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER));
    const nav = navigator as Navigator & { deviceMemory?: number };
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const t = initialTier(renderer, nav.hardwareConcurrency ?? 4, nav.deviceMemory, touch, window.devicePixelRatio || 1);
    useQuality.setState({ tier: t, renderer, reason: 'from the device' });
  }, [gl]);
  useEffect(() => {
    onDpr(Math.min(TIERS[tier].dprMax, window.devicePixelRatio || 1));
  }, [tier, onDpr]);
  // (the frame-stepped harness keeps its starting tier: its frame times mean nothing)
  if (VIRTUAL_TIME) return null;
  return (
    <PerformanceMonitor
      onDecline={() => stepTier(-1, 'frame rate too low')}
      onIncline={() => stepTier(1, 'frame rate recovered')}
      flipflops={3}
      onFallback={() => useQuality.setState((s) => (s.reason.startsWith('forced') ? s : { tier: 'low', reason: 'unsteady frame rate' }))}
    />
  );
}

// ───────────────────────────── the canvas ─────────────────────────────

/** Capture tools that read the canvas after the frame (not in the same task) need this. */
const CAPTURE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('capture') === '1';

export function Stage() {
  const deviceScene = useMemo(() => new THREE.Scene(), []);
  const controlsRef = useRef<CameraControls>(null);
  const { mounts, primary, highlight } = useMounts();
  const [dpr, setDpr] = useState(() => Math.min(TIERS[useQuality.getState().tier].dprMax, window.devicePixelRatio || 1));
  return (
    <Canvas
      shadows="percentage"
      frameloop={VIRTUAL_TIME ? 'never' : 'always'}
      dpr={dpr}
      gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE }}
      camera={{ fov: 34, near: 0.05, far: 400, position: [18.8, 2.3, 1.6] }}
      onCreated={({ gl }) => {
        // cutaway housings clip their own materials
        gl.localClippingEnabled = true;
        // the director redraws shadow maps only when something may have moved
        gl.shadowMap.autoUpdate = false;
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
      <QualityControl onDpr={setDpr} />
      {(TEST_HOOKS || DIAG) && <DevHook deviceScene={deviceScene} />}
    </Canvas>
  );
}

/** Development and test harness only: expose the renderer and scenes for measurement scripts. */
function DevHook({ deviceScene }: { deviceScene: THREE.Scene }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    (window as unknown as { __fab: unknown }).__fab = {
      gl,
      scene,
      deviceScene,
      camera,
      THREE,
      readyStations,
      failedStations,
      stationGroups,
      waferRegistry,
      cutOpen,
      cutAmount,
      proxyHidden,
      stageFocus,
      useStageInfo,
      stationBoxes,
      handover,
      frozen,
      shownState,
      quality,
      useQuality,
      useFilm,
      gapStats,
      deviceMeshes,
    };
    (window as unknown as { __fabQuality: () => unknown }).__fabQuality = () => ({ ...useQuality.getState(), dpr: gl.getPixelRatio(), shadowRedraws: quality.shadowRedraws });
  }, [gl, scene, camera, deviceScene]);
  return null;
}

// Test and recording harness: render n frames of exactly 1/30 s each (only with ?virt=1).
if (VIRTUAL_TIME) {
  (window as unknown as { __fabAdvance: (n?: number) => number }).__fabAdvance = (n = 1) => {
    for (let i = 0; i < n; i++) {
      stageTime.t += stageTime.dt;
      stageTime.beforeFrame?.();
      // (three.js' clock follows this value: seconds, like the wall clock it stands in for)
      advance(stageTime.t);
    }
    return stageTime.t;
  };
}
