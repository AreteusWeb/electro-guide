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
import { matchCirclesToTargets, summarizePlacements } from "../lib/electrodeMatch";
import { drawOverlay } from "../lib/overlayRenderer";
import { PoseDetector } from "../lib/poseDetector";
import { detectStickerCircles } from "../lib/simpleCircleDetector";
import { LandmarkSmoother } from "../lib/smoothing";
import { CalibrationPanel } from "./CalibrationPanel";
import { CameraFeed } from "./CameraFeed";
import { OverlayCanvas } from "./OverlayCanvas";

const CIRCLE_DETECT_EVERY_MS = 400;
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
  const smootherRef = useRef(new LandmarkSmoother(DEFAULT_CALIBRATION.alpha));
  const calibrationRef = useRef<CalibrationSettings>(DEFAULT_CALIBRATION);
  const showDebugRef = useRef(true);
  const lastStatusKey = useRef("");
  const lastPlacementKey = useRef("");
  const placementsRef = useRef<ElectrodePlacement[]>([]);
  const lastCircleDetectAtRef = useRef(0);
  const emptyDetectStreakRef = useRef(0);
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
  const [showDebug, setShowDebug] = useState(true);
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationSettings>(DEFAULT_CALIBRATION);
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
  showDebugRef.current = showDebug;

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
    smoother.reset();
    lastStatusKey.current = "";
    lastPlacementKey.current = "";
    placementsRef.current = [];
    lastCircleDetectAtRef.current = 0;
    emptyDetectStreakRef.current = 0;

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

          const now = performance.now();
          if (
            smoothed &&
            electrodes &&
            now - lastCircleDetectAtRef.current >= CIRCLE_DETECT_EVERY_MS
          ) {
            lastCircleDetectAtRef.current = now;
            if (!stickerCanvasRef.current) {
              stickerCanvasRef.current = document.createElement("canvas");
            }
            let circles: ReturnType<typeof detectStickerCircles> = [];
            try {
              circles = detectStickerCircles(video, smoothed, stickerCanvasRef.current);
            } catch {
              circles = [];
            }
            if (circles.length === 0) {
              emptyDetectStreakRef.current += 1;
              if (emptyDetectStreakRef.current >= HOLD_EMPTY_DETECTIONS) {
                placementsRef.current = [];
              }
            } else {
              emptyDetectStreakRef.current = 0;
              const torso = getTorsoFrame(smoothed);
              placementsRef.current = matchCirclesToTargets(
                circles,
                electrodes,
                torso?.torsoWidth ?? 0.3,
                width,
                height,
              );
            }
          } else if (!electrodes) {
            placementsRef.current = [];
            emptyDetectStreakRef.current = 0;
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
      cancelAnimationFrame(raf);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, [cameraOn, modelState]);

  const aspect = frameSize.width / Math.max(1, frameSize.height);
  const letterbox =
    typeof window !== "undefined" &&
    window.innerHeight > window.innerWidth &&
    aspect > 1.05;
  videoFitRef.current = letterbox ? "contain" : "cover";
  const detected = cameraOn && assessment.detected && assessment.issue === null;

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
            <p className="sticker-hint">
              For live detection, use solid 20mm stickers in a bright,
              high-contrast color — green, orange, magenta, or blue. Avoid
              skin-like tones.
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
              onClick={() => setCameraOn(true)}
            >
              Start camera
            </button>
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
          <div className="hud-top">
            <div className="hud-chips">
              <div className={`pill ${detected ? "ok" : "off"}`}>
                {detected ? "Torso detected" : "Torso not detected"}
              </div>
              <div className="legend">
                <span className="swatch precordial" /> V1–V6
                <span className="swatch limb" /> RA/LA/RL/LL
              </div>
            </div>
            {assessment.message ? (
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
            <p className="sticker-hint hud-hint">
              20mm bright green, orange, magenta, or blue stickers work best.
            </p>
          </div>

          <div className="hud-bottom">
            <div className="controls">
              <button
                type="button"
                className="primary-btn"
                onClick={() => setCameraOn(false)}
              >
                Stop camera
              </button>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showDebug}
                  onChange={(event) => setShowDebug(event.target.checked)}
                />
                Debug skeleton
              </label>
            </div>

            <CalibrationPanel
              open={showCalibration}
              onToggle={() => setShowCalibration((open) => !open)}
              settings={calibration}
              onChange={setCalibration}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
