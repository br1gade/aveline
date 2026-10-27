import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { EnquiryClosureReason, EnquirySource, EnquiryStage, EventType } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested, IsISO8601 } from 'class-validator';
import { Trimmed } from '../../../common/trimmed';

export class EnquiryContactDto {
  @IsOptional() @IsString() @Trimmed() @MinLength(1) @MaxLength(200)
  @ApiPropertyOptional({ type: String, nullable: true })
  name?: string | null;
  @IsOptional() @IsEmail() @MaxLength(200)
  @ApiPropertyOptional({ type: String, nullable: true })
  email?: string | null;
  @IsOptional() @IsString() @Matches(/^\+[1-9][0-9]{6,14}$/)
  @ApiPropertyOptional({ type: String, nullable: true })
  phone?: string | null;
}

export class EnquiryRequirementsDto {
  @IsOptional() @IsEnum(EventType)
  @ApiPropertyOptional({ enum: EventType, nullable: true })
  eventType?: EventType | null;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true })
  @ApiPropertyOptional({ type: String, nullable: true })
  approximateLocalDate?: string | null;
  @IsOptional() @IsString() @MaxLength(64)
  @ApiPropertyOptional({ type: String, nullable: true })
  approximateTimezone?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100000)
  @ApiPropertyOptional({ type: Number, nullable: true })
  estimatedGuestCount?: number | null;
}

export class CreateEnquiryDto {
  @IsObject() @ValidateNested() @Type(() => EnquiryContactDto)
  @ApiProperty({ type: () => EnquiryContactDto })
  contact!: EnquiryContactDto;
  @ValidateIf((value: CreateEnquiryDto) => value.requirements !== undefined) @IsObject() @ValidateNested() @Type(() => EnquiryRequirementsDto)
  @ApiPropertyOptional({ type: () => EnquiryRequirementsDto })
  requirements?: EnquiryRequirementsDto;
  @IsOptional() @IsIn(['en', 'ru', 'fr', 'hy'])
  @ApiPropertyOptional({ type: String, nullable: true })
  preferredLocale?: string | null;
  @IsOptional() @IsEnum(EnquirySource)
  @ApiPropertyOptional({ enum: EnquirySource, nullable: true })
  source?: EnquirySource | null;
  @IsOptional() @IsString() @MaxLength(128)
  @ApiPropertyOptional({ type: String, nullable: true })
  assignedUserId?: string | null;
}

export class EnquiryRevisionDto {
  @IsInt() @Min(1)
  @ApiProperty({ type: Number })
  expectedRevision!: number;
}

export class UpdateEnquiryDto extends EnquiryRevisionDto {
  @ValidateIf((value: UpdateEnquiryDto) => value.contact !== undefined) @IsObject() @ValidateNested() @Type(() => EnquiryContactDto)
  @ApiPropertyOptional({ type: () => EnquiryContactDto })
  contact?: EnquiryContactDto;
  @ValidateIf((value: UpdateEnquiryDto) => value.requirements !== undefined) @IsObject() @ValidateNested() @Type(() => EnquiryRequirementsDto)
  @ApiPropertyOptional({ type: () => EnquiryRequirementsDto })
  requirements?: EnquiryRequirementsDto;
  @IsOptional() @IsIn(['en', 'ru', 'fr', 'hy'])
  @ApiPropertyOptional({ type: String, nullable: true })
  preferredLocale?: string | null;
  @IsOptional() @IsEnum(EnquirySource)
  @ApiPropertyOptional({ enum: EnquirySource, nullable: true })
  source?: EnquirySource | null;
}

export class AssignEnquiryDto extends EnquiryRevisionDto {
  @ValidateIf((value: AssignEnquiryDto) => value.assignedUserId !== null) @IsString() @MinLength(1) @MaxLength(128)
  @ApiProperty({ type: String, nullable: true })
  assignedUserId!: string | null;
}

export class StageEnquiryDto extends EnquiryRevisionDto {
  @IsEnum(EnquiryStage)
  @ApiProperty({ enum: EnquiryStage })
  stage!: EnquiryStage;
  @IsOptional() @IsEnum(EnquiryClosureReason)
  @ApiPropertyOptional({ enum: EnquiryClosureReason })
  closureReason?: EnquiryClosureReason;
  @IsOptional() @IsString() @Trimmed() @MaxLength(2000)
  @ApiPropertyOptional({ type: String, nullable: true })
  closureNote?: string | null;
}

export class EnquiryNoteDto extends EnquiryRevisionDto {
  @IsString() @Trimmed() @MinLength(1) @MaxLength(10000)
  @ApiProperty({ type: String })
  body!: string;
  @IsOptional() @IsString() @MaxLength(128)
  @ApiPropertyOptional({ type: String })
  consultationId?: string;
}

export class EnquiryPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  @ApiPropertyOptional({ type: Number })
  limit?: number;
  @IsOptional() @IsString() @MaxLength(512)
  @ApiPropertyOptional({ type: String })
  cursor?: string;
}

export class EnquiryQueueDto extends EnquiryPageDto {
  @IsOptional() @IsEnum(EnquiryStage)
  @ApiPropertyOptional({ enum: EnquiryStage })
  stage?: EnquiryStage;
  @IsOptional() @IsString() @Trimmed() @MaxLength(200)
  @ApiPropertyOptional({ type: String })
  search?: string;
}
