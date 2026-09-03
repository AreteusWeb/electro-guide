import {
  LIMB_ELECTRODES,
  POSE_INDEX,
  type ElectrodePlacement,
  type ElectrodePoint,
  type Landmark,
  type PoseLandmarks,
} from "../types/electrode";
import { getTorsoFrame } from "./electrodeMapping";
import { POSE_CONNECTIONS } from "./poseDetector";

const LIMB_COLOR = "#f0b429";
const PRECORDIAL_COLOR = "#3ee0c7";
const DEBUG_COLOR = "#ff6b9d";
const PLACED_COLOR = "#4ade80";
const OFFSET_COLOR = "#ff8a4c";
const TORSO_FILL = "rgba(62, 224, 199, 0.08)";
const TORSO_STROKE = "rgba(62, 224, 199, 0.4)";

export type OverlayView = {
  videoWidth: number;
  videoHeight: number;
  displayWidth: number;
  displayHeight: number;
};

export type OverlayFrame = {
  landmarks: PoseLandmarks | null;
  electrodes: ElectrodePoint[] | null;
  placements: ElectrodePlacement[] | null;
  showDebug: boolean;
  /** Video is CSS-mirrored; canvas is not, so we flip x when drawing. */
  mirrored: boolean;
};

type ScreenPoint = { x: number; y: number };

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  view: OverlayView,
  frame: OverlayFrame,
): void {
  const { displayWidth, displayHeight } = view;
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  if (!frame.landmarks || view.videoWidth < 1 || view.videoHeight < 1) {
    return;
  }

  const cover = fitLayout(view);
  const toScreen = (x: number, y: number): ScreenPoint => {
    const vx = (frame.mirrored ? 1 - x : x) * view.videoWidth;
    const vy = y * view.videoHeight;
    return {
      x: cover.offsetX + vx * cover.scale,
      y: cover.offsetY + vy * cover.scale,
    };
  };

  const torso = getTorsoFrame(frame.landmarks);
  const torsoPx = torso ? torso.torsoWidth * view.videoWidth * cover.scale : 0;
  const ui = clamp(displayWidth / 420, 0.8, 1.35);

  drawTorsoSilhouette(ctx, frame.landmarks, toScreen, ui);

  if (frame.showDebug) {
    drawDebugSkeleton(ctx, frame.landmarks, toScreen, ui);
  }

  if (frame.electrodes) {
    drawElectrodes(
      ctx,
      frame.electrodes,
      frame.placements ?? [],
      toScreen,
      torsoPx,
      ui,
      displayWidth,
    );
  }
}

/** Match CSS object-fit: cover so markers stay locked to the video. */
function fitLayout(view: OverlayView): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.max(
    view.displayWidth / view.videoWidth,
    view.displayHeight / view.videoHeight,
  );
  return {
    scale,
    offsetX: (view.displayWidth - view.videoWidth * scale) / 2,
    offsetY: (view.displayHeight - view.videoHeight * scale) / 2,
  };
}

