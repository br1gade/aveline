import { initialiseSentry } from './infra/observability/sentry';
initialiseSentry(process.env);
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { validateEnv } from './common/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { SeatingQueue } from './modules/seating/jobs/seating-queue';
import { SeatingRunner } from './modules/seating/jobs/seating-runner';
import { SeatingPlanner } from './modules/seating/jobs/seating-planner';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule],
  providers: [SeatingQueue, SeatingRunner, SeatingPlanner],
})
class SeatingWorkerModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeatingWorkerModule);
  const runner = app.get(SeatingRunner);
  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());
  const logger = new Logger('SeatingWorker');
  try {
    while (!stop.signal.aborted) {
      try {
        await runner.runOne();
        await writeFile(process.env.SEATING_WORKER_HEARTBEAT_PATH ?? '/tmp/aveline-seating-worker-heartbeat', String(Date.now()), { mode: 0o600 });
      } catch { logger.error({ code: 'SEATING_WORKER_DEPENDENCY_UNAVAILABLE' }); }
      await delay(2000, undefined, { signal: stop.signal }).catch(() => undefined);
    }
  } finally { await app.close(); }
}
void main().catch(() => { new Logger('SeatingWorker').error('Seating worker startup failed'); process.exitCode = 1; });
