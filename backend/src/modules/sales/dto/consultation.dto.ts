import { ConsultationStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { IsIsoTimestamp } from '../../../common/iso-timestamp';
import { EnquiryRevisionDto } from './enquiry.dto';

const OFFSET_TIME = /T.*(?:Z|[+-]\d{2}:\d{2})$/;
export class CreateConsultationDto extends EnquiryRevisionDto {
  @IsString() @MaxLength(128)
  operatorUserId!: string;
  @IsIsoTimestamp() @Matches(OFFSET_TIME)
  startsAt!: string;
  @IsIsoTimestamp() @Matches(OFFSET_TIME)
  endsAt!: string;
  @IsString() @MaxLength(64)
  timezone!: string;
}
export class UpdateConsultationDto extends EnquiryRevisionDto {
  @IsInt() @Min(1)
  expectedConsultationRevision!: number;
  @IsOptional() @IsString() @MaxLength(128)
  operatorUserId?: string;
  @IsOptional() @IsIsoTimestamp() @Matches(OFFSET_TIME)
  startsAt?: string;
  @IsOptional() @IsIsoTimestamp() @Matches(OFFSET_TIME)
  endsAt?: string;
  @IsOptional() @IsString() @MaxLength(64)
  timezone?: string;
  @IsOptional() @IsEnum(ConsultationStatus)
  status?: ConsultationStatus;
}
export class ConsultationAvailabilityDto {
  @IsString() @MaxLength(128)
  operatorUserId!: string;
  @IsIsoTimestamp() @Matches(OFFSET_TIME)
  from!: string;
  @IsIsoTimestamp() @Matches(OFFSET_TIME)
  to!: string;
}
