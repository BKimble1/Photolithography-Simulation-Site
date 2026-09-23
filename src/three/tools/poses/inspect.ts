import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Inspect scene (metres): the stage and optical head at the origin, the
 * review SEM column at x = 0.3. Mounted in the rear module of the inspection tool's housing
 * (`inspection` in Fab.tsx), behind the front end and its load ports; the cutaway opens both
 * above the pods (station y > 1.25) in front of the module's back (station z > −0.55).
 * Wafer framings look from each variant's direction, so the variants also choose which side
 * of the optical head the close-up is seen from.
 */
export const POSE: ToolPose = {
  pos: [1.05, 2.1, 2.55],
  target: [0.2, 1.15, -0.05],
  mount: { yaw: 0, offset: [-0.1, -0.4] },
  cutaway: { z: -0.55, y: 1.25 },
  variants: {
    // from the right: the objective stays beyond the wafer while the stage spirals under it
    scan: { pos: [0.95, 1.75, 0.35], target: [0.05, 1.1, -0.02] },
    // the wafer resting at the stage's load position, clear of the optics
    diemap: { pos: [1.05, 1.9, 1.3], target: [0.28, 1.08, 0.05] },
    review: { pos: [1.0, 1.95, 2.45], target: [0.33, 1.08, 0.02] },
  },
};
