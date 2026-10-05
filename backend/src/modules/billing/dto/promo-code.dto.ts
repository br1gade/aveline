import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OrderLineDto } from '../../ticketing/dto/create-order.dto';

/** Minor units arrive as strings for the same reason money leaves as strings:
 *  JSON numbers lose precision above 2^53 and AMD amounts are large. */
const MINOR_UNITS = /^\d{1,15}$/;

export class CreatePromoCodeDto {
  @ApiProperty({ example: 'SPRING25' })
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  // Codes are typed by hand off a poster or a chat message, so the character
  // set excludes anything ambiguous in print.
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'A code may contain letters, numbers and hyphens only',
  })
  code!: string;

  @ApiProperty({ enum: DiscountKind })
  @IsEnum(DiscountKind)
  kind!: DiscountKind;

  @ApiProperty({ description: 'Percent 1–100, or an amount in minor units', example: '15' })
  @IsString()
  @Matches(MINOR_UNITS, { message: 'value must be a whole number' })
  value!: string;

  @ApiPropertyOptional({ description: 'Null applies the code to every event' })
  @IsOptional()
  @IsString()
  eventId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1_000_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxRedemptions?: number;

  @ApiPropertyOptional({ description: 'Minimum order in minor units' })
  @IsOptional()
  @IsString()
  @Matches(MINOR_UNITS, { message: 'minOrderMinor must be a whole number' })
  minOrderMinor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  validUntil?: string;
}

/** Everything is optional: omitted means "leave as is" (CLAUDE.md §6). */
export class UpdatePromoCodeDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 1_000_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxRedemptions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  validUntil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * The buyer's "do I have a discount?" question.
 *
 * The order lines come with it so the subtotal is computed from our own
 * prices. Taking a subtotal from the client would let anyone claim a
 * percentage of an amount they made up.
 */
export class CheckPromoCodeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(32)
  code!: string;

  @ApiProperty({ type: [OrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];
}
