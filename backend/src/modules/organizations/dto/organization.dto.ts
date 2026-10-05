import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrgKind } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Petrosyan Wedding' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ enum: OrgKind, description: 'HOST for a couple, AGENCY for a planner' })
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
