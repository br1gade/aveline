import { ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { HealthController } from './health.controller';

/**
 * B92: readiness said `ok` with Redis or Mongo down and `degraded` with
 * Postgres down — the one state that is not serving — and answered 200 in
 * both, so the container stayed healthy with no database.
 */
describe('HealthController.ready', () => {
  const up = () => Promise.resolve('ok');
  const down = () => Promise.reject(new Error('connection refused'));

  const controller = (dependencies: { postgres: () => Promise<unknown>; redis: () => Promise<unknown>; mongo: () => Promise<unknown> }) =>
    new HealthController(
      { $queryRaw: dependencies.postgres } as unknown as PrismaService,
      { ping: dependencies.redis } as unknown as Redis,
      { db: dependencies.mongo } as never,
    );

  it('is ok with everything up', async () => {
    await expect(controller({ postgres: up, redis: up, mongo: up }).ready()).resolves.toMatchObject({ status: 'ok' });
  });

  it.each(['redis', 'mongo'] as const)('is degraded but still serving with %s down', async (which) => {
    const result = await controller({ postgres: up, redis: up, mongo: up, [which]: down }).ready();

    expect(result.status).toBe('degraded');
  });

  it('is unavailable — not 200 — with Postgres down', async () => {
    await expect(controller({ postgres: down, redis: up, mongo: up }).ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
