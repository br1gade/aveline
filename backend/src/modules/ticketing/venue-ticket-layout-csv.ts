import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import { TICKET_LAYOUT_KEY, TicketSectionMode } from './dto/venue-ticket-layout.dto';
import { normalizeTicketLayout } from './venue-ticket-layout-definition';

export const MAX_TICKET_LAYOUT_CSV_BYTES = 8 * 1024 * 1024;
const MAX_SECTIONS = 100;
const MAX_SEATS = 75_000;
const MAX_SECTION_SEATS = 1_000;
const COLUMNS = ['section_key', 'section_name', 'mode', 'row', 'seat', 'capacity'];
const MODES = new Map<string, TicketSectionMode>(Object.values(TicketSectionMode).map((mode) => [mode, mode]));

interface CsvRecord {
  section_key: string;
  section_name: string;
  mode: string;
  row: string;
  seat: string;
  capacity: string;
}

interface CsvSection {
  name: string;
  mode: TicketSectionMode;
  rows: Map<string, string[]>;
  capacity?: number;
  seatCount: number;
}

export async function parseTicketLayoutCsv(buffer: Buffer) {
  const parser = parse({
    bom: true, trim: true, skip_empty_lines: true, max_record_size: 1024,
    columns: (header: string[]) => {
      if (header.join(',') !== COLUMNS.join(',')) throw new BadRequestException('file: use the ticket layout CSV headers');
      return header;
    },
  });
  const sections = new Map<string, CsvSection>();
  let recordNumber = 1;
  const stream = Readable.from(fileChunks(buffer)).pipe(parser) as unknown as AsyncIterable<CsvRecord>;
  try {
    for await (const record of stream) {
      recordNumber += 1;
      if (recordNumber > MAX_SEATS + MAX_SECTIONS + 1) throw new BadRequestException('file: too many layout records');
      addRecord(sections, record, recordNumber);
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(`file: invalid CSV near record ${recordNumber + 1}`);
  }
  if (!sections.size) throw new BadRequestException('file: supply at least one section');
  return normalizeTicketLayout([...sections].map(([key, section]) => toSection(key, section)), MAX_SEATS);
}

async function* fileChunks(buffer: Buffer) {
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    yield buffer.subarray(offset, offset + chunkSize);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function addRecord(sections: Map<string, CsvSection>, record: CsvRecord, number: number) {
  const { section_key: key, section_name: name } = record;
  const mode = MODES.get(record.mode);
  const fail = (reason: string): never => { throw new BadRequestException(`file: record ${number} ${reason}`); };
  if (!TICKET_LAYOUT_KEY.test(key) || !name || name.length > 100) fail('has an invalid section key or name');
  if (!mode) {
    throw new BadRequestException(`file: record ${number} must be NUMBERED or UNNUMBERED`);
  }
  const section = sections.get(key) ?? { name, mode, rows: new Map<string, string[]>(), seatCount: 0 };
  if (section.mode !== mode || section.name !== name) fail('changes the mode or name of an existing section');
  if (mode === TicketSectionMode.UNNUMBERED) addZone(section, record, fail);
  else addSeat(section, record, fail);
  sections.set(key, section);
  if (sections.size > MAX_SECTIONS) fail(`exceeds ${MAX_SECTIONS} sections`);
}

function addZone(section: CsvSection, { row, seat, capacity }: CsvRecord, fail: (reason: string) => never) {
  const quantity = Number(capacity);
  if (section.capacity !== undefined) fail('repeats an unnumbered section');
  if (row || seat || !/^\d+$/.test(capacity) || quantity < 1 || quantity > 100_000) {
    fail('must give an unnumbered capacity from 1 to 100,000 and leave row and seat blank');
  }
  section.capacity = quantity;
}

function addSeat(section: CsvSection, { row, seat, capacity }: CsvRecord, fail: (reason: string) => never) {
  if (!row || !seat || row.length > 16 || seat.length > 16 || capacity) {
    fail('must give a row and seat of up to 16 characters and leave capacity blank');
  }
  const seats = section.rows.get(row) ?? [];
  if (seats.length >= 100) fail('exceeds 100 seats per row');
  seats.push(seat);
  section.rows.set(row, seats);
  section.seatCount += 1;
  if (section.rows.size > 100 || section.seatCount > MAX_SECTION_SEATS) {
    fail(`exceeds 100 rows or ${MAX_SECTION_SEATS} seats per section`);
  }
}

function toSection(key: string, { name, mode, rows, capacity }: CsvSection) {
  return mode === TicketSectionMode.UNNUMBERED
    ? { key, name, mode, capacity }
    : { key, name, mode, rows: [...rows].map(([label, seats]) => ({ label, seats })) };
}
