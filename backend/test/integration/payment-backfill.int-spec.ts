import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { assertTestDatabaseUrl } from '../../src/common/test-database-url';
import { TEST_DATABASE_URL } from '../setup/test-database';

const DATE = '2026-11-01T00:00:00.000Z';
const LEGACY_SCHEMA = `
CREATE TABLE organizations (id TEXT PRIMARY KEY, "deletedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY);
CREATE TABLE events (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id));
CREATE TABLE plans (id TEXT PRIMARY KEY);
CREATE TABLE invoices (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id),
  "totalMinor" BIGINT NOT NULL, currency TEXT NOT NULL, "paymentOrderNumber" TEXT, "createdAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE ticket_orders (id TEXT PRIMARY KEY, "eventId" TEXT NOT NULL REFERENCES events(id),
  "totalMinor" BIGINT NOT NULL, currency TEXT NOT NULL, "paymentOrderNumber" TEXT);
CREATE TABLE payments (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, "organizationId" TEXT NOT NULL REFERENCES organizations(id),
  "eventId" TEXT REFERENCES events(id), "amountMinor" BIGINT NOT NULL, currency TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE, "orderNumber" TEXT NOT NULL UNIQUE, status TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE data_subject_requests (id TEXT PRIMARY KEY, "dueAt" TIMESTAMP(3) NOT NULL, "completedAt" TIMESTAMP(3));
INSERT INTO organizations VALUES ('organization-a',NULL,'2026-11-01'),('organization-b',NULL,'2026-11-01');
INSERT INTO users VALUES ('owner');
INSERT INTO events VALUES ('event-a','organization-a'),('event-b','organization-a');
INSERT INTO plans VALUES ('plan');
INSERT INTO invoices VALUES ('invoice-a','organization-a',100,'AMD',NULL,'2026-11-01');
INSERT INTO ticket_orders VALUES ('order-a','event-a',100,'AMD',NULL);
`;

interface LegacyPayment {
  id: string;
  purpose?: 'SUBSCRIPTION' | 'TICKET';
  organizationId?: string;
  eventId?: string | null;
  amountMinor?: number;
  currency?: string;
  idempotencyKey?: string;
  orderNumber?: string;
  status?: string;
}

