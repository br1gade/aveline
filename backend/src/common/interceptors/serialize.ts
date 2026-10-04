import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Converts every BigInt in a response to a string.
 *
 * `JSON.stringify` throws on a BigInt, so money had to be converted by hand
 * at every call site — nine of them, and every new endpoint touching an
 * amount had to remember. The one that forgot would 500 at runtime.
 *
 * Strings rather than numbers: a JavaScript number cannot hold every integer
 * we store, so emitting a number would silently round large amounts.
 */
export function serializeBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;

  if (Array.isArray(value)) return value.map(serializeBigInts);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      serializeBigInts(nested),
    ]),
  );
}

@Injectable()
export class SerializeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(serializeBigInts));
  }
}
