import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
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
  if (value instanceof Date || value instanceof StreamableFile) return value;

  if (Array.isArray(value)) return serializeArray(value);
  return serializeObject(value as Record<string, unknown>);
}

function serializeArray(value: unknown[]): unknown[] {
  let result: unknown[] | null = null;
  value.forEach((item, index) => {
    const serialized = serializeBigInts(item);
    if (serialized === item) return;
    result ??= [...value];
    result[index] = serialized;
  });
  return result ?? value;
}

function serializeObject(value: Record<string, unknown>): Record<string, unknown> {
  // Preserve the previous plain-object conversion for uncommon class instances.
  let result: Record<string, unknown> | null = Object.getPrototypeOf(value) === Object.prototype ? null : {};
  for (const key of Object.keys(value)) {
    const serialized = serializeBigInts(value[key]);
    if (serialized !== value[key]) result ??= { ...value };
    if (result) result[key] = serialized;
  }
  return result ?? value;
}

@Injectable()
export class SerializeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(serializeBigInts));
  }
}
