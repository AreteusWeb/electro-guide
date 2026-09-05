type PlacementCompleteOverlayProps = {
  open: boolean;
  onContinue: () => void;
};

export function PlacementCompleteOverlay({
  open,
  onContinue,
}: PlacementCompleteOverlayProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop placement-complete-backdrop" role="presentation">
      <div
        className="modal-card privacy-modal placement-complete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="placement-complete-title"
      >
        <div className="placement-complete-icon" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="3" />
            <path
              d="M14 25.5l6.5 6.5L34 17"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className="eyebrow">Complete</p>
        <h2 id="placement-complete-title">All electrodes placed correctly!</h2>
        <p>
          All 10 positions are within tolerance. You can continue watching the
          live view to double-check, or stop the camera when you are done.
        </p>
        <button type="button" className="primary-btn" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
