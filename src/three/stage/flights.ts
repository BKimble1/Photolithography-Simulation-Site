/**
 * Camera moves between framings, shared by the director (Learn and Explore flights, computed
 * on the fly) and the film (the same moves, laid out on the media timeline).
 *
 * A transition is a list of legs, each a function of its own 0..1 progress:
 *   - a direct move, for short distances and high overview shots;
 *   - an aisle move between machines: step back into the central aisle (clear of equipment,
 *     through the doorway to the back-end room), travel along it looking ahead, turn in;
 *   - an establishing beat when arriving at a new machine;
 *   - the anchored world ↔ device cross-fade through your die;
 *   - with reduced motion, a short cross-fade between two still compositions instead.
 */
import * as THREE from 'three';
import type { MachineId } from '../../state/nav';
import { waferShown } from './anchors';
import { copyPose, deviceToWorld, lerpPose, machinePose, makePose, resolve, worldToDevice, type CamPose, type CamSample } from './tracks';

export interface Leg {
  dur: number;
  eval: (u: number, out: CamSample) => void;
}



export const smooth = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));


/** Inside a tool row rather than in the central aisle (the aisle is |z| < 1.8 m). */
const deep = (p: THREE.Vector3) => Math.abs(p.z) > 1.6;
const aisleZ = (z: number) => Math.max(-0.5, Math.min(0.5, z)) * 0.5;

/**
 * A world move from `from` to a live target. Between machines the camera steps back into the
 * central aisle (clear of equipment, through the doorway to the back-end room), travels along
 * it looking ahead, and turns in to the next machine; short moves are direct.
 */
export function worldLeg(from: CamPose, target: () => CamPose): Leg {
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
      // (the arc-length lookup is only defined on 0..1)
      const k = smooth(clamp(u, 0, 1));
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
export function fadeLeg(from: CamPose, target: () => CamPose): Leg {
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

/** Hold a framing for a moment (the establishing beat on arriving at a new machine). */
export function holdLeg(pose: CamPose, dur: number): Leg & { pose: CamPose } {
  return {
    pose,
    dur,
    eval: (_, out) => {
      out.mix = 0;
      copyPose(out.a, pose);
    },
  };
}

/** The establishing pose held in a flight so far, if any (the next leg starts from it). */
export function establishPose(legs: Leg[]): CamPose | null {
  for (let i = legs.length - 1; i >= 0; i--) {
    const l = legs[i] as Leg & { pose?: CamPose };
    if (l.pose) return l.pose;
  }
  return null;
}


export interface TransitionOpts {
  /** The machine the camera leaves (a retrace from the cross-section starts at its wafer). */
  from: MachineId | null;
  /** The machine of the destination framing. */
  to: MachineId | null;
  /** Show the whole new machine for a moment before moving in. */
  establish: boolean;
  reduced: boolean;
  /** Adjust an intermediate framing for the viewport (the director's aspect fit). */
  fit: (p: CamPose) => void;
}

/** The legs of a move from `start` to a (possibly moving) target framing. */
export function planTransition(start: CamPose, target: () => CamPose, o: TransitionOpts): Leg[] {
  const startPose = copyPose(makePose(), start);
  const probe = target();
  const legs: Leg[] = [];

  /** World to world, via the new machine's establishing shot when changing machine. */
  const worldPath = (from: CamPose) => {
    if (o.establish && o.to) {
      const est = machinePose(o.to, makePose());
      o.fit(est);
      legs.push(worldLeg(from, () => est));
      legs.push(holdLeg(est, 0.35));
      legs.push(worldLeg(est, target));
    } else legs.push(worldLeg(from, target));
  };

  if (o.reduced) {
    legs.push(fadeLeg(startPose, target));
  } else if (startPose.space === 'world' && probe.space === 'world') {
    worldPath(startPose);
  } else if (startPose.space === 'device' && probe.space === 'device') {
    legs.push({ dur: 0.8, eval: (u, out) => ((out.mix = 0), lerpPose(startPose, target(), smooth(u), out.a)) });
  } else if (startPose.space === 'device') {
    // Retrace: out of the cross-section onto the wafer it came from (or the machine, if the wafer
    // is not in it at the moment), then on to the new framing.
    const origin = o.from ?? o.to;
    const onWafer = makePose();
    if (!origin || waferShown(origin)) resolve({ kind: 'wafer', framing: 'die' }, { station: origin }, onWafer);
    else machinePose(origin, onWafer);
    o.fit(onWafer);
    legs.push({ dur: 1.1, eval: (u, out) => deviceToWorld(startPose, onWafer, u, origin, out) });
    worldPath(onWafer);
  } else {
    // Down to the wafer, pick out your die, then reveal the cross-section. If the wafer is not
    // in this machine at the moment (it is in another tool for this part of the step), the
    // cross-section is revealed from the machine itself rather than from an empty holder.
    const anchor = makePose();
    if (!o.to || waferShown(o.to)) resolve({ kind: 'wafer', framing: 'die' }, { station: o.to }, anchor);
    else machinePose(o.to, anchor);
    o.fit(anchor);
    worldPath(startPose);
    legs.pop();
    const from = establishPose(legs) ?? startPose;
    if (from.pos.distanceTo(anchor.pos) > 0.05) legs.push(worldLeg(from, () => anchor));
    legs.push({ dur: 1.2, eval: (u, out) => worldToDevice(anchor, target(), u, o.to, out) });
  }
  return legs;
}

/** Evaluate a list of legs at time t (seconds from the start); returns false once past the end. */
export function evalLegs(legs: Leg[], t: number, out: CamSample): boolean {
  t = Math.max(0, t);
  for (const leg of legs) {
    if (t < leg.dur) {
      leg.eval(leg.dur > 0 ? t / leg.dur : 1, out);
      return true;
    }
    t -= leg.dur;
  }
  if (legs.length) legs[legs.length - 1].eval(1, out);
  return false;
}
