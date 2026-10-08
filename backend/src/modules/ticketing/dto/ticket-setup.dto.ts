import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Minor units as a string: AMD amounts are large and JSON numbers lose precision. */
const MINOR_UNITS = /^\d{1,15}$/;

export class CreateTicketTypeDto {
  @ApiProperty({ description: 'Translated name', example: { hy: 'Ընդհանուր', en: 'General' } })
  @IsObject()
  name!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Translated description' })
  @IsOptional()
  @IsObject()
  description?: Record<string, unknown>;

  @ApiProperty({ description: 'Price in minor units, as a string. "0" is a free ticket.', example: '15000' })
  @IsString()
  @Matches(MINOR_UNITS, { message: 'priceMinor must be a whole, non-negative number' })
  priceMinor!: string;

  @ApiProperty({ minimum: 1, maximum: 100_000 })
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantityTotal!: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  minPerOrder?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxPerOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  salesStartAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  salesEndAt?: string;
}

/** Omitted means "leave as is". Price may change at any time — see ticket-type-rules.ts. */
export class UpdateTicketTypeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  name?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  description?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Applies to future buyers; placed orders keep their price' })
  @IsOptional()
  @IsString()
  @Matches(MINOR_UNITS, { message: 'priceMinor must be a whole, non-negative number' })
  priceMinor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantityTotal?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  minPerOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxPerOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  salesStartAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  salesEndAt?: string;

  @ApiPropertyOptional({ description: 'false stops sales without deleting anything' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpsertListingDto {
  @ApiPropertyOptional({ description: 'Public URL segment. Generated from the headline if omitted.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug may contain lowercase letters, numbers and single hyphens',
  })
  slug?: string;

  @ApiPropertyOptional({ description: 'Translated headline' })
  @IsOptional()
  @IsObject()
  headline?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  summary?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;

  @ApiPropertyOptional({ isArray: true, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  categories?: string[];

  @ApiPropertyOptional({ description: 'Translated link-preview title' })
  @IsOptional()
  @IsObject()
  ogTitle?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Translated link-preview description' })
  @IsOptional()
  @IsObject()
  ogDescription?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Allow search engines to index it. Off by default.' })
  @IsOptional()
  @IsBoolean()
  isIndexable?: boolean;
}

export class RefundPaymentDto {
  @ApiProperty({ description: 'Amount in minor units, as a string', example: '15000' })
  @IsString()
  @Matches(/^[1-9]\d{0,14}$/, { message: 'amountMinor must be a positive whole number' })
  amountMinor!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
