import { Prisma } from '@prisma/client';
import { DomainHttpException } from '../../../common/domain-http.exception';

/** Retry only transactions PostgreSQL rolled back, preserving the caller's original dedupe key. */
export async function retryTemplateTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await operation(); }
    catch (error) { if (!canRetry(error)) throw error; }
  }
  throw new DomainHttpException('TEMPLATE_REVISION_CONFLICT', 'Concurrent design edits did not settle; reload and retry');
}
function canRetry(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  return error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code));
}
