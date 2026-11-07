/**
 * Reading a ticket through the camera (design PD-173, PD-174). A QR code can hold anything, a guest's
 * personal link among them, and what is sent becomes part of a request's address. So only what has a
 * ticket code's shape (`issue-attendees.ts`: 12 random bytes as base64url, in capitals) is ever sent,
 * and everything else stays on this device. Typed codes stay `ticket-code.ts`'s, which checks no shape
 * (FR-129 asks for the format to be stated).
 */
export type ScannedCode = { kind: 'ticket'; code: string } | { kind: 'notTicket' };

const TICKET_CODE = /^[A-Z0-9_-]{16}$/;

export function readScannedCode(read: string): ScannedCode {
  return TICKET_CODE.test(read) ? { kind: 'ticket', code: read } : { kind: 'notTicket' };
}

/**
 * How long a code must go unread before it counts as a new scan. "Unread" isn't quite "out of view":
 * glare can stop a code reading for a moment, and a second send would answer "already admitted" over the
 * guest just let in. To be checked at a real door (design PD-173).
 */
const HOLD_MS = 5000;

export interface ScanGate {
  /**
   * Whether this sighting should be sent. A sighting keeps a code in view held, even while the door
   * is busy and can't send, or a slow answer would see it go twice. A new one waits for the door.
   */
  offer: (code: string, now: number, canSend: boolean) => boolean;
}

/**
 * One ticket, one admission: a second would answer "already used" over the first answer while the
 * guest is still standing there. A code stays held for as long as it is in view, not for a fixed time.
 * Each is held by itself, as two tickets in one frame are read turn about.
 */
export function createScanGate(): ScanGate {
  const lastSeen = new Map<string, number>();
  const forgetGone = (now: number) => {
    for (const [code, seen] of lastSeen) {
      if (now - seen >= HOLD_MS) lastSeen.delete(code);
    }
  };
  return {
    offer: (code, now, canSend) => {
      forgetGone(now);
      const isHeld = lastSeen.has(code);
      if (isHeld || canSend) lastSeen.set(code, now);
      return !isHeld && canSend;
    },
  };
}

/** The size a frame is read at: enough for a code in view, and quick on a phone. */
const READ_SIZE = 640;

/**
 * The middle of a frame, which is what the square viewfinder shows. The queue behind it isn't read: a
 * ticket on the next person's phone must not be admitted with nobody having seen it.
 */
export function centreSquare(
  width: number,
  height: number,
): { x: number; y: number; side: number; size: number } {
  const side = Math.min(width, height);
  return {
    x: Math.round((width - side) / 2),
    y: Math.round((height - side) / 2),
    side,
    size: Math.min(side, READ_SIZE),
  };
}

/** `insecure` and `noReader` are this page's own: no way to ask, and the reader not loading. */
export type CameraProblem = 'refused' | 'none' | 'busy' | 'insecure' | 'noReader';

const CAMERA_PROBLEMS: Readonly<Record<string, CameraProblem>> = {
  NotAllowedError: 'refused',
  SecurityError: 'refused',
  NotFoundError: 'none',
};

/** Why the browser's camera refused, as it names it, for words pointing to the typed field. */
export function cameraProblemOf(error: unknown): CameraProblem {
  if (!(error instanceof DOMException)) throw error;
  return CAMERA_PROBLEMS[error.name] ?? 'busy';
}
