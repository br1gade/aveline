import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataSubjectRequestKind } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
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
  @IsString() @Trimmed() @MinLength(1) @MaxLength(2000)
  @ApiProperty({ type: String })
  verificationNote!: string;
}
export class EnquirySubjectCandidatesDto {
  @IsOptional() @IsEmail() @MaxLength(200)
  @ApiPropertyOptional({ type: String })
  email?: string;
  @IsOptional() @IsString() @Matches(/^\+[1-9][0-9]{6,14}$/)
  @ApiPropertyOptional({ type: String })
  phone?: string;
}
