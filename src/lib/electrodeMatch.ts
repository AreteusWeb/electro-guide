import {
  PLACEMENT_TOLERANCE_MM,
  type DetectedCircle,
  type ElectrodeId,
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

/**
 * Prefer keeping a circle on the same target unless another pairing is
 * meaningfully closer (normalized image distance).
 */
const STICKY_RADIUS = 0.08;
const STICKY_COST_SCALE = 0.55;
/** Only switch away from a sticky pair if the new pair is this much closer. */
const SWITCH_IMPROVEMENT = 0.035;

export type MatchOptions = {
  /** Previous frame's detected position per electrode (for stickiness). */
  previousDetected?: Map<ElectrodeId, DetectedCircle> | null;
};

export function matchCirclesToTargets(
  circles: DetectedCircle[],
  targets: ElectrodePoint[],
  torsoWidthNorm: number,
  videoWidth: number,
  videoHeight: number,
  options: MatchOptions = {},
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

  const previous = options.previousDetected ?? null;
  const maxDist = Math.max(0.12, torsoWidthNorm * MAX_ASSIGN_TORSO_FRACTION);
  const cost = usable.map((circle) =>
    targets.map((target) => {
      let d = Math.hypot(circle.x - target.x, circle.y - target.y);
      const prev = previous?.get(target.id);
      if (prev) {
        const toPrev = Math.hypot(circle.x - prev.x, circle.y - prev.y);
        if (toPrev <= STICKY_RADIUS) {
          d *= STICKY_COST_SCALE;
        }
      }
      return d;
    }),
  );

  const pxPerMm = torsoPx / CHEST_WIDTH_MM;
  const okPx = Math.max(
    torsoPx * PLACE_OK_TORSO_FRAC,
    pxPerMm * PLACEMENT_TOLERANCE_MM,
  );

  const rawPairs = hungarianAssign(cost).filter((pair) => pair.cost <= maxDist);
  const pairs = applyAssignmentHysteresis(
    rawPairs,
    usable,
    targets,
    previous,
    maxDist,
  );

  const placements: ElectrodePlacement[] = [];
  for (const pair of pairs) {
    const circle = usable[pair.row];
    const target = targets[pair.col];
    if (!circle || !target) {
      continue;
    }

    const dxPx = (circle.x - target.x) * videoWidth;
    const dyPx = (circle.y - target.y) * videoHeight;
    const pixelOffset = Math.hypot(dxPx, dyPx);

    placements.push({
      id: target.id,
      target,
      detected: circle,
      offsetMm: pixelOffset / pxPerMm,
      withinTolerance: pixelOffset <= okPx,
    });
  }

  return placements;
}

/**
 * After Hungarian, undo flaky swaps: keep last frame's circle on a target
 * unless another circle is meaningfully closer to that geometric target.
 */
function applyAssignmentHysteresis(
  pairs: { row: number; col: number; cost: number }[],
  circles: DetectedCircle[],
  targets: ElectrodePoint[],
  previous: Map<ElectrodeId, DetectedCircle> | null,
  maxDist: number,
): { row: number; col: number; cost: number }[] {
  if (!previous || previous.size === 0) {
    return pairs;
  }

  const byCol = new Map(pairs.map((p) => [p.col, p]));

  for (let col = 0; col < targets.length; col += 1) {
    const target = targets[col];
    if (!target) {
      continue;
    }
    const prev = previous.get(target.id);
    if (!prev) {
      continue;
    }

    let stickyRow = -1;
    let stickyDist = Infinity;
    for (let row = 0; row < circles.length; row += 1) {
      const c = circles[row];
      if (!c) {
        continue;
      }
      const toPrev = Math.hypot(c.x - prev.x, c.y - prev.y);
      if (toPrev > STICKY_RADIUS) {
        continue;
      }
      const toTarget = Math.hypot(c.x - target.x, c.y - target.y);
      if (toTarget < stickyDist) {
        stickyDist = toTarget;
        stickyRow = row;
      }
    }
    if (stickyRow < 0 || stickyDist > maxDist) {
      continue;
    }

    const current = byCol.get(col);
    if (!current) {
      // Free sticky circle if unused elsewhere.
      const taken = [...byCol.values()].some((p) => p.row === stickyRow);
      if (!taken) {
        byCol.set(col, { row: stickyRow, col, cost: stickyDist });
      }
      continue;
    }
    if (current.row === stickyRow) {
      continue;
    }

    const currentCircle = circles[current.row];
    if (!currentCircle) {
      continue;
    }
    const currentDist = Math.hypot(
      currentCircle.x - target.x,
      currentCircle.y - target.y,
    );
    // Switch only if the new pairing is meaningfully better.
    if (currentDist + SWITCH_IMPROVEMENT < stickyDist) {
      continue;
    }

    for (const [otherCol, pair] of byCol) {
      if (pair.row === stickyRow && otherCol !== col) {
        byCol.delete(otherCol);
      }
    }
    byCol.set(col, { row: stickyRow, col, cost: stickyDist });
  }

  return [...byCol.values()];
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
