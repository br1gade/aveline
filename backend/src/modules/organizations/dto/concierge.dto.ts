import { MessageStatus, OrganizationRole, OrgKind } from '@prisma/client';
import { ConciergeRelationship } from '../concierge-relationship';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, Matches, IsInt, Min, Max } from 'class-validator';
import { CreateOrganizationDto } from './organization.dto';
import { NormalizedEmail } from '../../../common/normalized-email';

export class OpenForCustomerDto extends CreateOrganizationDto {
  @ApiProperty({ description: 'The customer, invited as owner; they set their own password' })
  @NormalizedEmail()
  @IsEmail()
  @MaxLength(200)
  ownerEmail!: string;
  @ApiPropertyOptional({ minLength: 1, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  organizationId?: string;
}

export class FindOrganizationsQuery {
  @ApiPropertyOptional({ description: 'Part of the name, any case' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;
}

export class ResolveCustomerOrganizationsDto {
  @ApiProperty({ description: 'Customer email; staff-only resolution' })
  @NormalizedEmail()
  @IsEmail()
  @MaxLength(200)
  ownerEmail!: string;
  @ApiPropertyOptional({ type: 'integer', default: 50, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 50;
  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;
}

export class ConciergeOrganizationDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: OrgKind })
  kind!: OrgKind;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class ConciergeCustomerMatchDto extends ConciergeOrganizationDto {
  @ApiProperty({ enum: ConciergeRelationship, enumName: 'ConciergeRelationship' })
  relationship!: ConciergeRelationship;
}

export class ConciergeCustomerPageDto {
  @ApiProperty({ type: [ConciergeCustomerMatchDto] })
  items!: ConciergeCustomerMatchDto[];
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

class ConciergeOwnerInviteDto {
  @ApiProperty()
  sent!: boolean;
  @ApiProperty()
  email!: string;
  @ApiProperty({ enum: OrganizationRole })
  role!: OrganizationRole;
  @ApiProperty()
  invitationId!: string;
  @ApiProperty({ type: String, nullable: true })
  messageId!: string | null;
  @ApiProperty({ enum: MessageStatus, nullable: true })
  messageStatus!: MessageStatus | null;
  @ApiPropertyOptional({ description: 'Development only' })
  devLink?: string;
}

export class OpenForCustomerResponseDto {
  @ApiProperty({ type: ConciergeOrganizationDto })
  organization!: ConciergeOrganizationDto;
  @ApiProperty({ type: ConciergeOwnerInviteDto, nullable: true })
  invite!: ConciergeOwnerInviteDto | null;
  @ApiProperty()
  isExisting!: boolean;
  @ApiPropertyOptional({ enum: ConciergeRelationship, enumName: 'ConciergeRelationship', description: 'Present when an existing organization is reused' })
  relationship?: ConciergeRelationship;
}
