import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus, VendorCategory } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsISO4217CurrencyCode,
  IsNotIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Trimmed } from '../../../common/trimmed';
import { BRIEF_SECTIONS } from '../vendor-brief';

class VendorContactDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200, format: 'email' })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string | null;
}

export class CreateVendorDto extends VendorContactDto {
  @ApiProperty()
  @Trimmed()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ enum: VendorCategory })
  @IsEnum(VendorCategory)
  category!: VendorCategory;
}

export class UpdateVendorDto extends VendorContactDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 160 })
  @Trimmed()
  @ValidateIf((_dto: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ enum: VendorCategory, enumName: 'VendorCategory' })
  @ValidateIf((_dto: unknown, value: unknown) => value !== undefined)
  @IsEnum(VendorCategory)
  category?: VendorCategory;
}

export class ManagedVendorDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: VendorCategory, enumName: 'VendorCategory' })
  category!: VendorCategory;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;
}

class BookingFeeDto {
  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^\\d{1,15}$', description: 'Whole minor units as a string; null clears the fee', example: '150000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,15}$/, { message: 'feeMinor must be a whole number of minor units, e.g. "150000"' })
  feeMinor?: string | null;

  @ApiPropertyOptional({ type: String, pattern: '^[A-Za-z]{3}$', description: 'ISO 4217 currency code, stored uppercase; a new booking defaults to AMD' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toUpperCase() : value)
  @ValidateIf((_dto: unknown, value: unknown) => value !== undefined)
  @IsISO4217CurrencyCode({ message: 'feeCurrency: use an ISO 4217 currency code' })
  @IsNotIn(['XXX', 'XTS'], { message: 'feeCurrency: choose a currency for the fee' })
  feeCurrency?: string;
}

export class BookVendorDto extends BookingFeeDto {
  @ApiProperty()
  @IsString()
  vendorId!: string;

  @ApiPropertyOptional({
    isArray: true,
    enum: BRIEF_SECTIONS,
    description: 'Omission uses category defaults for a new or renewed engagement and preserves the grants on an existing active booking.',
  })
  @ValidateIf((_dto: unknown, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(BRIEF_SECTIONS.length)
  @IsIn(BRIEF_SECTIONS, { each: true })
  briefScopes?: string[];
}

/** Omitted means "leave as is". */
export class UpdateBookingDto extends BookingFeeDto {
  @ApiPropertyOptional({ description: 'Pause or resume the current brief without changing the booking or token' })
  @ValidateIf((_dto: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  isBriefEnabled?: boolean;

  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ isArray: true, enum: BRIEF_SECTIONS })
  @ValidateIf((_dto: unknown, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(BRIEF_SECTIONS.length)
  @IsIn(BRIEF_SECTIONS, { each: true })
  briefScopes?: string[];
}
