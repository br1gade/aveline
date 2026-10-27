import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentActor,
  OrganizationScope,
  RequestActor,
  RequirePermission,
} from '../../infra/auth/actor';
import { CreateOrganizationDto, RenameOrganizationDto, MembershipPageQuery, ChangeOrganizationMemberDto, OrganizationRevisionDto, TransferOrganizationOwnerDto } from './dto/organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  // Any signed-in account may create its own tenant: this is the step between
  // registering and being able to do anything, so it requires no permission —
  // there is no organization to hold one in yet.
  @Post()
  @ApiOperation({
    summary: 'Create your organization',
    description: 'One per account. The caller becomes its OWNER.',
  })
  create(@CurrentActor() actor: RequestActor, @Body() dto: CreateOrganizationDto, @Headers('idempotency-key') key?: string) {
    return this.organizations.create(actor.userId, dto, key);
  }

  @RequirePermission('event:read')
  @OrganizationScope()
  @Get('current')
  @ApiOperation({ summary: 'Your organization, its plan and its counts' })
  current(@CurrentActor() actor: RequestActor) {
    return this.organizations.current(actor.organizationId ?? '');
  }

  @RequirePermission('member:manage')
  @OrganizationScope()
  @Patch('current')
  @ApiOperation({ summary: 'Rename your organization' })
  rename(@CurrentActor() actor: RequestActor, @Body() dto: RenameOrganizationDto) {
    return this.organizations.rename(actor.organizationId ?? '', dto, actor);
  }

  @OrganizationScope()
  @RequirePermission('member:manage')
  @Get('current/members')
  @ApiOperation({ summary: 'List organization members without contacts' })
  members(@CurrentActor() actor: RequestActor, @Query() query: MembershipPageQuery) {
    return this.organizations.members(actor.organizationId!, query);
  }

  @OrganizationScope()
  @RequirePermission('member:manage')
  @Patch('current/members/:userId')
  @ApiOperation({ summary: 'Change an organization member role' })
  changeMember(@CurrentActor() actor: RequestActor, @Param('userId') userId: string, @Body() dto: ChangeOrganizationMemberDto) {
    return this.organizations.changeMember(actor.organizationId!, actor, { userId, ...dto });
  }

  @OrganizationScope()
  @RequirePermission('member:manage')
  @Delete('current/members/:userId')
  @ApiOperation({ summary: 'Remove all customer access in this organization' })
  removeMember(@CurrentActor() actor: RequestActor, @Param('userId') userId: string, @Query() dto: OrganizationRevisionDto) {
    return this.organizations.removeMember(actor.organizationId!, actor, { userId, ...dto });
  }

  @OrganizationScope()
  @Post('current/leave')
  @ApiOperation({ summary: 'Leave this organization after required ownership handovers' })
  leave(@CurrentActor() actor: RequestActor, @Body() dto: OrganizationRevisionDto) {
    return this.organizations.removeMember(actor.organizationId!, actor, { userId: actor.userId, ...dto });
  }

  @OrganizationScope()
  @RequirePermission('member:manage')
  @Post('current/owner-transfers')
  @ApiOperation({ summary: 'Promote an active member to owner; caller stays owner' })
  transferOwner(@CurrentActor() actor: RequestActor, @Body() dto: TransferOrganizationOwnerDto) {
    return this.organizations.transferOwner(actor.organizationId!, actor, dto);
  }
}
