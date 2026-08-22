import type { Landmark, PoseLandmarks } from "../types/electrode";

/**
 * Exponential moving average on each landmark coordinate.
 *
 * smoothed = alpha * newValue + (1 - alpha) * previousSmoothed
 *
 * alpha ~ 0.3–0.5 is a good starting point:
 * - lower alpha → more stable, more lag
 * - higher alpha → snappier, more jitter
 */
export class LandmarkSmoother {
  private previous: Landmark[] | null = null;
  private alpha: number;

  constructor(alpha: number) {
    this.alpha = alpha;
  }

  setAlpha(alpha: number): void {
    this.alpha = alpha;
  }

  reset(): void {
    this.previous = null;
  }

  apply(landmarks: PoseLandmarks): PoseLandmarks {
    const { alpha } = this;
    const prev = this.previous;

    if (!prev || prev.length !== landmarks.length) {
      const seed = landmarks.map(cloneLandmark);
      this.previous = seed;
      return seed;
    }

    const smoothed = landmarks.map((lm, i) => {
      const p = prev[i];
      return {
        x: alpha * lm.x + (1 - alpha) * p.x,
        y: alpha * lm.y + (1 - alpha) * p.y,
        z: alpha * lm.z + (1 - alpha) * p.z,
        visibility: lm.visibility,
      };
    });

    this.previous = smoothed;
    return smoothed;
  }
}

function cloneLandmark(lm: Landmark): Landmark {
  return { x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility };
}
