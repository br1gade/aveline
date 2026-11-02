import { Logger } from '@nestjs/common';
import { ANALYTICS_COLLECTION, AnalyticsService } from './analytics.service';
import { MongoConnection } from './mongo-connection';

/**
 * After an erasure commits, the guest's invitation views are unlinked from
 * them. The count of views is the host's and stays; which were this person's,
 * and from what browser and page, goes (docs/API.md, erasure).
 */
describe('unlinking an erased guest from invitation views', () => {
  const connectionWith = (updateMany: jest.Mock) => {
    const collection = jest.fn().mockReturnValue({ updateMany });
    return { db: jest.fn().mockResolvedValue({ collection }), reportFailure: jest.fn(), collection };
  };
  const serviceWith = (connection: ReturnType<typeof connectionWith>, isEnabled = true) =>
    new AnalyticsService(connection as unknown as MongoConnection, isEnabled, 1000);

  afterEach(() => jest.restoreAllMocks());

  it('unsets the guest, browser and referrer on their views and keeps the views', async () => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 2 });
    const connection = connectionWith(updateMany);

    await serviceWith(connection).forgetGuests(['guest-1', 'guest-2']);

    expect(connection.collection).toHaveBeenCalledWith(ANALYTICS_COLLECTION);
    expect(updateMany).toHaveBeenCalledWith(
      { guestId: { $in: ['guest-1', 'guest-2'] } },
      { $unset: { guestId: '', userAgent: '', referrer: '' } },
    );
  });

  it('does not reach Mongo when no guest was erased', async () => {
    const updateMany = jest.fn();
    const connection = connectionWith(updateMany);

    await serviceWith(connection).forgetGuests([]);

    expect(connection.db).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not reach Mongo when analytics is disabled', async () => {
    const updateMany = jest.fn();
    const connection = connectionWith(updateMany);

    await serviceWith(connection, false).forgetGuests(['guest-1']);

    expect(connection.db).not.toHaveBeenCalled();
  });

  it('logs a warning instead of failing the erasure when Mongo is down', async () => {
    const failure = new Error('mongo down');
    const connection = connectionWith(jest.fn().mockRejectedValue(failure));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(serviceWith(connection).forgetGuests(['guest-1'])).resolves.toBeUndefined();

    expect(connection.reportFailure).toHaveBeenCalledWith(failure);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('analytics erasure failed: mongo down'));
  });
});
