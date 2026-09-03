import {
  ELECTRODE_IDS,
  POSE_INDEX,
  type CalibrationSettings,
  type ElectrodeId,
  type ElectrodePoint,
  type Landmark,
  type PoseAssessment,
  type PoseLandmarks,
} from "../types/electrode";

/**
 * PLACEHOLDER anatomical offsets — edit these constants, not the mapping logic.
 *
 * Coordinate system (subject anatomy, not screen pixels):
 * - origin: estimated sternal notch (slightly below the shoulder midpoint)
 * - x: fraction of CHEST width (narrower than acromion-to-acromion)
 *      +x = anatomical LEFT of the subject
 *      x =  0.50 ≈ left chest wall / anterior axillary line
 *      x = -0.50 ≈ right chest wall
 * - y: fraction of torso height (sternal notch → mid-hips)
 *      +y = toward the hips / feet
 *
 * These numbers are first guesses for a 12-lead chest layout (Mason-Likar
 * limb leads on the torso). They are NOT clinically validated.
 */
export const ELECTRODE_OFFSETS: Record<ElectrodeId, { x: number; y: number }> = {
  // Mason-Likar on torso. Keep V5/V6 on the ribcage, not past the side wall.
  RA: { x: -0.38, y: 0.00 },
  LA: { x: 0.38, y: 0.00 },
  RL: { x: -0.30, y: 0.90 },
  LL: { x: 0.30, y: 0.90 },
  V1: { x: -0.10, y: 0.24 },
  V2: { x: 0.10, y: 0.24 },
  V3: { x: 0.24, y: 0.34 },
  V4: { x: 0.34, y: 0.44 },
  V5: { x: 0.45, y: 0.44 },
  V6: { x: 0.54, y: 0.44 },
};

/** Drop the origin from the acromion line down toward the sternal notch. */
const STERNAL_NOTCH_Y = 0.12;
/**
 * MediaPipe shoulders sit on the acromion (outside the thorax).
 * The ribcage is typically ~70–76% of that biacromial width.
 */
const CHEST_WIDTH_FROM_SHOULDERS = 0.73;

const MIN_LANDMARK_VISIBILITY = 0.5;
const ROTATION_Z_THRESHOLD = 0.35;
const PROFILE_WIDTH_RATIO = 0.12;
const TORSO_TOO_FAR = 0.10;
const TORSO_TOO_CLOSE = 0.85;

export type TorsoFrame = {
  origin: Landmark;
  leftUnit: { x: number; y: number };
  downUnit: { x: number; y: number };
  torsoWidth: number;
  torsoHeight: number;
  leftShoulder: Landmark;
  rightShoulder: Landmark;
  leftHip: Landmark;
  rightHip: Landmark;
  midHips: Landmark;
  nose: Landmark | null;
};

export function getTorsoFrame(landmarks: PoseLandmarks): TorsoFrame | null {
  const leftShoulder = landmarks[POSE_INDEX.LEFT_SHOULDER];
  const rightShoulder = landmarks[POSE_INDEX.RIGHT_SHOULDER];
  const leftHip = landmarks[POSE_INDEX.LEFT_HIP];
  const rightHip = landmarks[POSE_INDEX.RIGHT_HIP];
  const nose = landmarks[POSE_INDEX.NOSE] ?? null;

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return null;
  }

  const midShoulders = midpoint(leftShoulder, rightShoulder);
  const midHips = midpoint(leftHip, rightHip);
  const shoulderWidth = distance2d(leftShoulder, rightShoulder);
  const downX = midHips.x - midShoulders.x;
  const downY = midHips.y - midShoulders.y;
  const shoulderToHip = Math.hypot(downX, downY);

  if (shoulderWidth < 1e-4 || shoulderToHip < 1e-4) {
    return null;
  }

  const origin: Landmark = {
    x: midShoulders.x + downX * STERNAL_NOTCH_Y,
    y: midShoulders.y + downY * STERNAL_NOTCH_Y,
    z: midShoulders.z + (midHips.z - midShoulders.z) * STERNAL_NOTCH_Y,
    visibility: midShoulders.visibility,
  };

  const torsoWidth = shoulderWidth * CHEST_WIDTH_FROM_SHOULDERS;
  const torsoHeight = distance2d(origin, midHips);

  if (torsoHeight < 1e-4) {
    return null;
  }

  return {
    origin,
    leftUnit: {
      x: (leftShoulder.x - rightShoulder.x) / shoulderWidth,
      y: (leftShoulder.y - rightShoulder.y) / shoulderWidth,
    },
    downUnit: {
      x: (midHips.x - origin.x) / torsoHeight,
      y: (midHips.y - origin.y) / torsoHeight,
    },
    torsoWidth,
    torsoHeight,
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    midHips,
    nose,
  };
}

