import { Type } from 'class-transformer';
import { EnquiryClosureReason, EnquirySource, EnquiryStage, EventType } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested, IsISO8601 } from 'class-validator';
import { Trimmed } from '../../../common/trimmed';

export class EnquiryContactDto {
  @IsOptional() @IsString() @Trimmed() @MinLength(1) @MaxLength(200)
  name?: string | null;
  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string | null;
  @IsOptional() @IsString() @Matches(/^\+[1-9][0-9]{6,14}$/)
  phone?: string | null;
}

export class EnquiryRequirementsDto {
  @IsOptional() @IsEnum(EventType)
  eventType?: EventType | null;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true })
  approximateLocalDate?: string | null;
  @IsOptional() @IsString() @MaxLength(64)
  approximateTimezone?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100000)
  estimatedGuestCount?: number | null;
}

export class CreateEnquiryDto {
  @IsObject() @ValidateNested() @Type(() => EnquiryContactDto)
  contact!: EnquiryContactDto;
  @ValidateIf((value: CreateEnquiryDto) => value.requirements !== undefined) @IsObject() @ValidateNested() @Type(() => EnquiryRequirementsDto)
  requirements?: EnquiryRequirementsDto;
  @IsOptional() @IsIn(['en', 'ru', 'fr', 'hy'])
  preferredLocale?: string | null;
  @IsOptional() @IsEnum(EnquirySource)
  source?: EnquirySource | null;
  @IsOptional() @IsString() @MaxLength(128)
  assignedUserId?: string | null;
}

export class EnquiryRevisionDto {
  @IsInt() @Min(1)
  expectedRevision!: number;
}

export class UpdateEnquiryDto extends EnquiryRevisionDto {
  @ValidateIf((value: UpdateEnquiryDto) => value.contact !== undefined) @IsObject() @ValidateNested() @Type(() => EnquiryContactDto)
  contact?: EnquiryContactDto;
  @ValidateIf((value: UpdateEnquiryDto) => value.requirements !== undefined) @IsObject() @ValidateNested() @Type(() => EnquiryRequirementsDto)
  requirements?: EnquiryRequirementsDto;
  @IsOptional() @IsIn(['en', 'ru', 'fr', 'hy'])
  preferredLocale?: string | null;
  @IsOptional() @IsEnum(EnquirySource)
  source?: EnquirySource | null;
}

export class AssignEnquiryDto extends EnquiryRevisionDto {
  @ValidateIf((value: AssignEnquiryDto) => value.assignedUserId !== null) @IsString() @MinLength(1) @MaxLength(128)
  assignedUserId!: string | null;
}

export class StageEnquiryDto extends EnquiryRevisionDto {
  @IsEnum(EnquiryStage)
  stage!: EnquiryStage;
  @IsOptional() @IsEnum(EnquiryClosureReason)
  closureReason?: EnquiryClosureReason;
  @IsOptional() @IsString() @Trimmed() @MaxLength(2000)
  closureNote?: string | null;
}

export class EnquiryNoteDto extends EnquiryRevisionDto {
  @IsString() @Trimmed() @MinLength(1) @MaxLength(10000)
  body!: string;
  @IsOptional() @IsString() @MaxLength(128)
  consultationId?: string;
}

export class EnquiryPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
  @IsOptional() @IsString() @MaxLength(512)
  cursor?: string;
}

export class EnquiryQueueDto extends EnquiryPageDto {
  @IsOptional() @IsEnum(EnquiryStage)
  stage?: EnquiryStage;
  @IsOptional() @IsString() @Trimmed() @MaxLength(200)
  search?: string;
}
