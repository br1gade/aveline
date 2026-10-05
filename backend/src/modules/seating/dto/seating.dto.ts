import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
