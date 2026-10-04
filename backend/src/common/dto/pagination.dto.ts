import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * One pagination contract for every list endpoint.
 *
 * Before this, six list endpoints each invented their own limit — `take: 10`,
 * `take: 200`, `Math.min(limit ?? 20, 100)` — so a client had to learn each
 * one and the seventh would have invented an eighth.
 */
export class PaginationQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Clamps caller input to a range the database can serve cheaply. */
export function resolvePaging(query: PaginationQuery): { take: number; skip: number } {
  return {
    take: Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE),
    skip: Math.max(query.offset ?? 0, 0),
  };
}

export function toPage<T>(items: T[], total: number, paging: { take: number; skip: number }): Page<T> {
  return {
    items,
    total,
    limit: paging.take,
    offset: paging.skip,
    hasMore: paging.skip + items.length < total,
  };
}
