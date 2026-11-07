import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Trimmed } from '../../../common/trimmed';

export const TICKET_LAYOUT_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_LAYOUT_SEATS = 5_000;
export const MAX_VENUE_LAYOUTS = 30;

export enum TicketSectionMode {
  NUMBERED = 'NUMBERED',
  UNNUMBERED = 'UNNUMBERED',
}

export class TicketLayoutRowDto {
  @ApiProperty({ minLength: 1, maxLength: 16 })
  @Trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  label!: string;

  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(16, { each: true })
  @Matches(/\S/, { each: true })
  seats!: string[];
}

export class TicketLayoutSectionDto {
  @ApiProperty({ pattern: TICKET_LAYOUT_KEY.source })
  @Matches(TICKET_LAYOUT_KEY)
  key!: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: TicketSectionMode })
  @IsEnum(TicketSectionMode)
  mode!: TicketSectionMode;

  @ApiPropertyOptional({ type: [TicketLayoutRowDto], minItems: 1, maxItems: 100 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TicketLayoutRowDto)
  rows?: TicketLayoutRowDto[];

  @ApiPropertyOptional({ minimum: 1, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  capacity?: number;
}

export class VenueTicketLayoutVersionDto {
  @ApiProperty({ pattern: TICKET_LAYOUT_KEY.source })
  @Matches(TICKET_LAYOUT_KEY)
  key!: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ minimum: 0, description: 'Use 0 for a new layout, otherwise the latest version read' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value)
  @IsInt()
  @Min(0)
  @Max(2_147_483_646)
  expectedVersion!: number;
}

export class PublishVenueTicketLayoutDto extends VenueTicketLayoutVersionDto {
  @ApiProperty({ type: [TicketLayoutSectionDto], minItems: 1, maxItems: 40 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => TicketLayoutSectionDto)
  sections!: TicketLayoutSectionDto[];
}

export class SelectVenueTicketLayoutDto {
  @ApiProperty({ minLength: 1, maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  versionId!: string;
}
