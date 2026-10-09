import { Prisma } from '@prisma/client';

/** A unique constraint refused the write — someone else holds that value. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** A conditional update matched nothing — usually a compare-and-set someone else won. */
export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}
