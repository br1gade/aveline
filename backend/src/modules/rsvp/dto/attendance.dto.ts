import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RsvpStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

const ANSWER_STATUSES = [RsvpStatus.ATTENDING, RsvpStatus.DECLINED, RsvpStatus.UNDECIDED];

export class VenueAttendanceDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  venueId!: string;

  @ApiProperty({ enum: ANSWER_STATUSES })
  @IsIn(ANSWER_STATUSES)
  status!: RsvpStatus;
}

export class AttendanceAnswerDto {
  @ApiPropertyOptional({ enum: ANSWER_STATUSES, description: 'Required in event-wide mode; omit in per-venue mode' })
  @ValidateIf((answer: AttendanceAnswerDto) => answer.status !== undefined || answer.venueAttendance === undefined)
  @IsIn(ANSWER_STATUSES)
  status?: RsvpStatus;

  @ApiPropertyOptional({ type: [VenueAttendanceDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => VenueAttendanceDto)
  venueAttendance?: VenueAttendanceDto[];
}

export class AttendanceSubmissionDto extends AttendanceAnswerDto {
  @ApiPropertyOptional({ description: 'The current revision shown by the guest/host form. Mandatory after any policy change' })
  @ValidateIf((answer: AttendanceSubmissionDto) => answer.attendanceRevision !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  attendanceRevision?: number;
}
