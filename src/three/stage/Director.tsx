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
 * either one pose in one space, or a cross-fade between two poses: the outgoing view is drawn,
 * copied as displayed, and blended over the incoming one, so nothing is swapped out of sight.
 * With reduced motion, flights become short cross-fades between still compositions.
 *
 * Hand-overs (see handover.ts): the camera never leaves for a machine that is not loaded yet
 * (it holds the current picture, and the page says what it is waiting for); the learner's
 * wafer is shown by one machine at a time; and whenever the picture would change in a way no
 * motion explains (a cross-fade interrupted half-way, a machine going back a lesson), the
 * director captures the picture as displayed and dissolves from it. A flight replaced mid-way
 * hands its motion over to the new one, so the camera never stops dead.
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
import { failedStations, readyStations, stationBoxes, stationCentre, stationGroups, waferRegistry } from './anchors';
import { filmSample, filmBridge } from './filmBridge';
import { handover, remount } from './handover';
import { directorCommands, publish, stageFocus } from './info';
import { quality } from './quality';
import { stageTime } from './time';
import { handoverAt, legAt, planTransition, type Leg } from './flights';
import { BASE_FOV, copyPose, evalTrack, evalTrackStill, fovOf, makePose, makeSample, resolve, type CamPose, type CamSample, type Space } from './tracks';

// ───────────────────────────── flights ─────────────────────────────

interface Flight {
  legs: Leg[];
  total: number;
  /** Stage-clock milliseconds. */
  start: number;
  /** Where the flight ends up. */
  to: MachineId | null;
  from: MachineId | null;
  /** Hand the camera to the learner at the end (restoring a free-look view). */
  thenFree: boolean;
  /** Seconds into the flight at which the learner's wafer (and the key light) pass to `to`:
   * while the camera is between the two machines. */
  handAt: number;
  /** The machine showing the wafer when the flight began. */
  ownerFrom: MachineId | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** A captured picture dissolves into the live view over this long (seconds). */
const DISSOLVE = 0.35;
/** A new flight takes over the camera's motion from the one it replaces over this long. */
const RETARGET_BLEND = 0.45;
/** Waiting longer than this for a machine to load says so on screen (milliseconds). */
const LOADING_AFTER = 250;
/** A machine that has not drawn its new state after this long is dissolved to anyway (ms). */
const SWAP_PATIENCE = 2000;

// ───────────────────────────── hero (home) ─────────────────────────────

const HERO_WIDE = { pos: new THREE.Vector3(18.8, 2.3, 1.6), target: new THREE.Vector3(-4, 1.45, -1.9), fov: 34 };
const HERO_TALL = { pos: new THREE.Vector3(19.4, 3.6, 2.4), target: new THREE.Vector3(0, -1.6, -1.2), fov: 58 };

/** The home view of the bay at decorative time t, composed for the viewport's aspect. */
export function heroPose(t: number, aspect: number, reduced: boolean, out: CamSample): void {
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
  out.a.fov = THREE.MathUtils.lerp(HERO_WIDE.fov, HERO_TALL.fov, k);
}

// ───────────────────────────── explore overview ─────────────────────────────

/** The whole bay from high above its east end; on tall screens, looking down its length. */
const OV_WIDE = { pos: new THREE.Vector3(22, 26, 26), target: new THREE.Vector3(-7, 0, -1.5) };
const OV_TALL = { pos: new THREE.Vector3(30, 36, 6), target: new THREE.Vector3(-9, -2, 0) };

export function overviewPose(aspect: number, out: CamPose) {
  const k = THREE.MathUtils.clamp((1.4 - aspect) / 0.7, 0, 1);
  out.space = 'world';
  out.scale = 'fab';
  out.fov = undefined;
  out.pos.lerpVectors(OV_WIDE.pos, OV_TALL.pos, k);
  out.target.lerpVectors(OV_WIDE.target, OV_TALL.target, k);
  if (aspect < 1) fitOverview(aspect, out);
}

const ovCam = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.5, 500);
const ovPt = new THREE.Vector3();
const ovRight = new THREE.Vector3();
const ovUp = new THREE.Vector3();
const ovCache = new Map<string, { pos: THREE.Vector3; target: THREE.Vector3 }>();

