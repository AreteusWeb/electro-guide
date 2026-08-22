import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark, PoseLandmarks } from "../types/electrode";

/**
 * Switch to "lite" if FPS is too low on a phone.
 * "full" is more accurate for anatomical overlay work.
 */
export const POSE_MODEL_VARIANT: "lite" | "full" = "full";

const MODEL_URLS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
} as const;

const CDN_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";

function wasmPaths(): string[] {
  return [`${window.location.origin}/wasm`, CDN_WASM];
}

export class PoseDetector {
  private landmarker: PoseLandmarker | null = null;
  private lastTimestamp = 0;
  private frameCanvas: HTMLCanvasElement | null = null;

  async init(): Promise<void> {
    const modelAssetPath = MODEL_URLS[POSE_MODEL_VARIANT];
    let lastError: unknown;

    for (const wasmPath of wasmPaths()) {
      const vision = await FilesetResolver.forVisionTasks(wasmPath);
      for (const delegate of ["GPU", "CPU"] as const) {
        try {
          this.landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath, delegate },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
          return;
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Could not load the pose model.");
  }

  detect(video: HTMLVideoElement): PoseLandmarks | null {
    if (!this.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    if (videoW < 2 || videoH < 2) {
      return null;
    }

    const timestamp = Math.max(performance.now(), this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;

    const frame = this.copyVideoFrame(video, videoW, videoH);
    const result = this.landmarker.detectForVideo(frame, timestamp);
    const pose = result.landmarks[0];
    if (!pose || pose.length === 0) {
      return null;
    }

    return pose.map(
      (lm): Landmark => ({
        x: lm.x,
        y: lm.y,
        z: lm.z,
        visibility: lm.visibility ?? 0,
      }),
    );
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.lastTimestamp = 0;
    this.frameCanvas = null;
  }

  private copyVideoFrame(
    video: HTMLVideoElement,
    videoW: number,
    videoH: number,
  ): HTMLCanvasElement {
    if (!this.frameCanvas) {
      this.frameCanvas = document.createElement("canvas");
    }
    if (this.frameCanvas.width !== videoW || this.frameCanvas.height !== videoH) {
      this.frameCanvas.width = videoW;
      this.frameCanvas.height = videoH;
    }

    const ctx = this.frameCanvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0, videoW, videoH);
    }
    return this.frameCanvas;
  }
}

export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 11],
  [0, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];
