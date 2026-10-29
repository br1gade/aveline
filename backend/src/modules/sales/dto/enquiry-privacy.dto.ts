import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataSubjectRequestKind } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsInt, Min, Max, ValidateIf, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Trimmed } from '../../../common/trimmed';

export class EnquirySubjectIdsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(128, { each: true })
  @ApiProperty({ type: [String] })
  contactIds!: string[];
}
export class CreateEnquiryPrivacyRequestDto extends EnquirySubjectIdsDto {
  @IsEnum(DataSubjectRequestKind)
  @ApiProperty({ enum: DataSubjectRequestKind })
  kind!: DataSubjectRequestKind;
  @IsOptional() @IsString() @MaxLength(2000)
  @ApiPropertyOptional({ type: String })
  notes?: string;
}
export class BindEnquirySubjectsDto extends EnquirySubjectIdsDto {
  @ApiPropertyOptional({ type: Boolean, default: false }) @ValidateIf((value: BindEnquirySubjectsDto) => value.append !== undefined) @IsBoolean()
  append?: boolean;
  @IsString() @Trimmed() @MinLength(1) @MaxLength(2000)
  @ApiProperty({ type: String })
  verificationNote!: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @MaxLength(128)
  verifiedOwnerUserId?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @Trimmed() @MinLength(1) @MaxLength(2000)
  ownerVerificationNote?: string;
}
export class EnquirySubjectCandidatesDto {
  @ApiPropertyOptional({ type: Number, default: 50, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @MaxLength(512)
  cursor?: string;
  @IsOptional() @IsEmail() @MaxLength(200)
  @ApiPropertyOptional({ type: String })
  email?: string;
  @IsOptional() @IsString() @Matches(/^\+[1-9][0-9]{6,14}$/)
  @ApiPropertyOptional({ type: String })
  phone?: string;
}