/**
 * Portrait screens: move the overview so every machine is on screen, and on phones above the
 * overview card, which covers the bottom of the view (so each one can be tapped). The view
 * direction stays; the camera is centred on the machines and pulled back until they fit.
 */
function fitOverview(aspect: number, out: CamPose) {
  if (!stationBoxes.size) return;
  const key = `${aspect.toFixed(2)}:${stationBoxes.size}`;
  let hit = ovCache.get(key);
  if (!hit) {
    const pts: THREE.Vector3[] = [];
    stationBoxes.forEach((b) => {
      for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
    });
    // the visible band of the view in NDC y: phones keep the machines above the (compact) card
    const yLo = aspect < 0.7 ? -0.6 : -0.88;
    const yHi = 0.88;
    const xLim = 0.88;
    const pos = out.pos.clone();
    const target = out.target.clone();
    ovCam.aspect = aspect;
    ovCam.updateProjectionMatrix();
    const place = (dist: number) => {
      const dir = ovPt.copy(pos).sub(target).normalize();
      ovCam.position.copy(target).addScaledVector(dir, dist);
      ovCam.lookAt(target);
      ovCam.updateMatrixWorld();
    };
    const bounds = () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        ovPt.copy(p).project(ovCam);
        x0 = Math.min(x0, ovPt.x);
        x1 = Math.max(x1, ovPt.x);
        y0 = Math.min(y0, ovPt.y);
        y1 = Math.max(y1, ovPt.y);
      }
      return { x0, x1, y0, y1 };
    };
    let dist = pos.distanceTo(target);
    for (let it = 0; it < 6; it++) {
      place(dist);
      const b = bounds();
      // centre the machines in the visible band (shift the target along the screen axes)
      ovRight.setFromMatrixColumn(ovCam.matrixWorld, 0);
      ovUp.setFromMatrixColumn(ovCam.matrixWorld, 1);
      const halfW = dist * Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * aspect;
      const halfH = dist * Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2));
      target.addScaledVector(ovRight, ((b.x0 + b.x1) / 2) * halfW);
      target.addScaledVector(ovUp, ((b.y0 + b.y1) / 2 - (yLo + yHi) / 2) * halfH);
      // then scale the distance so the spread fits
      const need = Math.max((b.x1 - b.x0) / (2 * xLim), (b.y1 - b.y0) / (yHi - yLo));
      dist *= Math.max(0.6, Math.min(1.8, need));
    }
    place(dist);
    hit = { pos: ovCam.position.clone(), target: target.clone() };
    ovCache.set(key, hit);
  }
  out.pos.copy(hit.pos);
  out.target.copy(hit.target);
}

// ───────────────────────────── helpers ─────────────────────────────

/** Development check of the level-of-detail hand-over: ?lod=proxy keeps the low-detail bay. */
const FORCE_PROXY = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('lod') === 'proxy';

/** The world's fog (Stage.tsx), near and far in metres. */
const FOG: [number, number] = [34, 110];
const LOD_DISTANCE = 16;
/** Framings are composed for a landscape viewport; narrower canvases pull the camera back. */
const DESIGN_ASPECT = 1.4;
const BAY_BOX = new THREE.Box3(new THREE.Vector3(BACKEND.x0 + 0.5, 0.2, BAY.z0 + 0.5), new THREE.Vector3(BAY.x1 - 0.5, 30, BAY.z1 - 0.5));

