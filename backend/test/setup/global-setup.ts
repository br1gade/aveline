import { migrateTestDatabase, TEST_DATABASE_URL } from './test-database';
import { Client } from 'pg';

export const MAILPIT_API = process.env.MAILPIT_API ?? 'http://localhost:8025';

/** Creates the test database if absent, then applies migrations. */
export default async function globalSetup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const database = url.pathname.slice(1);

  const admin = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: url.username,
    password: url.password,
    database: 'postgres',
  });

  await admin.connect();
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (existing.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${database}"`);
  }
  await admin.end();

  migrateTestDatabase();
  await assertMailSinkIsRunning();
}

/**
 * The integration suite sends real mail at a local SMTP server, for the same
 * reason it runs against real Postgres: encoding and header bugs only appear
 * on the wire. `npm run db:up` starts it with the databases.
 */
async function assertMailSinkIsRunning(): Promise<void> {
  try {
    const response = await fetch(`${MAILPIT_API}/api/v1/messages?limit=1`);
    if (response.ok) return;
  } catch {
    // Falls through to the same message: unreachable and unhealthy are the
    // same problem for the person who has to fix it.
  }

  throw new Error(
    `No SMTP server at ${MAILPIT_API}. Run "npm run db:up" (service: mailpit).`,
  );
}
