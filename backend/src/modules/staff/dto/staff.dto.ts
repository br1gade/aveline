import { ApiProperty } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import { IsEmail, IsIn, MaxLength } from 'class-validator';
import { NormalizedEmail } from '../../../common/normalized-email';

/** The roles that make an account Aveline staff; `NONE` is every customer. */
export const STAFF_ROLES = [PlatformRole.ADMIN, PlatformRole.SUPPORT] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export class GrantStaffRoleDto {
  @ApiProperty({ description: 'The address the person registered with', example: 'ani@aveline.am' })
  @NormalizedEmail()
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty({ enum: STAFF_ROLES })
  @IsIn(STAFF_ROLES)
  role!: StaffRole;
}
