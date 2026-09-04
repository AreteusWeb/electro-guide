import type { DetectedCircle } from "../types/electrode";

const MAX_CIRCLES = 16;

/** Pure detection on RGBA buffer — safe to run inside a Web Worker. */
export function detectCirclesFromImageData(
  pixels: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  roi: { x: number; y: number; width: number; height: number },
  videoW: number,
  videoH: number,
  scale: number,
): DetectedCircle[] {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const r = pixels[i * 4] ?? 0;
    const g = pixels[i * 4 + 1] ?? 0;
    const b = pixels[i * 4 + 2] ?? 0;
    mask[i] = isStickerPixel(r, g, b) ? 1 : 0;
  }

  const seen = new Uint8Array(w * h);
  const blobs: {
    x: number;
    y: number;
    count: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }[] = [];

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!mask[i] || seen[i]) {
        continue;
      }
      const blob = flood(mask, seen, w, h, x, y);
      if (blob.count >= 12 && blob.count <= (w * h) / 6) {
        blobs.push(blob);
      }
    }
  }

  const toVideo = scale > 0 ? 1 / scale : 1;
  const circles: DetectedCircle[] = [];
  for (const blob of blobs) {
    const bw = blob.maxX - blob.minX + 1;
    const bh = blob.maxY - blob.minY + 1;
    const diameter = Math.max(bw, bh);
    const circularity = Math.min(bw, bh) / diameter;
    if (circularity < 0.55) {
      continue;
    }
    circles.push({
      x: (roi.x + blob.x * toVideo) / videoW,
      y: (roi.y + blob.y * toVideo) / videoH,
      radiusPx: (diameter / 2) * toVideo,
    });
    if (circles.length >= MAX_CIRCLES) {
      break;
    }
  }
  return circles;
}

function isStickerPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (max < 90 || sat < 0.45) {
    return false;
  }
  const hue = rgbHue(r, g, b);
  const orange = hue <= 45;
  const green = hue >= 70 && hue <= 160;
  const blue = hue >= 175 && hue <= 255;
  const magenta = hue >= 280 || hue <= 20;
  return orange || green || blue || magenta;
}

function rgbHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) {
    return 0;
  }
  let hue = 0;
  if (max === r) {
    hue = ((g - b) / d) % 6;
  } else if (max === g) {
    hue = (b - r) / d + 2;
  } else {
    hue = (r - g) / d + 4;
  }
  hue *= 60;
  if (hue < 0) {
    hue += 360;
  }
  return hue;
}

function flood(
  mask: Uint8Array,
  seen: Uint8Array,
  w: number,
  h: number,
  startX: number,
  startY: number,
): { x: number; y: number; count: number; minX: number; maxX: number; minY: number; maxY: number } {
  const stack = [startX, startY];
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;

  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    if (x === undefined || y === undefined) {
      break;
    }
    if (x < 0 || y < 0 || x >= w || y >= h) {
      continue;
    }
    const i = y * w + x;
    if (!mask[i] || seen[i]) {
      continue;
    }
    seen[i] = 1;
    count += 1;
    sumX += x;
    sumY += y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  return {
    x: count ? sumX / count : startX,
    y: count ? sumY / count : startY,
    count,
    minX,
    maxX,
    minY,
    maxY,
  };
}
