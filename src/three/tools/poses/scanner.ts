import type { ToolPose } from '../../poses';

export const POSE: ToolPose = {
  pos: [1.95, 1.78, 2.5],
  target: [0.26, 1.42, -0.05],
  variants: {
    reticle: { pos: [1.35, 2.3, 1.25], target: [0.5, 2.02, -0.05] },
    align: { pos: [0.55, 1.18, 1.2], target: [-0.3, 0.8, -0.02] },
    expose: { pos: [1.95, 1.78, 2.5], target: [0.26, 1.42, -0.05] },
  },
};
