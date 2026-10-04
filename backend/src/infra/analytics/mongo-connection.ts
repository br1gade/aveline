import { Injectable } from '@nestjs/common';
import type { Db, MongoClient } from 'mongodb';

export type MongoClientFactory = () => MongoClient;

/**
 * Owns the MongoClient's lifetime and survives an outage.
 *
 * The driver permanently closes its topology when the first connection
 * attempt fails. Without this wrapper, starting the API while Mongo is down —
 * or any outage that trips that path — disables analytics until the process
 * restarts, long after Mongo itself has recovered.
 *
 * So the client is built lazily and thrown away whenever it reports a closed
 * topology, which lets the next call build a fresh one.
 */
@Injectable()
export class MongoConnection {
  private client: MongoClient | null = null;

  constructor(private readonly createClient: MongoClientFactory) {}

  async db(): Promise<Db> {
    if (!this.client) {
      const client = this.createClient();
      try {
        await client.connect();
      } catch (error) {
        // Do not keep a client whose topology the driver has already closed.
        this.client = null;
        throw error;
      }
      this.client = client;
    }
    return this.client.db();
  }

  /** Callers hand back operation errors so a dead client is not reused. */
  reportFailure(error: unknown): void {
    if (isClosedTopology(error)) this.client = null;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.close();
    } catch {
      // Shutting down; a failure to close cleanly changes nothing.
    }
  }
}

function isClosedTopology(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /topology is closed|client (must be connected|is closed)/i.test(message);
}
