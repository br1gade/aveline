import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { DomainHttpException } from '../../common/domain-http.exception';
import { PrismaService } from '../../prisma/prisma.service';

export async function runEnquiryTransaction<T>(prisma: PrismaService, apply: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await prisma.$transaction(apply, { timeout: 15000, maxWait: 5000 }); }
    catch (error) {
      if (isReceiptCollision(error)) throw new DomainHttpException('IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT');
      if (!isTransactionConflict(error)) throw error;
      await setTimeout(randomInt(10, 51));
    }
  }
  throw new ServiceUnavailableException('Retry this command with the same Idempotency-Key');
}

function isReceiptCollision(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && error.meta?.modelName === 'EnquiryCommand';
}
function isTransactionConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2034';
  return error instanceof Prisma.PrismaClientUnknownRequestError && /40P01|40001/.test(error.message);
}
