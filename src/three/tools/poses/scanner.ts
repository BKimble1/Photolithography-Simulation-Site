import type { ToolPose } from '../../poses';

export const POSE: ToolPose = {
  pos: [2.2, 2.0, 2.8],
  target: [0, 1.25, 0],
  variants: {
    reticle: { pos: [1.2, 2.35, 1.6], target: [0, 2.05, 0] },
    align: { pos: [1.15, 1.2, 1.35], target: [0, 0.95, 0] },
    expose: { pos: [2.1, 1.9, 2.6], target: [0, 1.35, 0] },
  },
};
