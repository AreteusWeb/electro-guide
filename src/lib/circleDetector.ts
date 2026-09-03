import type { DetectedCircle, PoseLandmarks } from "../types/electrode";
import { getTorsoPixelRoi } from "./electrodeMapping";
import { loadOpenCv, type OpenCvMat, type OpenCvRuntime } from "./opencvLoader";

const MAX_ROI_WIDTH = 360;
const MAX_CIRCLES = 16;

export class CircleDetector {
  private cv: OpenCvRuntime | null = null;
  private roiCanvas: HTMLCanvasElement | null = null;
  private ready = false;
  private closed = false;

  async init(): Promise<void> {
    const cv = await loadOpenCv();
    if (this.closed) {
      return;
    }
    this.cv = cv;
    this.ready = true;
  }

  get isReady(): boolean {
    return !this.closed && this.ready && this.cv !== null;
  }

  detect(
    video: HTMLVideoElement,
    landmarks: PoseLandmarks,
  ): DetectedCircle[] {
    const cv = this.cv;
    if (!cv || !this.ready || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return [];
    }

    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    const roi = getTorsoPixelRoi(landmarks, videoW, videoH);
    if (!roi) {
      return [];
    }

    const scale = Math.min(1, MAX_ROI_WIDTH / roi.width);
    const roiW = Math.max(8, Math.round(roi.width * scale));
    const roiH = Math.max(8, Math.round(roi.height * scale));
    const canvas = this.ensureCanvas(roiW, roiH);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return [];
    }

    ctx.drawImage(video, roi.x, roi.y, roi.width, roi.height, 0, 0, roiW, roiH);

    const src = cv.imread(canvas);
    const found: { x: number; y: number; radius: number }[] = [];

    try {
      houghCircles(cv, src, found, roiW);
      colorCircles(cv, src, found, roiW);
    } finally {
      src.delete();
    }

    const unique = nms(found);
    const toVideo = 1 / scale;
    return unique.slice(0, MAX_CIRCLES).map((circle) => ({
      x: (roi.x + circle.x * toVideo) / videoW,
      y: (roi.y + circle.y * toVideo) / videoH,
      radiusPx: circle.radius * toVideo,
    }));
  }

  close(): void {
    this.closed = true;
    this.cv = null;
    this.ready = false;
    this.roiCanvas = null;
  }

  private ensureCanvas(width: number, height: number): HTMLCanvasElement {
    if (!this.roiCanvas) {
      this.roiCanvas = document.createElement("canvas");
    }
    if (this.roiCanvas.width !== width || this.roiCanvas.height !== height) {
      this.roiCanvas.width = width;
      this.roiCanvas.height = height;
    }
    return this.roiCanvas;
  }
}

function houghCircles(
  cv: OpenCvRuntime,
  src: OpenCvMat,
  out: { x: number; y: number; radius: number }[],
  roiW: number,
): void {
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const circles = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 1.6, 1.6);
    const minR = Math.max(4, Math.round(roiW * 0.018));
    const maxR = Math.max(minR + 3, Math.round(roiW * 0.09));
    cv.HoughCircles(
      blurred,
      circles,
      cv.HOUGH_GRADIENT,
      1.2,
      minR * 2.1,
      90,
      26,
      minR,
      maxR,
    );
    pushHough(circles, out);
  } finally {
    gray.delete();
    blurred.delete();
    circles.delete();
  }
}

function colorCircles(
  cv: OpenCvRuntime,
  src: OpenCvMat,
  out: { x: number; y: number; radius: number }[],
  roiW: number,
): void {
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const mask = new cv.Mat();
  let lower: OpenCvMat | null = null;
  let upper: OpenCvMat | null = null;
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type?.() ?? cv.CV_8UC3, [0, 90, 90, 0]);
    upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type?.() ?? cv.CV_8UC3, [180, 255, 255, 255]);
    cv.inRange(hsv, lower, upper, mask);
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const minArea = (roiW * 0.01) ** 2;
    const maxArea = (roiW * 0.16) ** 2;
    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < minArea || area > maxArea) {
        continue;
      }
      const peri = cv.arcLength(contour, true);
      if (peri < 1) {
        continue;
      }
      const circularity = (4 * Math.PI * area) / (peri * peri);
      if (circularity < 0.62) {
        continue;
      }
      const enclosed = cv.minEnclosingCircle(contour);
      out.push({
        x: enclosed.center.x,
        y: enclosed.center.y,
        radius: enclosed.radius,
      });
    }
  } finally {
    rgb.delete();
    hsv.delete();
    mask.delete();
    lower?.delete();
    upper?.delete();
    kernel.delete();
    contours.delete();
    hierarchy.delete();
  }
}

function pushHough(
  circles: OpenCvMat,
  out: { x: number; y: number; radius: number }[],
): void {
  const data = circles.data32F;
  if (!data || data.length < 3) {
    return;
  }
  for (let i = 0; i < data.length; i += 3) {
    const x = data[i];
    const y = data[i + 1];
    const radius = data[i + 2];
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(radius) && radius > 1) {
      out.push({ x, y, radius });
    }
  }
}

function nms(
  circles: { x: number; y: number; radius: number }[],
): { x: number; y: number; radius: number }[] {
  const sorted = [...circles].sort((a, b) => b.radius - a.radius);
  const kept: { x: number; y: number; radius: number }[] = [];
  for (const circle of sorted) {
    const overlaps = kept.some((other) => {
      const limit = Math.min(circle.radius, other.radius) * 1.15;
      return Math.hypot(circle.x - other.x, circle.y - other.y) < limit;
    });
    if (!overlaps) {
      kept.push(circle);
    }
  }
  return kept;
}
