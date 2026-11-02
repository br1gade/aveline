import { MongoConnection } from '../analytics/mongo-connection';
import { AuditEntry, AuditService } from './audit.service';

/**
 * A Mongo outage must never fail or slow a request: every path swallows the
 * error, reports it so a dead client is discarded, and reads come back empty.
 */
describe('AuditService when Mongo is down (coverage)', () => {
  const outage = new Error('connect ECONNREFUSED 127.0.0.1:27017');

  const build = () => {
    const connection = {
      db: jest.fn().mockRejectedValue(outage),
      reportFailure: jest.fn(),
    };
    return { connection, service: new AuditService(connection as unknown as MongoConnection) };
  };

  const entry: AuditEntry = {
    action: 'events.guests.create', method: 'POST', route: '/api/v1/events/:eventId/guests',
    userId: 'u1', email: 'host@test.local', organizationId: 'o1', eventId: 'e1',
    statusCode: 201, requestId: 'r1', at: new Date('2026-10-05T18:02:11.000Z'),
  };

  it('swallows a failed write and reports it', async () => {
    const { connection, service } = build();

    await expect(service.record(entry)).resolves.toBeUndefined();

    expect(connection.reportFailure).toHaveBeenCalledWith(outage);
  });

  it('returns an empty trail when the read fails, and reports it', async () => {
    const { connection, service } = build();

    await expect(service.forEvent('e1')).resolves.toEqual([]);

    expect(connection.reportFailure).toHaveBeenCalledWith(outage);
  });

  it('swallows a failed erasure and reports it', async () => {
    const { connection, service } = build();

    await expect(service.forgetPerson({ email: 'host@test.local', userId: 'u1' })).resolves.toBeUndefined();

    expect(connection.reportFailure).toHaveBeenCalledWith(outage);
  });

  it('swallows a failure part-way through a read, after the connection succeeded', async () => {
    const failing = { find: () => ({ sort: () => ({ limit: () => ({ toArray: () => Promise.reject(outage) }) }) }) };
    const connection = { db: jest.fn().mockResolvedValue({ collection: () => failing }), reportFailure: jest.fn() };
    const service = new AuditService(connection as unknown as MongoConnection);

    await expect(service.forEvent('e1')).resolves.toEqual([]);

    expect(connection.reportFailure).toHaveBeenCalledWith(outage);
  });
});
