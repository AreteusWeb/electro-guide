import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_CALIBRATION,
  type CalibrationSettings,
  type PoseAssessment,
} from "../types/electrode";
import { assessTorsoPose, mapElectrodes } from "../lib/electrodeMapping";
import { drawOverlay } from "../lib/overlayRenderer";
import { PoseDetector } from "../lib/poseDetector";
import { LandmarkSmoother } from "../lib/smoothing";
import { CalibrationPanel } from "./CalibrationPanel";
import { CameraFeed } from "./CameraFeed";
import { OverlayCanvas } from "./OverlayCanvas";

const MIRROR_VIDEO = true;

export function ElectrodeGuide() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<PoseDetector | null>(null);
  const smootherRef = useRef(new LandmarkSmoother(DEFAULT_CALIBRATION.alpha));
  const calibrationRef = useRef<CalibrationSettings>(DEFAULT_CALIBRATION);
  const showDebugRef = useRef(true);
  const lastStatusKey = useRef("");

  const [modelState, setModelState] = useState<"loading" | "ready" | "error">("loading");
  const [modelError, setModelError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 1280, height: 720 });
  const [showDebug, setShowDebug] = useState(true);
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationSettings>(DEFAULT_CALIBRATION);
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
        if (!cancelled) {
          setModelState("ready");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setModelState("error");
          setModelError(
            error instanceof Error
              ? error.message
              : "Could not load the pose model.",
          );
        }
      });

    return () => {
      cancelled = true;
      detector.close();
      detectorRef.current = null;
    };
  }, []);

  useEffect(() => {
    smootherRef.current.setAlpha(calibration.alpha);
  }, [calibration.alpha]);

  const handleCameraReady = useCallback((width: number, height: number) => {
    setCameraError(null);
    setFrameSize({ width, height });
  }, []);

  const handleCameraError = useCallback((message: string) => {
    setCameraError(message);
    setCameraOn(false);
  }, []);

  useEffect(() => {
    if (!cameraOn || modelState !== "ready") {
      return;
    }

    const smoother = smootherRef.current;
    smoother.reset();
    lastStatusKey.current = "";

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
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }

          const raw = detector.detect(video);
          if (!raw) {
            smoother.reset();
          }
          const smoothed = raw ? smoother.apply(raw) : null;
          const pose = assessTorsoPose(smoothed);
          const electrodes =
            pose.detected && smoothed ? mapElectrodes(smoothed, calibrationRef.current) : null;

          const ctx = canvas.getContext("2d");
          if (ctx) {
            drawOverlay(ctx, width, height, {
              landmarks: smoothed,
              electrodes,
              showDebug: showDebugRef.current,
              mirrored: MIRROR_VIDEO,
            });
          }

          const statusKey = `${pose.detected}:${pose.issue ?? ""}:${pose.message ?? ""}`;
          if (statusKey !== lastStatusKey.current) {
            lastStatusKey.current = statusKey;
            setAssessment(pose);
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

  const aspect = frameSize.width / frameSize.height;
  const detected = cameraOn && assessment.detected && assessment.issue === null;

  return (
    <div className="guide">
      <div
        className="stage"
        style={{
          ["--ar" as string]: String(aspect),
        }}
      >
        <div className="viewport">
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
              onClick={() => setCameraOn(true)}
            >
              Start camera
            </button>
          </div>
        ) : null}

        {cameraOn && assessment.message ? (
          <div className="banner banner-warn" role="status">
            {assessment.message}
          </div>
        ) : null}
      </div>

      {cameraOn ? (
        <div className="hud">
          <div className="hud-top">
            <div className={`pill ${detected ? "ok" : "off"}`}>
              {detected ? "Torso detected" : "Torso not detected"}
            </div>
            <div className="legend">
              <span className="swatch precordial" /> V1–V6
              <span className="swatch limb" /> RA/LA/RL/LL
            </div>
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
