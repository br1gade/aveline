import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExportFormat, ExportKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';

export class CreateExportSnapshotDto {
  @ApiProperty({ enum: ExportKind })
  @IsEnum(ExportKind)
  kind!: ExportKind;

  @ApiProperty({ description: 'New UUID for each regeneration; reuse only to retry the same request.' })
  @IsUUID('4')
  idempotencyKey!: string;

  @ApiPropertyOptional({ enum: ExportFormat, default: ExportFormat.CSV })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;

  @ApiPropertyOptional({ enum: ['en', 'ru', 'fr', 'hy'], description: 'Defaults to the event language; standard headings remain English pending four-language acceptance.' })
  @IsOptional()
  @IsIn(['en', 'ru', 'fr', 'hy'])
  locale?: string;

  @ApiPropertyOptional({ description: 'Defaults to current contact permission. False requests a redacted artifact.' })
  @IsOptional()
  @IsBoolean()
  includesContacts?: boolean;
}
