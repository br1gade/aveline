import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FileToStore, StorageAdapter, StoredFile } from '../storage-port';

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Where a stored object is readable from, which may be a CDN. */
  publicBaseUrl: string;
}

/**
 * S3-compatible object storage.
 *
 * Written against the S3 API rather than any one provider, so the same class
 * serves self-hosted Garage today and a managed bucket later with nothing but
 * configuration changing.
 *
 * `forcePathStyle` is required: Garage addresses buckets as a path segment
 * rather than a subdomain, and virtual-host style would need wildcard DNS.
 */
@Injectable()
export class S3StorageAdapter implements StorageAdapter {
  readonly kind = 's3' as const;
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      // The SDK sets no timeout of its own: an unreachable store held an
      // upload request, and the image sweep, open indefinitely.
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(file: FileToStore, key: string): Promise<StoredFile> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimeType,
        ContentLength: file.buffer.byteLength,
      }),
    );

    this.logger.log(`stored ${key} (${file.buffer.byteLength} bytes)`);
    return {
      key,
      url: `${this.config.publicBaseUrl}/${key}`,
      sizeBytes: file.buffer.byteLength,
      mimeType: file.mimeType,
    };
  }

  async get(key: string): Promise<Buffer> {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!object.Body) throw new Error(`stored object ${key} has no body`);
    return Buffer.from(await object.Body.transformToByteArray());
  }

  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }
}
