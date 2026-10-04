import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/**
 * Integration and e2e tests run against a real Postgres, never a mock, because
 * the behaviour under test is largely Prisma query semantics and transaction
 * boundaries. A mock would assert our assumptions rather than the database's.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://aveline:aveline@localhost:5433/aveline_test?schema=public';

let client: PrismaClient | null = null;

export function testPrisma(): PrismaClient {
  client ??= new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  return client;
}

/** Applies migrations once per jest worker. */
export function migrateTestDatabase(): void {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}

/**
 * Truncates every table between tests. RESTART IDENTITY + CASCADE keeps this a
 * single statement, which matters: per-test cleanup runs hundreds of times and
 * a per-table delete loop would dominate the suite's runtime.
 */
export async function resetTestDatabase(): Promise<void> {
  const prisma = testPrisma();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function disconnectTestDatabase(): Promise<void> {
  await client?.$disconnect();
  client = null;
}
