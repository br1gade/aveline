import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { assertTestDatabaseUrl } from '../../src/common/test-database-url';
import { TEST_DATABASE_URL } from '../setup/test-database';

const fixtures = [
  { minimumRevision: 2, hasActivatedMemberships: false, expectedRevision: 3 },
  { minimumRevision: 2, hasActivatedMemberships: true, expectedRevision: 3 },
  { minimumRevision: 4, hasActivatedMemberships: true, expectedRevision: 4 },
];

describe('populated shared reader floor migration', () => {
  it.each(fixtures)('raises floor $minimumRevision without resetting membership activation $hasActivatedMemberships', async (fixture) => {
    assertTestDatabaseUrl(TEST_DATABASE_URL);
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    const schema = `reader_floor_${randomUUID().replaceAll('-', '')}`;
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}", public`);
      await client.query('CREATE TABLE runtime_compatibility (id TEXT PRIMARY KEY, "minimumRevision" INTEGER NOT NULL DEFAULT 2, "multiOrganizationWrites" BOOLEAN NOT NULL DEFAULT false)');
      await client.query('INSERT INTO runtime_compatibility VALUES ($1,$2,$3)', ['organization-context', fixture.minimumRevision, fixture.hasActivatedMemberships]);
      await client.query(await readFile('prisma/migrations/20261030100000_shared_reader_compatibility_floor/migration.sql', 'utf8'));
      expect((await client.query('SELECT * FROM runtime_compatibility WHERE id = $1', ['organization-context'])).rows).toEqual([
        { id: 'organization-context', minimumRevision: fixture.expectedRevision, multiOrganizationWrites: fixture.hasActivatedMemberships },
      ]);
      expect((await client.query('INSERT INTO runtime_compatibility(id) VALUES ($1) RETURNING "minimumRevision", "multiOrganizationWrites"', ['new-gate'])).rows).toEqual([
        { minimumRevision: 3, multiOrganizationWrites: false },
      ]);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
