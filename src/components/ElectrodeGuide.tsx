import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  DEFAULT_CALIBRATION,
  ELECTRODE_IDS,
  type CalibrationSettings,
  type ElectrodePlacement,
  type PlacementSummary,
  type PoseAssessment,
} from "../types/electrode";
import { assessTorsoPose, getTorsoFrame, mapElectrodes } from "../lib/electrodeMapping";
import { CircleDetectClient } from "../lib/circleDetectClient";
import { CirclePlacementSmoother } from "../lib/circleSmoother";
import { matchCirclesToTargets, summarizePlacements } from "../lib/electrodeMatch";
import { drawOverlay } from "../lib/overlayRenderer";
import { PoseDetector } from "../lib/poseDetector";
import { LandmarkSmoother } from "../lib/smoothing";
import { SHOW_DEV_TOOLS } from "../lib/devFlags";
import { CalibrationPanel } from "./CalibrationPanel";
import { CameraFeed } from "./CameraFeed";
import { MeasurementGuidePanel } from "./MeasurementGuidePanel";
import { OverlayCanvas } from "./OverlayCanvas";
import { PrivacyOnboarding } from "./PrivacyOnboarding";

const CIRCLE_DETECT_EVERY_MS = 350;
const HOLD_EMPTY_DETECTIONS = 4;

const MIRROR_VIDEO = true;

const VIDEO_WINDOW_DEFAULT_VH = 92;
const VIDEO_WINDOW_DESKTOP_VH = 100;
const VIDEO_WINDOW_MIN_VH = 42;
const VIDEO_WINDOW_MAX_VH = 96;
const DESKTOP_MQ = "(min-width: 768px)";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getDefaultWindowHeightVh(): number {
  if (typeof window === "undefined") {
    return VIDEO_WINDOW_DEFAULT_VH;
  }
  return window.matchMedia(DESKTOP_MQ).matches
    ? VIDEO_WINDOW_DESKTOP_VH
    : VIDEO_WINDOW_DEFAULT_VH;
}

