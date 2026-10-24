import { Prisma } from '@prisma/client';
import { GuestPageMeta, readGuestPageBatch } from './guest-page-version';

interface PendingCheck {
  token?: string;
  resolve: (value: GuestPageMeta[]) => void;
  reject: (error: unknown) => void;
}
interface CheckQueue { pending: PendingCheck[]; active: number; isScheduled: boolean }

/** Only outstanding requests share IO; every check still reads a fresh DB snapshot. */
export class GuestPageReader {
  private readonly queues = new Map<string, CheckQueue>();
  private pendingCount = 0;
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  read(slug: string, token?: string): Promise<GuestPageMeta[]> {
    if (this.pendingCount >= 1000) return this.load(slug, [token]).then(([meta]) => meta);
    return new Promise((resolve, reject) => {
      this.pendingCount += 1;
      const queue = this.queues.get(slug) ?? { pending: [], active: 0, isScheduled: false };
      const request = { token, resolve, reject };
      queue.pending.push(request);
      this.queues.set(slug, queue);
      this.schedule(slug, queue);
    });
  }

  private schedule(slug: string, queue: CheckQueue): void {
    if (queue.isScheduled || queue.active >= 4) return;
    queue.isScheduled = true;
    setImmediate(() => {
      queue.isScheduled = false;
      while (queue.pending.length && queue.active < 4) {
        const batch = queue.pending.splice(0, 100);
        queue.active += 1;
        void this.complete(slug, queue, batch);
      }
    });
  }

  private async complete(slug: string, queue: CheckQueue, batch: PendingCheck[]): Promise<void> {
    try {
      const results = await this.load(slug, batch.map((request) => request.token));
      batch.forEach((request, index) => request.resolve(results[index]));
    } catch (error) { batch.forEach((request) => request.reject(error)); }
    finally {
      this.pendingCount -= batch.length; queue.active -= 1;
      if (queue.pending.length) this.schedule(slug, queue);
      else if (!queue.active) this.queues.delete(slug);
    }
  }

  private async load(slug: string, tokens: (string | undefined)[]): Promise<GuestPageMeta[][]> {
    // Payload validation uses the scoped counters; the coarse compatibility
    // ledger is still available to exports and direct metadata readers.
    const rows = await readGuestPageBatch(this.prisma, slug, tokens, false);
    if (tokens.length === 1) return [rows.map(({ requestIndex: _requestIndex, ...meta }) => meta)];
    const results: GuestPageMeta[][] = tokens.map(() => []);
    for (const { requestIndex, ...meta } of rows) results[requestIndex].push(meta);
    return results;
  }
}
