import { once } from 'node:events';
import { AddressInfo, connect, createServer, Server, Socket } from 'node:net';

/**
 * A TCP hop in front of a real dependency (Postgres, Redis, SMTP) that a test
 * can cut and restore, the way a container stop and start looks from the API:
 * live connections drop, new ones are refused, and the port comes back as it
 * was. The dependency itself is never touched — other test files share it.
 */
export class InterruptibleLink {
  private server: Server | null = null;
  private readonly pairs = new Set<{ client: Socket; upstream: Socket }>();
  private boundPort = 0;

  constructor(private readonly target: { host: string; port: number }) {}

  get port(): number { return this.boundPort; }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((client) => this.relay(client));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.boundPort, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    this.boundPort = (server.address() as AddressInfo).port;
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const { client, upstream } of this.pairs) { client.destroy(); upstream.destroy(); }
    this.pairs.clear();
    if (server) await new Promise<void>((resolve) => { server.close(() => resolve()); });
  }

  /**
   * Resolves once the dependency has closed every connection and all it said
   * last has been passed on — so a server that ends sessions politely (as
   * Postgres does on shutdown) is heard before the link is cut.
   */
  async settled(): Promise<void> {
    await Promise.all([...this.pairs].map(async ({ client, upstream }) => {
      if (!upstream.closed) await once(upstream, 'close');
      if (!client.writableFinished && !client.destroyed) await once(client, 'finish');
    }));
  }

  private relay(client: Socket): void {
    const upstream = connect(this.target.port, this.target.host);
    const pair = { client, upstream };
    this.pairs.add(pair);
    const drop = () => { client.destroy(); upstream.destroy(); };
    for (const socket of [client, upstream]) socket.on('error', drop);
    client.on('close', () => { upstream.destroy(); this.pairs.delete(pair); });
    // pipe() ends the other side once one side ends, after flushing what it carried.
    client.pipe(upstream);
    upstream.pipe(client);
  }
}

/** A promise a stalled worker waits on, plus a signal that it has started waiting. */
export function stall() {
  let release = () => undefined as void;
  let entered = () => undefined as void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hasEntered = new Promise<void>((resolve) => { entered = resolve; });
  return { gate, hasEntered, release, enter: () => entered() };
}
