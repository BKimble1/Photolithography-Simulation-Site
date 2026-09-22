import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Etch scene (metres). The cutaway process chamber sits at the origin
 * in the foreground; the transfer chamber, load lock and EFEM recede along −x.
 */
export const POSE: ToolPose = {
  pos: [1.22, 2.08, 2.3],
  target: [-0.28, 0.96, -0.06],
  variants: {
    ash: { pos: [1.22, 2.14, 2.3], target: [-0.28, 1.03, -0.06] },
  },
};
