import { ApiProperty } from '@nestjs/swagger';
import { AttendanceMode } from '@prisma/client';
import { IsEnum, IsInt, IsUUID, Matches, Max, Min } from 'class-validator';

export class PreviewAttendancePolicyDto {
  @ApiProperty({ enum: AttendanceMode })
  @IsEnum(AttendanceMode)
  mode!: AttendanceMode;
}

export class ChangeAttendancePolicyDto extends PreviewAttendancePolicyDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedRevision!: number;

  @ApiProperty({ description: 'Fingerprint returned by the preview; stale previews are rejected' })
  @Matches(/^[a-f0-9]{32}$/)
  previewToken!: string;

  @ApiProperty({ description: 'Client UUID reused when retrying this transition' })
  @IsUUID()
  transitionId!: string;
}
