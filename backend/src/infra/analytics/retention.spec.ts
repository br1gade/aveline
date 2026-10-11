import { ANALYTICS_COLLECTION, AnalyticsService, VIEW_RETENTION_SECONDS } from './analytics.service';
import { MongoConnection } from './mongo-connection';
import { AUDIT_COLLECTION, AUDIT_RETENTION_SECONDS, AuditService } from '../audit/audit.service';

/**
 * B91 / D22: both collections grew for ever, and the audit trail was read by
 * event with no index. (Checked against real Mongo by hand; under Jest the
 * driver cannot complete its handshake.)
 */
describe('Mongo retention', () => {
  const connectionRecording = () => {
    const created: { collection: string; key: unknown; options?: unknown }[] = [];
    const db = {
      collection: (collection: string) => ({
        createIndex: (key: unknown, options?: unknown) => Promise.resolve(void created.push({ collection, key, options })),
      }),
    };
    const connection = { db: () => Promise.resolve(db), reportFailure: jest.fn() } as unknown as MongoConnection;
    return { connection, created };
  };

  it('expires invitation views after thirteen months', async () => {
    const { connection, created } = connectionRecording();

    await new AnalyticsService(connection, true, 300).ensureIndexes();

    expect(VIEW_RETENTION_SECONDS).toBe(395 * 86_400);
    expect(created).toContainEqual({ collection: ANALYTICS_COLLECTION, key: { at: 1 }, options: { expireAfterSeconds: VIEW_RETENTION_SECONDS } });
  });

  it('expires the audit trail after two years, and indexes it the way it is read', async () => {
    const { connection, created } = connectionRecording();

    await new AuditService(connection).ensureIndexes();

    expect(AUDIT_RETENTION_SECONDS).toBe(730 * 86_400);
    expect(created).toContainEqual({ collection: AUDIT_COLLECTION, key: { eventId: 1, at: -1 }, options: undefined });
    expect(created).toContainEqual({ collection: AUDIT_COLLECTION, key: { at: 1 }, options: { expireAfterSeconds: AUDIT_RETENTION_SECONDS } });
  });
});
