import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConsultationStatus } from '@prisma/client';
import { IsEnum, IsInt, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsIsoTimestamp } from '../../../common/iso-timestamp';
import { EnquiryRevisionDto } from './enquiry.dto';

const OFFSET_TIME = /T.*(?:Z|[+-]\d{2}:\d{2})$/;
export class CreateConsultationDto extends EnquiryRevisionDto {
  @IsString() @MaxLength(128)
  @ApiProperty({ type: String })
  operatorUserId!: string;
  @IsIsoTimestamp() @Matches(OFFSET_TIME)
  @ApiProperty({ type: String })
  startsAt!: string;
  @IsIsoTimestamp() @Matches(OFFSET_TIME)
  @ApiProperty({ type: String })
  endsAt!: string;
  @IsString() @MaxLength(64)
  @ApiProperty({ type: String })
  timezone!: string;
}
export class UpdateConsultationDto extends EnquiryRevisionDto {
  @IsInt() @Min(1)
  @ApiProperty({ type: Number })
  expectedConsultationRevision!: number;
  @ValidateIf((value: UpdateConsultationDto) => value.operatorUserId !== undefined) @IsString() @MaxLength(128)
  @ApiPropertyOptional({ type: String })
  operatorUserId?: string;
  @ValidateIf((value: UpdateConsultationDto) => value.startsAt !== undefined) @IsIsoTimestamp() @Matches(OFFSET_TIME)
  @ApiPropertyOptional({ type: String })
  startsAt?: string;
  @ValidateIf((value: UpdateConsultationDto) => value.endsAt !== undefined) @IsIsoTimestamp() @Matches(OFFSET_TIME)
  @ApiPropertyOptional({ type: String })
  endsAt?: string;
  @ValidateIf((value: UpdateConsultationDto) => value.timezone !== undefined) @IsString() @MaxLength(64)
  @ApiPropertyOptional({ type: String })
  timezone?: string;
  @ValidateIf((value: UpdateConsultationDto) => value.status !== undefined) @IsEnum(ConsultationStatus)
  @ApiPropertyOptional({ enum: ConsultationStatus })
  status?: ConsultationStatus;
}
export class ConsultationAvailabilityDto {
  @IsString() @MaxLength(128)
  @ApiProperty({ type: String })
  operatorUserId!: string;
  @IsIsoTimestamp() @Matches(OFFSET_TIME)
  @ApiProperty({ type: String })
  from!: string;
  @IsIsoTimestamp() @Matches(OFFSET_TIME)
  @ApiProperty({ type: String })
  to!: string;
}
