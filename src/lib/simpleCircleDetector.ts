import type { DetectedCircle, PoseLandmarks } from "../types/electrode";
import { getTorsoPixelRoi } from "./electrodeMapping";
import { detectCirclesFromImageData } from "./circleDetectCore";

export { detectCirclesFromImageData } from "./circleDetectCore";

/** Max long-edge of the working ROI before blob detection. */
export const DETECT_MAX_LONG_EDGE = 480;

export type RoiWorkFrame = {
  imageData: ImageData;
  roi: { x: number; y: number; width: number; height: number };
  videoW: number;
  videoH: number;
  /** workPx / roiPx */
  scale: number;
};

/**
 * Crop torso ROI from the video into a downscaled canvas and return pixels
 * for blob detection (main thread or worker).
 */
export function captureTorsoRoiFrame(
  video: HTMLVideoElement,
  landmarks: PoseLandmarks,
  workCanvas: HTMLCanvasElement,
  maxLongEdge = DETECT_MAX_LONG_EDGE,
): RoiWorkFrame | null {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null;
  }
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;
  const roi = getTorsoPixelRoi(landmarks, videoW, videoH);
  if (!roi) {
    return null;
  }

  const longEdge = Math.max(roi.width, roi.height);
  const scale = Math.min(1, maxLongEdge / longEdge);
  const w = Math.max(8, Math.round(roi.width * scale));
  const h = Math.max(8, Math.round(roi.height * scale));
  const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  if (workCanvas.width !== w || workCanvas.height !== h) {
    workCanvas.width = w;
    workCanvas.height = h;
  }

  ctx.drawImage(video, roi.x, roi.y, roi.width, roi.height, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return { imageData, roi, videoW, videoH, scale };
}

/**
 * Lightweight sticker finder — no OpenCV. Looks for high-saturation
 * blobs (green / orange / magenta / blue) in a downscaled torso ROI.
 */
export function detectStickerCircles(
  video: HTMLVideoElement,
  landmarks: PoseLandmarks,
  workCanvas: HTMLCanvasElement,
): DetectedCircle[] {
  const frame = captureTorsoRoiFrame(video, landmarks, workCanvas);
  if (!frame) {
    return [];
  }
  return detectCirclesFromImageData(
    frame.imageData.data,
    frame.imageData.width,
    frame.imageData.height,
    frame.roi,
    frame.videoW,
    frame.videoH,
    frame.scale,
  );
}
