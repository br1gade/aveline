import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GuestAttribution, RsvpStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsIn,
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

  // The shape depends on the question, so it is checked against the question
  // in the service. It still needs a decorator: without one the global
  // whitelist treated it as an unknown property and refused every answer.
  @ApiProperty({
    description:
      'TEXT/LONG_TEXT: a string. BOOLEAN: true or false. SINGLE_CHOICE: the position ' +
      'of the chosen option (0-based). MULTI_CHOICE: a list of positions.',
  })
  @IsDefined()
  value!: unknown;
}

/** The answers one household member can be given by whoever holds the link. */
export const MEMBER_STATUSES = [RsvpStatus.ATTENDING, RsvpStatus.DECLINED, RsvpStatus.UNDECIDED] as const;

export class MemberAnswerDto {
  @ApiProperty({ description: 'A guest in the same household' })
  @IsString()
  guestId!: string;

  @ApiProperty({ enum: MEMBER_STATUSES })
  @IsIn(MEMBER_STATUSES)
  status!: (typeof MEMBER_STATUSES)[number];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  dietary?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  dietaryNotes?: string;

  @ApiPropertyOptional({
    type: [CustomAnswerDto],
    description: "This member's own answers to the host's questions, e.g. their meal",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CustomAnswerDto)
  answers?: CustomAnswerDto[];
}

export class SubmitRsvpDto {
  @ApiProperty({ enum: RsvpStatus })
  @IsEnum(RsvpStatus)
  status!: RsvpStatus;

  @ApiPropertyOptional({ enum: GuestAttribution, description: 'Which host invited the guest' })
  @IsOptional()
  @IsEnum(GuestAttribution)
  attribution?: GuestAttribution;

  @ApiPropertyOptional({
    type: [MemberAnswerDto],
    description: 'Answers for others already named in the household. Those left out keep their answer.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MemberAnswerDto)
  members?: MemberAnswerDto[];

  @ApiPropertyOptional({
    type: [PartyMemberDto],
    description: 'People to add to the household. A name already in it is not added again.',
  })
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
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CustomAnswerDto)
  answers?: CustomAnswerDto[];
}
