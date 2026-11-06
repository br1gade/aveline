import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountService } from './account.service';
import { CurrentActor, RequestActor } from './actor';

@ApiTags('auth')
@Controller('me')
export class MeController {
  constructor(private readonly accounts: AccountService) {}
  @Get()
  @ApiOperation({ summary: 'Your account identity and email verification state; no credentials' })
  current(@CurrentActor() actor: RequestActor) {
    return this.accounts.currentIdentity(actor.userId);
  }
}