export function getTorsoPixelRoi(
  landmarks: PoseLandmarks,
  videoWidth: number,
  videoHeight: number,
  pad = 0.12,
): { x: number; y: number; width: number; height: number } | null {
  const frame = getTorsoFrame(landmarks);
  if (!frame || videoWidth < 2 || videoHeight < 2) {
    return null;
  }

  const half = frame.torsoWidth * 0.5;
  const top = -frame.torsoHeight * 0.12;
  const bottom = frame.torsoHeight * 1.02;
  const lowerHalf = half * 0.82;
  const corners = [
    applyOffset(frame, half, top),
    applyOffset(frame, -half, top),
    applyOffset(frame, lowerHalf, bottom),
    applyOffset(frame, -lowerHalf, bottom),
  ];

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const corner of corners) {
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }

  const padX = (maxX - minX) * pad + 0.02;
  const padY = (maxY - minY) * pad + 0.02;
  const x = Math.max(0, Math.floor((minX - padX) * videoWidth));
  const y = Math.max(0, Math.floor((minY - padY) * videoHeight));
  const right = Math.min(videoWidth, Math.ceil((maxX + padX) * videoWidth));
  const bottomPx = Math.min(videoHeight, Math.ceil((maxY + padY) * videoHeight));
  const width = right - x;
  const height = bottomPx - y;
  if (width < 8 || height < 8) {
    return null;
  }
  return { x, y, width, height };
}

export function mapElectrodes(
  landmarks: PoseLandmarks,
  calibration: CalibrationSettings,
): ElectrodePoint[] | null {
  const frame = getTorsoFrame(landmarks);
  if (!frame) {
    return null;
  }

  return ELECTRODE_IDS.map((id) => {
    const offset = ELECTRODE_OFFSETS[id];
    const ox = (offset.x + calibration.nudgeX) * calibration.scale;
    const oy = (offset.y + calibration.nudgeY) * calibration.scale;
    const point = applyOffset(frame, ox, oy);
    return { id, x: point.x, y: point.y };
  });
}

export function assessTorsoPose(landmarks: PoseLandmarks | null): PoseAssessment {
  const empty: PoseAssessment = {
    detected: false,
    issue: "no-torso",
    message: "Torso not detected. Adjust your position or the lighting.",
    torsoWidth: 0,
    torsoHeight: 0,
    visibility: 0,
  };

  if (!landmarks) {
    return empty;
  }

  const frame = getTorsoFrame(landmarks);
  if (!frame) {
    return empty;
  }

  const visibility = Math.min(
    frame.leftShoulder.visibility,
    frame.rightShoulder.visibility,
    frame.leftHip.visibility,
    frame.rightHip.visibility,
  );

  if (visibility < MIN_LANDMARK_VISIBILITY) {
    return { ...empty, visibility };
  }

  const depthAsymmetry = Math.abs(frame.leftShoulder.z - frame.rightShoulder.z);
  const looksRotated =
    depthAsymmetry > ROTATION_Z_THRESHOLD ||
    frame.torsoWidth < frame.torsoHeight * PROFILE_WIDTH_RATIO;

  if (looksRotated) {
    return {
      detected: true,
      issue: "rotated",
      message: "Face the camera",
      torsoWidth: frame.torsoWidth,
      torsoHeight: frame.torsoHeight,
      visibility,
    };
  }

  if (frame.torsoWidth < TORSO_TOO_FAR) {
    return {
      detected: true,
      issue: "too-far",
      message: "Move a little closer to the camera",
      torsoWidth: frame.torsoWidth,
      torsoHeight: frame.torsoHeight,
      visibility,
    };
  }

  if (frame.torsoWidth > TORSO_TOO_CLOSE) {
    return {
      detected: true,
      issue: "too-close",
      message: "Move a little farther from the camera",
      torsoWidth: frame.torsoWidth,
      torsoHeight: frame.torsoHeight,
      visibility,
    };
  }

  return {
    detected: true,
    issue: null,
    message: null,
    torsoWidth: frame.torsoWidth,
    torsoHeight: frame.torsoHeight,
    visibility,
  };
}

function applyOffset(
  frame: TorsoFrame,
  offsetX: number,
  offsetY: number,
): { x: number; y: number } {
  return {
    x:
      frame.origin.x +
      offsetX * frame.torsoWidth * frame.leftUnit.x +
      offsetY * frame.torsoHeight * frame.downUnit.x,
    y:
      frame.origin.y +
      offsetX * frame.torsoWidth * frame.leftUnit.y +
      offsetY * frame.torsoHeight * frame.downUnit.y,
  };
}

function midpoint(a: Landmark, b: Landmark): Landmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

function distance2d(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