function fitPose(p: CamPose, fit: number) {
  if (fit === 1 || p.fov !== undefined) return; // composed framings are already fitted
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

/** Evaluate a flight at stage-clock time `now`; returns false once it is over. */
function evalFlight(f: Flight, now: number, out: CamSample): boolean {
  let t = Math.max(0, (now - f.start) / 1000);
  for (const leg of f.legs) {
    if (t < leg.dur) {
      leg.eval(t / leg.dur, out);
      return true;
    }
    t -= leg.dur;
  }
  f.legs[f.legs.length - 1].eval(1, out);
  return false;
}

/** The learner's wafer is shown by `owner` only (null: by any machine that holds it). */
function applyOwner(owner: MachineId | null) {
  waferRegistry.forEach((m, id) => {
    const v = owner === null || owner === id;
    if (m.visible !== v) m.visible = v;
  });
}

// ───────────────────────────── display-referred overlays ─────────────────────────────

/**
 * A full-screen quad drawing a copy of the displayed picture as it was (already tone-mapped
 * and encoded), with an opacity: cross-fades and dissolves blend exactly the pictures the
 * viewer saw, so nothing changes brightness or sharpness when one starts or ends.
 */
function makeOverlay() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, opacity: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float opacity; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, opacity); }',
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  return { mat, quad, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
}

/** A texture the size of the drawing buffer, (re)made on demand. */
class ScreenCopy {
  tex: THREE.FramebufferTexture | null = null;
  ensure(w: number, h: number): THREE.FramebufferTexture {
    if (!this.tex || this.tex.image.width !== w || this.tex.image.height !== h) {
      this.tex?.dispose();
      this.tex = new THREE.FramebufferTexture(w, h);
    }
    return this.tex;
  }
  fits(w: number, h: number): boolean {
    return !!this.tex && this.tex.image.width === w && this.tex.image.height === h;
  }
  dispose() {
    this.tex?.dispose();
    this.tex = null;
  }
}

// ───────────────────────────── the director ─────────────────────────────

/** What the director is showing (read by the measurement harness: both sides of a fade). */
export const directorView: { live: CamSample | null } = { live: null };

