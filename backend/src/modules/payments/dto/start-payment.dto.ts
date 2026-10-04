import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider, PaymentPurpose } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export const SUPPORTED_CURRENCIES = ['AMD', 'USD', 'EUR', 'RUB'] as const;

export class StartPaymentDto {
  @ApiProperty()
  @IsString()
  organizationId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eventId?: string;

  @ApiProperty({ enum: PaymentPurpose })
  @IsEnum(PaymentPurpose)
  purpose!: PaymentPurpose;

  @ApiProperty({ enum: PaymentProvider })
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  /** A string, because JSON numbers lose precision above 2^53 and money
   *  must never be parsed as a float. */
  @ApiProperty({ description: 'Minor units as a decimal string, e.g. "25000" for 25,000 AMD' })
  @IsNumberString({ no_symbols: true })
  @MaxLength(18)
  amountMinor!: string;

  @ApiProperty({ enum: SUPPORTED_CURRENCIES })
  @IsIn(SUPPORTED_CURRENCIES)
  currency!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  returnUrl!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiProperty({ description: 'Caller-supplied; makes a retried request safe' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey!: string;
}
