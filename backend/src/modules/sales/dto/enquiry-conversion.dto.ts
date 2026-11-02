import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { CreateOrganizationDto } from '../../organizations/dto/organization.dto';
import { CreateEventDto } from '../../events/dto/create-event.dto';
import { NormalizedEmail } from '../../../common/normalized-email';
import { EnquiryRevisionDto } from './enquiry.dto';

export class EnquiryOwnerSetupDto extends CreateOrganizationDto {
  @ApiProperty() @NormalizedEmail() @IsEmail() @MaxLength(200)
  ownerEmail!: string;
  @ApiPropertyOptional({ enum: ['INDEPENDENT', 'PRIMARY_CONTACT'] }) @IsOptional() @IsIn(['INDEPENDENT', 'PRIMARY_CONTACT'])
  ownerEmailSource?: 'INDEPENDENT' | 'PRIMARY_CONTACT';
}
export class EnquiryOrganizationTargetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128)
  existingId?: string;
  @ApiPropertyOptional({ type: () => EnquiryOwnerSetupDto }) @ValidateIf((value: EnquiryOrganizationTargetDto) => value.create !== undefined) @IsObject() @ValidateNested() @Type(() => EnquiryOwnerSetupDto)
  create?: EnquiryOwnerSetupDto;
}
export class EnquiryEventTargetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128)
  existingId?: string;
  @ApiPropertyOptional({ type: () => CreateEventDto }) @ValidateIf((value: EnquiryEventTargetDto) => value.create !== undefined) @IsObject() @ValidateNested() @Type(() => CreateEventDto)
  create?: CreateEventDto;
}
export class ConvertEnquiryDto extends EnquiryRevisionDto {
  @ApiProperty({ type: () => EnquiryOrganizationTargetDto }) @IsObject() @ValidateNested() @Type(() => EnquiryOrganizationTargetDto)
  organization!: EnquiryOrganizationTargetDto;
  @ApiPropertyOptional({ type: () => EnquiryEventTargetDto }) @ValidateIf((value: ConvertEnquiryDto) => value.event !== undefined) @IsObject() @ValidateNested() @Type(() => EnquiryEventTargetDto)
  event?: EnquiryEventTargetDto;
}
