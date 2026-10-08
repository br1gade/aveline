import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountService } from '../../infra/auth/account.service';
import { CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { InviteToEventDto } from '../../infra/auth/dto/account.dto';
import { ChangeRoleDto } from './dto/team.dto';
import { TeamService } from './team.service';

/** Bringing people onto one event — a coordinator, a designer, someone on the door. */
@ApiTags('events')
@Controller('events/:eventId/team')
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly accounts: AccountService,
  ) {}

  @RequirePermission('member:manage')
  @Get()
  @ApiOperation({ summary: "This event's team, and the invitations still open" })
  list(@Param('eventId') eventId: string) {
    return this.team.list(eventId);
  }

  @RequirePermission('member:manage')
  @Post('invites')
  @ApiOperation({
    summary: 'Invite someone to work on this event',
    description: 'They get this event and nothing else in the organization. Re-inviting replaces the link.',
  })
  invite(@Param('eventId') eventId: string, @CurrentActor() actor: RequestActor, @Body() dto: InviteToEventDto) {
    return this.accounts.inviteToEvent(eventId, actor.userId, dto);
  }

  @RequirePermission('member:manage')
  @Delete('invites/:email')
  @ApiOperation({ summary: 'Withdraw an invitation that has not been accepted' })
  revokeInvite(@Param('eventId') eventId: string, @Param('email') email: string) {
    return this.accounts.revokeEventInvite(eventId, email);
  }

  @RequirePermission('member:manage')
  @Patch(':userId')
  @ApiOperation({ summary: "Change someone's role", description: 'Takes effect on their next request.' })
  changeRole(@Param('eventId') eventId: string, @Param('userId') userId: string, @Body() dto: ChangeRoleDto) {
    return this.team.changeRole(eventId, userId, dto.role);
  }

  @RequirePermission('member:manage')
  @Delete(':userId')
  @ApiOperation({ summary: 'Take someone off the team', description: 'They lose access at once.' })
  remove(@Param('eventId') eventId: string, @Param('userId') userId: string) {
    return this.team.remove(eventId, userId);
  }
}
