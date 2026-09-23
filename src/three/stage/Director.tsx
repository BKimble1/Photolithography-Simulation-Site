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
import { create } from 'zustand';
import { DEMO_STEP, machineOfStep } from '../../content/machines';
import { trackFor, trackForIndex } from '../../content/shots';
import { STEPS } from '../../content/steps';
import { FLOW } from '../../sim/flow';
import { useDemo } from '../../state/demo';
import type { MachineId } from '../../state/nav';
import { cameraBridge, useApp, useClock, type CamPose as StoredPose, type ScaleId } from '../../state/store';
import { labelStations, projectLabels } from '../labels';
import { BAY, BACKEND } from '../tools/poses/fab';
import { fabLod, proxyHidden } from '../tools/Fab';
import { readyStations, stationCentre, stationGroups } from './anchors';
import { filmSample, filmBridge } from './filmBridge';
import { stageTime } from './time';
import { copyPose, deviceToWorld, evalTrack, lerpPose, makePose, makeSample, resolve, worldToDevice, type CamPose, type CamSample, type Space } from './tracks';

// ───────────────────────────── published stage info (for the DOM UI) ─────────────────────────────

export interface StageInfo {
  scale: ScaleId;
  space: Space;
  /** The learner has taken the camera; offer a way back to the guided view. */
  freeLook: boolean;
  /** The camera is travelling (or waiting for its destination to load). */
  flying: boolean;
}

export const useStageInfo = create<StageInfo>(() => ({ scale: 'fab', space: 'world', freeLook: false, flying: false }));

function publish(p: StageInfo) {
  const cur = useStageInfo.getState();
  if (cur.scale !== p.scale || cur.space !== p.space || cur.freeLook !== p.freeLook || cur.flying !== p.flying) useStageInfo.setState(p);
}

/** Commands the DOM UI can give the director. */
export const directorCommands = {
  /** Hand the camera back to the guided view (Learn, Explore demo) or reset the view (Explore). */
  recentre: () => {},
};

/** The machine the story is at (lighting and shadows follow it). */
export const stageFocus: { station: MachineId | null } = { station: null };

// ───────────────────────────── flights ─────────────────────────────

interface Leg {
  dur: number;
  eval: (u: number, out: CamSample) => void;
}

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

const smooth = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));


/** Inside a tool row rather than in the central aisle (the aisle is |z| < 1.8 m). */
const deep = (p: THREE.Vector3) => Math.abs(p.z) > 1.6;
const aisleZ = (z: number) => Math.max(-0.5, Math.min(0.5, z)) * 0.5;

/**
 * A world move from `from` to a live target. Between machines the camera steps back into the
 * central aisle (clear of equipment, through the doorway to the back-end room), travels along
 * it looking ahead, and turns in to the next machine; short moves are direct.
 */
function worldLeg(from: CamPose, target: () => CamPose): Leg {
  const f = copyPose(makePose(), from);
  const probe = copyPose(makePose(), target());
  const dx = Math.abs(probe.pos.x - f.pos.x);
  const dist = f.pos.distanceTo(probe.pos);
  // High overview shots fly directly; ground-level moves between machines use the aisle.
  const overview = f.pos.y > 6 || probe.pos.y > 6;
  const viaAisle = !overview && dx > 2.5 && (dist > 6 || deep(f.pos) || deep(probe.pos));
  if (!viaAisle) {
    const dur = overview ? clamp(1.2 + dist / 30, 1.4, 2.6) : clamp(0.6 + dist * 0.35, 0.6, 1.3);
    return {
      dur,
      eval: (u, out) => {
        out.mix = 0;
        lerpPose(f, target(), smooth(u), out.a);
      },
    };
  }
  const dirX = Math.sign(probe.pos.x - f.pos.x) || 1;
  const y = clamp((f.pos.y + probe.pos.y) / 2, 1.7, 2.15);
  const lead = Math.min(2.2, dx * 0.18);
  const p1 = new THREE.Vector3(f.pos.x + dirX * lead, y, aisleZ(f.pos.z));
  const p2 = new THREE.Vector3(probe.pos.x - dirX * Math.min(2.6, dx * 0.2), y, aisleZ(probe.pos.z));
  const path = new THREE.CatmullRomCurve3([f.pos.clone(), p1, p2, probe.pos.clone()], false, 'centripetal');
  // look ahead along the aisle while travelling, then onto the next machine
  const t1 = p1.clone().add(new THREE.Vector3(dirX * 6, -0.35, 0));
  const t2 = p2.clone().add(new THREE.Vector3(dirX * 3, -0.3, 0)).lerp(probe.target, 0.55);
  const look = new THREE.CatmullRomCurve3([f.target.clone(), t1, t2, probe.target.clone()], false, 'centripetal');
  const len = path.getLength();
  const dur = clamp(1.3 + len / 16, 1.6, 3.0);
  const drift = new THREE.Vector3();
  return {
    dur,
    eval: (u, out) => {
      const k = smooth(u);
      const t = path.getUtoTmapping(k, 0);
      out.mix = 0;
      out.a.space = 'world';
      path.getPoint(t, out.a.pos);
      look.getPoint(t, out.a.target);
      // follow a destination that moves while we travel (blended in towards the end)
      const to = target();
      const w = k * k;
      out.a.pos.addScaledVector(drift.subVectors(to.pos, probe.pos), w);
      out.a.target.addScaledVector(drift.subVectors(to.target, probe.target), w);
    },
  };
}

