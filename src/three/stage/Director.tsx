/**
 * The director: owns the camera and the render loop for every mode.
 *
 *   home     a slow, steady establishing view of the bay
 *   learn    the step's shot track, evaluated from lesson progress; between lessons, a flight
 *            from wherever the camera is to the next step's first framing (retargeted if the
 *            learner moves on again mid-flight); the lesson clock waits for the camera
 *   explore  flights between the overview and a machine (or its demonstration's track)
 *   watch    the film's shot track, evaluated from the media clock (no runtime flights)
 *
 * Learn and Explore let the learner take the camera (free look) at any time; "Back to guided
 * view" flies back. World (metres) and device (schematic) are separate scenes. A frame is
 * either one pose in one space, or a cross-fade between two poses: the outgoing view is drawn
 * into an offscreen target and blended over the incoming one, so nothing is swapped out of
 * sight. With reduced motion, flights become short cross-fades between still compositions.
 */

import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { DEMO_STEP, machineOfStep } from '../../content/machines';
import { trackFor, trackForIndex } from '../../content/shots';
import { STEPS } from '../../content/steps';
import { FLOW } from '../../sim/flow';
import { useDemo } from '../../state/demo';
import type { MachineId } from '../../state/nav';
import { cameraBridge, useApp, useClock, type CamPose as StoredPose, type ScaleId } from '../../state/store';
import { labelStations, projectLabels } from '../labelProjection';
import { BAY, BACKEND } from '../tools/poses/fab';
import { TOOL_POSES } from '../poses';
import { cutAmount, cutInstant, cutOpen, fabLod, proxyHidden } from '../tools/Fab';
import { readyStations, stationCentre, stationGroups } from './anchors';
import { filmSample, filmBridge } from './filmBridge';
import { directorCommands, publish, stageFocus } from './info';
import { stageTime } from './time';
import { planTransition, type Leg } from './flights';
import { copyPose, evalTrack, evalTrackStill, makePose, makeSample, resolve, type CamPose, type CamSample, type Space } from './tracks';

// ───────────────────────────── flights ─────────────────────────────

