import { migrateTestDatabase, TEST_DATABASE_URL } from './test-database';
import { Client } from 'pg';

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
}
