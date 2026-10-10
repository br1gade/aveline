import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OnAppOrigin } from '../../../common/app-url';
import { PaymentProvider } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

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
