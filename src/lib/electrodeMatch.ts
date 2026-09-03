import {
  PLACEMENT_TOLERANCE_MM,
  type DetectedCircle,
  type ElectrodePlacement,
  type ElectrodePoint,
  type PlacementSummary,
} from "../types/electrode";
import { hungarianAssign } from "./hungarian";

const MAX_ASSIGN_TORSO_FRACTION = 0.45;
/** Ignore blobs that are tiny noise or huge clothing patches. */
const MIN_RADIUS_TORSO_FRAC = 0.02;
const MAX_RADIUS_TORSO_FRAC = 0.12;
/** Adult chest width ~300mm — more stable than noisy sticker-pixel diameter. */
const CHEST_WIDTH_MM = 300;
/** “Close enough” ≈ this fraction of chest width (~12–15mm). */
const PLACE_OK_TORSO_FRAC = 0.05;

export function matchCirclesToTargets(
  circles: DetectedCircle[],
  targets: ElectrodePoint[],
  torsoWidthNorm: number,
  videoWidth: number,
  videoHeight: number,
): ElectrodePlacement[] {
  if (circles.length === 0 || targets.length === 0) {
    return [];
  }

  const torsoPx = Math.max(1, torsoWidthNorm * videoWidth);
  const minR = torsoPx * MIN_RADIUS_TORSO_FRAC;
  const maxR = torsoPx * MAX_RADIUS_TORSO_FRAC;
  const usable = circles.filter(
    (circle) => circle.radiusPx >= minR && circle.radiusPx <= maxR,
  );
  if (usable.length === 0) {
    return [];
  }

  const maxDist = Math.max(0.12, torsoWidthNorm * MAX_ASSIGN_TORSO_FRACTION);
  const cost = usable.map((circle) =>
    targets.map((target) => Math.hypot(circle.x - target.x, circle.y - target.y)),
  );

  const pxPerMm = torsoPx / CHEST_WIDTH_MM;
  const okPx = Math.max(
    torsoPx * PLACE_OK_TORSO_FRAC,
    pxPerMm * PLACEMENT_TOLERANCE_MM,
  );

  const placements: ElectrodePlacement[] = [];
  for (const pair of hungarianAssign(cost)) {
    if (pair.cost > maxDist) {
      continue;
    }
    const circle = usable[pair.row];
    const target = targets[pair.col];
    if (!circle || !target) {
      continue;
    }

    const dxPx = (circle.x - target.x) * videoWidth;
    const dyPx = (circle.y - target.y) * videoHeight;
    const pixelOffset = Math.hypot(dxPx, dyPx);
    const offsetMm = pixelOffset / pxPerMm;

    placements.push({
      id: target.id,
      target,
      detected: circle,
      offsetMm,
      withinTolerance: pixelOffset <= okPx,
    });
  }

  return placements;
}

export function summarizePlacements(
  placements: ElectrodePlacement[],
  total: number,
): PlacementSummary {
  return {
    detected: placements.length,
    placed: placements.filter((item) => item.withinTolerance).length,
    total,
  };
}