/** Reduced motion: hold both compositions still and cross-fade between them. */
function fadeLeg(from: CamPose, target: () => CamPose): Leg {
  const f = copyPose(makePose(), from);
  return {
    dur: 0.35,
    eval: (u, out) => {
      copyPose(out.a, f);
      copyPose(out.b, target());
      out.mix = u;
    },
  };
}

// ───────────────────────────── hero (home) ─────────────────────────────

const HERO_WIDE = { pos: new THREE.Vector3(18.8, 2.3, 1.6), target: new THREE.Vector3(-4, 1.45, -1.9), fov: 34 };
const HERO_TALL = { pos: new THREE.Vector3(19.4, 3.6, 2.4), target: new THREE.Vector3(0, -1.6, -1.2), fov: 58 };

function heroPose(t: number, aspect: number, reduced: boolean, out: CamSample): number {
  const k = THREE.MathUtils.clamp((1.25 - aspect) / 0.75, 0, 1);
  const tt = reduced ? 0 : t;
  out.mix = 0;
  out.a.space = 'world';
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

function overviewPose(aspect: number, out: CamPose) {
  const k = THREE.MathUtils.clamp((1.4 - aspect) / 0.7, 0, 1);
  out.space = 'world';
  out.pos.lerpVectors(OV_WIDE.pos, OV_TALL.pos, k);
  out.target.lerpVectors(OV_WIDE.target, OV_TALL.target, k);
}

// ───────────────────────────── helpers ─────────────────────────────

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
        else evalTrack(trackForIndex(a.step), useClock.getState().progress, ctx, out);
        break;
      }
      case 'explore': {
        if (a.machine && a.demo) {
          const d = useDemo.getState();
          const id = DEMO_STEP[a.machine];
          evalTrack(trackFor(id), d.progress, { station: a.machine, variant: STEPS[id].variant }, out);
        } else if (a.machine) resolve({ kind: 'shot', name: 'establish', station: a.machine }, { station: a.machine }, out.a);
        else {
          overviewPose(size.width / Math.max(1, size.height), out.a);
          return fov;
        }
        break;
      }
      case 'watch':
        if (!filmSample(out)) resolve({ kind: 'fab', station: 'overview' }, { station: null }, out.a);
        fov = filmBridge.fov ?? BASE_FOV;
        break;
    }
    fitPose(out.a, fitRef.current);
    if (out.mix > 0) fitPose(out.b, fitRef.current);
    return fov;
  };

  /** Build a flight from the live camera to a (live) target pose. */
  const planFlight = (target: () => CamPose, reduced: boolean, thenFree = false): Flight => {
    const s = st.current;
    const startPose = copyPose(makePose(), shown(s.live));
    const probe = target();
    const legs: Leg[] = [];
    const station = focusStation();
    if (reduced) {
      legs.push(fadeLeg(startPose, target));
    } else if (startPose.space === 'world' && probe.space === 'world') {
      legs.push(worldLeg(startPose, target));
    } else if (startPose.space === 'device' && probe.space === 'device') {
      legs.push({ dur: 0.8, eval: (u, out) => ((out.mix = 0), lerpPose(startPose, target(), smooth(u), out.a)) });
    } else if (startPose.space === 'device') {
      // Retrace: out of the cross-section onto the wafer, then on to the new framing.
      const from = s.lastStation ?? station;
      const onWafer = makePose();
      resolve({ kind: 'wafer', framing: 'die' }, { station: from }, onWafer);
      fitPose(onWafer, fitRef.current);
      legs.push({ dur: 1.1, eval: (u, out) => deviceToWorld(startPose, onWafer, u, from, out) });
      legs.push(worldLeg(onWafer, target));
    } else {
      // Down to the wafer, pick out your die, then reveal the cross-section.
      const onDie = makePose();
      resolve({ kind: 'wafer', framing: 'die' }, { station }, onDie);
      fitPose(onDie, fitRef.current);
      legs.push(worldLeg(startPose, () => onDie));
      legs.push({ dur: 1.2, eval: (u, out) => worldToDevice(onDie, target(), u, station, out) });
    }
    const total = legs.reduce((t, l) => t + l.dur, 0);
    return { legs, total, start: stageTime.now(), to: station, from: s.lastStation, thenFree };
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
      let t = (now - f.start) / 1000;
      let done = true;
      for (const leg of f.legs) {
        if (t < leg.dur) {
          leg.eval(t / leg.dur, s.live);
          done = false;
          break;
        }
        t -= leg.dur;
      }
      stageFocus.station = (now - f.start) / 1000 > f.total / 2 ? f.to : (f.from ?? f.to);
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
    // Detailed machines replace their proxies when the camera is near (never on the home view).
    proxyHidden.clear();
    if (a.mode !== 'home') {
      for (const id of readyStations) {
        if (cam.space === 'device' || cam.pos.distanceTo(stationCentre(id, tmp.c)) < LOD_DISTANCE) proxyHidden.add(id);
      }
      // mid-cross-fade both spaces are drawn: keep the world side detailed too
      if (s.live.mix > 0 && s.live.mix < 1) for (const id of readyStations) proxyHidden.add(id);
    }
    stationGroups.forEach((g, id) => (g.visible = proxyHidden.has(id)));
    fabLod.apply();

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