interface Flight {
  legs: Leg[];
  total: number;
  start: number;
  /** Where the flight ends up: lighting switches over halfway. */
  to: MachineId | null;
  from: MachineId | null;
  /** Hand the camera to the learner at the end (restoring a free-look view). */
  thenFree: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ───────────────────────────── hero (home) ─────────────────────────────

const HERO_WIDE = { pos: new THREE.Vector3(18.8, 2.3, 1.6), target: new THREE.Vector3(-4, 1.45, -1.9), fov: 34 };
const HERO_TALL = { pos: new THREE.Vector3(19.4, 3.6, 2.4), target: new THREE.Vector3(0, -1.6, -1.2), fov: 58 };

export function heroPose(t: number, aspect: number, reduced: boolean, out: CamSample): number {
  const k = THREE.MathUtils.clamp((1.25 - aspect) / 0.75, 0, 1);
  const tt = reduced ? 0 : t;
  out.mix = 0;
  out.a.space = 'world';
  out.a.scale = 'fab';
  out.a.pos.lerpVectors(HERO_WIDE.pos, HERO_TALL.pos, k);
  out.a.target.lerpVectors(HERO_WIDE.target, HERO_TALL.target, k);
  out.a.pos.x += Math.sin(tt * 0.045) * 0.35;
  out.a.pos.z += Math.sin(tt * 0.031 + 1.2) * 0.3;
  out.a.target.z += Math.sin(tt * 0.038 + 0.4) * 0.25;
  return THREE.MathUtils.lerp(HERO_WIDE.fov, HERO_TALL.fov, k);
}

// ───────────────────────────── explore overview ─────────────────────────────

/** The whole bay from high above its east end; on tall screens, looking down its length. */
const OV_WIDE = { pos: new THREE.Vector3(22, 26, 26), target: new THREE.Vector3(-7, 0, -1.5) };
const OV_TALL = { pos: new THREE.Vector3(30, 36, 6), target: new THREE.Vector3(-9, -2, 0) };

export function overviewPose(aspect: number, out: CamPose) {
  const k = THREE.MathUtils.clamp((1.4 - aspect) / 0.7, 0, 1);
  out.space = 'world';
  out.scale = 'fab';
  out.pos.lerpVectors(OV_WIDE.pos, OV_TALL.pos, k);
  out.target.lerpVectors(OV_WIDE.target, OV_TALL.target, k);
}

// ───────────────────────────── helpers ─────────────────────────────

/** Development check of the level-of-detail hand-over: ?lod=proxy keeps the low-detail bay. */
const FORCE_PROXY = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('lod') === 'proxy';

const BASE_FOV = 32;
const LOD_DISTANCE = 16;
/** Framings are composed for a landscape viewport; narrower canvases pull the camera back. */
const DESIGN_ASPECT = 1.4;
const BAY_BOX = new THREE.Box3(new THREE.Vector3(BACKEND.x0 + 0.5, 0.2, BAY.z0 + 0.5), new THREE.Vector3(BAY.x1 - 0.5, 30, BAY.z1 - 0.5));

function fitPose(p: CamPose, fit: number) {
  if (fit === 1) return;
  p.pos.sub(p.target).multiplyScalar(fit).add(p.target);
}

function copySample(dst: CamSample, src: CamSample) {
  copyPose(dst.a, src.a);
  copyPose(dst.b, src.b);
  dst.mix = src.mix;
}

const shown = (s: CamSample) => (s.mix >= 0.5 ? s.b : s.a);

function scaleOf(p: CamPose, mode: string): ScaleId {
  if (p.space === 'device') return 'device';
  if (mode === 'home') return 'fab';
  if (p.scale) return p.scale;
  const d = p.pos.distanceTo(p.target);
  if (d < 0.9) return 'wafer';
  if (p.pos.y > 6 || d > 11) return 'fab';
  return 'tool';
}

/** The machine the camera should be at for the current mode. */
function focusStation(): MachineId | null {
  const a = useApp.getState();
  if (a.mode === 'learn') return machineOfStep(a.step);
  if (a.mode === 'explore') return a.machine;
  if (a.mode === 'watch') return filmBridge.station ?? null;
  return null;
}

// ───────────────────────────── the director ─────────────────────────────

export function Director({ deviceScene, controlsRef }: { deviceScene: THREE.Scene; controlsRef: React.RefObject<CameraControls | null> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  // Offscreen target for cross-fades: linear half-float, tone-mapped when blended to screen,
  // so the outgoing view looks exactly as it did a frame earlier.
  const rt = useMemo(() => new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType }), []);
  const overlay = useMemo(() => {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.MeshBasicMaterial({ map: rt.texture, transparent: true, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    const sc = new THREE.Scene();
    sc.add(quad);
    return { cam, mat, sc, quad };
  }, [rt]);
  useEffect(
    () => () => {
      rt.dispose();
      overlay.mat.dispose();
      overlay.quad.geometry.dispose();
    },
    [rt, overlay],
  );

  const st = useRef({
    key: '',
    mode: '',
    flight: null as Flight | null,
    freeLook: false,
    live: makeSample(),
    guided: makeSample(),
    first: true,
    waitingFor: null as MachineId | null,
    waitSince: 0,
    lastSpace: 'world' as Space,
    /** A pose to fly to instead of the guided one (restoring a lesson's free-look view). */
    restore: null as CamPose | null,
    /** The machine the camera was last settled at (a retrace starts from its wafer). */
    lastStation: null as MachineId | null,
    /** Stations that were ready last frame (a machine that loads while the camera is already
     * there opens at once: there was no approach to reveal it on). */
    readyPrev: new Set<MachineId>(),
  });

  const fitRef = useRef(1);
  fitRef.current = Math.round(Math.pow(Math.max(1, DESIGN_ASPECT / Math.max(0.3, size.width / Math.max(1, size.height))), 0.8) * 20) / 20;

  /** What the camera should be following right now, as a key: a change starts a flight. */
  const keyFor = () => {
    const a = useApp.getState();
    if (a.mode === 'learn') return `learn:${a.step}:${a.scaleOverride ?? ''}`;
    if (a.mode === 'explore') return `explore:${a.machine ?? ''}:${a.demo ? 'demo' : ''}`;
    return a.mode;
  };

  /** The guided camera for the current mode at this instant; returns the field of view. */
  const guidedNow = (out: CamSample, elapsed: number): number => {
    const a = useApp.getState();
    out.mix = 0;
    let fov = BASE_FOV;
    switch (a.mode) {
      case 'home':
        return heroPose(elapsed, size.width / Math.max(1, size.height), a.reducedMotion, out);
      case 'learn': {
        const content = STEPS[FLOW[a.step].id];
        const ctx = { station: machineOfStep(a.step), variant: content.variant };
        const ov = a.scaleOverride;
        if (ov === 'device') resolve({ kind: 'device', framing: 'section' }, ctx, out.a);
        else if (ov === 'wafer') resolve({ kind: 'wafer', framing: 'top' }, ctx, out.a);
        else if (ov === 'tool') resolve({ kind: 'shot', name: content.variant ?? 'establish' }, ctx, out.a);
        else if (ov === 'fab') resolve({ kind: 'fab' }, ctx, out.a);
        else (a.reducedMotion ? evalTrackStill : evalTrack)(trackForIndex(a.step), useClock.getState().progress, ctx, out);
        break;
      }
      case 'explore': {
        if (a.machine && a.demo) {
          const d = useDemo.getState();
          const id = DEMO_STEP[a.machine];
          (a.reducedMotion ? evalTrackStill : evalTrack)(trackFor(id), d.progress, { station: a.machine, variant: STEPS[id].variant }, out);
        } else if (a.machine) resolve({ kind: 'machine', station: a.machine }, { station: a.machine }, out.a);
        else {
          overviewPose(size.width / Math.max(1, size.height), out.a);
          return fov;
        }
        break;
      }
      case 'watch':
        if (!filmSample(out)) overviewPose(size.width / Math.max(1, size.height), out.a);
        else if (filmBridge.fov) return filmBridge.fov; // framings that are already composed for this viewport
        break;
    }
    fitPose(out.a, fitRef.current);
    if (out.mix > 0) fitPose(out.b, fitRef.current);
    return fov;
  };

  /** Build a flight from the live camera to a (live) target pose. */
  const planFlight = (target: () => CamPose, reduced: boolean, thenFree = false): Flight => {
    const s = st.current;
    const a = useApp.getState();
    const station = focusStation();
    const from = s.lastStation;
    const legs = planTransition(shown(s.live), target, {
      from,
      to: station,
      // arriving at a different machine in a lesson: establish the whole machine first
      establish: a.mode === 'learn' && !!station && from !== station,
      reduced,
      fit: (p) => fitPose(p, fitRef.current),
    });
    const total = legs.reduce((t, l) => t + l.dur, 0);
    return { legs, total, start: stageTime.now(), to: station, from, thenFree };
  };

  const guidedTarget = () => {
    const sample = makeSample();
    return () => {
      guidedNow(sample, 0);
      return shown(sample);
    };
  };

  // The store can read and restore the camera (lesson snapshots for Explore/Watch); the UI can
  // ask for the guided view back.
  useEffect(() => {
    cameraBridge.get = (): StoredPose | null => {
      const s = st.current;
      if (!s.freeLook) return null;
      const p = shown(s.live);
      return { space: p.space, pos: p.pos.toArray() as [number, number, number], target: p.target.toArray() as [number, number, number] };
    };
    cameraBridge.restore = (p) => {
      const s = st.current;
      const pose = makePose(p.space);
      pose.pos.fromArray(p.pos);
      pose.target.fromArray(p.target);
      s.restore = pose;
    };
    directorCommands.recentre = () => {
      const s = st.current;
      s.freeLook = false;
      s.restore = null;
      s.key = ''; // forces a flight back to the guided framing
    };
  }, []);

  // Learner input on the canvas takes the camera (drag, pinch or wheel).
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    const take = () => {
      const s = st.current;
      const mode = useApp.getState().mode;
      if (mode !== 'learn' && mode !== 'explore') return;
      s.freeLook = true;
      s.flight = null;
      s.restore = null;
    };
    c.addEventListener('controlstart', take);
    c.addEventListener('control', take);
    return () => {
      c.removeEventListener('controlstart', take);
      c.removeEventListener('control', take);
    };
  }, [controlsRef]);

