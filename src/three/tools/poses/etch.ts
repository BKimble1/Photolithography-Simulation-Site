import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Etch scene (metres). The cutaway process chamber sits at the origin
 * in the foreground; the transfer chamber, load lock and EFEM recede along −x.
 */
export const POSE: ToolPose = {
  pos: [-1.0, 1.75, 1.35],
  target: [-1.55, 1.0, 0.0],
  variants: {
    ash: { pos: [1.22, 2.14, 2.3], target: [-0.28, 1.03, -0.06] },
  },
};