export function Director({ deviceScene, controlsRef }: { deviceScene: THREE.Scene; controlsRef: React.RefObject<CameraControls | null> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  const overlay = useMemo(() => makeOverlay(), []);
  // fade: the outgoing side of a cross-fade; snap: a captured picture being dissolved from;
  // last: the film's last good picture (held while a seek waits for its machine)
  const copies = useMemo(() => ({ fade: new ScreenCopy(), snap: new ScreenCopy(), last: new ScreenCopy(), buf: new THREE.Vector2() }), []);
  useEffect(
    () => () => {
      overlay.mat.dispose();
      overlay.quad.geometry.dispose();
      copies.fade.dispose();
      copies.snap.dispose();
      copies.last.dispose();
    },
    [overlay, copies],
  );

  const st = useRef({
    key: '',
    mode: '',
    flight: null as Flight | null,
    /** The flight a retarget replaced, still blended in for a moment (continuous motion). */
    prev: null as { flight: Flight; since: number } | null,
    freeLook: false,
    live: makeSample(),
    guided: makeSample(),
    blendTmp: makeSample(),
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
    /** The machine showing the learner's wafer. */
    owner: null as MachineId | null,
    /** The first picture with its machine loaded has been drawn. */
    shown: false,
    /** A captured picture over the live view: held at full strength, or dissolving. */
    snap: { on: false, hold: false, start: 0 },
    /** This frame's picture is already on screen (it was drawn to be captured). */
    drawn: false,
  });

  directorView.live = st.current.live;

  const fitRef = useRef(1);
  fitRef.current = Math.round(Math.pow(Math.max(1, DESIGN_ASPECT / Math.max(0.3, size.width / Math.max(1, size.height))), 0.8) * 20) / 20;

  /** What the camera should be following right now, as a key: a change starts a flight. */
  const keyFor = () => {
    const a = useApp.getState();
    if (a.mode === 'learn') return `learn:${a.step}:${a.scaleOverride ?? ''}`;
    if (a.mode === 'explore') return `explore:${a.machine ?? ''}:${a.demo ? 'demo' : ''}`;
    return a.mode;
  };

  /** The guided camera for the current mode at this instant. */
  const guidedNow = (out: CamSample, elapsed: number) => {
    const a = useApp.getState();
    out.mix = 0;
    switch (a.mode) {
      case 'home':
        heroPose(elapsed, size.width / Math.max(1, size.height), a.reducedMotion, out);
        return;
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
          return;
        }
        break;
      }
      case 'watch':
        if (!filmSample(out)) {
          overviewPose(size.width / Math.max(1, size.height), out.a);
          return;
        }
        break;
    }
    fitPose(out.a, fitRef.current);
    if (out.mix > 0) fitPose(out.b, fitRef.current);
  };

  /** Build a flight from the live camera to a (live) target pose. */
  const planFlight = (target: () => CamPose, reduced: boolean, now: number, thenFree = false): Flight => {
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
    return { legs, total, start: now, to: station, from, thenFree, handAt: handoverAt(legs), ownerFrom: s.owner ?? from };
  };

  const guidedTarget = () => {
    const sample = makeSample();
    return () => {
      guidedNow(sample, stageTime.decor);
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
    // A lazily loaded module that failed cannot be fetched again in this page: reload it
    // (the address and the session keep the viewer's place).
    directorCommands.retry = () => window.location.reload();
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
      s.prev = null;
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

  /** Opacity of the captured picture right now. */
  const snapOpacity = (now: number) => {
    const sn = st.current.snap;
    if (!sn.on) return 0;
    if (sn.hold) return 1;
    const o = 1 - smoothstep((now - sn.start) / 1000 / DISSOLVE);
    if (o <= 0.001) sn.on = false;
    return o;
  };

  useFrame(() => {
    const s = st.current;
    const a = useApp.getState();
    const clock = useClock.getState();
    const now = stageTime.clock();
    const controls = controlsRef.current;
    const reduced = a.reducedMotion;
    s.drawn = false;
    quality.frame++;

    filmBridge.aspect = size.width / Math.max(1, size.height);
    // ── what should we be looking at? ──
    guidedNow(s.guided, stageTime.decor);
    const key = keyFor();
    const want = focusStation();
    let waiting = false;
    if (key !== s.key || s.restore) {
      // Destination first: hold the picture until the next machine has loaded (however long
      // that takes: the page says what it is waiting for; a model that fails to load is shown
      // from outside instead). The latest destination is the one waited for.
      if (want && !readyStations.has(want) && !failedStations.has(want) && !s.first) {
        if (s.waitingFor !== want) {
          s.waitingFor = want;
          s.waitSince = now;
        }
        waiting = true;
      } else {
        s.waitingFor = null;
        const modeChanged = s.mode !== a.mode;
        const cut = s.first || (a.mode === 'watch' && modeChanged);
        // Whatever is on screen now — half of a cross-fade, a dissolve, a machine about to
        // change what it shows — is captured as displayed, and dissolved from.
        const mid = s.live.mix > 0.001 && s.live.mix < 0.999;
        const gate = handover.swap;
        if (!cut && (mid || s.snap.on || (gate && !gate.captured))) capture(now);
        const old = s.flight;
        s.key = key;
        s.mode = a.mode;
        const restore = s.restore;
        s.restore = null;
        s.freeLook = false;
        if (cut) {
          s.flight = null;
          s.prev = null;
          s.snap.on = false;
          copySample(s.live, s.guided);
          stageFocus.station = want;
          s.owner = a.mode === 'home' ? null : want;
        } else {
          s.flight = restore ? planFlight(() => restore, reduced, now, true) : planFlight(guidedTarget(), reduced, now);
          // a flight replaced mid-way hands its motion over smoothly (unless a dissolve covers it)
          s.prev = old && !s.snap.on && s.live.mix === 0 ? { flight: old, since: now } : null;
        }
        s.first = false;
        configureControls(controls, a.mode);
      }
    }
    // Watch: a seek or a chapter jump to a machine that is not loaded yet holds the film's last
    // good picture (the scene has already moved on to the new time), then dissolves from it.
    if (a.mode === 'watch' && s.mode === 'watch' && !s.first) {
      const hold = !!want && !readyStations.has(want) && !failedStations.has(want);
      if (hold) {
        if (s.waitingFor !== want) {
          s.waitingFor = want;
          s.waitSince = now;
        }
        waiting = true;
      } else if (s.waitingFor) {
        s.waitingFor = null;
        const buf = gl.getDrawingBufferSize(copies.buf);
        if (copies.last.fits(buf.x, buf.y)) {
          // the held picture becomes the one dissolved from
          const t = copies.snap.tex;
          copies.snap.tex = copies.last.tex;
          copies.last.tex = t;
          s.snap.on = true;
          s.snap.hold = false;
          s.snap.start = now;
        }
      }
    }
    // A machine changing what it shows without a new destination: capture it all the same.
    const gate = handover.swap;
    if (gate && !gate.captured && !waiting) capture(now);
    if (gate && gate.captured) {
      if (!gate.committed && now - s.snap.start < SWAP_PATIENCE) {
        // hold the captured picture (and the camera) until the machine shows its new state
        s.snap.on = true;
        s.snap.hold = true;
        if (s.flight) s.flight.start = now;
      } else {
        // dissolve in place, then move
        s.snap.hold = false;
        s.snap.start = now;
        if (s.flight) s.flight.start = now + DISSOLVE * 1000;
        handover.swap = null;
      }
    }

    // ── choose the frame ──
    const free = s.freeLook && (a.mode === 'learn' || a.mode === 'explore');
    if (s.flight) {
      const f = s.flight;
      const going = evalFlight(f, now, s.live);
      if (going && s.prev) {
        // blend in from the replaced flight's own motion (continuous velocity)
        const w = smoothstep((now - s.prev.since) / 1000 / RETARGET_BLEND);
        if (w >= 1) s.prev = null;
        else {
          const b = s.blendTmp;
          evalFlight(s.prev.flight, now, b);
          if (b.mix === 0 && s.live.mix === 0 && b.a.space === s.live.a.space) {
            s.live.a.pos.lerpVectors(b.a.pos, s.live.a.pos, w);
            s.live.a.target.lerpVectors(b.a.target, s.live.a.target, w);
            if (b.a.fov !== undefined || s.live.a.fov !== undefined) s.live.a.fov = fovOf(b.a) + (fovOf(s.live.a) - fovOf(b.a)) * w;
          }
        }
      }
      const el = Math.max(0, (now - f.start) / 1000);
      const handed = el >= f.handAt;
      stageFocus.station = handed ? f.to : (f.from ?? f.to);
      s.owner = handed ? f.to : f.ownerFrom;
      if (!going) {
        s.flight = null;
        s.prev = null;
        if (s.live.mix >= 0.5) copyPose(s.live.a, s.live.b);
        s.live.mix = 0;
        stageFocus.station = f.to;
        s.owner = f.to;
        if (f.thenFree) {
          s.freeLook = true;
          const p = s.live.a;
          controls?.setLookAt(p.pos.x, p.pos.y, p.pos.z, p.target.x, p.target.y, p.target.z, false);
        }
      }
    } else if (waiting) {
      // hold the current picture: the camera stays where it is
    } else if (free) {
      // the controls own the camera: read it back
      if (controls) {
        controls.getPosition(s.live.a.pos);
        controls.getTarget(s.live.a.target);
        s.live.a.space = s.lastSpace;
        s.live.a.scale = undefined;
        s.live.a.fov = undefined;
        s.live.mix = 0;
      }
      s.owner = a.mode === 'home' ? null : want;
    } else {
      copySample(s.live, s.guided);
      stageFocus.station = want;
      s.owner = a.mode === 'home' ? null : want;
    }
    // The film hands its wafer over on its own timeline.
    if (a.mode === 'watch') s.owner = filmBridge.station;
    handover.owner = s.owner;

    // The lesson clock waits for the camera to arrive (and for the first picture to be shown).
    if (a.mode === 'learn' && clock.pendingPlay && !s.flight && !waiting && !handover.swap && s.shown) useClock.setState({ playing: true, pendingPlay: false });

    // ── controls: enabled only when the learner may look around ──
    if (controls) {
      const interactive = (a.mode === 'learn' || a.mode === 'explore') && !s.flight && !waiting;
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

    finishFrame(!!s.flight || waiting, now, want);
  }, 1);

  /**
   * Capture the picture on screen right now (the last frame's view, including any half-done
   * cross-fade or dissolve) and hold it over the live view: the next flight starts under it.
   * The captured frame is also this frame's picture.
   */
  function capture(now: number) {
    const s = st.current;
    const gate = handover.swap;
    renderFrame(s.live, now);
    const buf = gl.getDrawingBufferSize(copies.buf);
    gl.copyFramebufferToTexture(copies.snap.ensure(buf.x, buf.y));
    s.snap.on = true;
    s.snap.hold = false;
    s.snap.start = now;
    s.drawn = true;
    if (gate && !gate.captured) {
      gate.captured = true;
      s.snap.hold = true;
      remount();
    }
  }

  /** Level of detail, labels, published info, and the render itself. */
  function finishFrame(flying: boolean, now: number, want: MachineId | null) {
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
    for (const id of readyStations) if (!s.readyPrev.has(id) && (!s.flight || !s.shown)) cutInstant.add(id);
    if (readyStations.size !== s.readyPrev.size || [...readyStations].some((id) => !s.readyPrev.has(id))) {
      s.readyPrev = new Set(readyStations);
      quality.invalidate('world');
    }
    if (a.reducedMotion) cutOpen.forEach((id) => cutInstant.add(id));
    fabLod.apply();
    stationGroups.forEach((g, id) => {
      const v = proxyHidden.has(id) || cutAmount(id) > 0.001 || cutOpen.has(id);
      if (g.visible !== v) {
        g.visible = v;
        quality.invalidate('world');
      }
      const c = cutAmount(id);
      if (c > 0.001 && c < 0.999) quality.invalidate('world');
    });

    labelStations.clear();
    const f = focusStation();
    if (f) labelStations.add(f);

    // Fog hides the far end of the floor; a distant overview (a phone's, say) pushes it back
    // with the camera so the bay stays readable.
    if (scene.fog instanceof THREE.Fog && cam.space === 'world') {
      const d = cam.pos.distanceTo(cam.target);
      scene.fog.near = Math.max(FOG[0], d * 0.75);
      scene.fog.far = Math.max(FOG[1], d * 2.2);
    }

    // The picture may be revealed once its machine is loaded (or known to have failed).
    const settled = !want || readyStations.has(want) || failedStations.has(want);
    if (!s.shown && settled && !s.waitingFor) s.shown = true;
    const loading = s.waitingFor ? (now - s.waitSince > LOADING_AFTER ? s.waitingFor : null) : !s.shown ? want : null;
    const failed = want && failedStations.has(want) ? want : null;

    s.lastSpace = cam.space;
    if (!flying) s.lastStation = f;
    publish({
      space: cam.space,
      freeLook: s.freeLook && (a.mode === 'learn' || a.mode === 'explore'),
      flying,
      scale: scaleOf(cam, a.mode),
      loading,
      failed,
      shown: s.shown,
    });
    if (s.drawn) return;
    const buf = gl.getDrawingBufferSize(copies.buf);
    if (a.mode === 'watch' && s.waitingFor && copies.last.fits(buf.x, buf.y)) {
      // hold the last good picture
      gl.setRenderTarget(null);
      gl.clear();
      drawOverlay(copies.last.tex!, 1);
      return;
    }
    renderFrame(s.live, now);
    // the film keeps a copy of what it shows, in case a seek has to hold it
    if (a.mode === 'watch') gl.copyFramebufferToTexture(copies.last.ensure(buf.x, buf.y));
  }

  function applyCamera(p: CamPose) {
    camera.position.copy(p.pos);
    camera.lookAt(p.target);
    const d = p.pos.distanceTo(p.target);
    const near = p.space === 'device' ? 0.05 : clamp(d * 0.02, 0.004, 0.25);
    const far = p.space === 'device' ? 200 : 400;
    const fov = fovOf(p);
    if (camera.near !== near || camera.far !== far || Math.abs(camera.fov - fov) > 1e-4) {
      camera.near = near;
      camera.far = far;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  const sceneOf = (space: Space) => (space === 'device' ? deviceScene : scene);

  /** Draw one view to the screen. */
  function drawView(p: CamPose, owner: MachineId | null) {
    applyOwner(owner);
    applyCamera(p);
    gl.setRenderTarget(null);
    quality.beforeRender(gl, p.space);
    gl.render(sceneOf(p.space), camera);
  }

  function drawOverlay(tex: THREE.Texture, opacity: number) {
    overlay.mat.uniforms.map.value = tex;
    overlay.mat.uniforms.opacity.value = opacity;
    const auto = gl.autoClear;
    gl.autoClear = false;
    gl.render(overlay.scene, overlay.cam);
    gl.autoClear = auto;
  }

  function renderFrame(sample: CamSample, now: number) {
    const s = st.current;
    const mix = sample.mix;
    const buf = gl.getDrawingBufferSize(copies.buf);
    // A cross-fade from one machine's picture to the other's (a reduced-motion flight) shows
    // the wafer on each side where that side's machine has it. Any other fade is into or out
    // of the layers at one machine, and shows it where the move has it at the time: at the
    // machine being left until the hand-over, then at the next (the wafer never disappears
    // from the picture the camera is leaving or arriving at).
    const f = s.flight;
    const across = !!f && !!legAt(f.legs, (now - f.start) / 1000)?.across;
    if (mix <= 0.001 || mix >= 0.999) {
      drawView(mix >= 0.999 ? sample.b : sample.a, s.owner);
    } else {
      // cross-fade: the outgoing view as displayed, the incoming view, blended
      drawView(sample.a, across ? f!.ownerFrom : s.owner);
      const tex = copies.fade.ensure(buf.x, buf.y);
      gl.copyFramebufferToTexture(tex);
      drawView(sample.b, across ? f!.to : s.owner);
      drawOverlay(tex, 1 - mix);
    }
    applyOwner(s.owner);
    const so = snapOpacity(now);
    if (so > 0) {
      // a picture captured at another size (the window was resized) is dropped
      if (copies.snap.tex && copies.snap.fits(buf.x, buf.y)) drawOverlay(copies.snap.tex, so);
      else s.snap.on = false;
    }
    // Labels only once the new view has settled in: never floating between two scales.
    const fading = mix > 0.001 && mix < 0.999;
    const alpha = so > 0.5 ? 0 : fading ? (mix < 0.85 ? 0 : (mix - 0.85) / 0.15) : 1;
    projectLabels(camera, (mix >= 0.5 ? sample.b : sample.a).space, alpha, size.width, size.height, gl.domElement);
  }

  return null;
}

/** Orbit limits per mode: Explore keeps the camera inside the building. */
function configureControls(c: CameraControls | null, mode: string) {
  if (!c) return;
  if (mode === 'explore') c.setBoundary(BAY_BOX);
  else c.setBoundary();
}
