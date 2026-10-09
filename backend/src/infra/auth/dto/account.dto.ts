import { ApiProperty } from '@nestjs/swagger';
import { EventRole, OrganizationRole } from '@prisma/client';
import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { NormalizedEmail } from '../../../common/normalized-email';

export class RequestPasswordResetDto {
  @ApiProperty()
  @NormalizedEmail()
  @IsEmail()
  @MaxLength(200)
  email!: string;
}

export class ConfirmPasswordResetDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  @MaxLength(200)
  token!: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  @MaxLength(200)
  token!: string;
}

export class InviteMemberDto {
  @ApiProperty()
  @NormalizedEmail()
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty({ enum: OrganizationRole })
  @IsEnum(OrganizationRole)
  role!: OrganizationRole;
}

export class InviteToEventDto {
  @ApiProperty()
  @NormalizedEmail()
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty({ enum: EventRole })
  @IsEnum(EventRole)
  role!: EventRole;
}

export class AcceptInviteDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  @MaxLength(200)
  token!: string;

  @ApiProperty({ description: 'Required when the invitee has no account yet' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;
}
