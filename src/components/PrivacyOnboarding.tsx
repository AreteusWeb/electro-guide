type PrivacyOnboardingProps = {
  open: boolean;
  onContinue: () => void;
  /** When true, Continue only dismisses (camera already started or re-open). */
  continueLabel?: string;
};

export function PrivacyOnboarding({
  open,
  onContinue,
  continueLabel = "Continue",
}: PrivacyOnboardingProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal-card privacy-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-title"
      >
        <p className="eyebrow">Privacy</p>
        <h2 id="privacy-title">Your camera stays on this device</h2>
        <p>
          Your camera feed stays on your device. Nothing is recorded, saved, or
          sent anywhere — all processing happens locally in your browser.
        </p>
        <button type="button" className="primary-btn" onClick={onContinue}>
          {continueLabel}
        </button>
      </div>
    </div>
  );
}
