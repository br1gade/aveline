import { MediaKind, PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { CacheService } from '../../src/infra/cache/cache.service';
import { FilesystemStorageAdapter } from '../../src/infra/storage/adapters/filesystem.adapter';
import { StorageService, storageKeyOf } from '../../src/infra/storage/storage.service';
import { ImageVariantsService } from '../../src/modules/media/image-variants.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Smaller copies of uploaded photos, made after upload by a sweep. Real
 * images through real sharp into a real folder — the point is what comes
 * out: the right sizes, upright, and an unreadable file left alone.
 */
describe('Resizing photos (integration)', () => {
  let prisma: PrismaClient;
  let storage: StorageService;
  let images: ImageVariantsService;
  let root: string;
  let eventId: string;

  beforeAll(async () => {
    prisma = testPrisma();
    root = await mkdtemp(join(tmpdir(), 'aveline-images-'));
    storage = new StorageService(new FilesystemStorageAdapter(root, 'http://media.test'));
    images = new ImageVariantsService(
      prisma as unknown as PrismaService,
      storage,
      { invalidateInvitation: () => Promise.resolve() } as unknown as CacheService,
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ({ eventId } = await seedEvent(prisma));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await disconnectTestDatabase();
  });

  /** Stores an image and records it, as an upload does. */
  const uploaded = async (buffer: Buffer, mimeType = 'image/jpeg', kind: MediaKind = MediaKind.PHOTO) => {
    const stored = await storage.put({ buffer, originalName: 'photo', mimeType });
    return prisma.mediaAsset.create({ data: { eventId, kind, url: stored.url, mimeType, sizeBytes: stored.sizeBytes } });
  };

  const photo = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: '#b76e79' } }).jpeg().toBuffer();

  it('makes three smaller WebP copies of a large photo, and records its size', async () => {
    const asset = await uploaded(await photo(3000, 2000));

    await images.processPending();

    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row).toMatchObject({ width: 3000, height: 2000, variantsError: null });
    expect(row.variantsProcessedAt).toBeInstanceOf(Date);
    const variants = row.variants as { width: number; height: number; url: string }[];
    expect(variants.map((v) => [v.width, v.height])).toEqual([
      [480, 320],
      [960, 640],
      [1600, 1067],
    ]);
    const smallest = await sharp(await storage.get(storageKeyOf(variants[0].url))).metadata();
    expect(smallest).toMatchObject({ format: 'webp', width: 480 });
  });

  it('makes no copy larger than the original', async () => {
    const asset = await uploaded(await photo(400, 300));

    await images.processPending();

    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.variants).toEqual([]);
    expect(row.variantsProcessedAt).not.toBeNull();
  });

  // A phone stores a portrait photo landscape, with a tag saying to turn it.
  it('turns a photo upright before copying it', async () => {
    const sideways = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#ffffff' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const asset = await uploaded(sideways);

    await images.processPending();

    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row).toMatchObject({ width: 1000, height: 2000 });
  });

  it('marks a file it cannot read, keeps serving the original, and does not try again', async () => {
    const asset = await uploaded(Buffer.from('this is not a jpeg'));

    const first = await images.processPending();
    const second = await images.processPending();

    expect(first).toEqual({ processed: 0, failed: 1 });
    expect(second).toEqual({ processed: 0, failed: 0 });
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.variantsError).toBeTruthy();
    expect(row.url).toBe(asset.url);
  });

  it('leaves SVGs and audio alone', async () => {
    const svg = await uploaded(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml');
    const song = await uploaded(Buffer.from('ID3'), 'audio/mpeg', MediaKind.AUDIO);

    expect(await images.processPending()).toEqual({ processed: 0, failed: 0 });
    for (const id of [svg.id, song.id]) {
      expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id } })).variantsProcessedAt).toBeNull();
    }
  });
});
