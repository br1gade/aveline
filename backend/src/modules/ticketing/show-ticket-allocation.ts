import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainHttpException } from '../../common/domain-http.exception';
import { CreateOrderDto } from './dto/create-order.dto';

export interface ShowTicketSelection {
  sectionId: string;
  sectionKey: string;
  sectionName: string;
  seatId: string | null;
  row: string | null;
  seat: string | null;
}

export class ShowSelectionUnavailable extends DomainHttpException {
  constructor(sectionKey: string, seatId?: string) {
    super('TICKET_SELECTION_UNAVAILABLE', 'The selected seat or zone is no longer available', { sectionKey, seatId });
  }
}

export async function prepareShowSelections(tx: Prisma.TransactionClient, eventId: string, dto: CreateOrderDto) {
  const inventory = await tx.showTicketInventory.findUnique({ where: { eventId }, select: {
    layoutVersionId: true, sections: { select: {
      id: true, key: true, name: true, capacity: true, offers: { select: { ticketTypeId: true } },
    } },
  } });
  if (!inventory) {
    if (dto.layoutVersionId || dto.selections) throw new DomainHttpException('TICKET_LAYOUT_CHANGED', 'This event has no published ticket layout');
    return [];
  }
  if (dto.layoutVersionId !== inventory.layoutVersionId) {
    throw new DomainHttpException('TICKET_LAYOUT_CHANGED', 'Reload the current layout before selecting tickets');
  }
  if (dto.selections?.length !== dto.attendees.length) throw new BadRequestException('selections: provide one selection per attendee');
  const sections = new Map(inventory.sections.map((section) => [section.key, section]));
  const ids = dto.selections.flatMap(({ seatId }) => seatId ? [seatId] : []);
  if (new Set(ids).size !== ids.length) throw new BadRequestException('selections: select each numbered seat at most once');
  const seats = ids.length ? await tx.showTicketSeat.findMany({
    where: { id: { in: ids }, section: { eventId }, isBlocked: false },
    select: { id: true, sectionId: true, row: true, label: true },
  }) : [];
  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  return dto.selections.map((selection, index) => snapshotSelection({
    index, selection, section: sections.get(selection.sectionKey),
    seat: selection.seatId ? seatById.get(selection.seatId) : undefined,
    ticketTypeId: dto.attendees[index].ticketTypeId,
  }));
}

interface SelectionSource {
  index: number;
  selection: { sectionKey: string; seatId?: string };
  section?: { id: string; name: string; capacity: number | null; offers: { ticketTypeId: string }[] };
  seat?: { id: string; sectionId: string; row: string; label: string };
  ticketTypeId: string;
}

function snapshotSelection({ index, selection: { sectionKey, seatId }, section, seat, ticketTypeId }: SelectionSource): ShowTicketSelection {
  if (!section?.offers.some((offer) => offer.ticketTypeId === ticketTypeId)) {
    throw new BadRequestException(`selections.${index}: this ticket type is not offered in that section`);
  }
  if (section.capacity === null && seat?.sectionId !== section.id) throw new ShowSelectionUnavailable(sectionKey, seatId);
  if (section.capacity !== null && seatId) throw new BadRequestException(`selections.${index}: a zone has no numbered seats`);
  const labels = seat ? { seatId: seat.id, row: seat.row, seat: seat.label } : { seatId: null, row: null, seat: null };
  return { sectionId: section.id, sectionKey, sectionName: section.name, ...labels };
}

export async function claimShowSelections(tx: Prisma.TransactionClient, orderId: string, selections: ShowTicketSelection[]) {
  await adjustZones(tx, selections, 1);
  const numbered = selections.filter(({ seatId }) => seatId !== null);
  if (!numbered.length) return;
  const ids = numbered.map(({ seatId }) => seatId!);
  const available = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM show_ticket_seats WHERE id IN (${Prisma.join(ids)})
      AND "orderId" IS NULL AND NOT "isBlocked" ORDER BY id FOR UPDATE`;
  const availableIds = new Set(available.map(({ id }) => id));
  const missing = numbered.find(({ seatId }) => !availableIds.has(seatId!));
  if (missing) throw new ShowSelectionUnavailable(missing.sectionKey, missing.seatId!);
  await tx.showTicketSeat.updateMany({ where: { id: { in: ids } }, data: { orderId } });
}

export async function releaseShowSelections(tx: Prisma.TransactionClient, orderId: string) {
  const selections = await readShowSelections(tx, orderId);
  if (!selections.length) return;
  await adjustZones(tx, selections, -1);
  const released = await tx.showTicketSeat.updateMany({ where: { orderId }, data: { orderId: null } });
  if (released.count !== selections.filter(({ seatId }) => seatId !== null).length) {
    throw new Error('Could not release all numbered seats for the order');
  }
}

export async function readShowSelections(tx: Prisma.TransactionClient, orderId: string) {
  const people = await tx.orderAttendee.findMany({
    where: { orderId, ticketSelection: { not: Prisma.DbNull } }, select: { ticketSelection: true },
  });
  return people.map(({ ticketSelection }) => ticketSelection as unknown as ShowTicketSelection);
}

async function adjustZones(tx: Prisma.TransactionClient, selections: ShowTicketSelection[], direction: 1 | -1) {
  const zones = new Map<string, { key: string; count: number }>();
  for (const selection of selections) {
    if (selection.seatId) continue;
    const { sectionId, sectionKey } = selection;
    zones.set(sectionId, { key: sectionKey, count: (zones.get(sectionId)?.count ?? 0) + direction });
  }
  if (!zones.size) return;
  // Acquire zone locks in the same order for reservations, late captures and releases.
  await tx.$queryRaw`
    SELECT id FROM show_ticket_sections WHERE id IN (${Prisma.join([...zones.keys()])}) ORDER BY id FOR UPDATE`;
  const changes = [...zones].map(([id, { count }]) => Prisma.sql`(${id}, ${count}::integer)`);
  const updated = await tx.$queryRaw<{ id: string }[]>`
    UPDATE show_ticket_sections s SET "quantityClaimed" = s."quantityClaimed" + changes.delta
    FROM (VALUES ${Prisma.join(changes)}) AS changes(id, delta)
    WHERE s.id = changes.id AND s."quantityClaimed" + changes.delta BETWEEN 0 AND s.capacity
    RETURNING s.id`;
  const updatedIds = new Set(updated.map(({ id }) => id));
  const missing = [...zones].find(([id]) => !updatedIds.has(id));
  if (missing && direction === -1) throw new Error('Could not release all zone inventory for the order');
  if (missing) throw new ShowSelectionUnavailable(missing[1].key);
}
