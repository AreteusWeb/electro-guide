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

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          onError("This browser does not allow camera access.");
        }
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (cancelled) {
          stopStream(stream);
          stream = null;
          return;
        }

        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        if (cancelled) {
          stopStream(stream);
          if (video.srcObject === stream) {
            video.srcObject = null;
          }
          stream = null;
          return;
        }

        const applySize = () => {
          if (cancelled) {
            return;
          }
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            onReady(video.videoWidth, video.videoHeight);
          }
        };

        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          applySize();
        } else {
          video.addEventListener("loadedmetadata", applySize, { once: true });
        }
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

    void start();

    return () => {
      cancelled = true;
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
