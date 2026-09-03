import { useEffect, type RefObject } from "react";

type CameraFeedProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
  onReady: (width: number, height: number) => void;
  onError: (message: string) => void;
};

export function CameraFeed({ videoRef, active, onReady, onError }: CameraFeedProps) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    let stream: MediaStream | null = null;
    let cancelled = false;
    let pollId = 0;

    const reportSize = () => {
      if (cancelled) {
        return;
      }
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        video.classList.add("is-ready");
        onReady(video.videoWidth, video.videoHeight);
      }
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          onError("This browser does not allow camera access.");
        }
        return;
      }

      try {
        // Don't force 1280x720 — phones renegotiate that slowly and often
        // start in a cropped/zoomed mode. Prefer native portrait on mobile.
        const mobile = window.matchMedia("(max-width: 767px)").matches;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: mobile
            ? {
                facingMode: { ideal: "user" },
                width: { ideal: 720 },
                height: { ideal: 1280 },
                aspectRatio: { ideal: 9 / 16 },
              }
            : {
                facingMode: { ideal: "user" },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
        });

        if (cancelled) {
          stopStream(stream);
          stream = null;
          return;
        }

        const track = stream.getVideoTracks()[0];
        if (track) {
          // Prefer full sensor FOV when the browser supports it (avoids digital zoom).
          try {
            const caps = track.getCapabilities?.() as
              | (MediaTrackCapabilities & { resizeMode?: string[] })
              | undefined;
            if (caps?.resizeMode?.includes("none")) {
              await track.applyConstraints({
                advanced: [{ resizeMode: "none" } as MediaTrackConstraintSet],
              });
            }
          } catch {
            // Optional constraint — ignore if unsupported.
          }
        }

        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");
        video.setAttribute("webkit-playsinline", "true");
        await video.play();

        if (cancelled) {
          stopStream(stream);
          if (video.srcObject === stream) {
            video.srcObject = null;
          }
          stream = null;
          return;
        }

        reportSize();
        video.addEventListener("loadedmetadata", reportSize);
        video.addEventListener("resize", reportSize);

        // Some mobiles change track settings a moment after play.
        let polls = 0;
        pollId = window.setInterval(() => {
          polls += 1;
          reportSize();
          if (polls >= 10) {
            window.clearInterval(pollId);
            pollId = 0;
          }
        }, 300);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          onError("Camera permission denied. Enable it in the browser to continue.");
        } else if (name === "NotFoundError") {
          onError("No camera was found on this device.");
        } else {
          onError("Could not start the camera.");
        }
      }
    };

    video.classList.remove("is-ready");
    void start();

    return () => {
      cancelled = true;
      if (pollId) {
        window.clearInterval(pollId);
      }
      video.removeEventListener("loadedmetadata", reportSize);
      video.removeEventListener("resize", reportSize);
      video.classList.remove("is-ready");
      const current = video.srcObject;
      if (current instanceof MediaStream) {
        stopStream(current);
      }
      if (stream && stream !== current) {
        stopStream(stream);
      }
      stream = null;
      video.srcObject = null;
    };
  }, [active, onError, onReady, videoRef]);

  return (
    <video
      ref={videoRef}
      className="camera-feed"
      autoPlay
      playsInline
      muted
    />
  );
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
