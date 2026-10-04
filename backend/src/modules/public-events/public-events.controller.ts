import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicEventsService } from './public-events.service';

@ApiTags('public-events')
@Controller('public/events')
export class PublicEventsController {
  constructor(private readonly publicEvents: PublicEventsService) {}

  @Get()
  @ApiOperation({ summary: 'Browse published public events' })
  list(
    @Query('locale') locale?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ) {
    return this.publicEvents.list({ locale, category, limit: limit ? Number(limit) : undefined });
  }

  @Get(':slug')
  @ApiOperation({
    summary: 'One announcement, with ticket availability and preview metadata',
  })
  findOne(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.publicEvents.findBySlug(slug, locale);
  }
}
