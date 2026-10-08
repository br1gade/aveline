import { ApiPropertyOptional } from '@nestjs/swagger';
import { EventType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * An event's core details. Omitted means unchanged; `null` clears the
 * optional ones (`endsAt`, the side labels).
 */
export class UpdateEventDto {
  @ApiPropertyOptional({ enum: EventType })
  @IsOptional()
  @IsEnum(EventType)
  type?: EventType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Shown on the invitation' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  hostsLabel?: string;

  @ApiPropertyOptional({ description: 'ISO 8601' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'ISO 8601, or null to clear', nullable: true })
  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @ApiPropertyOptional({ description: 'IANA zone, e.g. Asia/Yerevan' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ isArray: true, type: String, example: ['hy', 'ru', 'en'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  locales?: string[];

  @ApiPropertyOptional({ example: 'hy' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultLocale?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sideALabel?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sideBLabel?: string | null;
}
