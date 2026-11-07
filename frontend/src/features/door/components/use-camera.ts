import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { cameraProblemOf, centreSquare, type CameraProblem } from '../scan';

export type CameraState =
  { kind: 'off' | 'opening' | 'on' } | { kind: 'problem'; problem: CameraProblem };

type Decode = (data: Uint8ClampedArray, width: number, height: number) => string | null;

/** About five reads a second: a code is read at once, and the phone stays cool. */
const READ_EVERY_MS = 200;
const REAR_CAMERA: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: 'environment' } },
};

class ScannerProblem extends Error {
  constructor(readonly problem: CameraProblem) {
    super(problem);
  }
}

/** Loaded on opening alone, so the door page pays nothing until the camera is asked for. */
async function loadDecoder(): Promise<Decode> {
  try {
    const { default: jsQR } = await import('jsqr');
    return (data, width, height) => {
      try {
        // Our codes are dark on light, and looking for inverted ones takes twice as long.
        return jsQR(data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null;
      } catch {
        // A frame it can't make sense of is a frame with no code in it. The next one comes at once.
        return null;
      }
    };
  } catch {
    throw new ScannerProblem('noReader');
  }
}

interface Reading {
  decode: Decode;
  onRead: (read: string) => void;
  onBroken: () => void;
}

function readEvery(video: HTMLVideoElement, { decode, onRead, onBroken }: Reading): () => void {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const readFrame = () => {
    if (!context || video.videoWidth === 0) return;
    const { x, y, side, size } = centreSquare(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;
    context.drawImage(video, x, y, side, side, 0, 0, size, size);
    const read = decode(context.getImageData(0, 0, size, size).data, size, size);
    if (read !== null) onRead(read);
  };
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    try {
      readFrame();
      timer = setTimeout(tick, READ_EVERY_MS);
    } catch {
      onBroken();
    }
  };
  timer = setTimeout(tick, 0);
  return () => clearTimeout(timer);
}

/** A door has gaps between guests, and a phone that locks hides the page and closes the camera. */
function keepScreenAwake(): () => void {
  if (!('wakeLock' in navigator) || !navigator.wakeLock) return () => undefined;
  const lock = navigator.wakeLock.request('screen').catch(() => null);
  return () => void lock.then((held) => held?.release());
}

interface Start {
  video: RefObject<HTMLVideoElement | null>;
  onRead: (read: string) => void;
  /** The camera stopped, or its picture did: taken by a call, or by another tab. */
  onBroken: () => void;
  isAbandoned: () => boolean;
}

/** Whatever is abandoned or fails on the way stops the camera: its light never stays on. */
async function startCamera({ video, onRead, onBroken, isAbandoned }: Start) {
  const decode = await loadDecoder();
  if (isAbandoned()) return null;
  const stream = await navigator.mediaDevices.getUserMedia(REAR_CAMERA);
  const stopStream = () => stream.getTracks().forEach((track) => track.stop());
  const element = video.current;
  if (isAbandoned() || !element) {
    stopStream();
    return null;
  }
  try {
    element.srcObject = stream;
    await element.play();
  } catch {
    // Permission was given to get this far, so this isn't a matter for the browser's settings.
    stopStream();
    throw new ScannerProblem('busy');
  }
  if (isAbandoned()) {
    stopStream();
    return null;
  }
  const [track] = stream.getTracks();
  track?.addEventListener('ended', onBroken);
  track?.addEventListener('mute', onBroken);
  const stopReading = readEvery(element, { decode, onRead, onBroken });
  const letScreenSleep = keepScreenAwake();
  return () => {
    stopReading();
    stopStream();
    letScreenSleep();
  };
}

function useCameraPutAway(close: () => void, stop: () => void) {
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') close();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [close, stop]);
}

/**
 * The camera, read until it is put away: on closing, on leaving the page and when the tab hides, as a
 * phone left in a pocket must not go on watching. Frames are read and thrown away; nothing is kept.
 */
export function useCameraReader(onRead: (read: string) => void) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>({ kind: 'off' });
  const latestOnRead = useRef(onRead);
  const stopCamera = useRef<(() => void) | null>(null);
  const attempt = useRef(0);
  useEffect(() => {
    latestOnRead.current = onRead;
  });

  const stop = useCallback(() => {
    attempt.current += 1;
    stopCamera.current?.();
    stopCamera.current = null;
  }, []);
  const close = useCallback(() => {
    stop();
    setState({ kind: 'off' });
  }, [stop]);
  const fail = useCallback(
    (problem: CameraProblem) => {
      stop();
      setState({ kind: 'problem', problem });
    },
    [stop],
  );

  const open = useCallback(async () => {
    if (!navigator.mediaDevices) {
      fail('insecure');
      return;
    }
    stop();
    const mine = attempt.current;
    const isAbandoned = () => mine !== attempt.current;
    setState({ kind: 'opening' });
    try {
      const stopper = await startCamera({
        video,
        onRead: (read) => latestOnRead.current(read),
        onBroken: () => fail('busy'),
        isAbandoned,
      });
      if (!stopper) return;
      stopCamera.current = stopper;
      setState({ kind: 'on' });
    } catch (error) {
      if (isAbandoned()) return;
      if (error instanceof ScannerProblem) fail(error.problem);
      else if (error instanceof DOMException) fail(cameraProblemOf(error));
      else {
        // Not one the browser names, as a WebView might throw: never left saying "opening".
        fail('busy');
        throw error;
      }
    }
  }, [fail, stop]);
  useCameraPutAway(close, stop);

  return { state, video, open, close };
}
