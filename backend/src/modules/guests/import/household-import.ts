import { HttpException, NotFoundException } from '@nestjs/common';
import { GuestAttribution, Prisma } from '@prisma/client';
import { newGuestToken } from '../guest-token';
import { capacityProblem } from '../guest-rules';
import { ParsedGuest, RowError } from './csv-guests';

type Tx = Prisma.TransactionClient;

/** Households written per transaction: few enough to keep locks short, enough to make each round trip count. */
export const HOUSEHOLDS_PER_BATCH = 100;

/** What the file says about one household: the seats it states, and how many it names. */
export interface HouseholdInFile {
  stated?: number;
  named: number;
}

interface StoredGuest {
  id: string;
  householdId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  locale: string | null;
  attribution: GuestAttribution;
}

interface HouseholdPlan {
  householdId: string;
  seats: number;
  isSeatsChanged: boolean;
  isFirstPrimary: boolean;
  updates: { id: string; data: Prisma.GuestUpdateInput }[];
  placed: ParsedGuest[];
  failures: RowError[];
}

/**
 * A batch of households, in one transaction and a handful of queries: the
 * households found or made together, locked together, their guests read
 * together, and every new guest written in one insert.
 *
 * Row by row, an import ran four or five queries a guest — some twenty
 * seconds for two thousand rows (B91). The rules are the same: a guest is
 * matched by name within the household and updated without clearing what the
 * file left blank; a new one needs a seat, and a row past the seats the file
 * states is reported on its own while the rest is saved.
 */
export async function importHouseholds(
  tx: Tx,
  eventId: string,
  groups: ParsedGuest[][],
  seatsInFile: Map<string, HouseholdInFile>,
): Promise<{ imported: number; failures: RowError[] }> {
  const idByName = await householdIdsFor(tx, eventId, groups.map((rows) => rows[0].household), seatsInFile);
  const seats = await lockSeats(tx, eventId, [...idByName.values()]);
  const stored = await tx.guest.findMany({
    where: { householdId: { in: [...idByName.values()] } },
    select: { id: true, householdId: true, firstName: true, lastName: true, email: true, phone: true, locale: true, attribution: true },
  });

  const plans = groups.map((rows) => {
    const householdId = idByName.get(rows[0].household) as string;
    const members = stored.filter((guest) => guest.householdId === householdId);
    return planHousehold({ householdId, seats: seats.get(householdId) ?? 0 }, members, rows, seatsInFile.get(rows[0].household)?.stated);
  });
  await applyPlans(tx, eventId, plans);

  const failures = plans.flatMap((plan) => plan.failures);
  return { imported: groups.flat().length - failures.length, failures };
}

async function householdIdsFor(tx: Tx, eventId: string, names: string[], seatsInFile: Map<string, HouseholdInFile>) {
  const existing = await tx.household.findMany({ where: { eventId, name: { in: names } }, select: { id: true, name: true } });
  const idByName = new Map(existing.map((household) => [household.name, household.id]));
  const missing = names.filter((name) => !idByName.has(name));
  if (missing.length > 0) {
    const created = await tx.household.createManyAndReturn({
      data: missing.map((name) => {
        const inFile = seatsInFile.get(name);
        return { eventId, name, seatsAllotted: inFile?.stated ?? inFile?.named ?? 1 };
      }),
      select: { id: true, name: true },
    });
    for (const household of created) idByName.set(household.name, household.id);
  }
  return idByName;
}

/** One statement, locking in id order as every other writer does, so two cannot deadlock. */
async function lockSeats(tx: Tx, eventId: string, householdIds: string[]): Promise<Map<string, number>> {
  const rows = await tx.$queryRaw<{ id: string; seatsAllotted: number }[]>`
    SELECT id, "seatsAllotted" FROM households
     WHERE id IN (${Prisma.join(householdIds)}) AND "eventId" = ${eventId}
     ORDER BY id FOR UPDATE`;
  if (rows.length !== new Set(householdIds).size) throw new NotFoundException('A household was removed during the import');
  return new Map(rows.map((row) => [row.id, row.seatsAllotted]));
}

/**
 * What one household's rows change. Seats each new guest in turn, the same
 * rule as adding one by hand: named guests never outnumber seats. A household
 * with no stated seats grows to fit; one with stated seats never shrinks, and
 * a row past them is reported.
 */
