import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataSubjectRequestKind, DataSubjectRequestStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDataSubjectRequestDto {
  @ApiProperty({ enum: DataSubjectRequestKind })
  @IsEnum(DataSubjectRequestKind)
  kind!: DataSubjectRequestKind;

  @ApiProperty({ description: 'The address the data is held against' })
  @IsEmail()
  @MaxLength(200)
  subjectEmail!: string;

  @ApiPropertyOptional({ description: 'Anything the requester wants to add' })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string;
}

export class UpdateDataSubjectRequestDto {
  @ApiPropertyOptional({ enum: DataSubjectRequestStatus })
  @IsOptional()
  @IsEnum(DataSubjectRequestStatus)
  status?: DataSubjectRequestStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string;
}
