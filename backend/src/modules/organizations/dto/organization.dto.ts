import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { OrganizationRole, OrgKind } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength, IsInt, Min, Max, Matches, IsIn } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Petrosyan Wedding' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ enum: OrgKind, description: 'HOST for a couple, PLANNER for a planner, CORPORATE for a company' })
  @IsOptional()
  @IsEnum(OrgKind)
  kind?: OrgKind;
}

export class RenameOrganizationDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;
}

export class MembershipPageQuery {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;
}
export class OrganizationRevisionDto {
  @ApiProperty({ minimum: 0, maximum: 2147483647 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  expectedRevision!: number;
}
export class ChangeOrganizationMemberDto extends OrganizationRevisionDto {
  @ApiProperty({ enum: OrganizationRole })
  @IsEnum(OrganizationRole)
  role!: OrganizationRole;
}
export class TransferOrganizationOwnerDto extends OrganizationRevisionDto {
  @ApiProperty({ minLength: 1, maxLength: 64 })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  successorUserId!: string;
}
export class ResolveOrganizationReviewDto extends OrganizationRevisionDto {
  @ApiProperty({ enum: ['HANDOVER', 'CLOSE', 'DECLINE'] })
  @IsIn(['HANDOVER', 'CLOSE', 'DECLINE'])
  decision!: 'HANDOVER' | 'CLOSE' | 'DECLINE';
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  successorUserId?: string;
}
