import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GUEST_PAGE_LIMITS } from '../../infra/auth/throttler.guard';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrangementService } from './arrangement.service';
import { ArrangeBlocksDto } from './dto/arrange-blocks.dto';
import { InvitationsService } from './invitations.service';
import { EventScope, Public, RequirePermission } from '../../infra/auth/actor';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly arrangement: ArrangementService,
  ) {}

  // The capability link IS the credential — see docs/ACCESS_CONTROL.md §1.
  @Public()
  @Throttle(GUEST_PAGE_LIMITS)
  @Get(':slug')
  @ApiOperation({ summary: 'Public invitation page payload (cached per slug and locale)' })
  @ApiOkResponse({ description: 'Hydrated, locale-resolved invitation' })
  getBySlug(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.invitations.getCachedInvitation(slug, locale);
  }

  @RequirePermission('invitation:design')
  @EventScope('invitationSlug')
  @Patch(':slug/arrangement')
  @ApiOperation({
    summary: 'Reorder, toggle and re-variant every block in one atomic request',
    description:
      'Display order is the array order. Rejected arrangements change nothing.',
  })
  arrange(@Param('slug') slug: string, @Body() dto: ArrangeBlocksDto) {
    return this.arrangement.arrange(slug, dto);
  }

  @Public()
  @Throttle(GUEST_PAGE_LIMITS)
  @Get(':slug/g/:guestToken')
  @ApiOperation({ summary: 'Invitation personalized for one guest' })
  getForGuest(
    @Param('slug') slug: string,
    @Param('guestToken') guestToken: string,
    @Query('locale') locale?: string,
  ) {
    return this.invitations.getPublicInvitation(slug, guestToken, locale);
  }
}
