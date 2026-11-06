import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';

export const LEGACY_REPORT_ROW_LIMIT = 5000;
export const LEGACY_REPORT_QUESTION_LIMIT = 100;

export class ReportQueryDto extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Preferred language; response names the negotiated language' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}
