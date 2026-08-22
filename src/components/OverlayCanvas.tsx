import type { RefObject } from "react";

type OverlayCanvasProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
};

export function OverlayCanvas({ canvasRef }: OverlayCanvasProps) {
  return <canvas ref={canvasRef} className="overlay-canvas" />;
}
