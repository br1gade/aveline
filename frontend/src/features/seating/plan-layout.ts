import type { SeatingTable, TableShape } from './types';

/**
 * Drawing the seating plan (design PD-135). The API stores a table's place "in the editor's own
 * units" and draws nothing itself, so one unit here is one CSS pixel, with no scaling to get wrong:
 * a phone scrolls the canvas instead of shrinking the tables below what a finger can press.
 */
export const TABLE_SHAPES = ['round', 'rectangle', 'square', 'oval'] as const;

export interface Position {
  x: number;
  y: number;
}

export const SNAP = 20;
export const ARROW_STEP = SNAP;
export const MIN_CANVAS = { width: 960, height: 640 } as const;
/** Inside the API's ±100000, which nobody can scroll across. */
export const MAX_POSITION = 4000;
/** Room beyond the furthest table, to drag it further. */
const CANVAS_MARGIN = 200;
/** A pointer that moved less than this was pressing, not dragging. */
const DRAG_THRESHOLD = 4;
const GAP = 20;

const SIZES: Readonly<Record<TableShape, { width: number; height: number }>> = {
  round: { width: 100, height: 100 },
  square: { width: 100, height: 100 },
  rectangle: { width: 140, height: 80 },
  oval: { width: 140, height: 80 },
};

export function sizeOf(shape: TableShape): { width: number; height: number } {
  return SIZES[shape];
}

export function snap(value: number): number {
  return Math.round(value / SNAP) * SNAP || 0;
}

export function clampPosition({ x, y }: Position): Position {
  return {
    x: Math.min(MAX_POSITION, Math.max(0, x)),
    y: Math.min(MAX_POSITION, Math.max(0, y)),
  };
}

/** Where a table is on the plan, or `null` while it waits to be placed. */
export function placedPosition({ posX, posY }: SeatingTable): Position | null {
  return posX === null || posY === null ? null : clampPosition({ x: posX, y: posY });
}

export function draggedTo(start: Position, delta: Position): Position {
  return clampPosition({ x: snap(start.x + delta.x), y: snap(start.y + delta.y) });
}

export function isDrag({ x, y }: Position): boolean {
  return Math.abs(x) > DRAG_THRESHOLD || Math.abs(y) > DRAG_THRESHOLD;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

const ARROWS: Readonly<Record<Direction, Position>> = {
  up: { x: 0, y: -ARROW_STEP },
  down: { x: 0, y: ARROW_STEP },
  left: { x: -ARROW_STEP, y: 0 },
  right: { x: ARROW_STEP, y: 0 },
};

export function nudged({ x, y }: Position, direction: Direction): Position {
  const step = ARROWS[direction];
  return clampPosition({ x: x + step.x, y: y + step.y });
}

export function canvasSize(tables: readonly SeatingTable[]): { width: number; height: number } {
  return tables.reduce<{ width: number; height: number }>(
    (size, table) => {
      const position = placedPosition(table);
      if (!position) return size;
      const { width, height } = sizeOf(table.shape);
      return {
        width: Math.max(size.width, position.x + width + CANVAS_MARGIN),
        height: Math.max(size.height, position.y + height + CANVAS_MARGIN),
      };
    },
    { ...MIN_CANVAS },
  );
}

/** The largest table, so a cell holds any of them. */
const CELL = {
  width: Math.max(...Object.values(SIZES).map(({ width }) => width)) + GAP,
  height: Math.max(...Object.values(SIZES).map(({ height }) => height)) + GAP,
};

function overlaps(cell: Position, table: SeatingTable): boolean {
  const position = placedPosition(table);
  if (!position) return false;
  const { width, height } = sizeOf(table.shape);
  return (
    cell.x < position.x + width &&
    position.x < cell.x + CELL.width &&
    cell.y < position.y + height &&
    position.y < cell.y + CELL.height
  );
}

/** Where `count` tables can go, row by row across the smallest canvas, clear of those placed. */
export function freeCells(placed: readonly SeatingTable[], count: number): Position[] {
  const perRow = Math.floor(MIN_CANVAS.width / CELL.width);
  const cells: Position[] = [];
  for (let index = 0; cells.length < count; index += 1) {
    const cell = clampPosition({
      x: (index % perRow) * CELL.width,
      y: Math.floor(index / perRow) * CELL.height,
    });
    // Past the edge there is no more room to look for: they stack there, to be dragged apart.
    const isPastTheEdge = cell.y >= MAX_POSITION;
    if (isPastTheEdge || !placed.some((table) => overlaps(cell, table))) cells.push(cell);
  }
  return cells;
}

export interface ChairChoice {
  position: number;
  /** Who sits there; not the guest being seated, who may keep their own chair. */
  takenBy: string | null;
}

/** Each numbered chair at a table. Only the seat's own `position` says who has one. */
export function chairChoices(table: SeatingTable, guestId: string): ChairChoice[] {
  const sitting = new Map(
    table.guests
      .filter((guest) => guest.guestId !== guestId && guest.position !== null)
      .map((guest) => [guest.position, guest.name]),
  );
  return Array.from({ length: table.capacity }, (_, index) => ({
    position: index + 1,
    takenBy: sitting.get(index + 1) ?? null,
  }));
}

/** Whether a chair chosen can still be sent, once the table on screen or who sits there changed. */
export function isOpenChair(table: SeatingTable, guestId: string, chair: string): boolean {
  if (chair === '') return true;
  return chairChoices(table, guestId).some(
    ({ position, takenBy }) => String(position) === chair && takenBy === null,
  );
}
