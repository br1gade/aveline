import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesystemStorageAdapter } from './adapters/filesystem.adapter';
import { S3StorageAdapter } from './adapters/s3.adapter';
import { STORAGE_ADAPTER, StorageAdapter } from './storage-port';
import { StorageService } from './storage.service';

/**
 * Picks a backend from configuration.
 *
 * S3 whenever credentials are present — self-hosted Garage locally, a managed
 * bucket later, both over the same API. Filesystem otherwise, which is correct
 * for one instance and wrong the moment there are two.
 */
function buildAdapter(config: ConfigService): StorageAdapter {
  const logger = new Logger('StorageModule');
  const accessKeyId = config.get<string>('S3_ACCESS_KEY_ID');
  const secretAccessKey = config.get<string>('S3_SECRET_ACCESS_KEY');
  const endpoint = config.get<string>('S3_ENDPOINT');

  if (accessKeyId && secretAccessKey && endpoint) {
    const bucket = config.get<string>('S3_BUCKET') ?? 'aveline-media';
    logger.log(`Storage: S3 at ${endpoint}, bucket ${bucket}`);
    return new S3StorageAdapter({
      endpoint,
      region: config.get<string>('S3_REGION') ?? 'garage',
      bucket,
      accessKeyId,
      secretAccessKey,
      publicBaseUrl: config.get<string>('S3_PUBLIC_URL') ?? `${endpoint}/${bucket}`,
    });
  }

  const root = config.get<string>('STORAGE_ROOT') ?? './storage';
  logger.warn(
    `Storage: local filesystem at ${root}. Correct for one instance only — ` +
      'a second instance cannot serve what this one wrote.',
  );
  return new FilesystemStorageAdapter(root, config.get<string>('STORAGE_PUBLIC_URL') ?? '/files');
}

@Global()
@Module({
  providers: [
    { provide: STORAGE_ADAPTER, inject: [ConfigService], useFactory: buildAdapter },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
