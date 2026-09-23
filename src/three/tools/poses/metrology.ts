import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Metrology scene (metres): the CD-SEM chamber (front cut away) at the
 * origin with its column above, the load lock and transfer arm to the left, the front end
 * with its load ports in front of them, and the operator's monitor (the live SEM image) on its
 * arm at the front right.
 */
export const POSE: ToolPose = {
  pos: [0.9, 2.3, 3.35],
  target: [0.32, 1.25, 0.5],
  // The chamber stands right of and behind the housing's centre, the monitor on the housing's arm.
  mount: { yaw: 0, offset: [0.2, -0.15] },
  // The cabinet opens above the chamber floor, in front of the rear bulkhead.
  cutaway: { z: -0.74, y: 0.87 },
};
