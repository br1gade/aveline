import { OrderAttendeeDto } from './attendee.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OnAppOrigin } from '../../../common/app-url';
import { PaymentProvider } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class OrderLineDto {
  @ApiProperty()
  @IsString()
  ticketTypeId!: string;

  @ApiProperty({ minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}

export class CreateOrderDto {
  @ApiProperty({ type: [OrderAttendeeDto], description: 'Exactly one named person per requested ticket' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => OrderAttendeeDto)
  attendees!: OrderAttendeeDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  attendanceRevision?: number;

  @ApiPropertyOptional({ description: 'A promo code to redeem, case-insensitive' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  promoCode?: string;

  @ApiProperty({ type: [OrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  // One line per type: two lines of six each passed a limit of ten (B85).
  @ArrayUnique((line: OrderLineDto) => line?.ticketTypeId, { message: 'items: list each ticket type once, with its quantity' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  buyerName!: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(200)
  buyerEmail!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  buyerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({ enum: PaymentProvider, description: 'Omit for a free event' })
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;

  @ApiPropertyOptional({ description: 'Where the bank returns the payer; a page of the Aveline app' })
  @IsOptional()
  @OnAppOrigin()
  @MaxLength(300)
  returnUrl?: string;

  @ApiProperty({ description: 'Caller-supplied; makes a double-tapped checkout safe' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey!: string;
}
