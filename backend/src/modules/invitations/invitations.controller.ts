import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get(':slug')
  @ApiOperation({ summary: 'Public invitation page payload' })
  @ApiOkResponse({ description: 'Hydrated, locale-resolved invitation' })
  getBySlug(@Param('slug') slug: string, @Query('locale') _locale?: string) {
    return this.invitations.getPublicInvitation(slug);
  }

  @Get(':slug/g/:guestToken')
  @ApiOperation({ summary: 'Invitation personalized for one guest' })
  getForGuest(@Param('slug') slug: string, @Param('guestToken') guestToken: string) {
    return this.invitations.getPublicInvitation(slug, guestToken);
  }
}
