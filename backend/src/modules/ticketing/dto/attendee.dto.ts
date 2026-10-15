import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RsvpStatus } from '@prisma/client';
import { MEMBER_STATUSES, PartyMemberDto } from '../../rsvp/dto/submit-rsvp.dto';
import { Trimmed } from '../../../common/trimmed';

export class OrderAttendeeDto extends PartyMemberDto {
  @ApiPropertyOptional({ enum: MEMBER_STATUSES, description: 'Defaults to ATTENDING in event-wide mode; omit and supply venueAttendance in per-venue mode' })
  declare status?: RsvpStatus;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  ticketTypeId!: string;

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
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({ description: 'Explicit household grouping within this order only; omit to keep people separate' })
  @IsOptional()
  @IsString()
  @Trimmed()
  @MinLength(1)
  @MaxLength(60)
  householdKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  drinkPreference?: string;
}
