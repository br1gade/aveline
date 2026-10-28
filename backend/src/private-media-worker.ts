import { initialiseSentry } from './infra/observability/sentry';
initialiseSentry(process.env);
import sharp from 'sharp';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { validateEnv } from './common/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { PrivateStorageModule } from './infra/storage/private/private-storage.module';
import { PrivateStorageService } from './infra/storage/private/private-storage';
import { PrivateMediaRunner } from './modules/guest-contributions/private-media-runner';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule, PrivateStorageModule], providers: [PrivateMediaRunner] })
class PrivateMediaWorkerModule {}
async function main() {
  sharp.cache(false); sharp.concurrency(1);
  const app = await NestFactory.createApplicationContext(PrivateMediaWorkerModule);
  const runner = app.get(PrivateMediaRunner); const storage = app.get(PrivateStorageService);
  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort()); process.once('SIGINT', () => stop.abort());
  const logger = new Logger('PrivateMediaWorker');
  try {
    while (!stop.signal.aborted) {
      try {
        await runIteration(runner, storage, stop.signal);
      } catch { logger.error({ code: 'PRIVATE_MEDIA_WORKER_DEPENDENCY_UNAVAILABLE' }); }
      await delay(1000, undefined, { signal: stop.signal }).catch(() => undefined);
    }
  } finally { await app.close(); }
}
async function runIteration(runner: PrivateMediaRunner, storage: PrivateStorageService, signal: AbortSignal) {
  await storage.probe(); await runner.cleanup();
  if (!signal.aborted) await runner.runOne();
  await writeFile(process.env.PRIVATE_MEDIA_WORKER_HEARTBEAT_PATH ?? '/tmp/aveline-private-media-worker-heartbeat', String(Date.now()), { mode: 0o600 });
}
void main().catch(() => { new Logger('PrivateMediaWorker').error('Private media worker startup failed'); process.exitCode = 1; });
