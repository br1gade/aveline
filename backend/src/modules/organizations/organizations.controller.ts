import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentActor,
  OrganizationScope,
  RequestActor,
  RequirePermission,
} from '../../infra/auth/actor';
import { CreateOrganizationDto, RenameOrganizationDto } from './dto/organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  // Any signed-in account may create its own tenant: this is the step between
  // registering and being able to do anything, so it requires no permission —
  // there is no organization to hold one in yet.
  @OrganizationScope()
  @Post()
  @ApiOperation({
    summary: 'Create your organization',
    description: 'One per account. The caller becomes its OWNER.',
  })
  create(@CurrentActor() actor: RequestActor, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(actor.userId, dto);
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
    return this.organizations.rename(actor.organizationId ?? '', dto);
  }
}
