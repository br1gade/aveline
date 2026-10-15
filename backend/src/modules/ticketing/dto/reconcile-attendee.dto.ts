import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsDefined, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { OrderAttendeeDto } from './attendee.dto';

export class RegisterTicketAttendeeDto {
  @ApiProperty({ type: OrderAttendeeDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => OrderAttendeeDto)
  attendee!: OrderAttendeeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  attendanceRevision?: number;
}

export class LinkTicketGuestDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  guestId!: string;

  @ApiProperty({ type: String, nullable: true, description: 'The guest currently linked to this ticket, or null for a legacy unlinked ticket' })
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(100)
  expectedGuestId!: string | null;

  @ApiProperty({ enum: [true], description: 'Explicitly preserve the invited guest’s answers; checkout answers remain archived' })
  @Equals(true)
  keepExistingAnswers!: true;
}
