import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountService } from './account.service';
import {
  CurrentActor,
  OrganizationScope,
  Public,
  RequestActor,
  RequirePermission,
} from './actor';
import { AcceptInviteDto, InviteMemberDto } from './dto/account.dto';

@ApiTags('invites')
@Controller()
export class InvitesController {
  constructor(private readonly accounts: AccountService) {}

  @RequirePermission('member:manage')
  @OrganizationScope()
  @Get('organization/invites')
  @ApiOperation({ summary: 'Pending invitations for your organization' })
  list(@CurrentActor() actor: RequestActor) {
    return this.accounts.listInvites(actor.organizationId ?? '');
  }

  @RequirePermission('member:manage')
  @OrganizationScope()
  @Post('organization/invites')
  @ApiOperation({
    summary: 'Invite someone to your organization',
    description: 'Re-inviting replaces the previous link rather than adding a second.',
  })
  invite(@CurrentActor() actor: RequestActor, @Body() dto: InviteMemberDto) {
    return this.accounts.inviteMember(actor.organizationId ?? '', actor.userId, dto);
  }

  @RequirePermission('member:manage')
  @OrganizationScope()
  @Delete('organization/invites/:email')
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  revoke(@CurrentActor() actor: RequestActor, @Param('email') email: string) {
    return this.accounts.revokeInvite(actor.organizationId ?? '', email);
  }

  @Public()
  @Post('invites/accept')
  @ApiOperation({
    summary: 'Accept an invitation',
    description: 'Creates the account when the invitee has none, in the same transaction as the membership.',
  })
  accept(@Body() dto: AcceptInviteDto) {
    return this.accounts.acceptInvite(dto);
  }

  @Public()
  @Post('event-invites/accept')
  @ApiOperation({
    summary: 'Accept an invitation to work on one event',
    description:
      'Grants the event role and nothing in the organization. An existing account must ' +
      'give its own password; otherwise one is created with the membership.',
  })
  acceptEventInvite(@Body() dto: AcceptInviteDto) {
    return this.accounts.acceptEventInvite(dto);
  }
}
