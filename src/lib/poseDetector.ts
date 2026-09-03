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

const MIN_DETECT_INTERVAL_MS = 66;
const MAX_PROCESS_WIDTH = 960;

function wasmPaths(): string[] {
  return [`${window.location.origin}/wasm`, CDN_WASM];
}

/**
 * One graph per page load. Closing and recreating PoseLandmarker on
 * React StrictMode remount deadlocks the WebGL context.
 */
let sharedPromise: Promise<PoseLandmarker> | null = null;

function getSharedLandmarker(): Promise<PoseLandmarker> {
  if (!sharedPromise) {
    sharedPromise = createLandmarker().catch((error) => {
      sharedPromise = null;
      throw error;
    });
  }
  return sharedPromise;
}

async function createLandmarker(): Promise<PoseLandmarker> {
  const modelAssetPath = MODEL_URLS[POSE_MODEL_VARIANT];
  let lastError: unknown;

  for (const wasmPath of wasmPaths()) {
    const vision = await FilesetResolver.forVisionTasks(wasmPath);
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        return await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not load the pose model.");
}

export class PoseDetector {
  private landmarker: PoseLandmarker | null = null;
  private lastTimestamp = 0;
  private lastDetectAt = 0;
  private lastPose: PoseLandmarks | null = null;
  private frameCanvas: HTMLCanvasElement | null = null;
  private frameCtx: CanvasRenderingContext2D | null = null;
  private closed = false;

  async init(): Promise<void> {
    const landmarker = await getSharedLandmarker();
    if (this.closed) {
      return;
    }
    this.landmarker = landmarker;
  }

  detect(video: HTMLVideoElement): PoseLandmarks | null {
    if (this.closed || !this.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return this.lastPose;
    }

    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    if (videoW < 2 || videoH < 2) {
      return this.lastPose;
    }

    const now = performance.now();
    if (this.lastPose && now - this.lastDetectAt < MIN_DETECT_INTERVAL_MS) {
      return this.lastPose;
    }

    const frame = this.copyVideoFrame(video, videoW, videoH);
    if (!frame) {
      return this.lastPose;
    }

    const timestamp = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    this.lastDetectAt = now;

    const result = this.landmarker.detectForVideo(frame, timestamp);
    const pose = result.landmarks[0];
    if (!pose || pose.length === 0) {
      return this.lastPose;
    }

    this.lastPose = pose.map(
      (lm): Landmark => ({
        x: lm.x,
        y: lm.y,
        z: lm.z,
        visibility: lm.visibility ?? 0,
      }),
    );
    return this.lastPose;
  }

  close(): void {
    this.closed = true;
    this.landmarker = null;
    this.lastTimestamp = 0;
    this.lastDetectAt = 0;
    this.lastPose = null;
    this.frameCanvas = null;
    this.frameCtx = null;
  }

  /**
   * Canvas with real width/height so MediaPipe gets IMAGE_DIMENSIONS
   * (avoids the square-ROI squeeze). Cap resolution to stay responsive.
   */
  private copyVideoFrame(
    video: HTMLVideoElement,
    videoW: number,
    videoH: number,
  ): HTMLCanvasElement | null {
    const scale = Math.min(1, MAX_PROCESS_WIDTH / videoW);
    const width = Math.max(2, Math.round(videoW * scale));
    const height = Math.max(2, Math.round(videoH * scale));

    if (!this.frameCanvas) {
      this.frameCanvas = document.createElement("canvas");
      this.frameCtx = this.frameCanvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
      });
    }
    if (!this.frameCtx) {
      return null;
    }
    if (this.frameCanvas.width !== width || this.frameCanvas.height !== height) {
      this.frameCanvas.width = width;
      this.frameCanvas.height = height;
    }

    this.frameCtx.drawImage(video, 0, 0, width, height);
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
