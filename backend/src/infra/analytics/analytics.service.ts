import { Inject, Injectable, Logger } from '@nestjs/common';
import { MongoConnection } from './mongo-connection';

export const MONGO_CONNECTION = Symbol('MONGO_CONNECTION');
export const ANALYTICS_ENABLED = Symbol('ANALYTICS_ENABLED');
export const ANALYTICS_READ_TIMEOUT_MS = Symbol('ANALYTICS_READ_TIMEOUT_MS');

export const ANALYTICS_COLLECTION = 'invitation_events';

export interface InvitationView {
  slug: string;
  eventId: string;
  locale: string;
  guestId?: string;
  referrer?: string;
  userAgent?: string;
}

export interface ViewSummary {
  totalViews: number;
  byLocale: { locale: string; views: number }[];
}

/**
 * Invitation engagement, stored in MongoDB.
 *
 * Why Mongo and not Postgres: these are append-only, high-volume, never
 * joined against the domain, and their shape changes as we learn what to
 * measure. See docs/DATA_STORES.md for where the line sits.
 *
 * Two rules this service must never break:
 *   1. A write must not slow the guest's page — callers fire and forget.
 *   2. A Mongo outage must not fail a request — every path swallows and logs.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @Inject(MONGO_CONNECTION) private readonly connection: MongoConnection,
    @Inject(ANALYTICS_ENABLED) private readonly isEnabled: boolean,
    @Inject(ANALYTICS_READ_TIMEOUT_MS) private readonly readTimeoutMs: number,
  ) {}

  async recordInvitationView(view: InvitationView): Promise<void> {
    if (!this.isEnabled) return;

    try {
      const db = await this.connection.db();
      await db.collection(ANALYTICS_COLLECTION).insertOne({
        type: 'invitation_view',
        at: new Date(),
        ...view,
      });
    } catch (error) {
      // Hand the error back so a dead client is replaced on the next call,
      // rather than every later write failing until the process restarts.
      this.connection.reportFailure(error);
      this.logger.warn(`analytics write failed: ${describe(error)}`);
    }
  }

  /**
   * Aggregates in Mongo rather than pulling documents — the collection grows
   * without bound and must never be loaded into Node to be counted.
   *
   * Bounded by its own timeout. The driver's server-selection timeout is far
   * longer than the dashboard's whole latency budget (spec §12), so an
   * unreachable Mongo would otherwise hold the entire response hostage.
   * Analytics is the least important panel on the screen; it yields first.
   */
  async invitationViewSummary(eventId: string): Promise<ViewSummary> {
    const empty: ViewSummary = { totalViews: 0, byLocale: [] };
    if (!this.isEnabled) return empty;

    try {
      return await withTimeout(this.aggregateViews(eventId), this.readTimeoutMs, empty);
    } catch (error) {
      this.connection.reportFailure(error);
      this.logger.warn(`analytics read failed: ${describe(error)}`);
      return empty;
    }
  }

  private async aggregateViews(eventId: string): Promise<ViewSummary> {
    const db = await this.connection.db();
    const rows = await db
      .collection(ANALYTICS_COLLECTION)
      .aggregate<{ _id: string; views: number }>([
        { $match: { type: 'invitation_view', eventId } },
        { $group: { _id: '$locale', views: { $sum: 1 } } },
        { $sort: { views: -1 } },
      ])
      .toArray();

    return {
      totalViews: rows.reduce((sum, row) => sum + row.views, 0),
      byLocale: rows.map((row) => ({ locale: row._id, views: row.views })),
    };
  }

  async shutdown(): Promise<void> {
    await this.connection.close();
  }

  /** Indexes the two fields every query filters on. Safe to call repeatedly. */
  async ensureIndexes(): Promise<void> {
    if (!this.isEnabled) return;
    try {
      const db = await this.connection.db();
      await db.collection(ANALYTICS_COLLECTION).createIndex({ eventId: 1, at: -1 });
    } catch (error) {
      // Mongo may simply not be up yet. The next write creates the index.
      this.connection.reportFailure(error);
      this.logger.warn(`analytics index creation failed: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolves to `fallback` if `work` has not settled in time. The timer is
 *  always cleared, so a slow result cannot keep the process alive. */
async function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });

  try {
    return await Promise.race([work, expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
