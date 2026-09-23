import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Etch scene (metres). The etch chamber (drawn in cutaway) is at the
 * origin; the transfer-chamber hub is at x = −0.912 with the load lock in front of it (+z) and
 * the EFEM beyond; the strip (ash) chamber is on the far side of the hub (x = −1.824), the
 * cluster's mirror image. Framings look into the chamber in use from the aisle side, over the
 * cut-down EFEM, with the load lock and the robot in view (and stay west of the litho bay's
 * amber partition, 2.25 m east of the station centre).
 */
export const POSE: ToolPose = {
  pos: [1.2, 2.75, 2.55],
  target: [-0.45, 0.98, 0.26],
  // The hub stands at the centre of the bay model's transfer chamber, the EFEM on its front.
  mount: { yaw: 0, offset: [0.912, -0.16] },
  // Everything in front of the gas cabinet opens above the chamber floors.
  cutaway: { z: -1.41, y: 0.76 },
  variants: {
    ash: { pos: [-3.02, 2.77, 2.55], target: [-1.37, 1.02, 0.26] },
  },
};
