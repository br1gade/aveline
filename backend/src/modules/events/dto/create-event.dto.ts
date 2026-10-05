import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventType, EventVisibility } from '@prisma/client';
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

export class CreateEventDto {
  @ApiProperty({ enum: EventType })
  @IsEnum(EventType)
  type!: EventType;

  @ApiProperty({ example: 'Anna & Davit' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({
    description: 'Shown on the invitation. Defaults to the title.',
    example: 'Anna & Davit',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  hostsLabel?: string;

  @ApiProperty({ description: 'When it starts, ISO 8601' })
  @IsISO8601()
  startsAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @ApiPropertyOptional({ default: 'Asia/Yerevan', description: 'IANA zone' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ isArray: true, type: String, example: ['hy', 'en'] })
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

  @ApiPropertyOptional({ description: 'Label for one side, e.g. "Bride"' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sideALabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sideBLabel?: string;

  @ApiPropertyOptional({ enum: EventVisibility, default: EventVisibility.PRIVATE })
  @IsOptional()
  @IsEnum(EventVisibility)
  visibility?: EventVisibility;

  @ApiPropertyOptional({
    description:
      "A template key from GET /events/:id/design-templates. Omitted picks the " +
      'first active template, so an event always comes with a draft invitation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  templateKey?: string;
}
