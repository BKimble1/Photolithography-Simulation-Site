import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Depo scene (metres). The hexagonal transfer chamber is at the origin;
 * the load locks and the front end face the aisle (+z), the cutaway process chamber is on the
 * west side (−x) and opens toward the front left, chamber B opposite it, two more behind.
 * The bay model (`depoCluster` in Fab.tsx) is the same cluster in low detail; the cutaway
 * takes everything above the chamber frames in front of the gas cabinet (station y > 0.82,
 * z > −1.24) and the detailed cluster takes its place, with the front end cut down to 1.3 m.
 */
export const POSE: ToolPose = {
  pos: [-2.1, 2.55, 1.85],
  target: [-0.5, 1.0, 0.1],
  mount: { yaw: 0, offset: [0, 0] },
  cutaway: { z: -1.24, y: 0.82 },
};
