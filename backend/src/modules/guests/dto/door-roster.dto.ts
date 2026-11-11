import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RsvpStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../common/dto/pagination.dto';

export class DoorRosterQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;
}

export class DoorSeatDto {
  @ApiProperty({ type: String, nullable: true }) venue!: string | null;
  @ApiProperty() table!: string;
  @ApiProperty({ type: Number, nullable: true }) position!: number | null;
}

export class DoorGuestDto {
  @ApiProperty() guestId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() householdName!: string;
  @ApiProperty({ type: [DoorSeatDto] }) seating!: DoorSeatDto[];
  @ApiProperty({ enum: RsvpStatus }) attendance!: RsvpStatus;
  @ApiProperty({ type: Date, nullable: true }) arrivedAt!: Date | null;
  @ApiProperty() hasTicket!: boolean;
  @ApiProperty({ description: 'The guest was erased: show them, but offer no check-in or agreement' }) isErased!: boolean;
}

export class DoorRosterDto {
  @ApiProperty({ type: [DoorGuestDto] }) items!: DoorGuestDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
