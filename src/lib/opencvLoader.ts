export type OpenCvRuntime = {
  Mat: new (rows?: number, cols?: number, type?: number, fill?: number[]) => OpenCvMat;
  Size: new (w: number, h: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Scalar: new (...args: number[]) => unknown;
  HOUGH_GRADIENT: number;
  COLOR_RGBA2GRAY: number;
  COLOR_RGBA2RGB: number;
  COLOR_RGB2HSV: number;
  CV_8UC1: number;
  CV_8UC3: number;
  CV_32FC3: number;
  RETR_EXTERNAL: number;
  CHAIN_APPROX_SIMPLE: number;
  MORPH_ELLIPSE: number;
  MORPH_OPEN: number;
  MORPH_CLOSE: number;
  imread: (el: HTMLCanvasElement) => OpenCvMat;
  cvtColor: (src: OpenCvMat, dst: OpenCvMat, code: number, dstCn?: number) => void;
  GaussianBlur: (
    src: OpenCvMat,
    dst: OpenCvMat,
    ksize: unknown,
    sigmaX: number,
    sigmaY?: number,
  ) => void;
  HoughCircles: (
    image: OpenCvMat,
    circles: OpenCvMat,
    method: number,
    dp: number,
    minDist: number,
    param1?: number,
    param2?: number,
    minRadius?: number,
    maxRadius?: number,
  ) => void;
  inRange: (src: OpenCvMat, lower: OpenCvMat, upper: OpenCvMat, dst: OpenCvMat) => void;
  getStructuringElement: (shape: number, ksize: unknown) => OpenCvMat;
  morphologyEx: (src: OpenCvMat, dst: OpenCvMat, op: number, kernel: OpenCvMat) => void;
  findContours: (
    image: OpenCvMat,
    contours: OpenCvMatVector,
    hierarchy: OpenCvMat,
    mode: number,
    method: number,
  ) => void;
  contourArea: (contour: OpenCvMat) => number;
  arcLength: (contour: OpenCvMat, closed: boolean) => number;
  minEnclosingCircle: (contour: OpenCvMat) => { center: { x: number; y: number }; radius: number };
  matFromArray: (rows: number, cols: number, type: number, array: number[]) => OpenCvMat;
  MatVector: new () => OpenCvMatVector;
};

export type OpenCvMat = {
  rows: number;
  cols: number;
  data32F: Float32Array;
  type?: () => number;
  delete: () => void;
};

export type OpenCvMatVector = {
  size: () => number;
  get: (i: number) => OpenCvMat;
  delete: () => void;
};

const OPENCV_URLS = [
  "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js",
  "https://docs.opencv.org/4.10.0/opencv.js",
];

declare global {
  interface Window {
    cv?: OpenCvRuntime & { onRuntimeInitialized?: () => void };
  }
}

let loadPromise: Promise<OpenCvRuntime> | null = null;

export function loadOpenCv(): Promise<OpenCvRuntime> {
  if (window.cv?.Mat) {
    return Promise.resolve(window.cv);
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    let lastError: unknown;
    for (const url of OPENCV_URLS) {
      try {
        return await loadFromUrl(url);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Could not load OpenCV.js.");
  })();

  return loadPromise;
}

function loadFromUrl(url: string): Promise<OpenCvRuntime> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-opencv="1"]`);
    if (existing && window.cv) {
      waitForRuntime(window.cv, resolve, reject);
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.opencv = "1";
    script.src = url;
    script.onerror = () => reject(new Error(`Failed to load OpenCV from ${url}`));
    script.onload = () => {
      if (!window.cv) {
        reject(new Error("OpenCV script loaded but window.cv is missing."));
        return;
      }
      waitForRuntime(window.cv, resolve, reject);
    };
    document.head.appendChild(script);
  });
}

function waitForRuntime(
  cv: OpenCvRuntime & { onRuntimeInitialized?: () => void },
  resolve: (cv: OpenCvRuntime) => void,
  reject: (error: Error) => void,
): void {
  if (cv.Mat) {
    resolve(cv);
    return;
  }

  const previous = cv.onRuntimeInitialized;
  const timeout = window.setTimeout(() => {
    reject(new Error("OpenCV.wasm timed out while initializing."));
  }, 30000);

  cv.onRuntimeInitialized = () => {
    window.clearTimeout(timeout);
    previous?.();
    if (cv.Mat) {
      resolve(cv);
    } else {
      reject(new Error("OpenCV initialized without cv.Mat."));
    }
  };
}
