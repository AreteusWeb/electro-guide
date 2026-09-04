import type { DetectedCircle, PoseLandmarks } from "../types/electrode";
import { detectCirclesFromImageData } from "./circleDetectCore";
import { captureTorsoRoiFrame } from "./simpleCircleDetector";
import type { CircleDetectRequest, CircleDetectResponse } from "./circleDetectWorker";

type Pending = {
  requestId: number;
  resolve: (circles: DetectedCircle[]) => void;
  reject: (error: Error) => void;
};

/**
 * Offloads sticker blob detection to a module worker when available.
 * Falls back to main-thread detection if workers fail.
 */
export class CircleDetectClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private busy = false;

  constructor() {
    try {
      this.worker = new Worker(
        new URL("./circleDetectWorker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (event: MessageEvent<CircleDetectResponse>) => {
        const msg = event.data;
        if (!msg || msg.type !== "result") {
          return;
        }
        const job = this.pending.get(msg.requestId);
        if (!job) {
          return;
        }
        this.pending.delete(msg.requestId);
        this.busy = false;
        job.resolve(msg.circles);
      };
      this.worker.onerror = () => {
        this.failAll(new Error("Circle detect worker error"));
        this.worker?.terminate();
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  /** True while a worker job is in flight (skip overlapping detects). */
  get isBusy(): boolean {
    return this.busy;
  }

  dispose(): void {
    this.failAll(new Error("Circle detect client disposed"));
    this.worker?.terminate();
    this.worker = null;
  }

  async detect(
    video: HTMLVideoElement,
    landmarks: PoseLandmarks,
    workCanvas: HTMLCanvasElement,
  ): Promise<DetectedCircle[]> {
    const frame = captureTorsoRoiFrame(video, landmarks, workCanvas);
    if (!frame) {
      return [];
    }

    if (this.busy) {
      return Promise.reject(new Error("busy"));
    }

    if (!this.worker) {
      return Promise.resolve(
        detectCirclesFromImageData(
          frame.imageData.data,
          frame.imageData.width,
          frame.imageData.height,
          frame.roi,
          frame.videoW,
          frame.videoH,
          frame.scale,
        ),
      );
    }

    const requestId = this.nextId++;
    const buffer = frame.imageData.data.buffer.slice(0);
    const request: CircleDetectRequest = {
      type: "detect",
      requestId,
      width: frame.imageData.width,
      height: frame.imageData.height,
      buffer,
      roi: frame.roi,
      videoW: frame.videoW,
      videoH: frame.videoH,
      scale: frame.scale,
    };

    this.busy = true;
    return new Promise<DetectedCircle[]>((resolve, reject) => {
      this.pending.set(requestId, { requestId, resolve, reject });
      try {
        this.worker!.postMessage(request, [buffer]);
      } catch (error) {
        this.pending.delete(requestId);
        this.busy = false;
        resolve(
          detectCirclesFromImageData(
            frame.imageData.data,
            frame.imageData.width,
            frame.imageData.height,
            frame.roi,
            frame.videoW,
            frame.videoH,
            frame.scale,
          ),
        );
        void error;
      }
    });
  }

  private failAll(error: Error): void {
    for (const job of this.pending.values()) {
      job.reject(error);
    }
    this.pending.clear();
    this.busy = false;
  }
}
