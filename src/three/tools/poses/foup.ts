import type { ToolPose } from '../../poses';

/** Camera pose(s) for the Foup scene (metres). Variant poses override the default. */
export const POSE: ToolPose = {
  pos: [2.55, 2.95, -0.6],
  target: [0.28, 1.16, 0.14],
  variants: {
    dock: { pos: [2.55, 2.95, -0.6], target: [0.28, 1.16, 0.14] },
    robot: { pos: [0.37, 1.55, -0.45], target: [0.37, 1.02, -0.74] },
  },
};
