import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '@/ui';
import { SelectField, WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import {
  canvasSize,
  draggedTo,
  isDrag,
  nudged,
  sizeOf,
  TABLE_SHAPES,
  type Direction,
  type Position,
} from '../plan-layout';
import type { SeatingTable, TableShape } from '../types';
import { PANEL } from './shared';
import { usePlanCanvas } from './use-plan-canvas';
import type { SeatingHost } from './use-seating-host';

type Canvas = ReturnType<typeof usePlanCanvas>;

const SHAPE_CORNERS: Readonly<Record<TableShape, string>> = {
  round: 'rounded-full',
  oval: 'rounded-[50%]',
  square: '',
  rectangle: '',
};

const ARROW_KEYS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const ARROW_ICONS: Readonly<Record<Direction, IconName>> = {
  up: 'arrow-up',
  down: 'arrow-down',
  left: 'arrow-left',
  right: 'arrow-right',
};

interface DrawnTableProps {
  table: SeatingTable;
  position: Position;
  canvas: Canvas;
}

/** Pointer and arrow keys: a held move draws at once, and is saved when let go. */
function useDrawnTableMoves({ table, position, canvas }: DrawnTableProps) {
  const dragging = useRef<{ start: Position; from: Position; hasMoved: boolean } | null>(null);
  const isSelected = canvas.selectedId === table.id;
  const deltaFrom = (held: { from: Position }, event: PointerEvent<HTMLButtonElement>) => ({
    x: event.clientX - held.from.x,
    y: event.clientY - held.from.y,
  });
  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragging.current = {
        start: position,
        from: { x: event.clientX, y: event.clientY },
        hasMoved: false,
      };
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const held = dragging.current;
      if (!held) return;
      const delta = deltaFrom(held, event);
      if (!held.hasMoved && !isDrag(delta)) return;
      held.hasMoved = true;
      canvas.hold(table.id, draggedTo(held.start, delta));
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const held = dragging.current;
      if (held?.hasMoved) canvas.drop(table, draggedTo(held.start, deltaFrom(held, event)));
    },
    // The system took the pointer: no drop will come, so the table goes back to where it is saved.
    onPointerCancel: () => {
      if (dragging.current?.hasMoved) canvas.letGo(table.id);
      dragging.current = null;
    },
    onClick: () => {
      if (!dragging.current?.hasMoved) canvas.select(table.id);
      dragging.current = null;
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const direction = ARROW_KEYS[event.key];
      if (!direction || !isSelected) return;
      event.preventDefault();
      canvas.hold(table.id, nudged(position, direction));
    },
    onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (ARROW_KEYS[event.key] && isSelected) canvas.drop(table, position);
    },
  };
}

/** One table: pressed to select it, dragged or moved with the arrows once selected. */
function DrawnTable(props: DrawnTableProps) {
  const { table, position, canvas } = props;
  const { t } = useTranslation('seating');
  const element = useRef<HTMLButtonElement>(null);
  const isSelected = canvas.selectedId === table.id;
  const moves = useDrawnTableMoves(props);
  useEffect(() => {
    if (isSelected) element.current?.focus({ preventScroll: true });
  }, [isSelected]);
  const seats = t('plan.seats', { taken: table.guests.length, capacity: table.capacity });
  return (
    <button
      ref={element}
      type="button"
      aria-pressed={isSelected}
      {...moves}
      style={{ left: position.x, top: position.y, ...sizeOf(table.shape) }}
      className={`bg-card absolute flex cursor-grab touch-none flex-col items-center justify-center overflow-hidden border-2 p-1 text-center text-sm leading-[18px] select-none active:cursor-grabbing ${SHAPE_CORNERS[table.shape]} ${isSelected ? 'border-primary' : 'border-border'}`}
    >
      <span className="line-clamp-2 break-words">{table.name}</span>{' '}
      <span className="text-muted-foreground">{seats}</span>
    </button>
  );
}

/** The arrows, for whoever can't drag: a keyboard, a switch, a hand that shakes (WCAG 2.5.7). */
function Arrows({ table, position, canvas }: DrawnTableProps) {
  const { t } = useTranslation('seating');
  const arrow = (direction: Direction) => (
    <Button
      variant="outline"
      aria-label={t(`plan.move.${direction}`, { name: table.name })}
      className="size-11 p-0 pointer-coarse:size-11"
      onClick={() => canvas.drop(table, nudged(position, direction))}
    >
      <Icon name={ARROW_ICONS[direction]} size={18} />
    </Button>
  );
  return (
    <div className="grid w-fit grid-cols-3 gap-1">
      <span />
      {arrow('up')}
      <span />
      {arrow('left')}
      <span />
      {arrow('right')}
      <span />
      {arrow('down')}
      <span />
    </div>
  );
}

