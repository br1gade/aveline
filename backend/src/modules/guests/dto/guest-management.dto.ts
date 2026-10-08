import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GuestAttribution } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AddGuestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: 'hy' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({ enum: GuestAttribution })
  @IsOptional()
  @IsEnum(GuestAttribution)
  attribution?: GuestAttribution;

  @ApiPropertyOptional({
    description: 'Join an existing household. Omitted creates a new one for this guest.',
  })
  @IsOptional()
  @IsString()
  householdId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 20,
    description: 'Seats for a new household. Ignored when joining an existing one.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  seatsAllotted?: number;
}

/** Omitted means "leave as is". An empty string clears email or phone. */
export class UpdateGuestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ description: 'An empty string removes it' })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ description: 'An empty string removes it' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({ enum: GuestAttribution })
  @IsOptional()
  @IsEnum(GuestAttribution)
  attribution?: GuestAttribution;

  @ApiPropertyOptional({ description: 'Move the guest to another household on this event' })
  @IsOptional()
  @IsString()
  householdId?: string;
}

export class UpdateHouseholdDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  seatsAllotted?: number;
}
