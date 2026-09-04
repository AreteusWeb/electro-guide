import type {
  DetectedCircle,
  ElectrodeId,
  ElectrodePlacement,
  ElectrodePoint,
} from "../types/electrode";
import { PLACEMENT_TOLERANCE_MM } from "../types/electrode";

const CHEST_WIDTH_MM = 300;
const PLACE_OK_TORSO_FRAC = 0.05;

/**
 * EMA on detected circle centers (and radii) keyed by electrode id.
 * Call {@link ingest} when a new match arrives; call {@link tick} every
 * animation frame so positions keep easing between sparse detections.
 */
export class CirclePlacementSmoother {
  private smoothed = new Map<ElectrodeId, DetectedCircle>();
  private lastRaw = new Map<ElectrodeId, DetectedCircle>();
  private ingestAlpha: number;
  private tickAlpha: number;

  constructor(ingestAlpha = 0.32, tickAlpha = 0.12) {
    this.ingestAlpha = ingestAlpha;
    this.tickAlpha = tickAlpha;
  }

  reset(): void {
    this.smoothed.clear();
    this.lastRaw.clear();
  }

  /** New detection assignments (raw). Blends into smoothed state. */
  ingest(placements: ElectrodePlacement[]): void {
    const seen = new Set<ElectrodeId>();
    for (const p of placements) {
      seen.add(p.id);
      this.lastRaw.set(p.id, { ...p.detected });
      const prev = this.smoothed.get(p.id);
      if (!prev) {
        this.smoothed.set(p.id, { ...p.detected });
        continue;
      }
      const a = this.ingestAlpha;
      this.smoothed.set(p.id, {
        x: a * p.detected.x + (1 - a) * prev.x,
        y: a * p.detected.y + (1 - a) * prev.y,
        radiusPx: a * p.detected.radiusPx + (1 - a) * prev.radiusPx,
      });
    }
    for (const id of [...this.lastRaw.keys()]) {
      if (!seen.has(id)) {
        this.lastRaw.delete(id);
        this.smoothed.delete(id);
      }
    }
  }

  /**
   * Continues easing toward the last raw sample so overlays feel continuous
   * even when detection only runs every few hundred ms.
   */
  tick(
    targets: ElectrodePoint[],
    torsoWidthNorm: number,
    videoWidth: number,
    videoHeight: number,
  ): ElectrodePlacement[] {
    const a = this.tickAlpha;
    for (const [id, raw] of this.lastRaw) {
      const prev = this.smoothed.get(id);
      if (!prev) {
        this.smoothed.set(id, { ...raw });
        continue;
      }
      this.smoothed.set(id, {
        x: a * raw.x + (1 - a) * prev.x,
        y: a * raw.y + (1 - a) * prev.y,
        radiusPx: a * raw.radiusPx + (1 - a) * prev.radiusPx,
      });
    }

    return buildPlacementsFromSmoothed(
      this.smoothed,
      targets,
      torsoWidthNorm,
      videoWidth,
      videoHeight,
    );
  }

  /** Last known assignment positions (for sticky matching). */
  previousDetected(): Map<ElectrodeId, DetectedCircle> {
    return new Map(this.smoothed);
  }
}

function buildPlacementsFromSmoothed(
  smoothed: Map<ElectrodeId, DetectedCircle>,
  targets: ElectrodePoint[],
  torsoWidthNorm: number,
  videoWidth: number,
  videoHeight: number,
): ElectrodePlacement[] {
  const torsoPx = Math.max(1, torsoWidthNorm * videoWidth);
  const pxPerMm = torsoPx / CHEST_WIDTH_MM;
  const okPx = Math.max(
    torsoPx * PLACE_OK_TORSO_FRAC,
    pxPerMm * PLACEMENT_TOLERANCE_MM,
  );

  const placements: ElectrodePlacement[] = [];
  for (const target of targets) {
    const detected = smoothed.get(target.id);
    if (!detected) {
      continue;
    }
    const dxPx = (detected.x - target.x) * videoWidth;
    const dyPx = (detected.y - target.y) * videoHeight;
    const pixelOffset = Math.hypot(dxPx, dyPx);
    placements.push({
      id: target.id,
      target,
      detected,
      offsetMm: pixelOffset / pxPerMm,
      withinTolerance: pixelOffset <= okPx,
    });
  }
  return placements;
}
