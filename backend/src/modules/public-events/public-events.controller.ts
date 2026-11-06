import { OptionalQuery } from '../../common/openapi-document';
import { Throttle } from '@nestjs/throttler';
import { GUEST_PAGE_LIMITS } from '../../infra/auth/throttler.guard';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrowsePublicEventsQuery } from './dto/browse-public-events.dto';
import { PublicEventsService } from './public-events.service';
import { Public } from '../../infra/auth/actor';

@ApiTags('public-events')
@Controller('public/events')
export class PublicEventsController {
  constructor(private readonly publicEvents: PublicEventsService) {}

  @Public()
  @Get()
  @Throttle(GUEST_PAGE_LIMITS)
  @ApiOperation({ summary: 'Browse published public events' })
  list(@Query() query: BrowsePublicEventsQuery) {
    return this.publicEvents.list(query);
  }

  @Public()
  @Get(':slug')
  @Throttle(GUEST_PAGE_LIMITS)
  @OptionalQuery('locale', 'Preferred language; the response names the one it used')
  @ApiOperation({
    summary: 'One announcement, with ticket availability and preview metadata',
  })
  findOne(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.publicEvents.findBySlug(slug, locale);
  }
}