  const tmp = useMemo(() => ({ c: new THREE.Vector3() }), []);

  useFrame((state) => {
    const s = st.current;
    const a = useApp.getState();
    const clock = useClock.getState();
    const now = stageTime.now();
    const controls = controlsRef.current;
    const reduced = a.reducedMotion;

    filmBridge.aspect = size.width / Math.max(1, size.height);
    // ── what should we be looking at? ──
    const fov = guidedNow(s.guided, stageTime.virtual ? stageTime.t : state.clock.elapsedTime);
    const key = keyFor();
    if (key !== s.key || s.restore) {
      const want = focusStation();
      // Destination first: hold the current view (briefly) until the next machine has loaded.
      if (want && !readyStations.has(want) && !s.first) {
        if (s.waitingFor !== want) {
          s.waitingFor = want;
          s.waitSince = now;
        }
        if (now - s.waitSince < 3000) {
          finishFrame(true);
          return;
        }
      }
      s.waitingFor = null;
      const modeChanged = s.mode !== a.mode;
      s.key = key;
      s.mode = a.mode;
      const restore = s.restore;
      s.restore = null;
      s.freeLook = false;
      const cut = s.first || (a.mode === 'watch' && modeChanged) || (a.mode === 'home' && s.first);
      if (cut) {
        s.flight = null;
        copySample(s.live, s.guided);
        stageFocus.station = want;
      } else if (restore) {
        s.flight = planFlight(() => restore, reduced, true);
      } else {
        s.flight = planFlight(guidedTarget(), reduced);
      }
      s.first = false;
      configureControls(controls, a.mode);
    }

    // ── choose the frame ──
    const free = s.freeLook && (a.mode === 'learn' || a.mode === 'explore');
    if (s.flight) {
      const f = s.flight;
      // (a flight planned during this frame starts a fraction of a millisecond after `now`)
      let t = Math.max(0, (now - f.start) / 1000);
      let done = true;
      for (const leg of f.legs) {
        if (t < leg.dur) {
          leg.eval(t / leg.dur, s.live);
          done = false;
          break;
        }
        t -= leg.dur;
      }
      stageFocus.station = Math.max(0, (now - f.start) / 1000) > f.total / 2 ? f.to : (f.from ?? f.to);
      if (done) {
        f.legs[f.legs.length - 1].eval(1, s.live);
        s.flight = null;
        if (s.live.mix >= 0.5) copyPose(s.live.a, s.live.b);
        s.live.mix = 0;
        stageFocus.station = f.to;
        if (f.thenFree) {
          s.freeLook = true;
          const p = s.live.a;
          controls?.setLookAt(p.pos.x, p.pos.y, p.pos.z, p.target.x, p.target.y, p.target.z, false);
        }
      }
    } else if (free) {
      // the controls own the camera: read it back
      if (controls) {
        controls.getPosition(s.live.a.pos);
        controls.getTarget(s.live.a.target);
        s.live.a.space = s.lastSpace;
        s.live.a.scale = undefined;
        s.live.mix = 0;
      }
    } else {
      copySample(s.live, s.guided);
      stageFocus.station = focusStation();
    }

    // The lesson clock waits for the camera to arrive.
    if (a.mode === 'learn' && clock.pendingPlay && !s.flight) useClock.setState({ playing: true, pendingPlay: false });

    // ── controls: enabled only when the learner may look around ──
    if (controls) {
      const interactive = (a.mode === 'learn' || a.mode === 'explore') && !s.flight;
      if (controls.enabled !== interactive) controls.enabled = interactive;
      const p = shown(s.live);
      if (!free) controls.setLookAt(p.pos.x, p.pos.y, p.pos.z, p.target.x, p.target.y, p.target.z, false);
      if (!free) {
        const d = p.pos.distanceTo(p.target);
        if (p.space === 'device') {
          controls.minDistance = 2;
          controls.maxDistance = 18;
        } else if (a.mode === 'explore' && !a.machine) {
          controls.minDistance = 4;
          controls.maxDistance = Math.max(60, d * 1.3);
        } else {
          controls.minDistance = Math.max(0.03, d * 0.3);
          controls.maxDistance = Math.max(4, d * 3);
        }
      }
    }

    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    finishFrame(!!s.flight);
  }, 1);

