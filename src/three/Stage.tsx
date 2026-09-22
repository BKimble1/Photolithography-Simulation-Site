import { CameraControls, ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { STEPS, type SceneId, type ViewLevel } from '../content/steps';
import { FLOW } from '../sim/flow';
import { useStep } from '../state/sim';
import { useApp, useClock } from '../state/store';
import { DeviceScene } from './device/DeviceScene';
import { poseFor, type Pose } from './poses';
import { ToolScene } from './tools';
import { FabScene } from './tools/Fab';
import { WaferScene } from './WaferScene';

/** Advances the step animation while playing. */
function ClockDriver() {
  const fast = useApp((s) => s.fast);
  useFrame((_, dt) => {
    const c = useClock.getState();
    if (!c.playing) return;
    const st = STEPS[FLOW[useApp.getState().step].id];
    const dur = st.duration / (fast ? 6 : 1);
    const p = Math.min(1, c.progress + Math.min(dt, 0.1) / dur);
    useClock.setState({ progress: p, playing: p < 1 });
  });
  return null;
}

type Mood = 'lab' | 'yellow' | 'fab' | 'device' | 'wafer';

function moodOf(view: ViewLevel, scene: SceneId): Mood {
  if (view === 'device') return 'device';
  if (view === 'wafer') return 'wafer';
  if (view === 'fab') return 'fab';
  if (scene === 'track' || scene === 'scanner' || scene === 'metrology') return 'yellow';
  return 'lab';
}

const BG: Record<Mood, string> = {
  lab: '#dfe1e4',
  yellow: '#e2ddd2',
  fab: '#eef0f2',
  device: '#f0f0ee',
  wafer: '#e4e3df',
};

function Lighting({ mood }: { mood: Mood }) {
  const warm = mood === 'yellow';
  const device = mood === 'device';
  return (
    <>
      <ambientLight intensity={device ? 0.5 : 0.12} />
      <hemisphereLight args={[warm ? '#fff4dc' : '#ffffff', '#6b6f78', device ? 0.5 : 0.35]} />
      <directionalLight
        position={[3, 6, 4]}
        intensity={device ? 1.5 : 2.2}
        color={warm ? '#fff3d9' : '#ffffff'}
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
      <directionalLight position={[-4, 3, -2]} intensity={0.5} color={warm ? '#ffe9bf' : '#dfe8ff'} />
      {/* Studio environment: bright softboxes on a dark surround, so steel shows crisp
          reflections instead of a flat grey. */}
      <Environment resolution={256} frames={1}>
        <color attach="background" args={[device ? '#8a8d93' : '#565a62']} />
        <Lightformer form="rect" intensity={3.4} color={warm ? '#fff6e2' : '#ffffff'} position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[9, 9, 1]} />
        <Lightformer form="rect" intensity={2.4} color="#ffffff" position={[-5, 1.8, 1.5]} rotation={[0, Math.PI / 2, 0]} scale={[1.6, 7, 1]} />
        <Lightformer form="rect" intensity={2.0} color="#ffffff" position={[5, 2.2, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[1.6, 7, 1]} />
        <Lightformer form="rect" intensity={1.4} color={warm ? '#ffe7b3' : '#f2f4ff'} position={[0, 1.6, 6]} rotation={[0, Math.PI, 0]} scale={[7, 1.2, 1]} />
        <Lightformer form="rect" intensity={1.0} color="#ffffff" position={[0, 1.2, -6]} rotation={[0, 0, 0]} scale={[8, 1.5, 1]} />
        <Lightformer form="ring" intensity={1.6} color={warm ? '#ffd98a' : '#cfc8ff'} position={[3, 3.5, -4]} scale={1.6} />
      </Environment>
    </>
  );
}

/** Smoothly moves the camera to the pose for the current view/scene/variant. */
function CameraRig({ pose, instantKey, fromFar }: { pose: Pose; instantKey: string; fromFar: 'in' | 'out' | null }) {
  const ref = useRef<CameraControls>(null);
  const reduced = useApp((s) => s.reducedMotion);
  const last = useRef('');
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.minDistance = pose.min ?? 0.2;
    c.maxDistance = pose.max ?? 30;
    const [px, py, pz] = pose.pos;
    const [tx, ty, tz] = pose.target;
    const sceneChanged = last.current !== instantKey;
    last.current = instantKey;
    if (sceneChanged && fromFar && !reduced) {
      // Start pulled back (zooming in) or pushed in (zooming out), then glide to the pose.
      const k = fromFar === 'in' ? 2.1 : 0.45;
      c.setLookAt(tx + (px - tx) * k, ty + (py - ty) * k, tz + (pz - tz) * k, tx, ty, tz, false);
      c.setLookAt(px, py, pz, tx, ty, tz, true);
    } else {
      c.setLookAt(px, py, pz, tx, ty, tz, !reduced && !sceneChanged);
    }
  }, [pose, instantKey, fromFar, reduced]);
  return (
    <CameraControls
      ref={ref}
      makeDefault
      smoothTime={0.55}
      draggingSmoothTime={0.12}
      maxPolarAngle={Math.PI * 0.49}
      dollySpeed={0.6}
      truckSpeed={0.8}
    />
  );
}

