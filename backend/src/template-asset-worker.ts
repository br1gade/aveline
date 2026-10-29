import { TemplateMaterializationRunner } from './modules/design/templates/template-materialization-runner';
import { initialiseSentry } from './infra/observability/sentry';
initialiseSentry(process.env);
import sharp from 'sharp';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { setTimeout as delay } from 'node:timers/promises';
import { validateEnv } from './common/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { PrivateStorageModule } from './infra/storage/private/private-storage.module';
import { TemplateAssetRunner } from './modules/design/templates/template-asset-runner';
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule, PrivateStorageModule], providers: [TemplateAssetRunner, TemplateMaterializationRunner] })
class TemplateAssetWorkerModule {}
async function main() {
  sharp.cache(false); sharp.concurrency(1);
  const app = await NestFactory.createApplicationContext(TemplateAssetWorkerModule);
  const runner = app.get(TemplateAssetRunner); const materializations = app.get(TemplateMaterializationRunner); const config = app.get(ConfigService);
  const stop = new AbortController(); process.once('SIGTERM', () => stop.abort()); process.once('SIGINT', () => stop.abort());
  const logger = new Logger('TemplateAssetWorker');
  try {
    while (!stop.signal.aborted) {
      try { await runIteration(runner, materializations, config); }
      catch { logger.error({ code: 'TEMPLATE_ASSET_WORKER_FAILED' }); }
      await delay(1000, undefined, { signal: stop.signal }).catch(() => undefined);
    }
  } finally { await app.close(); }
}
void main().catch(() => { new Logger('TemplateAssetWorker').error('Template artwork worker startup failed'); process.exitCode = 1; });

async function runIteration(runner: TemplateAssetRunner, materializations: TemplateMaterializationRunner, config: ConfigService) {
  await runner.cleanup();
  if (config.get('TEMPLATE_ASSETS_ENABLED') === 'true') { await runner.runOne(); await materializations.runOne(); }
}
