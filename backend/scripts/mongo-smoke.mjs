// Run with plain Node in the disposable rehearsal, outside Jest's VM loader.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { MongoClient } = require('mongodb');
const { MongoConnection } = require('../dist/infra/analytics/mongo-connection');
const { AnalyticsService, ANALYTICS_COLLECTION, VIEW_RETENTION_SECONDS } = require('../dist/infra/analytics/analytics.service');
const { AuditService, AUDIT_COLLECTION, AUDIT_RETENTION_SECONDS } = require('../dist/infra/audit/audit.service');
const url = new URL(process.env.MONGO_URL);
assert.match(url.pathname, /_test$/u, 'Mongo smoke requires an explicitly disposable test database');
const connection = new MongoConnection(() => new MongoClient(url.href, { serverSelectionTimeoutMS: 500, connectTimeoutMS: 500 }));
const analytics = new AnalyticsService(connection, true, 1000);
const audit = new AuditService(connection);
const eventId = randomUUID();
const guestId = randomUUID();
try {
  await connection.probe();
  await analytics.ensureIndexes();
  await audit.ensureIndexes();
  await analytics.recordInvitationView({ slug: 'synthetic', eventId, locale: 'hy', guestId, referrer: 'synthetic-referrer' });
  await analytics.recordInvitationView({ slug: 'synthetic', eventId, locale: 'en' });
  await audit.record({ action: 'synthetic.read', method: 'GET', route: '/synthetic', userId: guestId, email: 'synthetic@example.test', organizationId: null, eventId, statusCode: 200, requestId: null, at: new Date() });
  const summary = await analytics.invitationViewSummary(eventId);
  assert.equal(summary.totalViews, 2);
  assert.deepEqual(summary.byLocale.map((row) => row.locale).sort(), ['en', 'hy']);
  assert.equal((await audit.forEvent(eventId)).length, 1);
  const db = await connection.db();
  for (const [collection, seconds] of [[ANALYTICS_COLLECTION, VIEW_RETENTION_SECONDS], [AUDIT_COLLECTION, AUDIT_RETENTION_SECONDS]]) {
    const indexes = await db.collection(collection).indexes();
    assert.ok(indexes.some((index) => index.expireAfterSeconds === seconds && index.key.at === 1));
    assert.ok(indexes.some((index) => index.key.eventId === 1 && index.key.at === -1));
  }
  await analytics.forgetGuests([guestId]);
  await audit.forgetPerson({ userId: guestId, email: 'synthetic@example.test' });
  const view = await db.collection(ANALYTICS_COLLECTION).findOne({ eventId, locale: 'hy' });
  assert.equal(view.guestId, undefined);
  assert.equal(view.referrer, undefined);
  assert.equal((await audit.forEvent(eventId))[0].email, null);
  assert.equal((await analytics.invitationViewSummary(eventId)).totalViews, 2);
  console.log('Native Mongo: real writes, aggregates, retention indexes and erasure passed.');
} catch {
  console.error('Native Mongo smoke failed; no connection credentials logged.');
  process.exitCode = 1;
} finally {
  await connection.close();
}
