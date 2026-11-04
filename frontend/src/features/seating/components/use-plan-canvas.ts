import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRevalidator } from 'react-router';

import { browserSession } from '@/api/session';

import { updateTable } from '../api';
import type { TableUpdate } from '../payload';
import { freeCells, placedPosition, type Position } from '../plan-layout';
import { refusalOf } from '../refusals';
import { seatOneByOne } from '../seat-household';
import type { SeatingTable } from '../types';
import type { SeatingHost } from './use-seating-host';

function atPosition({ x, y }: Position): TableUpdate {
  return { posX: x, posY: y };
}

/** Where tables are drawn while a move is held, or being saved, before the reload brings it back. */
function useMoving() {
  const [moving, setMoving] = useState<ReadonlyMap<string, Position>>(new Map());
  const versions = useRef(new Map<string, number>());
  const hold = useCallback((tableId: string, position: Position) => {
    const version = (versions.current.get(tableId) ?? 0) + 1;
    versions.current.set(tableId, version);
    setMoving((held) => new Map(held).set(tableId, position));
    return version;
  }, []);
  const remove = useCallback((tableId: string) => {
    setMoving((held) => {
      const next = new Map(held);
      next.delete(tableId);
      return next;
    });
  }, []);
  /** A later move of the same table keeps its own place. */
  const release = useCallback(
    (tableId: string, version: number) => {
      if (versions.current.get(tableId) === version) remove(tableId);
    },
    [remove],
  );
  return { moving, hold, release, letGo: remove };
}

/** The tables as they stand on screen, moves held included, for finding a free place among them. */
function asDrawn(
  tables: readonly SeatingTable[],
  moving: ReadonlyMap<string, Position>,
): SeatingTable[] {
  return tables.map((table) => {
    const held = moving.get(table.id);
    return held ? { ...table, posX: held.x, posY: held.y } : table;
  });
}

/** Each table to its cell, in order, stopping at the first refusal. */
function placeOneByOne(
  eventId: string,
  waiting: readonly SeatingTable[],
  cells: readonly Position[],
) {
  const byId = new Map(waiting.map((table, index) => [table.id, cells[index]]));
  return seatOneByOne(
    waiting.map((table) => table.id),
    async (tableId) => {
      const cell = byId.get(tableId);
      if (cell) await updateTable(browserSession().api, eventId, tableId, atPosition(cell));
    },
  );
}

/**
 * Lets go of held places once the reloaded tables are on screen. React Router renders a reload as a
 * transition, which may come after the reload's promise, so letting go at once would show the old
 * place for a moment.
 */
function useReleaseOnReload(
  tables: readonly SeatingTable[],
  release: (tableId: string, version: number) => void,
) {
  const drawn = useRef(tables);
  const waiting = useRef<Array<[string, number]>>([]);
  useEffect(() => {
    drawn.current = tables;
    for (const [tableId, held] of waiting.current.splice(0)) release(tableId, held);
  }, [tables, release]);
  return {
    drawn: () => drawn.current,
    releaseAfter: (before: readonly SeatingTable[], settled: ReadonlyArray<[string, number]>) => {
      if (drawn.current === before) waiting.current.push(...settled);
      else for (const [tableId, held] of settled) release(tableId, held);
    },
  };
}

/** Saves in order; the page is read again once, when the last of those pressed together is saved. */
function useSaves(
  tables: readonly SeatingTable[],
  host: SeatingHost,
  release: (tableId: string, version: number) => void,
  onSaved: (message: string) => void,
) {
  const { revalidate } = useRevalidator();
  const reload = useReleaseOnReload(tables, release);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const settled = useRef<Array<[string, number]>>([]);
  const refused = (error: unknown) => {
    const refusal = refusalOf(error, 'editTable');
    host.refuse(refusal);
    if (refusal.isStale) host.reload();
  };
  const save = (table: SeatingTable, body: TableUpdate, message: string, version?: number) => {
    host.refuse(null);
    pending.current += 1;
    chain.current = chain.current.then(async () => {
      try {
        await updateTable(browserSession().api, host.eventId, table.id, body);
        onSaved(message);
      } catch (error) {
        refused(error);
      }
      if (version !== undefined) settled.current.push([table.id, version]);
      pending.current -= 1;
      if (pending.current > 0) return;
      const before = reload.drawn();
      await revalidate();
      reload.releaseAfter(before, settled.current.splice(0));
    });
  };
  return { save, refused };
}

/**
 * The plan's moves (design PD-135). The table goes where it was put at once, and each save is one
 * `PATCH`, in order, so two quick moves can't land the wrong way round. A refused save puts it back
 * and says why. Saved quietly: the focus stays on the table, for the next arrow. **A temporary
 * stand-in** for placing many: one request each, stopping at a refusal (FR-113).
 */
export function usePlanCanvas(tables: readonly SeatingTable[], host: SeatingHost) {
  const { t } = useTranslation('seating');
  const { revalidate } = useRevalidator();
  const { moving, hold, release, letGo } = useMoving();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [isPlacing, setIsPlacing] = useState(false);

  const { save, refused } = useSaves(tables, host, release, setSaid);

  const drop = (table: SeatingTable, position: Position) => {
    const version = hold(table.id, position);
    save(table, atPosition(position), t('plan.moved', { name: table.name }), version);
  };

  const place = (table: SeatingTable) => {
    const [cell] = freeCells(asDrawn(tables, moving), 1);
    if (!cell) return;
    setSelectedId(table.id);
    drop(table, cell);
  };

  const placeTheRest = async (waiting: readonly SeatingTable[]) => {
    host.refuse(null);
    setIsPlacing(true);
    const outcome = await placeOneByOne(
      host.eventId,
      waiting,
      freeCells(asDrawn(tables, moving), waiting.length),
    );
    await revalidate();
    if (outcome.error !== null) refused(outcome.error);
    setSaid(t('plan.placed', { count: outcome.seated.length }));
    setIsPlacing(false);
  };

  return {
    hold,
    letGo,
    positionOf: (table: SeatingTable) => moving.get(table.id) ?? placedPosition(table),
    drop,
    place,
    placeTheRest,
    save,
    isPlacing,
    said,
    selectedId,
    select: setSelectedId,
  };
}
