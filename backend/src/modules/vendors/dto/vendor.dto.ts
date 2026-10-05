import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus, VendorCategory } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BRIEF_SECTIONS } from '../vendor-brief';

export class CreateVendorDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ enum: VendorCategory })
  @IsEnum(VendorCategory)
  category!: VendorCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string;
}

export class BookVendorDto {
  @ApiProperty()
  @IsString()
  vendorId!: string;

  @ApiPropertyOptional({
    isArray: true,
    enum: BRIEF_SECTIONS,
    description: 'Exactly what this vendor may read. Omitted uses the category default.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRIEF_SECTIONS.length)
  @IsIn(BRIEF_SECTIONS, { each: true })
  briefScopes?: string[];

  @ApiPropertyOptional({ description: 'Agreed fee, as a decimal string', example: '150000.00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'feeAmount must be a decimal amount' })
  feeAmount?: string;
}

/** Omitted means "leave as is". */
export class UpdateBookingDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ isArray: true, enum: BRIEF_SECTIONS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRIEF_SECTIONS.length)
  @IsIn(BRIEF_SECTIONS, { each: true })
  briefScopes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'feeAmount must be a decimal amount' })
  feeAmount?: string;
}
