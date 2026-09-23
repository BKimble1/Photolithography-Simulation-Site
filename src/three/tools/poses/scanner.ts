import type { ToolPose } from '../../poses';

/**
 * Camera pose(s) for the Scanner scene (metres). The wafer-stage line is z = 0: the projection
 * lens at x = 0.3 (reticle stage above it at y = 2.02, illuminator on top), the alignment
 * sensor over the measure stage at x = −0.4, the reticle library at x = 1.95 and the wafer
 * handler at the left end. Framings look in through the cut-away front and top.
 */
export const POSE: ToolPose = {
  pos: [2.4, 2.3, 3.3],
  target: [0.25, 1.72, -0.1],
  // The stage line stands 0.25 m in front of the housing's centre; the rear bulkhead at its cut.
  mount: { yaw: 0, offset: [0, 0.25] },
  // The steel upper enclosure opens in front of the rear bulkhead, above the white lower band.
  cutaway: { z: -0.75, y: 1.03 },
  variants: {
    reticle: { pos: [1.95, 3.05, 1.75], target: [1.1, 2.05, -0.05] },
    align: { pos: [0.35, 1.4, 1.4], target: [-0.4, 0.78, 0.0] },
    expose: { pos: [2.4, 2.3, 3.3], target: [0.25, 1.72, -0.1] },
  },
};
