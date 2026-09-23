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
};
