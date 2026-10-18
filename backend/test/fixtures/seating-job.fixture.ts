import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { resolveArrangement } from '../../src/modules/seating/seating-arrangements';
import { SeatingJobsService } from '../../src/modules/seating/jobs/seating-jobs.service';
import { SeatingQueue } from '../../src/modules/seating/jobs/seating-queue';
import { SeatingRunner } from '../../src/modules/seating/jobs/seating-runner';
import { SeatingPlanner } from '../../src/modules/seating/jobs/seating-planner';

export async function seatingTestJob(prisma: PrismaClient, eventId: string, arrangementId?: string) {
  const user = await prisma.user.upsert({ where: { email: `seating-${eventId}@test.local` }, update: {},
    create: { name: 'Coordinator', email: `seating-${eventId}@test.local`, eventMemberships: { create: { eventId, role: 'COORDINATOR' } } } });
  const selected = await prisma.$transaction((tx) => resolveArrangement(tx, eventId, arrangementId));
  const database = prisma as unknown as PrismaService;
  const jobs = new SeatingJobsService(database);
  const planner = new SeatingPlanner();
  const runner = new SeatingRunner(database, new SeatingQueue(database), planner);
  const active = await prisma.seatingJob.findFirst({ where: { arrangementId: selected.id, status: { in: ['QUEUED', 'RUNNING'] } } });
  const job = active ?? await jobs.create(eventId, user.id, { idempotencyKey: randomUUID() }, selected.id);
  await prisma.seatingJob.updateMany({ where: { id: job.id, status: 'QUEUED' }, data: { nextAttemptAt: new Date(0) } });
  return { jobs, planner, runner, job };
}

export async function runAutomaticSeating(prisma: PrismaClient, eventId: string, arrangementId?: string) {
  const { jobs, runner, job } = await seatingTestJob(prisma, eventId, arrangementId);
  await runner.runOne();
  const completed = await jobs.findOne(eventId, job.id);
  if (completed.status !== 'COMPLETED') throw new Error(`Seating job ${completed.status}: ${completed.failureReason}`);
  return { ...completed.result as { seated: number; households: number; unseated: { householdId: string; size: number; reason: string }[] }, attendanceRevision: completed.attendanceRevision };
}
