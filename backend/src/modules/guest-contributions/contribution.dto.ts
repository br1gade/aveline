import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AcknowledgementMethod, GalleryModerationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, Equals, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, NotContains } from 'class-validator';
import { Trimmed } from '../../common/trimmed';

export class SignAcknowledgementDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  statementVersionId!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(21)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  subjectGuestIds!: string[];

  @ApiProperty({ enum: AcknowledgementMethod })
  @IsEnum(AcknowledgementMethod)
  method!: AcknowledgementMethod;

  @ApiProperty()
  @Trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @NotContains(String.fromCharCode(0))
  signerName!: string;

  @ApiProperty({ enum: [true] })
  @Equals(true)
  isAcknowledged!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRepresentative?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  assetId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(16)
  locale!: string;
}

export class GalleryUploadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trimmed()
  @IsString()
  @MaxLength(500)
  @NotContains(String.fromCharCode(0))
  caption?: string;
}
export class ContributionPageDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;

  @ApiPropertyOptional({ description: 'Last returned item id, bound to this event and visible collection' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  after?: string;
}
export class ModerateGalleryDto {
  @ApiProperty({ enum: [GalleryModerationStatus.APPROVED, GalleryModerationStatus.REJECTED] })
  @IsIn([GalleryModerationStatus.APPROVED, GalleryModerationStatus.REJECTED])
  moderationStatus!: GalleryModerationStatus;
}
export class PrivateImageQuery {
  @ApiPropertyOptional({ enum: ['display', 'thumbnail'] })
  @IsOptional()
  @IsIn(['display', 'thumbnail'])
  variant?: 'display' | 'thumbnail';
}

export class LinkParams {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  @NotContains(String.fromCharCode(0))
  slug!: string;
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  @NotContains(String.fromCharCode(0))
  guestToken!: string;
}
export class LinkMediaParams extends LinkParams {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  @NotContains(String.fromCharCode(0))
  mediaId!: string;
}
export class LinkAcknowledgementParams extends LinkParams {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  @NotContains(String.fromCharCode(0))
  acknowledgementId!: string;
}
export class EventMediaParams {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  @NotContains(String.fromCharCode(0))
  eventId!: string;
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  @NotContains(String.fromCharCode(0))
  mediaId!: string;
}
