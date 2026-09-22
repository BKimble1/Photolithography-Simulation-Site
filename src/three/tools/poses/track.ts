import type { ToolPose } from '../../poses';

export const POSE: ToolPose = {
  pos: [0.62, 1.34, 0.72],
  target: [0, 1.0, 0],
  variants: {
    prime: { pos: [1.92, 1.36, 0.66], target: [1.4, 0.95, -0.02] },
    coat: { pos: [0.46, 1.36, 0.74], target: [0, 0.9, -0.02] },
    bake: { pos: [-0.18, 1.36, 0.66], target: [-0.7, 0.95, -0.02] },
    develop: { pos: [1.22, 1.33, 0.64], target: [0.7, 0.94, -0.02] },
  },
};