export function ElectrodeGuide() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<PoseDetector | null>(null);
  const stickerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const circleClientRef = useRef<CircleDetectClient | null>(null);
  const smootherRef = useRef(new LandmarkSmoother(DEFAULT_CALIBRATION.alpha));
  const circleSmootherRef = useRef(new CirclePlacementSmoother(0.32, 0.14));
  const calibrationRef = useRef<CalibrationSettings>(DEFAULT_CALIBRATION);
  const showDebugRef = useRef(true);
  const lastStatusKey = useRef("");
  const lastPlacementKey = useRef("");
  const placementsRef = useRef<ElectrodePlacement[]>([]);
  const lastCircleDetectAtRef = useRef(0);
  const emptyDetectStreakRef = useRef(0);
  const detectGenRef = useRef(0);
  const videoFitRef = useRef<"cover" | "contain">("cover");

  const [modelState, setModelState] = useState<"loading" | "ready" | "error">("loading");
  const [modelError, setModelError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
      ? { width: 720, height: 1280 }
      : { width: 1280, height: 720 },
  );
  const [showDebug, setShowDebug] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationSettings>(DEFAULT_CALIBRATION);
  const [privacyAcked, setPrivacyAcked] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [privacyContinueStartsCamera, setPrivacyContinueStartsCamera] = useState(false);
  const [showMeasureGuide, setShowMeasureGuide] = useState(false);
  const [windowHeightVh, setWindowHeightVh] = useState(getDefaultWindowHeightVh);
  const hasCustomHeight = useRef(false);
  const resizeDragRef = useRef<{
    pointerId: number;
    startY: number;
    startVh: number;
  } | null>(null);
  const [circleDetectorState] = useState<"loading" | "ready" | "error">("ready");
  const [placementSummary, setPlacementSummary] = useState<PlacementSummary>({
    detected: 0,
    placed: 0,
    total: ELECTRODE_IDS.length,
  });
  const [assessment, setAssessment] = useState<PoseAssessment>({
    detected: false,
    issue: "no-torso",
    message: "Torso not detected. Adjust your position or the lighting.",
    torsoWidth: 0,
    torsoHeight: 0,
    visibility: 0,
  });

  calibrationRef.current = calibration;
  showDebugRef.current = SHOW_DEV_TOOLS && showDebug;

  useEffect(() => {
    const detector = new PoseDetector();
    detectorRef.current = detector;
    let cancelled = false;

    detector
      .init()
      .then(() => {
        if (cancelled) {
          return;
        }
        setModelState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setModelState("error");
        setModelError(
          error instanceof Error
            ? error.message
            : "Could not load the pose model.",
        );
      });

    return () => {
      cancelled = true;
      detector.close();
      if (detectorRef.current === detector) {
        detectorRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    smootherRef.current.setAlpha(calibration.alpha);
  }, [calibration.alpha]);

  useEffect(() => {
    const applyDefault = () => {
      if (!hasCustomHeight.current) {
        setWindowHeightVh(getDefaultWindowHeightVh());
      }
    };
    const mq = window.matchMedia(DESKTOP_MQ);
    mq.addEventListener("change", applyDefault);
    window.addEventListener("resize", applyDefault);
    return () => {
      mq.removeEventListener("change", applyDefault);
      window.removeEventListener("resize", applyDefault);
    };
  }, []);

  const handleCameraReady = useCallback((width: number, height: number) => {
    setCameraError(null);
    if (width > 0 && height > 0) {
      setFrameSize({ width, height });
    }
  }, []);

  const handleCameraError = useCallback((message: string) => {
    setCameraError(message);
    setCameraOn(false);
  }, []);

  const handleResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeDragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startVh: windowHeightVh,
      };
    },
    [windowHeightVh],
  );

  const handleResizePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const viewportH = window.visualViewport?.height ?? window.innerHeight;
    if (viewportH <= 0) {
      return;
    }
    const deltaVh = ((event.clientY - drag.startY) / viewportH) * 100;
    hasCustomHeight.current = true;
    setWindowHeightVh(
      clamp(drag.startVh + deltaVh, VIDEO_WINDOW_MIN_VH, VIDEO_WINDOW_MAX_VH),
    );
  }, []);

  const endResizeDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (resizeDragRef.current?.pointerId === event.pointerId) {
      resizeDragRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!cameraOn || modelState !== "ready") {
      return;
    }

    const smoother = smootherRef.current;
    const circleSmoother = circleSmootherRef.current;
    smoother.reset();
    circleSmoother.reset();
    lastStatusKey.current = "";
    lastPlacementKey.current = "";
    placementsRef.current = [];
    lastCircleDetectAtRef.current = 0;
    emptyDetectStreakRef.current = 0;
    detectGenRef.current += 1;
    const detectGen = detectGenRef.current;

    if (!circleClientRef.current) {
      circleClientRef.current = new CircleDetectClient();
    }
    const circleClient = circleClientRef.current;

    let raf = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) {
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const detector = detectorRef.current;

      if (video && canvas && detector && video.readyState >= 2) {
        const width = video.videoWidth;
        const height = video.videoHeight;

        if (width > 0 && height > 0) {
          const rect = canvas.getBoundingClientRect();
          const displayWidth = rect.width;
          const displayHeight = rect.height;
          const dpr = window.devicePixelRatio || 1;
          const pixelWidth = Math.max(1, Math.round(displayWidth * dpr));
          const pixelHeight = Math.max(1, Math.round(displayHeight * dpr));

          if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
          }

          let raw: ReturnType<PoseDetector["detect"]> = null;
          try {
            raw = detector.detect(video);
          } catch {
            raw = null;
          }
          if (!raw) {
            smoother.reset();
          }
          const smoothed = raw ? smoother.apply(raw) : null;
          const pose = assessTorsoPose(smoothed);
          const electrodes = smoothed ? mapElectrodes(smoothed, calibrationRef.current) : null;
          const torso = smoothed ? getTorsoFrame(smoothed) : null;
          const torsoWidth = torso?.torsoWidth ?? 0.3;

          const now = performance.now();
          if (
            smoothed &&
            electrodes &&
            !circleClient.isBusy &&
            now - lastCircleDetectAtRef.current >= CIRCLE_DETECT_EVERY_MS
          ) {
            lastCircleDetectAtRef.current = now;
            if (!stickerCanvasRef.current) {
              stickerCanvasRef.current = document.createElement("canvas");
            }
            const landmarksAtDetect = smoothed;
            const electrodesAtDetect = electrodes;
            const widthAtDetect = width;
            const heightAtDetect = height;
            const torsoWidthAtDetect = torsoWidth;

            void circleClient
              .detect(video, landmarksAtDetect, stickerCanvasRef.current)
              .then((circles) => {
                if (cancelled || detectGenRef.current !== detectGen) {
                  return;
                }
                if (circles.length === 0) {
                  emptyDetectStreakRef.current += 1;
                  if (emptyDetectStreakRef.current >= HOLD_EMPTY_DETECTIONS) {
                    circleSmoother.reset();
                    placementsRef.current = [];
                  }
                  return;
                }
                emptyDetectStreakRef.current = 0;
                const matched = matchCirclesToTargets(
                  circles,
                  electrodesAtDetect,
                  torsoWidthAtDetect,
                  widthAtDetect,
                  heightAtDetect,
                  { previousDetected: circleSmoother.previousDetected() },
                );
                circleSmoother.ingest(matched);
              })
              .catch(() => {
                /* keep last smoothed placements */
              });
          } else if (!electrodes) {
            circleSmoother.reset();
            placementsRef.current = [];
            emptyDetectStreakRef.current = 0;
          }

          // Every frame: ease toward last raw detections + refresh targets/offsets.
          if (electrodes) {
            placementsRef.current = circleSmoother.tick(
              electrodes,
              torsoWidth,
              width,
              height,
            );
          }

          const placements = placementsRef.current;

          const ctx = canvas.getContext("2d");
          if (ctx && displayWidth > 0 && displayHeight > 0) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawOverlay(
              ctx,
              {
                videoWidth: width,
                videoHeight: height,
                displayWidth,
                displayHeight,
                fit: videoFitRef.current,
              },
              {
                landmarks: smoothed,
                electrodes,
                placements,
                showDebug: showDebugRef.current,
                mirrored: MIRROR_VIDEO,
              },
            );
          }

          const statusKey = `${pose.detected}:${pose.issue ?? ""}:${pose.message ?? ""}`;
          if (statusKey !== lastStatusKey.current) {
            lastStatusKey.current = statusKey;
            setAssessment(pose);
          }

          const nextSummary = summarizePlacements(placements, ELECTRODE_IDS.length);
          const placementKey = `${nextSummary.detected}:${nextSummary.placed}`;
          if (placementKey !== lastPlacementKey.current) {
            lastPlacementKey.current = placementKey;
            setPlacementSummary(nextSummary);
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      detectGenRef.current += 1;
      cancelAnimationFrame(raf);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, [cameraOn, modelState]);

  useEffect(() => {
    return () => {
      circleClientRef.current?.dispose();
      circleClientRef.current = null;
    };
  }, []);

  const aspect = frameSize.width / Math.max(1, frameSize.height);
  const letterbox =
    typeof window !== "undefined" &&
    window.innerHeight > window.innerWidth &&
    aspect > 1.05;
  videoFitRef.current = letterbox ? "contain" : "cover";
  const detected = cameraOn && assessment.detected && assessment.issue === null;

  const requestStartCamera = useCallback(() => {
    if (privacyAcked) {
      setCameraOn(true);
      return;
    }
    setPrivacyContinueStartsCamera(true);
    setShowPrivacy(true);
  }, [privacyAcked]);

  const handlePrivacyContinue = useCallback(() => {
    setPrivacyAcked(true);
    setShowPrivacy(false);
    if (privacyContinueStartsCamera) {
      setCameraOn(true);
    }
    setPrivacyContinueStartsCamera(false);
  }, [privacyContinueStartsCamera]);

  const reopenPrivacy = useCallback(() => {
    setPrivacyContinueStartsCamera(false);
    setShowPrivacy(true);
  }, []);

  return (
    <div className="guide">
      <div className="stage">
        <div
          className={`viewport${letterbox ? " is-letterbox" : ""}`}
          style={{
            ["--video-window-vh" as string]: String(windowHeightVh),
            ["--ar" as string]: String(aspect),
          }}
        >
          <CameraFeed
            videoRef={videoRef}
            active={cameraOn}
            onReady={handleCameraReady}
            onError={handleCameraError}
          />
          <OverlayCanvas canvasRef={canvasRef} />
        </div>

        {!cameraOn ? (
          <div className="idle-card">
            <p className="eyebrow">The Patch · 12-lead ECG</p>
            <h1>Visual electrode placement guide</h1>
            <p>
              Face the camera. You will see 10 points (RA, LA, RL, LL, and
              V1–V6) overlaid on your torso. This is an assistance guide, not a
              certified medical device.
            </p>
            
            {modelState === "loading" ? (
              <p className="status-line">Loading pose model…</p>
            ) : null}
            {modelState === "error" ? (
              <p className="idle-alert banner-error">
                {modelError ?? "Failed to load MediaPipe."}
              </p>
            ) : null}
            {cameraError ? <p className="idle-alert banner-error">{cameraError}</p> : null}
            <button
              type="button"
              className="primary-btn"
              disabled={modelState !== "ready"}
              onClick={requestStartCamera}
            >
              Start camera
            </button>
            <div className="idle-links">
              <button
                type="button"
                className="text-btn"
                onClick={() => setShowMeasureGuide(true)}
              >
                Need help? Use the measurement guide
              </button>
              <button type="button" className="text-btn" onClick={reopenPrivacy}>
                About privacy
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {cameraOn ? (
        <div
          className="viewport-handle"
          role="slider"
          aria-label="Resize camera window"
          aria-orientation="vertical"
          aria-valuemin={VIDEO_WINDOW_MIN_VH}
          aria-valuemax={VIDEO_WINDOW_MAX_VH}
          aria-valuenow={Math.round(windowHeightVh)}
          style={{
            ["--video-window-vh" as string]: String(windowHeightVh),
          }}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
        />
      ) : null}

      {cameraOn ? (
        <div className="hud">
          <div className="privacy-badge" aria-live="polite">
            <span className="privacy-badge-icon" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path
                  d="M9.5 12.5l1.8 1.8 3.7-3.8"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            Private — not recorded
          </div>

          <div className="hud-top">
            <div className="hud-status">
              <div className={`pill ${detected ? "ok" : "off"}`}>
                {detected ? "Torso detected" : "Torso not detected"}
              </div>
              <div className="legend">
                <span className="swatch precordial" /> V1–V6
                <span className="swatch limb" /> RA/LA/RL/LL
              </div>
            </div>
            {assessment.message && assessment.issue !== "no-torso" ? (
              <div className="banner banner-warn" role="status">
                {assessment.message}
              </div>
            ) : null}
            {detected ? (
              <div
                className={`pill placement ${placementSummary.placed === placementSummary.total ? "ok" : ""}`}
              >
                {circleDetectorState === "loading"
                  ? "Loading circle detector…"
                  : circleDetectorState === "error"
                    ? "Circle detector unavailable"
                    : `${placementSummary.detected}/10 electrodes detected, ${placementSummary.placed} correctly placed`}
              </div>
            ) : null}
            {SHOW_DEV_TOOLS ? (
              <p className="sticker-hint hud-hint">
                20mm bright green, orange, magenta, or blue stickers work best.
              </p>
            ) : null}
          </div>

          <div className="hud-bottom">
            <div className="hud-toolbar">
              <div className="hud-actions">
                <button
                  type="button"
                  className="primary-btn toolbar-btn"
                  onClick={() => setCameraOn(false)}
                >
                  Stop camera
                </button>
                <CalibrationPanel
                  open={showCalibration}
                  onToggle={() => setShowCalibration((open) => !open)}
                  settings={calibration}
                  onChange={setCalibration}
                  compact
                />
                <button
                  type="button"
                  className="ghost-btn toolbar-btn"
                  onClick={() => setShowMeasureGuide(true)}
                >
                  Measurement guide
                </button>
                {SHOW_DEV_TOOLS ? (
                  <label className="toggle toggle-compact hud-dev-inline">
                    <input
                      type="checkbox"
                      checked={showDebug}
                      onChange={(event) => setShowDebug(event.target.checked)}
                    />
                    Debug skeleton
                  </label>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <PrivacyOnboarding
        open={showPrivacy}
        onContinue={handlePrivacyContinue}
        continueLabel={privacyContinueStartsCamera ? "Start camera" : "Got it"}
      />
      <MeasurementGuidePanel
        open={showMeasureGuide}
        onClose={() => setShowMeasureGuide(false)}
      />
    </div>
  );
}
