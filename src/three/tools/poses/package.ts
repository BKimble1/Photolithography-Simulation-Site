import type { ToolPose } from '../../poses';

/** Camera pose(s) for the Package scene (metres). Variant poses override the default. */
export const POSE: ToolPose = {
  pos: [0.012, 1.17, 0.205],
  target: [-0.038, 1.002, 0.0],
  min: 0.06,
  max: 1.6,
  variants: {
    attach: { pos: [0.012, 1.17, 0.205], target: [-0.038, 1.002, 0.0], min: 0.06, max: 1.6 },
    bond: { pos: [0.056, 1.043, 0.03], target: [0.0005, 1.0012, -0.0095], min: 0.03, max: 1.6 },
  },
};
