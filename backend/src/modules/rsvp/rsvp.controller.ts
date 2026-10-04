import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubmitRsvpDto } from './dto/submit-rsvp.dto';
import { RsvpService } from './rsvp.service';

@ApiTags('rsvp')
@Controller('invitations/:slug/g/:guestToken/rsvp')
export class RsvpController {
  constructor(private readonly rsvp: RsvpService) {}

  @Get()
  @ApiOperation({ summary: "Read a guest's current response" })
  get(@Param('slug') slug: string, @Param('guestToken') guestToken: string) {
    return this.rsvp.getForGuest(slug, guestToken);
  }

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