async function insertPayment(client: Client, input: LegacyPayment) {
  const payment = { purpose: 'SUBSCRIPTION', organizationId: 'organization-a', eventId: null,
    amountMinor: 100, currency: 'AMD', idempotencyKey: `unknown-${input.id}`, orderNumber: `bank-${input.id}`, status: 'CAPTURED', ...input };
  await client.query(`INSERT INTO payments VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [payment.id, payment.purpose,
    payment.organizationId, payment.eventId, payment.amountMinor, payment.currency, payment.idempotencyKey, payment.orderNumber, payment.status, DATE]);
}

async function applyBackfill(client: Client) {
  await client.query(await readFile('prisma/migrations/20261123090000_backend_launch_safety/migration.sql', 'utf8'));
  await client.query(await readFile('prisma/migrations/20261123091000_payment_recovery_backfill/migration.sql', 'utf8'));
}

async function withLegacyDatabase(test: (client: Client) => Promise<void>) {
  assertTestDatabaseUrl(TEST_DATABASE_URL);
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  const schema = `payment_backfill_${randomUUID().replaceAll('-', '')}`;
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(LEGACY_SCHEMA);
    await test(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

async function associations(client: Client) {
  return (await client.query<{ id: string; invoiceId: string | null; ticketOrderId: string | null; status: string;
    hasUnknownOutcome: boolean; hasOriginalRegistrationTime: boolean }>(`SELECT id,"invoiceId","ticketOrderId",status,
      "outcomeUnknownAt" IS NOT NULL AS "hasUnknownOutcome",
      "registrationStartedAt" = "createdAt" AS "hasOriginalRegistrationTime" FROM payments ORDER BY id`)).rows;
}

describe('populated payment association backfill', () => {
  it('preserves existing rows and backfills additive display state without inventing a notice recipient', async () => {
    await withLegacyDatabase(async (client) => {
      await insertPayment(client, { id: 'legacy', status: 'FAILED' });
      await applyBackfill(client);
      expect((await client.query('SELECT id,translations FROM plans')).rows).toEqual([{ id: 'plan', translations: {} }]);
      expect((await client.query('SELECT id,"requestedByUserId","paymentNoticeLocale" FROM invoices')).rows)
        .toEqual([{ id: 'invoice-a', requestedByUserId: null, paymentNoticeLocale: null }]);
      expect(await associations(client)).toEqual([{ id: 'legacy', invoiceId: null, ticketOrderId: null, status: 'FAILED',
        hasUnknownOutcome: true, hasOriginalRegistrationTime: true }]);
    });
  });

  it('follows exact invoice anchors and successor keys through multiple historical attempts', async () => {
    await withLegacyDatabase(async (client) => {
      await insertPayment(client, { id: 'first', idempotencyKey: 'invoice-invoice-a', status: 'EXPIRED' });
      await insertPayment(client, { id: 'second', idempotencyKey: 'invoice-invoice-a-after-bank-first', status: 'FAILED' });
      await insertPayment(client, { id: 'third', idempotencyKey: 'invoice-invoice-a-after-bank-second', status: 'CAPTURED' });
      await client.query('UPDATE invoices SET "paymentOrderNumber"=$1', ['bank-third']);
      await applyBackfill(client);
      expect(await associations(client)).toEqual([
        { id: 'first', invoiceId: 'invoice-a', ticketOrderId: null, status: 'EXPIRED', hasUnknownOutcome: true, hasOriginalRegistrationTime: true },
        { id: 'second', invoiceId: 'invoice-a', ticketOrderId: null, status: 'FAILED', hasUnknownOutcome: true, hasOriginalRegistrationTime: true },
        { id: 'third', invoiceId: 'invoice-a', ticketOrderId: null, status: 'CAPTURED', hasUnknownOutcome: false, hasOriginalRegistrationTime: true },
      ]);
    });
  });

  it('quarantines malformed, ambiguous and financially mismatched invoice keys without rewriting their status ledger', async () => {
    await withLegacyDatabase(async (client) => {
      await client.query(`INSERT INTO invoices VALUES ('invoice-b','organization-a',100,'AMD','bank-ambiguous','2026-11-01'),
        ('invoice-amount','organization-a',100,'AMD',NULL,'2026-11-01'),('invoice-currency','organization-a',100,'AMD',NULL,'2026-11-01')`);
      const cases: LegacyPayment[] = [
        { id: 'ambiguous', idempotencyKey: 'invoice-invoice-a' },
        { id: 'malformed', idempotencyKey: 'invoice-invoice-a-after-missing' },
        { id: 'prefix', idempotencyKey: 'invoice-invoice-a-extra' },
        { id: 'successor', idempotencyKey: 'invoice-invoice-a-after-bank-ambiguous' },
        { id: 'amount', idempotencyKey: 'invoice-invoice-amount', amountMinor: 101 },
        { id: 'currency', idempotencyKey: 'invoice-invoice-currency', currency: 'USD' },
        { id: 'owner', idempotencyKey: 'invoice-invoice-b', organizationId: 'organization-b', status: 'AUTHORIZED' },
      ];
      for (const payment of cases) await insertPayment(client, payment);
      await applyBackfill(client);
      expect(await associations(client)).toEqual([...cases].sort((left, right) => left.id.localeCompare(right.id)).map((payment) => ({
        id: payment.id, invoiceId: null, ticketOrderId: null, status: payment.status ?? 'CAPTURED',
        hasUnknownOutcome: true, hasOriginalRegistrationTime: true,
      })));
    });
  });

  it('associates exact ticket captures and quarantines captures without matching event, owner or financial terms', async () => {
    await withLegacyDatabase(async (client) => {
      await client.query(`INSERT INTO ticket_orders SELECT 'order-' || name,'event-a',100,'AMD',NULL
        FROM unnest(ARRAY['event','owner','amount','currency']) name`);
      const cases: LegacyPayment[] = [
        { id: 'exact', idempotencyKey: 'order-order-a' },
        { id: 'pointer' },
        { id: 'event', idempotencyKey: 'order-order-event', eventId: 'event-b' },
        { id: 'owner', idempotencyKey: 'order-order-owner', organizationId: 'organization-b' },
        { id: 'amount', idempotencyKey: 'order-order-amount', amountMinor: 101 },
        { id: 'currency', idempotencyKey: 'order-order-currency', currency: 'USD' },
        { id: 'unknown' },
      ];
      for (const payment of cases) await insertPayment(client, { purpose: 'TICKET', eventId: 'event-a', ...payment });
      await client.query('UPDATE ticket_orders SET "paymentOrderNumber"=$1 WHERE id=$2', ['bank-pointer', 'order-a']);
      await applyBackfill(client);
      expect(await associations(client)).toEqual([...cases].sort((left, right) => left.id.localeCompare(right.id)).map((payment) => ({
        id: payment.id, invoiceId: null, ticketOrderId: ['exact', 'pointer'].includes(payment.id) ? 'order-a' : null,
        status: 'CAPTURED', hasUnknownOutcome: !['exact', 'pointer'].includes(payment.id), hasOriginalRegistrationTime: true,
      })));
    });
  });
});
