import { Prisma, PrismaClient } from '@prisma/client';

/** Returns once another session in this database is blocked on a lock. Bounded so a broken race fails, not hangs. */
export async function untilSomeoneWaitsOnALock(prisma: PrismaClient): Promise<void> {
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>(Prisma.sql`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`);
    if (waiting > 0) return;
  }
  throw new Error('no session ever waited on a lock');
}

/**
 * Runs `work` in a transaction and keeps it open until released, so a test
 * can start a competing writer against the rows it holds.
 */
export async function holdTransaction(
  prisma: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<{ release: () => void; done: Promise<unknown> }> {
  let signalHeld!: () => void;
  let release!: () => void;
  const isHeld = new Promise<void>((resolve) => { signalHeld = resolve; });
  const canFinish = new Promise<void>((resolve) => { release = resolve; });
  const done = prisma.$transaction(async (tx) => {
    await work(tx);
    signalHeld();
    await canFinish;
  }, { timeout: 20_000 });
  await Promise.race([isHeld, done]);
  return { release, done };
}
