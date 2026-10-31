import { Logger } from '@nestjs/common';
import { MongoConnection } from '../analytics/mongo-connection';
import { AUDIT_COLLECTION, AuditService } from './audit.service';

/**
 * After an erasure commits, the person's address leaves the staff audit
 * trail. The entries stay — that an account acted is the accountability the
 * trail exists for — but the address does not (docs/API.md, erasure).
 */
describe('forgetting an erased person in the audit trail', () => {
  const connectionWith = (updateMany: jest.Mock) => {
    const collection = jest.fn().mockReturnValue({ updateMany });
    return {
      connection: { db: jest.fn().mockResolvedValue({ collection }), reportFailure: jest.fn() },
      collection,
    };
  };

  afterEach(() => jest.restoreAllMocks());

  it('clears the address on every entry recorded under their address or their account', async () => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 3 });
    const { connection, collection } = connectionWith(updateMany);
    const service = new AuditService(connection as unknown as MongoConnection);

    await service.forgetPerson({ email: 'ani@example.am', userId: 'user-1' });

    expect(collection).toHaveBeenCalledWith(AUDIT_COLLECTION);
    expect(updateMany).toHaveBeenCalledWith(
      { $or: [{ email: 'ani@example.am' }, { userId: 'user-1' }] },
      { $set: { email: null } },
    );
  });

  it('matches on the address alone when they had no account', async () => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const { connection } = connectionWith(updateMany);
    const service = new AuditService(connection as unknown as MongoConnection);

    await service.forgetPerson({ email: 'guest@example.am', userId: null });

    expect(updateMany).toHaveBeenCalledWith({ $or: [{ email: 'guest@example.am' }] }, { $set: { email: null } });
  });

  it('logs a warning and reports the dead client instead of failing the erasure when Mongo is down', async () => {
    const failure = new Error('mongo down');
    const updateMany = jest.fn().mockRejectedValue(failure);
    const { connection } = connectionWith(updateMany);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new AuditService(connection as unknown as MongoConnection);

    await expect(service.forgetPerson({ email: 'ani@example.am', userId: 'user-1' })).resolves.toBeUndefined();

    expect(connection.reportFailure).toHaveBeenCalledWith(failure);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('audit erasure failed: mongo down'));
  });
});
