import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OptionalQuery } from '../../common/openapi-document';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SubmitRsvpDto } from './dto/submit-rsvp.dto';
import { RsvpService } from './rsvp.service';
import { Public } from '../../infra/auth/actor';
import { GUEST_PAGE_LIMITS } from '../../infra/auth/throttler.guard';

@ApiTags('rsvp')
@Controller('invitations/:slug/g/:guestToken/rsvp')
export class RsvpController {
  constructor(private readonly rsvp: RsvpService) {}

  // A guest responds with no account; the token in the URL is the proof.
  // The read shares the guest-page allowance: the client's server renderer
  // reads it for every personal page it serves, all from one address.
  @Public()
  @Throttle(GUEST_PAGE_LIMITS)
  @Get()
  @OptionalQuery('locale', 'The page language, for venue names; negotiated as the personal page does')
  @ApiOperation({ summary: "Read a guest's current response" })
  get(@Param('slug') slug: string, @Param('guestToken') guestToken: string, @Query('locale') locale?: string) {
    return this.rsvp.getForGuest(slug, guestToken, locale);
  }

  @Public()
  @Post()
  @ApiOperation({ summary: 'Submit or update a response' })
  submit(
    @Param('slug') slug: string,
    @Param('guestToken') guestToken: string,
    @Body() dto: SubmitRsvpDto,
  ) {
    return this.rsvp.submit(slug, guestToken, dto);
  }
}
