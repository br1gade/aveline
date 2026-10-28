import { ApiProperty } from '@nestjs/swagger';
import { InvitationLifetimeSource, InvitationStatus } from '@prisma/client';

/** Shared lifecycle response; guest availability is independent of status. */
export class InvitationLifecycleDto {
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: InvitationStatus }) status!: InvitationStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) expiresAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) firstPublishedAt!: Date | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Captured duration; null may mean indefinite or uncaptured legacy history.' }) lifetimeDays!: number | null;
  @ApiProperty({ enum: InvitationLifetimeSource, nullable: true }) lifetimeSource!: InvitationLifetimeSource | null;
  @ApiProperty({ type: String, nullable: true }) lifetimePlanKey!: string | null;
  @ApiProperty() isExpired!: boolean;
}
