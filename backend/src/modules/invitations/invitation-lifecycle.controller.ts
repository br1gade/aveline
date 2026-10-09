import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { actorCan, CurrentActor, EventScope, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { NotifyChangesDto } from './dto/notify-changes.dto';
import { SendInvitationDto } from './dto/send-invitation.dto';
import { PublishingService } from './publishing.service';
import { InvitationSenderService } from './sending/invitation-sender.service';
import { ReminderService } from './sending/reminder.service';

/**
 * What a host does with an invitation once it is designed: make it live, send
 * it, chase the people who have not answered, thank the ones who came.
 *
 * Separate from `InvitationsController`, which serves the guest-facing page.
 * The two share a URL prefix and almost nothing else — one is public and
 * cached, the other is permissioned and writes — and putting them together
 * had given one class five collaborators.
 */
@ApiTags('invitations')
@Controller('invitations')
export class InvitationLifecycleController {
  constructor(
    private readonly publishing: PublishingService,
    private readonly sender: InvitationSenderService,
    private readonly reminders: ReminderService,
  ) {}

  @RequirePermission('invitation:publish')
  @EventScope('invitationSlug')
  @Post(':slug/publish')
  @ApiOperation({
    summary: 'Make the invitation live',
    description:
      'Refused until it has an enabled RSVP block, a venue with an address, ' +
      'and a start date in the future. Every missing item is named at once.',
  })
  publish(@Param('slug') slug: string) {
    return this.publishing.publish(slug);
  }

  @RequirePermission('invitation:publish')
  @EventScope('invitationSlug')
  @Post(':slug/close')
  @ApiOperation({
    summary: 'Stop accepting responses',
    description: 'The page stays readable to guests; only new RSVPs are refused.',
  })
  close(@Param('slug') slug: string) {
    return this.publishing.close(slug);
  }

  @RequirePermission('invitation:publish')
  @EventScope('invitationSlug')
  @Post(':slug/reopen')
  @ApiOperation({ summary: 'Accept responses again after closing' })
  reopen(@Param('slug') slug: string) {
    return this.publishing.reopen(slug);
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
  @Post(':slug/notify-changes')
  @ApiOperation({
    summary: 'Tell everyone who holds the invitation that its details changed',
    description:
      'Offered after the date, time or a venue changes; never sent automatically. ' +
      'Only households the invitation reached. Pressing twice in a minute sends once.',
  })
  notifyChanges(@Param('slug') slug: string, @Body() dto: NotifyChangesDto) {
    return this.reminders.notifyDetailsChanged(slug, dto.note);
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

  // guest:read, not invitation:read: the report is every household and guest
  // by name, and a designer shapes the page without reading the guest list.
  @RequirePermission('guest:read')
  @EventScope('invitationSlug')
  @Get(':slug/delivery')
  @ApiOperation({
    summary: 'Who has been invited, and what happened to each email',
    description:
      'Grouped by household, because that is the unit a host thinks in. ' +
      'The address each went to only with guest:contact:read.',
  })
  deliveryStatus(@CurrentActor() actor: RequestActor, @Param('slug') slug: string) {
    return this.sender.deliveryStatus(slug, actorCan(actor, 'guest:contact:read'));
  }
}
