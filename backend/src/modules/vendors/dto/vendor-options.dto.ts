import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VendorCategory } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';
import { BRIEF_SECTIONS, type BriefSection } from '../vendor-brief';

export class VendorOptionsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: VendorCategory, enumName: 'VendorCategory' })
  @IsOptional()
  @IsEnum(VendorCategory)
  category?: VendorCategory;

  @ApiPropertyOptional({ type: 'integer', minimum: 0, maximum: 10000, default: 0 })
  @IsInt()
  @Min(0)
  @Max(10000)
  declare offset?: number;
}

class VendorOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: VendorCategory, enumName: 'VendorCategory' })
  category!: VendorCategory;

  @ApiProperty()
  isCurated!: boolean;
}

class BriefSectionDto {
  @ApiProperty({ enum: BRIEF_SECTIONS, enumName: 'VendorBriefSection' })
  section!: BriefSection;

  @ApiProperty()
  purpose!: string;
}

class VendorCategoryDefaultsDto {
  @ApiProperty({ enum: VendorCategory, enumName: 'VendorCategory' })
  category!: VendorCategory;

  @ApiProperty({ enum: BRIEF_SECTIONS, enumName: 'VendorBriefSection', isArray: true })
  scopes!: BriefSection[];
}

export class VendorOptionsDto {
  @ApiProperty({ type: [VendorOptionDto] })
  items!: VendorOptionDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ type: [BriefSectionDto] })
  sections!: BriefSectionDto[];

  @ApiProperty({ type: [VendorCategoryDefaultsDto] })
  defaults!: VendorCategoryDefaultsDto[];
}
