import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OnAppOrigin } from '../../../common/app-url';
import { BillingInterval, PaymentProvider } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class SubscribeDto {
  @ApiProperty({ description: "A plan's key, as returned by GET /plans", example: 'managed-monthly' })
  @IsString()
  @MaxLength(64)
  planKey!: string;

  @ApiPropertyOptional({ enum: PaymentProvider, description: 'Required for a paid plan' })
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;

  @ApiPropertyOptional({ description: 'Where the bank returns the payer; a page of the Aveline app' })
  @IsOptional()
  @OnAppOrigin()
  @MaxLength(500)
  returnUrl?: string;
}

export class PayInvoiceDto {
  @ApiProperty({ enum: PaymentProvider })
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;
}

export class RenewSubscriptionDto extends PayInvoiceDto {

  @ApiProperty({ description: 'The currentPeriodEnd being renewed; repeat it unchanged on retry.' })
  @IsISO8601({ strict: true })
  @MaxLength(40)
  expectedPeriodEnd!: string;

  @ApiProperty()
  @Matches(/^[0-9]{1,20}$/)
  expectedPriceMinor!: string;

  @ApiProperty()
  @Matches(/^[A-Z]{3}$/)
  expectedCurrency!: string;

  @ApiProperty({ enum: BillingInterval })
  @IsEnum(BillingInterval)
  expectedInterval!: BillingInterval;
}
