import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExportFormat, ExportKind } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class CreateExportDto {
  @ApiProperty({ enum: ExportKind })
  @IsEnum(ExportKind)
  kind!: ExportKind;

  @ApiPropertyOptional({ enum: ExportFormat, default: ExportFormat.CSV })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;
}
