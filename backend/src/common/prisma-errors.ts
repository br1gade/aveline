import { Prisma } from '@prisma/client';

/** A unique constraint refused the write — someone else holds that value. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
