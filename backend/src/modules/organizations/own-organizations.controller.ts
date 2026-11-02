import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequestActor } from '../../infra/auth/actor';
import { MembershipPageQuery } from './dto/organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@Controller('me/organizations')
export class OwnOrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}
  @Get()
  @ApiOperation({ summary: 'Bounded own organization selector without billing or contacts' })
  list(@CurrentActor() actor: RequestActor, @Query() query: MembershipPageQuery) {
    return this.organizations.ownMemberships(actor.userId, query);
  }
}
