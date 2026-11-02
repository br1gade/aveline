import { ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { HealthController } from './health.controller';

/**
 * The readiness body is a contract (docs/API.md §7): each dependency carries
 * isUp and latencyMs, and an error when it is unreachable. Operators read the
 * error to tell which store is down; the load balancer reads the status.
 */
describe('HealthController.ready report', () => {
  const up = () => Promise.resolve('ok');
  const refused = () => Promise.reject(new Error('connection refused'));
  type Probe = () => Promise<unknown>;

  const controller = (probes: Partial<Record<'postgres' | 'redis' | 'mongo' | 'storage', Probe>> = {}) =>
    new HealthController(
      { $queryRaw: probes.postgres ?? up } as unknown as PrismaService,
      { ping: probes.redis ?? up } as unknown as Redis,
      { probe: probes.mongo ?? up } as never,
      { probe: probes.storage ?? up } as unknown as StorageService,
    );

  const healthy = { isUp: true, latencyMs: expect.any(Number) };

  it('reports every dependency up, with latency, under status ok', async () => {
    const report = await controller().ready();

    expect(report).toEqual({
      status: 'ok',
      required: { postgres: healthy },
      optional: { redis: healthy, mongo: healthy, storage: healthy },
      at: expect.any(String),
    });
    expect(new Date(report.at).toISOString()).toBe(report.at);
  });

  it.each(['redis', 'mongo', 'storage'] as const)('names the error of an unreachable %s and leaves the others clean', async (which) => {
    const report = await controller({ [which]: refused }).ready();

    expect(report.optional[which]).toEqual({ isUp: false, latencyMs: expect.any(Number), error: 'connection refused' });
    expect(report.required.postgres).toEqual(healthy);
  });

  it('answers 503 with the full report, status unavailable, when Postgres is down', async () => {
    const failure = await controller({ postgres: refused }).ready().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect((failure as ServiceUnavailableException).getStatus()).toBe(503);
    expect((failure as ServiceUnavailableException).getResponse()).toMatchObject({
      status: 'unavailable',
      required: { postgres: { isUp: false, latencyMs: expect.any(Number), error: 'connection refused' } },
      optional: { redis: healthy, mongo: healthy, storage: healthy },
    });
  });
});
