// Runs only inside this rehearsal's private Docker network/database.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcrypt');
if (!process.env.DATABASE_URL?.includes('aveline_rehearsal_test')) throw new Error('Disposable database required');
const prisma = new PrismaClient();
const state = process.env.REHEARSAL_STATE_ROOT;
const action = process.argv[2];
try {
  if (action === 'owner') {
    const email = `owner-${randomUUID()}@example.test`; const password = `Pilot-${randomUUID()}`;
    const user = await prisma.user.create({ data: { email, name: 'Synthetic pilot owner', passwordHash: await hash(password, 12) } });
    await writeFile(`${state}/owner.json`, JSON.stringify({ userId: user.id, email, password }), { mode: 0o600 });
  } else {
    const event = JSON.parse(await readFile(`${state}/event.json`, 'utf8'));
    if (action === 'responses') {
      const guests = await prisma.guest.findMany({ where: { eventId: event.id }, orderBy: [{ householdId: 'asc' }, { id: 'asc' }], select: { id: true, householdId: true, token: true, firstName: true, locale: true } });
      const venues = await prisma.venue.findMany({ where: { eventId: event.id }, orderBy: { sortOrder: 'asc' }, select: { id: true } });
      await prisma.$transaction(async (tx) => {
        for (const [status, start, end] of [['ATTENDING', 0, 320], ['DECLINED', 320, 360], ['PENDING', 360, 400]]) {
          await tx.rsvp.createMany({ data: guests.slice(start, end).map((guest) => ({ guestId: guest.id, status, respondedAt: status === 'PENDING' ? null : new Date() })), skipDuplicates: true });
          await tx.rsvp.updateMany({ where: { guestId: { in: guests.slice(start, end).map((guest) => guest.id) } }, data: { status, respondedAt: status === 'PENDING' ? null : new Date() } });
        }
      });
      await writeFile(`${state}/guests.json`, JSON.stringify({ guests, venues }), { mode: 0o600 });
    } else if (action === 'venue-responses') {
      const data = JSON.parse(await readFile(`${state}/guests.json`, 'utf8'));
      const current = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { attendanceRevision: true } });
      await prisma.$transaction(async (tx) => {
        await tx.attendanceResponse.createMany({ data: data.guests.flatMap((guest, index) => data.venues.map((venue, venueIndex) => ({ eventId: event.id, guestId: guest.id, scopeId: venue.id, venueId: venue.id, revision: current.attendanceRevision, status: index >= 360 ? 'PENDING' : index < (venueIndex ? 240 : 320) ? 'ATTENDING' : 'DECLINED' }))), skipDuplicates: true });
        for (const [status, start, end] of [['ATTENDING', 0, 320], ['DECLINED', 320, 360], ['PENDING', 360, 400]]) {
          await tx.rsvp.updateMany({ where: { guestId: { in: data.guests.slice(start, end).map((guest) => guest.id) } }, data: { status } });
        }
        // Fixture reset gives the second planner pass real unseated eligible people.
        await tx.seat.deleteMany({ where: { guest: { eventId: event.id } } });
      });
    } else if (action === 'hold-workers') {
      const owner = JSON.parse(await readFile(`${state}/owner.json`, 'utf8'));
      await prisma.exportPrivacyFence.upsert({ where: { id: 'exports' }, create: { id: 'exports' }, update: {} });
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.userId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM export_privacy_fences WHERE id = 'exports' FOR UPDATE`;
        await writeFile(`${state}/workers-held.json`, JSON.stringify({ isHeld: true }), { mode: 0o600 });
        await tx.$queryRaw`SELECT pg_sleep(60)`;
      }, { timeout: 65000 });
    } else if (action === 'age-invitations') {
      await prisma.message.updateMany({ where: { eventId: event.id, templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * 86400000) } });
    } else if (action === 'mail-due') {
      await prisma.message.updateMany({ where: { eventId: event.id, status: 'QUEUED' }, data: { scheduledFor: new Date() } });
    } else if (action === 'expire') {
      await prisma.invitation.update({ where: { eventId: event.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    } else if (action === 'outbox-report') {
      const tally = await prisma.message.groupBy({ by: ['status'], where: { eventId: event.id }, _count: true });
      await writeFile(`${state}/outbox.json`, JSON.stringify(tally), { mode: 0o600 });
    } else if (action === 'erase') {
      const { eraseSubject } = require('../../dist/modules/privacy/erasure.js');
      const { guests } = JSON.parse(await readFile(`${state}/guests.json`, 'utf8'));
      const guest = await prisma.guest.findUniqueOrThrow({ where: { id: guests[0].id, eventId: event.id }, select: { id: true, email: true } });
      const media = await prisma.guestMedia.findMany({ where: { uploaderGuestId: guest.id, eventId: event.id }, select: { id: true, sourceKey: true, displayKey: true, thumbnailKey: true } });
      await writeFile(`${state}/erasure-media.json`, JSON.stringify(media), { mode: 0o600 });
      const result = await prisma.$transaction((tx) => eraseSubject(tx, guest.email, new Date()), { timeout: 30000 });
      await writeFile(`${state}/erasure.json`, JSON.stringify(result), { mode: 0o600 });
    } else if (action === 'erasure-cleanup-report') {
      const media = JSON.parse(await readFile(`${state}/erasure-media.json`, 'utf8'));
      const rows = await prisma.guestMedia.findMany({ where: { id: { in: media.map((item) => item.id) } }, select: { processingStatus: true, clearedAt: true, storedBytes: true, reservedBytes: true } });
      const { ConfigService } = require('@nestjs/config');
      const { buildPrivateStorage } = require('../../dist/infra/storage/private/private-storage.js');
      const storage = buildPrivateStorage(new ConfigService(process.env));
      const keys = media.flatMap((item) => [item.sourceKey, item.displayKey, item.thumbnailKey].filter(Boolean));
      const missing = await Promise.all(keys.map((key) => storage.get(key).then(() => false).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return true;
      })));
      const report = { trackedMedia: media.length, isCleared: rows.length === media.length && rows.every((row) => row.processingStatus === 'REMOVED' && row.clearedAt && row.storedBytes === 0 && row.reservedBytes === 0), isBytesRemoved: missing.every(Boolean) };
      await writeFile(`${state}/erasure-cleanup-report.json`, JSON.stringify(report), { mode: 0o600 });
    } else throw new Error('Unknown rehearsal fixture action');
  }
} finally { await prisma.$disconnect(); }