function drawTorsoSilhouette(
  ctx: CanvasRenderingContext2D,
  landmarks: PoseLandmarks,
  toScreen: (x: number, y: number) => ScreenPoint,
  ui: number,
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
  ctx.lineWidth = 1.75 * ui;
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
  toScreen: (x: number, y: number) => ScreenPoint,
  ui: number,
): void {
  ctx.strokeStyle = DEBUG_COLOR;
  ctx.lineWidth = 1.5 * ui;
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

  const r = 4.5 * ui;
  ctx.font = `${11 * ui}px ui-sans-serif, system-ui, sans-serif`;
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
    ctx.lineWidth = 1.5 * ui;
    ctx.strokeStyle = "#1a0a12";
    ctx.stroke();

    drawHaloText(ctx, label, p.x + r + 6 * ui, p.y, "#ffd0de", ui);
  }

  const torso = getTorsoFrame(landmarks);
  if (torso) {
    const o = toScreen(torso.origin.x, torso.origin.y);
    const h = toScreen(torso.midHips.x, torso.midHips.y);
    ctx.setLineDash([5 * ui, 5 * ui]);
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
  placements: ElectrodePlacement[],
  toScreen: (x: number, y: number) => ScreenPoint,
  torsoPx: number,
  ui: number,
  displayWidth: number,
): void {
  const radius = electrodeRadius(torsoPx, ui, displayWidth);
  const labelSize = displayWidth < 768 ? 12 * ui : 11 * ui;
  ctx.font = `600 ${labelSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "bottom";

  const byId = new Map(placements.map((item) => [item.id, item]));

  for (const electrode of electrodes) {
    const p = toScreen(electrode.x, electrode.y);
    const isLimb = LIMB_ELECTRODES.has(electrode.id);
    const color = isLimb ? LIMB_COLOR : PRECORDIAL_COLOR;
    const placement = byId.get(electrode.id);
    const ok = placement?.withinTolerance === true;
    const ringColor = ok ? PLACED_COLOR : color;

    // Hollow ring so a real sticker under the guide stays visible.
    drawTargetRing(ctx, p, radius, ui, ringColor, Boolean(placement));
    ctx.textAlign = "center";
    drawHaloText(ctx, electrode.id, p.x, p.y - radius - 3 * ui, ringColor, ui);

    if (placement) {
      const from = toScreen(placement.detected.x, placement.detected.y);
      const gap = Math.hypot(from.x - p.x, from.y - p.y);
      if (ok) {
        drawCheck(ctx, p, radius, ui);
      } else if (gap >= radius * 1.6) {
        drawArrow(ctx, from, p, OFFSET_COLOR, ui);
      }

      ctx.beginPath();
      ctx.strokeStyle = ok ? PLACED_COLOR : OFFSET_COLOR;
      ctx.lineWidth = 2 * ui;
      ctx.setLineDash(ok ? [] : [4 * ui, 3 * ui]);
      ctx.arc(from.x, from.y, Math.max(6, radius * 0.95), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.textAlign = "left";
}

function drawTargetRing(
  ctx: CanvasRenderingContext2D,
  p: ScreenPoint,
  radius: number,
  ui: number,
  color: string,
  hasSticker: boolean,
): void {
  ctx.beginPath();
  ctx.fillStyle = hasSticker ? "rgba(7, 9, 12, 0.12)" : "rgba(7, 9, 12, 0.28)";
  ctx.arc(p.x, p.y, radius + 1.5 * ui, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.25 * ui;
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(p.x, p.y, Math.max(2, radius * 0.22), 0, Math.PI * 2);
  ctx.fill();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: ScreenPoint,
  to: ScreenPoint,
  color: string,
  ui: number,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) {
    return;
  }
  const nx = dx / len;
  const ny = dy / len;
  const tip = 8 * ui;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2 * ui;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x - nx * tip * 0.4, to.y - ny * tip * 0.4);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - nx * tip - ny * tip * 0.45, to.y - ny * tip + nx * tip * 0.45);
  ctx.lineTo(to.x - nx * tip + ny * tip * 0.45, to.y - ny * tip - nx * tip * 0.45);
  ctx.closePath();
  ctx.fill();
}

function drawCheck(
  ctx: CanvasRenderingContext2D,
  p: ScreenPoint,
  radius: number,
  ui: number,
): void {
  ctx.strokeStyle = "#06251f";
  ctx.lineWidth = 2 * ui;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(p.x - radius * 0.35, p.y);
  ctx.lineTo(p.x - radius * 0.08, p.y + radius * 0.32);
  ctx.lineTo(p.x + radius * 0.4, p.y - radius * 0.3);
  ctx.stroke();
}

function electrodeRadius(torsoPx: number, ui: number, displayWidth: number): number {
  const mobile = displayWidth < 768;
  const ratio = mobile ? 15 / 300 : 16 / 300;
  const minR = mobile ? 4.5 : 4.5 * ui;
  const maxR = mobile ? 7.5 : 9 * ui;
  if (torsoPx > 0) {
    return clamp(torsoPx * ratio, minR, maxR);
  }
  return mobile ? 6 : 6 * ui;
}

function drawHaloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  ui: number,
): void {
  ctx.lineWidth = 3.5 * ui;
  ctx.strokeStyle = "rgba(7, 9, 12, 0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
