import { Body, Controller, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../infra/auth/actor';
import { HostRsvpDto } from './dto/host-rsvp.dto';
import { HostRsvpService } from './host-rsvp.service';

@ApiTags('rsvp')
@Controller('events/:eventId/guests/:guestId/rsvp')
export class HostRsvpController {
  constructor(private readonly hostRsvp: HostRsvpService) {}

  @RequirePermission('guest:write')
  @Patch()
  @ApiOperation({
    summary: "Record a guest's answer for them",
    description:
      'For answers phoned in or given in person. Omitted fields are unchanged; required ' +
      'questions are not enforced; the guest is not messaged unless notifyGuest is true.',
  })
  record(@Param('eventId') eventId: string, @Param('guestId') guestId: string, @Body() dto: HostRsvpDto) {
    return this.hostRsvp.record(eventId, guestId, dto);
  }
}
