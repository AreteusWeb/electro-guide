import { LIMB_ELECTRODES, POSE_INDEX, type ElectrodePoint, type Landmark, type PoseLandmarks } from "../types/electrode";
import { getTorsoFrame } from "./electrodeMapping";
import { POSE_CONNECTIONS } from "./poseDetector";

const LIMB_COLOR = "#f0b429";
const PRECORDIAL_COLOR = "#3ee0c7";
const DEBUG_COLOR = "#ff6b9d";
const TORSO_FILL = "rgba(62, 224, 199, 0.08)";
const TORSO_STROKE = "rgba(62, 224, 199, 0.4)";

export type OverlayFrame = {
  landmarks: PoseLandmarks | null;
  electrodes: ElectrodePoint[] | null;
  showDebug: boolean;
  /** Video is CSS-mirrored; canvas is not, so we flip x when drawing. */
  mirrored: boolean;
};

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: OverlayFrame,
): void {
  ctx.clearRect(0, 0, width, height);

  if (!frame.landmarks) {
    return;
  }

  const toScreen = (x: number, y: number) => ({
    x: (frame.mirrored ? 1 - x : x) * width,
    y: y * height,
  });

  drawTorsoSilhouette(ctx, frame.landmarks, toScreen);

  if (frame.showDebug) {
    drawDebugSkeleton(ctx, frame.landmarks, toScreen, width);
  }

  if (frame.electrodes) {
    drawElectrodes(ctx, frame.electrodes, toScreen, width);
  }
}

function drawTorsoSilhouette(
  ctx: CanvasRenderingContext2D,
  landmarks: PoseLandmarks,
  toScreen: (x: number, y: number) => { x: number; y: number },
): void {
  const torso = getTorsoFrame(landmarks);
  if (!torso) {
    return;
  }

  const half = torso.torsoWidth * 0.5;
  const top = -torso.torsoHeight * 0.1;
  const bottom = torso.torsoHeight * 0.98;
  const lowerHalf = half * 0.82;

  const leftShoulder = offsetPoint(torso.origin, torso.leftUnit, torso.downUnit, half, top);
  const rightShoulder = offsetPoint(torso.origin, torso.leftUnit, torso.downUnit, -half, top);
  const leftHip = offsetPoint(torso.origin, torso.leftUnit, torso.downUnit, lowerHalf, bottom);
  const rightHip = offsetPoint(torso.origin, torso.leftUnit, torso.downUnit, -lowerHalf, bottom);

  const ls = toScreen(leftShoulder.x, leftShoulder.y);
  const rs = toScreen(rightShoulder.x, rightShoulder.y);
  const lh = toScreen(leftHip.x, leftHip.y);
  const rh = toScreen(rightHip.x, rightHip.y);

  ctx.beginPath();
  ctx.moveTo(rs.x, rs.y);
  ctx.lineTo(ls.x, ls.y);
  ctx.lineTo(lh.x, lh.y);
  ctx.lineTo(rh.x, rh.y);
  ctx.closePath();
  ctx.fillStyle = TORSO_FILL;
  ctx.fill();
  ctx.strokeStyle = TORSO_STROKE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function offsetPoint(
  origin: Landmark,
  leftUnit: { x: number; y: number },
  downUnit: { x: number; y: number },
  alongLeft: number,
  alongDown: number,
): { x: number; y: number } {
  return {
    x: origin.x + alongLeft * leftUnit.x + alongDown * downUnit.x,
    y: origin.y + alongLeft * leftUnit.y + alongDown * downUnit.y,
  };
}

function drawDebugSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: PoseLandmarks,
  toScreen: (x: number, y: number) => { x: number; y: number },
  width: number,
): void {
  ctx.strokeStyle = DEBUG_COLOR;
  ctx.lineWidth = Math.max(1.5, width * 0.0018);
  ctx.globalAlpha = 0.85;

  for (const [a, b] of POSE_CONNECTIONS) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!pa || !pb || pa.visibility < 0.4 || pb.visibility < 0.4) {
      continue;
    }
    const sa = toScreen(pa.x, pa.y);
    const sb = toScreen(pb.x, pb.y);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
  }

  const key = [
    [POSE_INDEX.NOSE, "N"],
    [POSE_INDEX.LEFT_SHOULDER, "LS"],
    [POSE_INDEX.RIGHT_SHOULDER, "RS"],
    [POSE_INDEX.LEFT_HIP, "LH"],
    [POSE_INDEX.RIGHT_HIP, "RH"],
  ] as const;

  const r = Math.max(4, width * 0.007);
  ctx.font = `${Math.max(11, width * 0.012)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";

  for (const [index, label] of key) {
    const lm = landmarks[index];
    if (!lm) {
      continue;
    }
    const p = toScreen(lm.x, lm.y);
    ctx.beginPath();
    ctx.fillStyle = DEBUG_COLOR;
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1a0a12";
    ctx.stroke();

    drawHaloText(ctx, label, p.x + r + 6, p.y, "#ffd0de");
  }

  const torso = getTorsoFrame(landmarks);
  if (torso) {
    const o = toScreen(torso.origin.x, torso.origin.y);
    const h = toScreen(torso.midHips.x, torso.midHips.y);
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(h.x, h.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.globalAlpha = 1;
}

function drawElectrodes(
  ctx: CanvasRenderingContext2D,
  electrodes: ElectrodePoint[],
  toScreen: (x: number, y: number) => { x: number; y: number },
  width: number,
): void {
  const radius = Math.max(4, width * 0.0065);
  ctx.font = `600 ${Math.max(11, width * 0.012)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "bottom";

  for (const electrode of electrodes) {
    const p = toScreen(electrode.x, electrode.y);
    const isLimb = LIMB_ELECTRODES.has(electrode.id);
    const color = isLimb ? LIMB_COLOR : PRECORDIAL_COLOR;

    ctx.beginPath();
    ctx.fillStyle = "rgba(7, 9, 12, 0.4)";
    ctx.arc(p.x, p.y, radius + 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#071014";
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.arc(p.x, p.y, radius * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = "center";
    drawHaloText(ctx, electrode.id, p.x, p.y - radius - 3, color);
  }

  ctx.textAlign = "left";
}

function drawHaloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
): void {
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(7, 9, 12, 0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}
