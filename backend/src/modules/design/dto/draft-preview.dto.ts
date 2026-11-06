import { ApiProperty } from '@nestjs/swagger';
import { BlockType } from '@prisma/client';
import { IsEnum } from 'class-validator';
import { UpdateBlockDto } from './design.dto';

/** The exact block edit, evaluated without persisting it. Locale is a query. */
export class DraftPreviewDto extends UpdateBlockDto {
  @ApiProperty({ enum: BlockType })
  @IsEnum(BlockType)
  type!: BlockType;
}
