import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { retryTemplateTransaction } from './template-transaction';
const serialization = new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: 'test' });
describe('template transaction retries', () => {
  it('retries a rolled-back serialization failure using the same operation', async () => {
    const operation = jest.fn().mockRejectedValueOnce(serialization).mockResolvedValue('committed');
    expect(await retryTemplateTransaction(operation)).toBe('committed'); expect(operation).toHaveBeenCalledTimes(2);
  });
  it('bounds retry exhaustion at three attempts and returns a recoverable conflict', async () => {
    const operation = jest.fn().mockRejectedValue(serialization);
    await expect(retryTemplateTransaction(operation)).rejects.toMatchObject({ status: 409 }); expect(operation).toHaveBeenCalledTimes(3);
  });
  it('never retries ordinary domain rejection', async () => {
    const operation = jest.fn().mockRejectedValue(new BadRequestException('invalid'));
    await expect(retryTemplateTransaction(operation)).rejects.toMatchObject({ status: 400 }); expect(operation).toHaveBeenCalledTimes(1);
  });
});
