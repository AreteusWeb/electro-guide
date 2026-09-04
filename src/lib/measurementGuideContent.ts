import type { ElectrodeId } from "../types/electrode";

export type MeasurementGuideEntry = {
  id: ElectrodeId;
  landmark: string;
  approxCm: string;
};

/**
 * Static placement reference for the measurement-guide fallback.
 * Landmark wording follows common 12-lead ECG teaching; cm figures are
 * rough adult averages only — prefer anatomical landmarks in practice.
 */
export const MEASUREMENT_GUIDE: readonly MeasurementGuideEntry[] = [
  {
    id: "RA",
    landmark:
      "Right arm / right infraclavicular fossa — below the clavicle near the shoulder, right side.",
    approxCm: "Limb lead; place on soft tissue below the right clavicle (not on bone).",
  },
  {
    id: "LA",
    landmark:
      "Left arm / left infraclavicular fossa — below the clavicle near the shoulder, left side.",
    approxCm: "Limb lead; mirror of RA on the left side.",
  },
  {
    id: "RL",
    landmark:
      "Right lower torso / leg area — right lower abdomen or upper thigh, below the rib cage (ground/reference).",
    approxCm: "Limb lead; well below the right costal margin, away from the heart.",
  },
  {
    id: "LL",
    landmark:
      "Left lower torso / leg area — left lower abdomen or upper thigh, below the rib cage.",
    approxCm: "Limb lead; mirror of RL on the left side.",
  },
  {
    id: "V1",
    landmark: "4th intercostal space, right sternal border.",
    approxCm: "About 2–3 cm to the right of the sternum, at the 4th rib space.",
  },
  {
    id: "V2",
    landmark: "4th intercostal space, left sternal border (same level as V1).",
    approxCm: "About 2–3 cm to the left of the sternum, horizontally aligned with V1.",
  },
  {
    id: "V3",
    landmark: "Midway between V2 and V4 along a diagonal line.",
    approxCm: "Halfway in both distance and height between V2 and V4 (body-size dependent).",
  },
  {
    id: "V4",
    landmark:
      "5th intercostal space, left midclavicular line. Prefer palpating the rib space — nipple position varies, especially with breast tissue.",
    approxCm:
      "Often near nipple level in male anatomy; for female anatomy, follow the midclavicular line to the 5th ICS rather than the nipple.",
  },
  {
    id: "V5",
    landmark: "Left anterior axillary line, same horizontal level as V4.",
    approxCm: "Roughly 8–10 cm lateral to V4 (adjust for body size).",
  },
  {
    id: "V6",
    landmark: "Left midaxillary line, same horizontal level as V4 and V5.",
    approxCm: "Roughly 6–8 cm lateral to V5 (adjust for body size).",
  },
] as const;
