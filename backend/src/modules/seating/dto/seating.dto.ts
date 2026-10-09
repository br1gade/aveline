import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTableDto {
  @ApiProperty()
  @IsString()
  @MaxLength(60)
  name!: string;

  @ApiProperty({ minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  capacity!: number;

  @ApiPropertyOptional({ description: 'Grouping inside a venue, e.g. "terrace"' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  zone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  venueId?: string;
}

/** What the seating editor can draw. */
export const TABLE_SHAPES = ['round', 'rectangle', 'square', 'oval'] as const;

/**
 * Editing a table: any of its fields, the rest unchanged. `null` clears
 * `zone`, `venueId` and the canvas position.
 */
export class UpdateTableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, description: 'Never below the guests already seated' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  capacity?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  zone?: string | null;

  @ApiPropertyOptional({ nullable: true, description: "One of this event's venues" })
  @IsOptional()
  @IsString()
  venueId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Canvas position, in the editor’s own units' })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-100000)
  @Max(100000)
  posX?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-100000)
  @Max(100000)
  posY?: number | null;

  @ApiPropertyOptional({ enum: TABLE_SHAPES })
  @IsOptional()
  @IsIn(TABLE_SHAPES)
  shape?: (typeof TABLE_SHAPES)[number];
}

export class CreateTablesDto {
  @ApiProperty({ description: 'Prefix for generated names, e.g. "Table"' })
  @IsString()
  @MaxLength(40)
  namePrefix!: string;

  @ApiProperty({ minimum: 1, maximum: 200 })
  @IsInt()
  @Min(1)
  @Max(200)
  count!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  capacity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  zone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  venueId?: string;
}

export class AssignSeatDto {
  @ApiProperty()
  @IsString()
  guestId!: string;

  @ApiProperty()
  @IsString()
  tableId!: string;

  @ApiPropertyOptional({ description: 'Place at the table, for printed cards' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  position?: number;
}
