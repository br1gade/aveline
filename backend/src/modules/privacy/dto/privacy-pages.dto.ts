import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataSubjectRequest, DataSubjectRequestKind, DataSubjectRequestStatus, DataSubjectSource, Prisma } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CursorPageQuery } from '../../../common/cursor-pagination.dto';

export enum PrivacyQueue { OPEN = 'OPEN', CLOSED = 'CLOSED' }

export class PrivacyPageQuery extends CursorPageQuery {
  @ApiPropertyOptional({ enum: PrivacyQueue, default: PrivacyQueue.OPEN })
  @IsOptional()
  @IsEnum(PrivacyQueue)
  queue = PrivacyQueue.OPEN;

  @ApiPropertyOptional({ enum: DataSubjectRequestStatus, description: 'Narrows the selected queue' })
  @IsOptional()
  @IsEnum(DataSubjectRequestStatus)
  status?: DataSubjectRequestStatus;
}

export class PrivacyRequestRowDto implements DataSubjectRequest {
  @ApiProperty()
  id!: string;
  @ApiProperty({ enum: DataSubjectRequestKind })
  kind!: DataSubjectRequestKind;
  @ApiProperty({ enum: DataSubjectRequestStatus })
  status!: DataSubjectRequestStatus;
  @ApiProperty({ type: String, nullable: true })
  subjectEmail!: string | null;
  @ApiProperty({ enum: DataSubjectSource })
  subjectSource!: DataSubjectSource;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  enquirySubjectsVerifiedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  verifiedOwnerUserId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  ownerAccountVerifiedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  erasureAppliedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  erasureCheckpointId!: string | null;
  @ApiProperty({ oneOf: [
    { type: 'object', nullable: true, additionalProperties: true }, { type: 'array', items: {} },
    { type: 'string' }, { type: 'number' }, { type: 'boolean' },
  ] })
  erasureResult!: Prisma.JsonValue;
  @ApiProperty({ type: String, nullable: true })
  organizationId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  guestId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  userId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  requestedAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' })
  dueAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  resultAssetId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  handledByUserId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  exportGenerationId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  exportGeneratedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  exportGeneratedByUserId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  exportDeliveredByUserId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;
}

export class PrivacyPageDto {
  @ApiProperty({ type: [PrivacyRequestRowDto] })
  items!: PrivacyRequestRowDto[];
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
