import { MessageChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunicationsService } from './communications.service';
import { SuppressionService } from './suppression.service';

it('stops dispatch and reports an unavailable email budget before claiming or sending', async () => {
  const previous = process.env.EMAIL_SENDS_PER_MINUTE;
  process.env.EMAIL_SENDS_PER_MINUTE = '60';
  const send = jest.fn();
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const database = {
    $transaction: jest.fn().mockRejectedValue(new Error('budget unavailable')),
    message: {
      updateMany,
      findMany: jest.fn().mockResolvedValueOnce([{ id: 'message-1', channel: 'EMAIL' }]).mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ attempts: 0 }),
    },
  } as unknown as PrismaService;
  const communications = new CommunicationsService(database, new Map([[MessageChannel.EMAIL, { channel: MessageChannel.EMAIL, send }]]), new SuppressionService(database));
  try {
    await expect(communications.dispatchDue()).rejects.toThrow('budget unavailable');
    expect(send).not.toHaveBeenCalled();
    expect(updateMany.mock.calls.every(([query]) => query.where.status !== 'QUEUED')).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.EMAIL_SENDS_PER_MINUTE;
    else process.env.EMAIL_SENDS_PER_MINUTE = previous;
  }
});
