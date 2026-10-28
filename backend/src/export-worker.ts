import { initialiseSentry } from './infra/observability/sentry';
initialiseSentry(process.env);
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { validateEnv } from './common/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AnalyticsModule } from './infra/analytics/analytics.module';
import { PrivateStorageModule } from './infra/storage/private/private-storage.module';
import { PrivateStorageService } from './infra/storage/private/private-storage';
import { OperationsService } from './modules/operations/operations.service';
import { ExportRunner } from './modules/exports/export-runner';
import { ExportQueue } from './modules/exports/export-queue';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule, AnalyticsModule, PrivateStorageModule],
  providers: [OperationsService, ExportQueue, ExportRunner],
})
class ExportWorkerModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(ExportWorkerModule);
  const runner = app.get(ExportRunner);
  const storage = app.get(PrivateStorageService);
  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());
  const logger = new Logger('ExportWorker');
  try {
    // One job at a time per process. More processes use SKIP LOCKED leases.
    while (!stop.signal.aborted) {
      try {
        await storage.probe();
        await runner.cleanup();
        await runNextExport(runner, stop.signal);
        await writeFile(process.env.EXPORT_WORKER_HEARTBEAT_PATH ?? '/tmp/aveline-export-worker-heartbeat', String(Date.now()), { mode: 0o600 });
      } catch { logger.error({ code: 'EXPORT_WORKER_DEPENDENCY_UNAVAILABLE' }); }
      await delay(2000, undefined, { signal: stop.signal }).catch(() => undefined);
    }
  } finally { await app.close(); }
}
async function runNextExport(runner: ExportRunner, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await runner.runOne();
}

void main().catch(() => { new Logger('ExportWorker').error('Export worker startup failed'); process.exitCode = 1; });
