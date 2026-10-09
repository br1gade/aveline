import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateOrganizationDto } from './organization.dto';
import { NormalizedEmail } from '../../../common/normalized-email';

export class OpenForCustomerDto extends CreateOrganizationDto {
  @ApiProperty({ description: 'The customer, invited as owner; they set their own password' })
  @NormalizedEmail()
  @IsEmail()
  @MaxLength(200)
  ownerEmail!: string;
}

export class FindOrganizationsQuery {
  @ApiPropertyOptional({ description: 'Part of the name, any case' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;
}
