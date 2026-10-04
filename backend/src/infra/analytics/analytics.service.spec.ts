import { AnalyticsService, ANALYTICS_COLLECTION } from './analytics.service';

/**
 * Analytics is observability, not product state. Two rules it must never
 * break: a write cannot slow the guest's page, and a Mongo outage cannot
 * fail a request.
 */
describe('AnalyticsService', () => {
  const makeCollection = (overrides: Record<string, jest.Mock> = {}) => ({
    insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    createIndex: jest.fn().mockResolvedValue('ok'),
    ...overrides,
  });

  const makeDb = (collection: ReturnType<typeof makeCollection>) => ({
    db: jest.fn().mockResolvedValue({ collection: jest.fn().mockReturnValue(collection) }),
    reportFailure: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  });

  it('records a view against the right collection', async () => {
    const collection = makeCollection();
    const service = new AnalyticsService(makeDb(collection) as never, true, 1000);

    await service.recordInvitationView({ slug: 's', eventId: 'e', locale: 'hy' });

    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    const [doc] = collection.insertOne.mock.calls[0] as [Record<string, unknown>];
    expect(doc).toMatchObject({ type: 'invitation_view', slug: 's', eventId: 'e', locale: 'hy' });
    expect(doc.at).toBeInstanceOf(Date);
  });

  it('never throws when the write fails', async () => {
    const collection = makeCollection({
      insertOne: jest.fn().mockRejectedValue(new Error('mongo down')),
    });
    const service = new AnalyticsService(makeDb(collection) as never, true, 1000);

    await expect(
      service.recordInvitationView({ slug: 's', eventId: 'e', locale: 'hy' }),
    ).resolves.toBeUndefined();
  });

  it('writes nothing when analytics is disabled', async () => {
    const collection = makeCollection();
    const service = new AnalyticsService(makeDb(collection) as never, false, 1000);

    await service.recordInvitationView({ slug: 's', eventId: 'e', locale: 'hy' });

    expect(collection.insertOne).not.toHaveBeenCalled();
  });

  it('summarizes views into totals the dashboard can render', async () => {
    const collection = makeCollection({
      aggregate: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: 'hy', views: 12 }, { _id: 'en', views: 3 }]),
      }),
    });
    const service = new AnalyticsService(makeDb(collection) as never, true, 1000);

    await expect(service.invitationViewSummary('e')).resolves.toEqual({
      totalViews: 15,
      byLocale: [
        { locale: 'hy', views: 12 },
        { locale: 'en', views: 3 },
      ],
    });
  });

  it('returns an empty summary rather than failing when Mongo is unreachable', async () => {
    const collection = makeCollection({
      aggregate: jest.fn().mockImplementation(() => {
        throw new Error('mongo down');
      }),
    });
    const service = new AnalyticsService(makeDb(collection) as never, true, 1000);

    await expect(service.invitationViewSummary('e')).resolves.toEqual({
      totalViews: 0,
      byLocale: [],
    });
  });

  // Found by running the dashboard with Mongo stopped: the driver's own
  // server-selection timeout held the whole response for 2s, blowing the
  // <500ms budget in spec §12. Analytics must bound itself.
  it('gives up on a hanging read within its own budget', async () => {
    const collection = makeCollection({
      aggregate: jest.fn().mockReturnValue({
        toArray: jest.fn().mockReturnValue(new Promise(() => undefined)),
      }),
    });
    const service = new AnalyticsService(makeDb(collection) as never, true, 50);

    const startedAt = Date.now();
    await expect(service.invitationViewSummary('e')).resolves.toEqual({
      totalViews: 0,
      byLocale: [],
    });
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('exposes the collection name so indexes and the doc agree', () => {
    expect(ANALYTICS_COLLECTION).toBe('invitation_events');
  });
});
