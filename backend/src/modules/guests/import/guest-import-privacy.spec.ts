import { BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GuestImportService } from './guest-import.service';

describe('failed import diagnostic privacy', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([new Error('unique token secret-capability'), new BadRequestException('invalid address person@example.test')])(
    'does not log database values or persist uploaded names on a failed batch: %p', async (failure) => {
      const warnings = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const update = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'import', ...args.data }));
      const prisma = { event: { findUnique: jest.fn().mockResolvedValue({ id: 'event', organizationId: 'organization', locales: ['en'] }) },
        guestImport: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({ id: 'import' }), update },
        $transaction: jest.fn().mockRejectedValue(failure),
      } as unknown as PrismaService;
      const result = await new GuestImportService(prisma).importCsv('event', 'list.csv', Buffer.from('name\nperson@example.test'));
      expect(result).toMatchObject({ status: 'FAILED', rowsFailed: 1, errors: [expect.objectContaining({ row: 2, reason: 'NOT_SAVED' })] });
      expect(JSON.stringify(update.mock.calls)).not.toMatch(/secret-capability|person@example/);
      expect(JSON.stringify(warnings.mock.calls)).not.toMatch(/secret-capability|person@example/);
    },
  );
});
