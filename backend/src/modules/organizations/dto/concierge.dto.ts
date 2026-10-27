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
  @ApiPropertyOptional({ default: 50, maximum: 50 })
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
