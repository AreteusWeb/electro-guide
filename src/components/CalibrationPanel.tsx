import { DEFAULT_CALIBRATION, type CalibrationSettings } from "../types/electrode";

type CalibrationPanelProps = {
  open: boolean;
  onToggle: () => void;
  settings: CalibrationSettings;
  onChange: (next: CalibrationSettings) => void;
};

export function CalibrationPanel({
  open,
  onToggle,
  settings,
  onChange,
}: CalibrationPanelProps) {
  return (
    <section className={`calibration ${open ? "is-open" : ""}`}>
      <button type="button" className="ghost-btn" onClick={onToggle}>
        {open ? "Hide calibration" : "Calibration"}
      </button>

      {open ? (
        <div className="calibration-body">
          <p className="hint">
            Live adjustments. Base proportions live in{" "}
            <code>ELECTRODE_OFFSETS</code> (<code>src/lib/electrodeMapping.ts</code>).
          </p>

          <label>
            Smoothing (alpha)
            <input
              type="range"
              min={0.15}
              max={0.8}
              step={0.05}
              value={settings.alpha}
              onChange={(event) =>
                onChange({ ...settings, alpha: Number(event.target.value) })
              }
            />
            <span>{settings.alpha.toFixed(2)}</span>
          </label>

          <label>
            Offset X
            <input
              type="range"
              min={-0.2}
              max={0.2}
              step={0.01}
              value={settings.nudgeX}
              onChange={(event) =>
                onChange({ ...settings, nudgeX: Number(event.target.value) })
              }
            />
            <span>{settings.nudgeX.toFixed(2)}</span>
          </label>

          <label>
            Offset Y
            <input
              type="range"
              min={-0.2}
              max={0.2}
              step={0.01}
              value={settings.nudgeY}
              onChange={(event) =>
                onChange({ ...settings, nudgeY: Number(event.target.value) })
              }
            />
            <span>{settings.nudgeY.toFixed(2)}</span>
          </label>

          <label>
            Scale
            <input
              type="range"
              min={0.7}
              max={1.3}
              step={0.01}
              value={settings.scale}
              onChange={(event) =>
                onChange({ ...settings, scale: Number(event.target.value) })
              }
            />
            <span>{settings.scale.toFixed(2)}</span>
          </label>

          <button
            type="button"
            className="ghost-btn"
            onClick={() => onChange(DEFAULT_CALIBRATION)}
          >
            Reset
          </button>
        </div>
      ) : null}
    </section>
  );
}
