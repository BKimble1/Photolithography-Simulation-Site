import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Inspect scene (metres): the stage and optical head at the origin,
 * the defect-map monitor to the right. The review variant adds an SEM column at x = 0.3.
 */
export const POSE: ToolPose = {
  pos: [0.95, 1.95, 2.45],
  target: [0.3, 1.08, 0.02],
  variants: {
    review: { pos: [1.0, 1.95, 2.45], target: [0.33, 1.08, 0.02] },
  },
};
