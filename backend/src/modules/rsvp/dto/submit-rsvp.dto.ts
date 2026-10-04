import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GuestAttribution, RsvpStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PartyMemberDto {
  @ApiProperty()
  @IsString()
  @MaxLength(80)
  firstName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;
}

export class CustomAnswerDto {
  @ApiProperty()
  @IsString()
  questionId!: string;

  @ApiProperty({ description: 'Scalar or array, shape depends on question type' })
  value!: unknown;
}

export class SubmitRsvpDto {
  @ApiProperty({ enum: RsvpStatus })
  @IsEnum(RsvpStatus)
  status!: RsvpStatus;

  @ApiPropertyOptional({ enum: GuestAttribution, description: 'Which host invited the guest' })
  @IsOptional()
  @IsEnum(GuestAttribution)
  attribution?: GuestAttribution;

  @ApiPropertyOptional({ type: [PartyMemberDto], description: 'Additional household members' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PartyMemberDto)
  party?: PartyMemberDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  dietary?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  dietaryNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  drinkPreference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  songRequest?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({ type: [CustomAnswerDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomAnswerDto)
  answers?: CustomAnswerDto[];
}
