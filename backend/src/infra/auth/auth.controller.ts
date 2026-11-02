import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientContext, CurrentActor, Public, RequestActor } from './actor';
import { AccountService } from './account.service';
import { AuthService, SessionContext } from './auth.service';
import {
  ConfirmPasswordResetDto,
  RequestPasswordResetDto,
  VerifyEmailDto,
} from './dto/account.dto';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Answers 202 the same way whether or not the address already has an account; the owner of ' +
      'an existing one is emailed a way in. Does not sign in — log in next.',
  })
  register(@Body() dto: RegisterDto) {
    return this.accounts.register(dto);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Exchange credentials for a token pair' })
  login(@Body() dto: LoginDto, @ClientContext() client: SessionContext) {
    return this.auth.login(dto, client);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({
    summary: 'Rotate a refresh token for a new pair',
    description: 'The presented token is revoked, so a stolen one works at most once.',
  })
  refresh(@Body() dto: RefreshDto, @ClientContext() client: SessionContext) {
    return this.auth.refresh(dto.refreshToken, client);
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Revoke one session' })
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { ok: true };
  }

  @Public()
  @Post('password-reset')
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Always reports success, whether or not the address has an account — ' +
      'answering otherwise is an account-enumeration oracle.',
  })
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.accounts.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('password-reset/confirm')
  @ApiOperation({
    summary: 'Set a new password using a reset link',
    description: 'Revokes every existing session, since a reset is what someone does when they believe an account is compromised.',
  })
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.accounts.confirmPasswordReset(dto.token, dto.password);
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Send a verification link to the signed-in account' })
  requestEmailVerification(@CurrentActor() actor: RequestActor) {
    return this.accounts.requestEmailVerification(actor.userId);
  }

  @Public()
  @Post('verify-email/confirm')
  @ApiOperation({ summary: 'Confirm an email address' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.accounts.verifyEmail(dto.token);
  }

  @Post('logout-everywhere')
  @ApiOperation({ summary: 'Revoke every session for the signed-in account' })
  logoutEverywhere(@CurrentActor() actor: RequestActor) {
    return this.auth.revokeAllSessions(actor.userId);
  }
}
