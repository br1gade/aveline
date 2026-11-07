import { BadRequestException } from '@nestjs/common';
import { MAX_LAYOUT_SEATS, TicketLayoutSectionDto, TicketSectionMode } from './dto/venue-ticket-layout.dto';

export type TicketLayoutSection =
  | { key: string; name: string; mode: TicketSectionMode.NUMBERED; rows: { label: string; seats: string[] }[] }
  | { key: string; name: string; mode: TicketSectionMode.UNNUMBERED; capacity: number };

export function normalizeTicketLayout(sections: TicketLayoutSectionDto[]): TicketLayoutSection[] {
  assertUniqueLabels(sections.map((section) => section.key), 'sections', 'section keys');
  const normalized = sections.map(normalizeSection);
  const seatCount = normalized.reduce((sum, section) => sum + countSeats(section), 0);
  if (seatCount > MAX_LAYOUT_SEATS) throw new BadRequestException(`sections: at most ${MAX_LAYOUT_SEATS} numbered seats per layout`);
  return normalized;
}

function normalizeSection({ key, name, mode, rows, capacity }: TicketLayoutSectionDto): TicketLayoutSection {
  if (mode === TicketSectionMode.UNNUMBERED) {
    if (rows != null || capacity == null) throw new BadRequestException('sections: unnumbered sections require capacity and have no rows');
    return { key, name, mode, capacity };
  }

  if (!rows?.length || capacity != null) throw new BadRequestException('sections: numbered sections require rows and have no zone capacity');
  assertUniqueLabels(rows.map((row) => row.label), 'sections.rows', 'row labels');
  return { key, name, mode, rows: rows.map(({ label, seats }) => {
    const normalized = seats.map((seat) => seat.trim());
    assertUniqueLabels(normalized, 'sections.rows.seats', 'seat labels within a row');
    return { label, seats: normalized };
  }) };
}

function countSeats(section: TicketLayoutSection): number {
  return section.mode === TicketSectionMode.NUMBERED
    ? section.rows.reduce((sum, row) => sum + row.seats.length, 0) : 0;
}

function assertUniqueLabels(values: string[], field: string, label: string) {
  if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
    throw new BadRequestException(`${field}: ${label} must be unique`);
  }
}
