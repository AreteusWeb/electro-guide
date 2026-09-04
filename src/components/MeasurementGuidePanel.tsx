import { MEASUREMENT_GUIDE } from "../lib/measurementGuideContent";
import { LIMB_ELECTRODES } from "../types/electrode";

type MeasurementGuidePanelProps = {
  open: boolean;
  onClose: () => void;
};

export function MeasurementGuidePanel({ open, onClose }: MeasurementGuidePanelProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal-card measure-guide-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="measure-guide-title"
      >
        <div className="measure-guide-header">
          <div>
            <p className="eyebrow">Fallback reference</p>
            <h2 id="measure-guide-title">Measurement guide</h2>
          </div>
          <button type="button" className="ghost-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="measure-guide-intro">
          Use anatomical landmarks first (intercostal spaces, sternal border,
          midclavicular / axillary lines). Centimeter figures are general adult
          averages — not personalized — and are only a rough sanity check.
          Body size varies.
        </p>

        <ul className="measure-guide-list">
          {MEASUREMENT_GUIDE.map((entry) => (
            <li key={entry.id} className="measure-guide-item">
              <div className="measure-guide-id-row">
                <span
                  className={`measure-guide-id ${LIMB_ELECTRODES.has(entry.id) ? "limb" : "precordial"}`}
                >
                  {entry.id}
                </span>
              </div>
              <p className="measure-guide-landmark">{entry.landmark}</p>
              <p className="measure-guide-cm">
                <span className="measure-guide-cm-label">Approx.</span>{" "}
                {entry.approxCm}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
