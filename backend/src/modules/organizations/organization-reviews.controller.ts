import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, OrganizationScope, RequestActor } from '../../infra/auth/actor';
import { MembershipPageQuery, OrganizationRevisionDto, ResolveOrganizationReviewDto } from './dto/organization.dto';
import { OrganizationReviewsService } from './organization-reviews.service';

@ApiTags('organizations')
@Controller()
export class OrganizationReviewsController {
  constructor(private readonly reviews: OrganizationReviewsService) {}
  @Post('organizations/current/closure-reviews')
  @OrganizationScope()
  @ApiOperation({ summary: 'Request administrator closure review without removing access' })
  request(@CurrentActor() actor: RequestActor, @Body() dto: OrganizationRevisionDto) {
    return this.reviews.request(actor.organizationId!, actor, dto);
  }
  @Get('admin/organization-access-reviews')
  @ApiOperation({ summary: 'List open organization access reviews; ADMIN only' })
  list(@CurrentActor() actor: RequestActor, @Query() query: MembershipPageQuery) {
    return this.reviews.list(actor, query);
  }
  @Post('admin/organization-access-reviews/:reviewId/resolve')
  @ApiOperation({ summary: 'Resolve ownership recovery or closure; ADMIN only' })
  resolve(@CurrentActor() actor: RequestActor, @Param('reviewId') reviewId: string, @Body() dto: ResolveOrganizationReviewDto) {
    return this.reviews.resolve(actor, reviewId, dto);
  }
}
