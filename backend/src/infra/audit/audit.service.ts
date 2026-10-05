import { Inject, Injectable, Logger } from '@nestjs/common';
import { MONGO_CONNECTION } from '../analytics/analytics.service';
import { MongoConnection } from '../analytics/mongo-connection';

export const AUDIT_COLLECTION = 'audit_trail';

export interface AuditEntry {
  action: string;
  method: string;
  route: string;
  /** Null for a capability-token caller, who has no account. */
  userId: string | null;
  email: string | null;
  organizationId: string | null;
  eventId: string | null;
  statusCode: number;
  requestId: string | null;
  at: Date;
}

/**
 * Who did what, stored in MongoDB.
 *
 * Mongo for the same reasons as analytics: append-only, never joined against
 * the domain, and losing it costs accountability rather than correctness. The
 * documented blocker on this was "no actor to record" — authentication closed
 * that, and it stayed unbuilt long enough to be worth saying plainly that it
 * is now the thing that makes `SUPPORT` staff acting on a customer's behalf
 * accountable.
 *
 * Two rules, inherited from the analytics service for the same reasons:
 *   1. A write must never slow the request — callers fire and forget.
 *   2. A Mongo outage must never fail a request — every path swallows and logs.
 *
 * The deliberate omission: **no request bodies.** A guest list, a password
 * reset payload and a card binding would all end up in a store with weaker
 * access controls than Postgres. The trail records that someone changed the
 * guest list, not what the new list was.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(MONGO_CONNECTION) private readonly connection: MongoConnection) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      const db = await this.connection.db();
      await db.collection<AuditEntry>(AUDIT_COLLECTION).insertOne(entry);
    } catch (error) {
      // Reported so a dead client is discarded rather than retried forever.
      this.connection.reportFailure(error);
      this.logger.warn(`audit write failed: ${describeError(error)}`);
    }
  }

  /**
   * The trail for one event, newest first.
   *
   * Bounded, because this is read by a human answering a question, not by a
   * report. An unbounded query over an append-only collection is a way to
   * discover how large it has become.
   */
  async forEvent(eventId: string, limit = 100): Promise<AuditEntry[]> {
    try {
      const db = await this.connection.db();
      return await db
        .collection<AuditEntry>(AUDIT_COLLECTION)
        .find({ eventId })
        .sort({ at: -1 })
        .limit(Math.min(limit, 500))
        .toArray();
    } catch (error) {
      this.connection.reportFailure(error);
      this.logger.warn(`audit read failed: ${describeError(error)}`);
      return [];
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
