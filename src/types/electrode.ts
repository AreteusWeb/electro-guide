export const ELECTRODE_IDS = [
  "RA",
  "LA",
  "RL",
  "LL",
  "V1",
  "V2",
  "V3",
  "V4",
  "V5",
  "V6",
] as const;

export type ElectrodeId = (typeof ELECTRODE_IDS)[number];

export const LIMB_ELECTRODES: ReadonlySet<ElectrodeId> = new Set([
  "RA",
  "LA",
  "RL",
  "LL",
]);

export const PRECORDIAL_ELECTRODES: ReadonlySet<ElectrodeId> = new Set([
  "V1",
  "V2",
  "V3",
  "V4",
  "V5",
  "V6",
]);

/** MediaPipe Pose landmark indices we actually use. */
export const POSE_INDEX = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

export type Landmark = {
  x: number;
  y: number;
  z: number;
  visibility: number;
};

export type PoseLandmarks = Landmark[];

export type ElectrodePoint = {
  id: ElectrodeId;
  /** Normalized image coordinates in [0, 1], same space as MediaPipe landmarks. */
  x: number;
  y: number;
};

export type PoseIssue =
  | "no-torso"
  | "rotated"
  | "too-far"
  | "too-close";

export type PoseAssessment = {
  detected: boolean;
  issue: PoseIssue | null;
  message: string | null;
  torsoWidth: number;
  torsoHeight: number;
  visibility: number;
};

export type CalibrationSettings = {
  /** EMA alpha: higher = follow motion faster, more jitter. */
  alpha: number;
  /** Added to every electrode offset.x (fraction of torso width). */
  nudgeX: number;
  /** Added to every electrode offset.y (fraction of torso height). */
  nudgeY: number;
  /** Multiplies all electrode offsets around the sternal origin. */
  scale: number;
};

export const DEFAULT_CALIBRATION: CalibrationSettings = {
  alpha: 0.5,
  nudgeX: 0,
  nudgeY: 0,
  scale: 1,
};
