import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BlockType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class BlockPlacementDto {
  @ApiProperty({ enum: BlockType })
  @IsEnum(BlockType)
  type!: BlockType;

  @ApiPropertyOptional({ description: 'Omit to leave the block enabled as-is' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: "Template layout variant, e.g. 'split'" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  variant?: string;
}

/**
 * The whole arrangement in one request. Display order is the array order, so
 * the client never computes indices and a partial reorder cannot leave the
 * page in an inconsistent state.
 */
export class ArrangeBlocksDto {
  @ApiProperty({ type: [BlockPlacementDto], description: 'Blocks in their new display order' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => BlockPlacementDto)
  blocks!: BlockPlacementDto[];
}
