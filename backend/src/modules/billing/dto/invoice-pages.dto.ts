import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CursorPageQuery } from '../../../common/cursor-pagination.dto';
import { LOCALE } from '../../../common/locale';
import { InvoiceResponseDto } from './billing-response.dto';

export class InvoicePageQuery extends CursorPageQuery {
  @ApiPropertyOptional({ example: 'hy', description: 'Display language; otherwise Accept-Language, then English' })
  @IsOptional()
  @IsString()
  @Matches(LOCALE)
  @MaxLength(12)
  locale?: string;
}

export class InvoicePageDto {
  @ApiProperty({ type: [InvoiceResponseDto] })
  items!: InvoiceResponseDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
