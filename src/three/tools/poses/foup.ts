import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Foup scene (metres). The scene is the inside of the wafer sorter that
 * stands at this station (`sorter` in Fab.tsx): its EFEM front wall is the tool frame's z = 0,
 * with our load port at x = 0.3 and the robot and pre-aligner behind. Mounted so that the pod
 * on our port hangs straight under the bay's overhead rail (station z = 1.1). The cutaway
 * opens the enclosure in front of EFEM z = −0.62 above the load-port stages.
 */
export const POSE: ToolPose = {
  pos: [1.39, 2.09, 1.49],
  target: [0.3, 1.15, 0.1],
  mount: { yaw: 0, offset: [0.06, 0.823] },
  cutaway: { z: 0.203, y: 0.62 },
  variants: {
    // front right: the pod comes down on the hoist and docks, the enclosure open behind it
    dock: { pos: [1.39, 2.09, 1.49], target: [0.3, 1.15, 0.1] },
    // front right, above the port band: pod, robot and pre-aligner in one view
    robot: { pos: [1.14, 2.4, 1.02], target: [0.22, 1.05, -0.3] },
  },
};
