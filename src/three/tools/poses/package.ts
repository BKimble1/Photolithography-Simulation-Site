import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Package scene (metres): two machines on benches, the die bonder at
 * x = −0.75 (attach) and the wire bonder at x = 0.75 (bond), with their work holders at
 * y ≈ 1.0. Close framings of the millimetre-scale work.
 */
export const POSE: ToolPose = {
  pos: [-0.738, 1.17, 0.205],
  target: [-0.788, 1.002, 0.0],
  min: 0.06,
  max: 1.6,
  // The machines open above their work holders, in front of their rear halves.
  cutaway: { z: -0.15, y: 0.95 },
  variants: {
    attach: { pos: [-0.738, 1.17, 0.205], target: [-0.788, 1.002, 0.0], min: 0.06, max: 1.6 },
    bond: { pos: [0.806, 1.043, 0.03], target: [0.7505, 1.0012, -0.0095], min: 0.03, max: 1.6 },
  },
  shots: {
    // Both machines on their benches, from above the bench fronts: the way from one machine's
    // close-up to the other's (a straight line between them runs through the machines).
    benches: { pos: [0, 1.75, 1.35], target: [0, 1.0, -0.05] },
    // The wire bond's close-up pulled back 0.35 m along its own line of sight, so the camera
    // arrives at the capillary the way it looks at it.
    bondApproach: { pos: [1.047, 1.225, 0.202], target: [0.7505, 1.0012, -0.0095] },
  },
};