  /** Level of detail, labels, published info, and the render itself. */
  function finishFrame(flying: boolean) {
    const s = st.current;
    const a = useApp.getState();
    const cam = shown(s.live);
    // Level of detail (never on the home view). A housed machine keeps its enclosure and opens
    // it (cutaway) when it is the one the story is at and the camera is near; other machines
    // hand over from the low-detail model to the detailed one when the camera is near.
    proxyHidden.clear();
    cutOpen.clear();
    if (a.mode !== 'home' && !FORCE_PROXY) {
      const focus = focusStation();
      const f = s.flight;
      const mid = s.live.mix > 0 && s.live.mix < 1;
      for (const id of readyStations) {
        const near = cam.space === 'device' || mid || cam.pos.distanceTo(stationCentre(id, tmp.c)) < LOD_DISTANCE;
        if (!near) continue;
        if (TOOL_POSES[id].cutaway) {
          const inStory = id === focus || (f && (id === f.from || id === f.to));
          if (inStory) cutOpen.add(id);
        } else proxyHidden.add(id);
      }
    }
    for (const id of readyStations) if (!s.readyPrev.has(id) && !s.flight) cutInstant.add(id);
    s.readyPrev = new Set(readyStations);
    if (a.reducedMotion) cutOpen.forEach((id) => cutInstant.add(id));
    fabLod.apply();
    stationGroups.forEach((g, id) => (g.visible = proxyHidden.has(id) || cutAmount(id) > 0.001 || cutOpen.has(id)));

    labelStations.clear();
    const f = focusStation();
    if (f) labelStations.add(f);

    s.lastSpace = cam.space;
    if (!flying) s.lastStation = f;
    publish({ space: cam.space, freeLook: s.freeLook && (a.mode === 'learn' || a.mode === 'explore'), flying, scale: scaleOf(cam, a.mode) });
    renderFrame(s.live);
  }

