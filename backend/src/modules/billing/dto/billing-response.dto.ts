import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { InvoiceStatus, Prisma } from '@prisma/client';

export class InvoiceLineDisplayDto {
  @ApiProperty({ type: String, nullable: true })
  locale!: string | null;

  @ApiProperty()
  description!: string;
}

export class InvoiceLineDto {
  @ApiProperty()
  description!: string;

  @ApiPropertyOptional()
  planKey?: string;

  @ApiProperty()
  quantity!: number;

  @ApiPropertyOptional()
  unitPriceMinor?: string;

  @ApiProperty()
  totalMinor!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  descriptionTranslations?: Record<string, string>;

  @ApiProperty({ type: InvoiceLineDisplayDto })
  display!: InvoiceLineDisplayDto;
}

@ApiExtraModels(InvoiceLineDto)
export class InvoiceResponseDto {
  @ApiProperty({ enum: ['PURCHASE', 'RENEWAL'] })
  kind!: string;

  @ApiProperty({ type: Date, nullable: true })
  periodStart!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  periodEnd!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  renewalAnchorEnd!: Date | null;

  @ApiProperty()
  number!: string;

  @ApiProperty({ enum: InvoiceStatus })
  status!: InvoiceStatus;

  @ApiProperty()
  subtotalMinor!: string;

  @ApiProperty()
  taxMinor!: string;

  @ApiProperty()
  totalMinor!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'New invoice lines include display; historical JSON is retained unchanged.', anyOf: [
    { type: 'array', items: { $ref: getSchemaPath(InvoiceLineDto) } },
    { type: 'array', items: {} }, { type: 'object', nullable: true, additionalProperties: true },
    { type: 'string' }, { type: 'number' }, { type: 'boolean' },
  ] })
  lines!: Prisma.JsonValue;

  @ApiProperty({ type: Date, nullable: true })
  issuedAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  dueAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  paidAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  paymentOrderNumber!: string | null;
}
