import { detectCirclesFromImageData } from "./circleDetectCore";
import type { DetectedCircle } from "../types/electrode";

export type CircleDetectRequest = {
  type: "detect";
  requestId: number;
  width: number;
  height: number;
  /** RGBA pixel buffer (transferred). */
  buffer: ArrayBuffer;
  roi: { x: number; y: number; width: number; height: number };
  videoW: number;
  videoH: number;
  scale: number;
};

export type CircleDetectResponse = {
  type: "result";
  requestId: number;
  circles: DetectedCircle[];
};

self.onmessage = (event: MessageEvent<CircleDetectRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== "detect") {
    return;
  }
  const pixels = new Uint8ClampedArray(msg.buffer);
  const circles = detectCirclesFromImageData(
    pixels,
    msg.width,
    msg.height,
    msg.roi,
    msg.videoW,
    msg.videoH,
    msg.scale,
  );
  const response: CircleDetectResponse = {
    type: "result",
    requestId: msg.requestId,
    circles,
  };
  self.postMessage(response);
};