  function applyCamera(p: CamPose) {
    camera.position.copy(p.pos);
    camera.lookAt(p.target);
    const d = p.pos.distanceTo(p.target);
    const near = p.space === 'device' ? 0.05 : clamp(d * 0.02, 0.004, 0.25);
    const far = p.space === 'device' ? 200 : 400;
    if (camera.near !== near || camera.far !== far) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  const sceneOf = (space: Space) => (space === 'device' ? deviceScene : scene);

  function renderFrame(sample: CamSample) {
    const mix = sample.mix;
    const W = size.width;
    const H = size.height;
    if (mix <= 0.001 || mix >= 0.999) {
      const p = mix >= 0.999 ? sample.b : sample.a;
      applyCamera(p);
      gl.setRenderTarget(null);
      gl.render(sceneOf(p.space), camera);
      projectLabels(camera, p.space, 1, W, H, gl.domElement);
      return;
    }
    // cross-fade: outgoing view offscreen, incoming view on screen, blend
    const w = Math.max(1, Math.floor(W * gl.getPixelRatio()));
    const h = Math.max(1, Math.floor(H * gl.getPixelRatio()));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    applyCamera(sample.a);
    gl.setRenderTarget(rt);
    gl.render(sceneOf(sample.a.space), camera);
    gl.setRenderTarget(null);
    applyCamera(sample.b);
    gl.render(sceneOf(sample.b.space), camera);
    overlay.mat.opacity = 1 - mix;
    const auto = gl.autoClear;
    gl.autoClear = false;
    gl.render(overlay.sc, overlay.cam);
    gl.autoClear = auto;
    // Labels only once the new view has settled in: never floating between two scales.
    projectLabels(camera, sample.b.space, mix < 0.85 ? 0 : (mix - 0.85) / 0.15, W, H, gl.domElement);
  }

  return null;
}

/** Orbit limits per mode: Explore keeps the camera inside the building. */
function configureControls(c: CameraControls | null, mode: string) {
  if (!c) return;
  if (mode === 'explore') c.setBoundary(BAY_BOX);
  else c.setBoundary();
}
