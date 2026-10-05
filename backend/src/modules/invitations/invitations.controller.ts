import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrangementService } from './arrangement.service';
import { ArrangeBlocksDto } from './dto/arrange-blocks.dto';
import { SendInvitationDto } from './dto/send-invitation.dto';
import { InvitationsService } from './invitations.service';
import { InvitationSenderService } from './sending/invitation-sender.service';
import { ReminderService } from './sending/reminder.service';
import { EventScope, Public, RequirePermission } from '../../infra/auth/actor';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly arrangement: ArrangementService,
    private readonly sender: InvitationSenderService,
    private readonly reminders: ReminderService,
  ) {}

  // The capability link IS the credential — see docs/ACCESS_CONTROL.md §1.
  @Public()
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

  @RequirePermission('invitation:publish')
  @EventScope('invitationSlug')
  @Post(':slug/send')
  @ApiOperation({
    summary: 'Send the invitation — one email per household',
    description:
      'Safe to press twice: a guest is only invited once per invitation. ' +
      'Refused while the invitation is a draft, because the link would 404.',
  })
  send(@Param('slug') slug: string, @Body() dto: SendInvitationDto) {
    return this.sender.send(slug, dto);
  }

  @RequirePermission('invitation:publish')
  @EventScope('invitationSlug')
  @Post(':slug/remind')
  @ApiOperation({
    summary: 'Chase the households that have not answered',
    description:
      'Only guests who were actually invited and have not replied. At most ' +
      'one reminder per guest per day, so pressing twice is safe.',
  })
  remind(@Param('slug') slug: string) {
    return this.reminders.remindNow(slug);
  }

  @RequirePermission('invitation:publish')
  @EventScope('invitationSlug')
  @Post(':slug/thank-you')
  @ApiOperation({
    summary: 'Thank the guests who came',
    description:
      'Only those who actually checked in, and only once ever. Refused before ' +
      'the event, because a thank-you that arrives first cannot be unsent.',
  })
  thankAttendees(@Param('slug') slug: string) {
    return this.reminders.thankAttendees(slug);
  }

  @RequirePermission('invitation:read')
  @EventScope('invitationSlug')
  @Get(':slug/delivery')
  @ApiOperation({
    summary: 'Who has been invited, and what happened to each email',
    description: 'Grouped by household, because that is the unit a host thinks in.',
  })
  deliveryStatus(@Param('slug') slug: string) {
    return this.sender.deliveryStatus(slug);
  }

  @Public()
  @Get(':slug/g/:guestToken')
  @ApiOperation({ summary: 'Invitation personalized for one guest' })
  getForGuest(@Param('slug') slug: string, @Param('guestToken') guestToken: string) {
    return this.invitations.getPublicInvitation(slug, guestToken);
  }
}
