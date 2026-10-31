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

  afterEach(() => jest.restoreAllMocks());

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
    // A JPEG signature, so upload accepts it, over a body no decoder can read.
    const asset = await uploaded(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('this is not a jpeg')]));

    const first = await images.processPending();
    const second = await images.processPending();

    expect(first).toEqual({ processed: 0, failed: 1 });
    expect(second).toEqual({ processed: 0, failed: 0 });
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.variantsError).toBeTruthy();
    expect(row.url).toBe(asset.url);
  });

  // B87: storage being briefly unreachable marked the photo unreadable for good.
  it('tries again next sweep when storage could not hand the file back', async () => {
    const asset = await uploaded(await photo(2000, 1000));
    jest.spyOn(storage, 'get').mockRejectedValueOnce(new Error('connection reset'));

    await images.processPending();
    const second = await images.processPending();

    expect(second).toEqual({ processed: 1, failed: 0 });
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.variantsError).toBeNull();
  });

  // B87: an upload removed mid-resize threw out of the sweep and orphaned its copies.
  it('carries on, and leaves no copies behind, when an upload is removed while it is resized', async () => {
    const removed = await uploaded(await photo(2000, 1000));
    const kept = await uploaded(await photo(2000, 1000));
    const put = storage.put.bind(storage);
    const written: string[] = [];
    jest.spyOn(storage, 'put').mockImplementation(async (file) => {
      const stored = await put(file);
      written.push(stored.url);
      await prisma.mediaAsset.deleteMany({ where: { id: removed.id } });
      return stored;
    });
    const removedUrls: string[] = [];
    jest.spyOn(storage, 'removeByUrl').mockImplementation((url) => Promise.resolve(void removedUrls.push(url)));

    await images.processPending();

    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: kept.id } })).variantsProcessedAt).not.toBeNull();
    expect(removedUrls.length).toBeGreaterThan(0);
    expect(removedUrls.every((url) => written.includes(url))).toBe(true);
  });

  it('leaves SVGs and audio alone', async () => {
    // SVG uploads are refused now (B92); one stored before that is still left alone.
    const svg = await prisma.mediaAsset.create({
      data: { eventId, kind: MediaKind.PHOTO, url: 'http://media.test/legacy.svg', mimeType: 'image/svg+xml', sizeBytes: 40 },
    });
    const song = await uploaded(Buffer.from('ID3'), 'audio/mpeg', MediaKind.AUDIO);

    expect(await images.processPending()).toEqual({ processed: 0, failed: 0 });
    for (const id of [svg.id, song.id]) {
      expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id } })).variantsProcessedAt).toBeNull();
    }
  });
});
