/**
 * A drawn signature as strokes, kept apart from the canvas so it is tested without one (jsdom has
 * none). The canvas draws at a fixed size and is scaled by CSS, so a point from the pointer is
 * mapped from the element's box to the canvas.
 */
export interface Point {
  x: number;
  y: number;
}

export type Stroke = readonly Point[];

/** The canvas's own size: three to one, sharp on a phone held either way. */
export const PAD_WIDTH = 900;
export const PAD_HEIGHT = 300;

/** A pointer position in the element's box, as a point on the canvas. */
export function toCanvasPoint(
  client: { x: number; y: number },
  box: { left: number; top: number; width: number; height: number },
): Point {
  const scaleX = box.width > 0 ? PAD_WIDTH / box.width : 1;
  const scaleY = box.height > 0 ? PAD_HEIGHT / box.height : 1;
  return {
    x: Math.round((client.x - box.left) * scaleX),
    y: Math.round((client.y - box.top) * scaleY),
  };
}

export function startStroke(strokes: readonly Stroke[], point: Point): Stroke[] {
  return [...strokes, [point]];
}

/** The point added to the stroke being drawn; nothing when no stroke has started. */
export function extendStroke(strokes: readonly Stroke[], point: Point): Stroke[] {
  const last = strokes.at(-1);
  if (!last) return [...strokes];
  return [...strokes.slice(0, -1), [...last, point]];
}

/** Whether anything was drawn: a tap leaves a dot, which counts; nothing at all does not. */
export function hasInk(strokes: readonly Stroke[]): boolean {
  return strokes.some((stroke) => stroke.length > 0);
}
