import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { actorCan, CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { LinkTicketGuestDto, RegisterTicketAttendeeDto } from './dto/reconcile-attendee.dto';
import { TicketAttendeesService } from './ticket-attendees.service';

@ApiTags('ticketing')
@Controller('events/:eventId')
export class TicketAttendeesController {
  constructor(private readonly attendees: TicketAttendeesService) {}

  @Get('ticket-orders/:orderId')
  @RequirePermission('guest:read')
  @ApiOperation({ summary: 'Review named attendees and ticket links; contacts/codes require contact permission' })
  findOrder(@Param('eventId') eventId: string, @Param('orderId') orderId: string, @CurrentActor() actor: RequestActor) {
    return this.attendees.findOrder(eventId, orderId, actorCan(actor, 'guest:contact:read'));
  }

  @Post('tickets/:ticketId/attendee')
  @RequirePermission('guest:write')
  @ApiOperation({ summary: 'Register an explicitly supplied attendee for an unlinked legacy ticket' })
  register(@Param('eventId') eventId: string, @Param('ticketId') ticketId: string, @Body() dto: RegisterTicketAttendeeDto) {
    return this.attendees.register(eventId, ticketId, dto);
  }

  @Post('tickets/:ticketId/link-guest')
  @RequirePermission('guest:write')
  @ApiOperation({ summary: 'Explicitly link an existing invited guest, preserving their answers' })
  link(@Param('eventId') eventId: string, @Param('ticketId') ticketId: string, @Body() dto: LinkTicketGuestDto) {
    return this.attendees.linkGuest(eventId, ticketId, dto);
  }
}
