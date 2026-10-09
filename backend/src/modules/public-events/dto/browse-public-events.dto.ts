import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';

/**
 * Everything browsing accepts, in one DTO. The filters were read beside a
 * pagination DTO, and the whitelist refused them as unknown — so the
 * documented `?category=…&locale=…` was a 400.
 */
export class BrowsePublicEventsQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Language to answer in, negotiated against what each event publishes' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @ApiPropertyOptional({ description: 'One listing category, e.g. concert' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;
}