/**
 * The shape chosen shows at once, until a reload brings the table back as a new object, saved or
 * refused (the plan's tables change only with a reload, `seating-page.tsx`).
 */
function useChosenShape(table: SeatingTable) {
  const [chosen, setChosen] = useState<{ shape: TableShape; over: SeatingTable } | null>(null);
  const shown = chosen?.over === table ? chosen.shape : table.shape;
  return { shown, choose: (shape: TableShape) => setChosen({ shape, over: table }) };
}

function Selected({ table, position, canvas }: DrawnTableProps) {
  const { t } = useTranslation('seating');
  const shape = useChosenShape(table);
  return (
    <div className={PANEL}>
      <h3 className="m-0 text-base font-medium break-words">{table.name}</h3>
      <Arrows table={table} position={position} canvas={canvas} />
      <SelectField
        label={t('plan.shape')}
        value={shape.shown}
        onChange={(event) => {
          const chosen = TABLE_SHAPES.find((each) => each === event.target.value);
          if (chosen) {
            shape.choose(chosen);
            canvas.save(table, { shape: chosen }, t('plan.shapeSaved', { name: table.name }));
          }
        }}
      >
        {TABLE_SHAPES.map((shape) => (
          <option key={shape} value={shape}>
            {t(`plan.shapes.${shape}`)}
          </option>
        ))}
      </SelectField>
      <Button
        variant="outline"
        className={`${WRAPPING_BUTTON} self-start`}
        onClick={() => {
          canvas.select(null);
          canvas.save(table, { posX: null, posY: null }, t('plan.takenOff', { name: table.name }));
        }}
      >
        {t('plan.takeOff')}
      </Button>
    </div>
  );
}

function Waiting({ waiting, canvas }: { waiting: readonly SeatingTable[]; canvas: Canvas }) {
  const { t } = useTranslation('seating');
  if (waiting.length === 0) return null;
  return (
    <div className={PANEL}>
      <h3 className="m-0 text-base font-medium">{t('plan.waiting')}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {waiting.map((table) => (
          <li key={table.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words">{table.name}</span>
            <Button
              variant="outline"
              className={WRAPPING_BUTTON}
              aria-label={t('actionFor', { action: t('plan.place'), name: table.name })}
              disabled={canvas.isPlacing}
              onClick={() => canvas.place(table)}
            >
              {t('plan.place')}
            </Button>
          </li>
        ))}
      </ul>
      {waiting.length > 1 ? (
        <Button
          className={`${WRAPPING_BUTTON} self-start`}
          disabled={canvas.isPlacing}
          onClick={() => void canvas.placeTheRest(waiting)}
        >
          {canvas.isPlacing ? t('plan.placing') : t('plan.placeAll')}
        </Button>
      ) : null}
    </div>
  );
}

/** Always focusable, so a keyboard can scroll it even with nothing on it yet. */
const SCROLLS_BY_KEYBOARD = 0;

/**
 * Drawing the plan (design PD-135): where each table stands in the room, for the hosts alone; guests
 * see only their own table's name. It holds no guests: seating is on the list.
 */
export function PlanCanvas({
  tables,
  host,
}: {
  tables: readonly SeatingTable[];
  host: SeatingHost;
}) {
  const { t } = useTranslation('seating');
  const canvas = usePlanCanvas(tables, host);
  const drawn = tables.flatMap((table) => {
    const position = canvas.positionOf(table);
    return position ? [{ table, position }] : [];
  });
  const waiting = tables.filter((table) => canvas.positionOf(table) === null);
  const selected = drawn.find(({ table }) => table.id === canvas.selectedId);
  const size = canvasSize(
    drawn.map(({ table, position }) => ({ ...table, posX: position.x, posY: position.y })),
  );
  if (tables.length === 0) return <p className="m-0">{t('plan.noTables')}</p>;
  return (
    <section className="flex flex-col gap-4" aria-label={t('plan.title')}>
      <p className="m-0 max-w-[40rem]">{t('plan.lead')}</p>
      <div
        role="group"
        aria-label={t('plan.canvas')}
        tabIndex={SCROLLS_BY_KEYBOARD}
        className="border-border bg-muted max-h-[70vh] overflow-auto border"
      >
        <div className="relative" style={size}>
          {drawn.map(({ table, position }) => (
            <DrawnTable key={table.id} table={table} position={position} canvas={canvas} />
          ))}
        </div>
      </div>
      <p role="status" className="sr-only">
        {canvas.said}
      </p>
      {selected ? <Selected {...selected} canvas={canvas} /> : null}
      <Waiting waiting={waiting} canvas={canvas} />
    </section>
  );
}
