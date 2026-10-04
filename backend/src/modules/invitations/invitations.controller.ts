import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrangementService } from './arrangement.service';
import { ArrangeBlocksDto } from './dto/arrange-blocks.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly arrangement: ArrangementService,
  ) {}

  @Get(':slug')
  @ApiOperation({ summary: 'Public invitation page payload (cached per slug and locale)' })
  @ApiOkResponse({ description: 'Hydrated, locale-resolved invitation' })
  getBySlug(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.invitations.getCachedInvitation(slug, locale);
  }

  @Patch(':slug/arrangement')
  @ApiOperation({
    summary: 'Reorder, toggle and re-variant every block in one atomic request',
    description:
      'Display order is the array order. Rejected arrangements change nothing.',
  })
  arrange(@Param('slug') slug: string, @Body() dto: ArrangeBlocksDto) {
    return this.arrangement.arrange(slug, dto);
  }

  @Get(':slug/g/:guestToken')
  @ApiOperation({ summary: 'Invitation personalized for one guest' })
  getForGuest(@Param('slug') slug: string, @Param('guestToken') guestToken: string) {
    return this.invitations.getPublicInvitation(slug, guestToken);
  }
}