function Grounding({ mood }: { mood: Mood }) {
  if (mood === 'device') return <ContactShadows position={[0, -0.9, 0]} opacity={0.35} scale={12} blur={2.6} far={3} resolution={512} />;
  return null;
}

const LEVEL_RANK: Record<ViewLevel, number> = { fab: 0, tool: 1, wafer: 2, device: 3 };

export function Stage() {
  const view = useApp((s) => s.view);
  const reduced = useApp((s) => s.reducedMotion);
  const { content } = useStep();
  const want = useMemo(() => ({ view, scene: content.scene, variant: content.variant }), [view, content.scene, content.variant]);
  const [shown, setShown] = useState(want);
  const [fade, setFade] = useState(false);
  const [dir, setDir] = useState<'in' | 'out' | null>(null);

  useEffect(() => {
    if (want.view === shown.view && want.scene === shown.scene) {
      if (want.variant !== shown.variant) setShown(want);
      return;
    }
    if (reduced) {
      setShown(want);
      setDir(null);
      return;
    }
    const d = LEVEL_RANK[want.view] > LEVEL_RANK[shown.view] ? 'in' : LEVEL_RANK[want.view] < LEVEL_RANK[shown.view] ? 'out' : 'in';
    setDir(d);
    setFade(true);
    const t = setTimeout(() => {
      setShown(want);
      requestAnimationFrame(() => setFade(false));
    }, 260);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want]);

  const mood = moodOf(shown.view, shown.scene);
  const pose = useMemo(() => poseFor(shown.view, shown.scene, shown.variant), [shown]);
  const sceneKey = `${shown.view}:${shown.scene}`;
  return (
    <>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        camera={{ fov: 32, near: 0.01, far: 200, position: pose.pos }}
        aria-hidden
      >
        <color attach="background" args={[BG[mood]]} />
        <fog attach="fog" args={[BG[mood], mood === 'fab' ? 18 : 9, mood === 'fab' ? 60 : 30]} />
        <ClockDriver />
        <Lighting mood={mood} />
        <Suspense fallback={null}>
          <SceneContent view={shown.view} scene={shown.scene} variant={shown.variant} />
        </Suspense>
        <Grounding mood={mood} />
        <CameraRig pose={pose} instantKey={sceneKey} fromFar={dir} />
      </Canvas>
      <div className={'vp-fade' + (fade ? ' is-on' : '')} />
    </>
  );
}

function SceneContent({ view, scene, variant }: { view: ViewLevel; scene: SceneId; variant?: string }) {
  if (view === 'device') return <DeviceScene />;
  if (view === 'wafer') return <WaferScene />;
  if (view === 'fab') return <FabScene highlight={scene} />;
  if (scene === 'wafer') return <WaferScene />;
  return <ToolScene id={scene} variant={variant} />;
}

/** Keeps the renderer's size in sync when the layout changes (panels, mobile). */
export function useInvalidateOnResize() {
  const { invalidate } = useThree();
  useEffect(() => {
    const on = () => invalidate();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [invalidate]);
}
