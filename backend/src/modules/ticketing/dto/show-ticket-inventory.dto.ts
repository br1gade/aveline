import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class TicketSelectionDto {
  @ApiProperty()
  @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/)
  sectionKey!: string;

  @ApiPropertyOptional({ description: 'Required for a numbered section' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  seatId?: string;
}

class ShowTicketOfferDto {
  @ApiProperty()
  @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/)
  sectionKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  ticketTypeId!: string;
}

class BlockedShowSeatDto {
  @ApiProperty()
  @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/)
  sectionKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  row!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  seat!: string;
}

export class PublishShowTicketInventoryDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  venueId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  layoutVersionId!: string;

  @ApiProperty({ type: [ShowTicketOfferDto], maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ShowTicketOfferDto)
  offers!: ShowTicketOfferDto[];

  @ApiPropertyOptional({ type: [BlockedShowSeatDto], maxItems: 5000 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => BlockedShowSeatDto)
  blockedSeats?: BlockedShowSeatDto[];
}
