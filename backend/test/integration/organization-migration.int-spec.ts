import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { assertTestDatabaseUrl } from '../../src/common/test-database-url';
import { TEST_DATABASE_URL } from '../setup/test-database';

const FIXTURE = `
CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL);
CREATE UNIQUE INDEX users_email_lower_key ON users(lower(email));
CREATE TABLE organization_memberships (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES users(id), "organizationId" TEXT NOT NULL REFERENCES organizations(id), role "OrganizationRole" NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "organization_memberships_userId_key" ON organization_memberships("userId");
CREATE UNIQUE INDEX organization_memberships_pair_key ON organization_memberships("userId","organizationId");
CREATE TABLE events (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id));
CREATE TABLE invoices (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id));
CREATE TABLE organization_invites (id TEXT PRIMARY KEY, "organizationId" TEXT REFERENCES organizations(id), "tokenHash" TEXT UNIQUE);
CREATE TABLE event_invites (id TEXT PRIMARY KEY, "eventId" TEXT REFERENCES events(id), "tokenHash" TEXT UNIQUE);
INSERT INTO organizations VALUES ('org_a','Family'),('org_b','Agency');
INSERT INTO users VALUES ('user_a','ani@example.test');
INSERT INTO organization_memberships(id,"userId","organizationId",role) VALUES ('membership_a','user_a','org_a','OWNER');
INSERT INTO events VALUES ('event_a','org_a');
INSERT INTO invoices VALUES ('invoice_a','org_a');
INSERT INTO organization_invites VALUES ('invite_a','org_a','hash_a');
INSERT INTO event_invites VALUES ('event_invite_a','event_a','hash_b');
`;

async function expectConstraint(client: Client, statement: string, code: string) {
  await client.query('SAVEPOINT constraint_case');
  await expect(client.query(statement)).rejects.toMatchObject({ code });
  await client.query('ROLLBACK TO SAVEPOINT constraint_case');
}

describe('populated organization compatibility migration', () => {
  it('preserves identities and old safety constraints while backfilling additive state', async () => {
    assertTestDatabaseUrl(TEST_DATABASE_URL);
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    const schema = `organization_migration_${randomUUID().replaceAll('-', '')}`;
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}", public`);
      await client.query(FIXTURE);
      await client.query(await readFile('prisma/migrations/20261026100000_organization_context_compatibility/migration.sql', 'utf8'));
      await client.query(await readFile('prisma/migrations/20261026101000_organization_authority_evidence/migration.sql', 'utf8'));
      expect((await client.query('SELECT id,"accessRevision" FROM organizations ORDER BY id')).rows).toEqual([{ id: 'org_a', accessRevision: 0 }, { id: 'org_b', accessRevision: 0 }]);
      expect((await client.query('SELECT id FROM organization_memberships')).rows).toEqual([{ id: 'membership_a' }]);
      expect((await client.query('SELECT id FROM events')).rows).toEqual([{ id: 'event_a' }]);
      expect((await client.query('SELECT id FROM invoices')).rows).toEqual([{ id: 'invoice_a' }]);
      expect((await client.query('SELECT "acceptedByUserId" FROM organization_invites')).rows).toEqual([{ acceptedByUserId: null }]);
      expect((await client.query('SELECT "minimumRevision","multiOrganizationWrites" FROM runtime_compatibility')).rows).toEqual([{ minimumRevision: 2, multiOrganizationWrites: false }]);
      await expectConstraint(client, "INSERT INTO users VALUES ('upper','ANI@example.test')", '23505');
      await expectConstraint(client, "INSERT INTO organization_memberships(id,\"userId\",\"organizationId\",role) VALUES ('second','user_a','org_b','MANAGER')", '23505');
      await expectConstraint(client, "UPDATE organization_invites SET \"acceptedByUserId\"='missing'", '23503');
      await expectConstraint(client, "INSERT INTO organization_invites VALUES ('duplicate','org_a','hash_a',NULL)", '23505');
      await client.query(`DROP INDEX "${schema}"."organization_memberships_userId_key"`);
      await client.query("INSERT INTO organization_memberships(id,\"userId\",\"organizationId\",role) VALUES ('second','user_a','org_b','MANAGER')");
      await expectConstraint(client, "INSERT INTO organization_memberships(id,\"userId\",\"organizationId\",role) VALUES ('duplicate_pair','user_a','org_b','MANAGER')", '23505');
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