function planHousehold(
  household: { householdId: string; seats: number },
  members: StoredGuest[],
  rows: ParsedGuest[],
  stated: number | undefined,
): HouseholdPlan {
  const byName = new Map(members.map((guest) => [nameKey(guest.firstName, guest.lastName), guest]));
  const fresh = new Map<string, ParsedGuest>();
  const updates: HouseholdPlan['updates'] = [];
  for (const row of rows) {
    const key = nameKey(row.firstName, row.lastName ?? null);
    const known = byName.get(key);
    const update = known ? changesFor(known, row) : null;
    if (update) updates.push({ id: known!.id, data: update });
    if (!known) fresh.set(key, { ...fresh.get(key), ...withoutBlanks(row) });
  }

  const { seats, placed, failures } = seatNewGuests([...fresh.values()], { seats: household.seats, named: members.length, stated });
  return { householdId: household.householdId, seats, isSeatsChanged: seats !== household.seats, isFirstPrimary: members.length === 0, updates, placed, failures };
}

function seatNewGuests(rows: ParsedGuest[], start: { seats: number; named: number; stated: number | undefined }) {
  let seats = start.seats;
  const placed: ParsedGuest[] = [];
  const failures: RowError[] = [];
  for (const row of rows) {
    const needed = start.named + placed.length + 1;
    const offered = start.stated === undefined ? Math.max(seats, needed) : Math.max(seats, start.stated);
    const problem = capacityProblem(offered, needed);
    if (problem) {
      failures.push({ row: row.row, message: `Could not save ${row.firstName}: ${problem}` });
      continue;
    }
    seats = offered;
    placed.push(row);
  }
  return { seats, placed, failures };
}

/** Never clears a field the file left blank; nothing at all when nothing changed. */
function changesFor(known: StoredGuest, row: ParsedGuest): Prisma.GuestUpdateInput | null {
  const next = {
    email: row.email ?? known.email,
    phone: row.phone ?? known.phone,
    locale: row.locale ?? known.locale,
    attribution: row.attribution ?? known.attribution,
  };
  const isChanged = (Object.keys(next) as (keyof typeof next)[]).some((field) => next[field] !== known[field]);
  return isChanged ? next : null;
}

async function applyPlans(tx: Tx, eventId: string, plans: HouseholdPlan[]): Promise<void> {
  for (const plan of plans) {
    for (const update of plan.updates) await tx.guest.update({ where: { id: update.id }, data: update.data });
    if (plan.isSeatsChanged) await tx.household.update({ where: { id: plan.householdId }, data: { seatsAllotted: plan.seats } });
  }
  const now = new Date();
  const data = plans.flatMap((plan) => plan.placed.map((row, index) => newGuest(eventId, plan, row, { now, isPrimary: plan.isFirstPrimary && index === 0 })));
  if (data.length === 0) return;
  const created = await tx.guest.createManyAndReturn({ data, select: { id: true } });
  await tx.rsvp.createMany({ data: created.map((guest) => ({ guestId: guest.id })) });
}

function newGuest(eventId: string, plan: HouseholdPlan, row: ParsedGuest, options: { now: Date; isPrimary: boolean }): Prisma.GuestCreateManyInput {
  return {
    eventId,
    householdId: plan.householdId,
    firstName: row.firstName,
    lastName: row.lastName ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    locale: row.locale ?? null,
    attribution: row.attribution ?? GuestAttribution.UNKNOWN,
    token: newGuestToken(),
    // The first person listed for a household holds its invitation link;
    // the rest are family on the same link.
    isPrimary: options.isPrimary,
    // An imported guest was given to us by the host, which is the lawful
    // basis we record (spec §GDPR). Not a guest's own consent.
    consentAt: options.now,
    consentSource: 'host-import',
  };
}

function nameKey(firstName: string, lastName: string | null): string {
  return `${firstName}\u0000${lastName ?? ''}`;
}

/** A repeated row adds what it has to the earlier one, never blanks it. */
function withoutBlanks(row: ParsedGuest): ParsedGuest {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as unknown as ParsedGuest;
}

/**
 * A rule we enforce speaks for itself; anything else — a database error can
 * echo the row's values — is not repeated into a history others read.
 */
export function describeImportError(error: unknown): string {
  return error instanceof HttpException ? error.message : 'an unexpected error; try the row again';
}
