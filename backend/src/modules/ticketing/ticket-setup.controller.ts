import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TicketOrderStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { RequirePermission } from '../../infra/auth/actor';
import {
  CreateTicketTypeDto,
  UpdateTicketTypeDto,
  UpsertListingDto,
} from './dto/ticket-setup.dto';
import { TicketCancellationService } from './ticket-cancellation.service';
import { TicketSetupService } from './ticket-setup.service';

class OrderStatusQuery {
  @IsOptional()
  @IsEnum(TicketOrderStatus)
  status?: TicketOrderStatus;
}

/**
 * The host's side of a public event: what is for sale, the page that sells
 * it, and the orders that came in. Separate from `TicketingController`, which
 * is the buyer's side and mostly public.
 */
@ApiTags('ticketing')
@Controller('events/:eventId')
export class TicketSetupController {
  constructor(
    private readonly setup: TicketSetupService,
    private readonly cancellation: TicketCancellationService,
  ) {}

  @RequirePermission('event:read')
  @Get('ticket-types')
  @ApiOperation({ summary: 'What is for sale, with sold, held and available counts' })
  listTicketTypes(@Param('eventId') eventId: string) {
    return this.setup.listTicketTypes(eventId);
  }

  @RequirePermission('event:write')
  @Post('ticket-types')
  @ApiOperation({ summary: 'Put a kind of ticket on sale' })
  createTicketType(@Param('eventId') eventId: string, @Body() dto: CreateTicketTypeDto) {
    return this.setup.createTicketType(eventId, dto);
  }

  @RequirePermission('event:write')
  @Patch('ticket-types/:typeId')
  @ApiOperation({
    summary: 'Change a ticket type',
    description:
      'Price may change at any time; orders already placed keep what they paid. ' +
      'Capacity cannot go below what is already sold or held.',
  })
  updateTicketType(
    @Param('eventId') eventId: string,
    @Param('typeId') typeId: string,
    @Body() dto: UpdateTicketTypeDto,
  ) {
    return this.setup.updateTicketType(eventId, typeId, dto);
  }

  @RequirePermission('event:write')
  @Delete('ticket-types/:typeId')
  @ApiOperation({
    summary: 'Remove a ticket type nothing has been sold against',
    description: 'Refused once anything is sold or held; deactivate it instead.',
  })
  deleteTicketType(@Param('eventId') eventId: string, @Param('typeId') typeId: string) {
    return this.setup.deleteTicketType(eventId, typeId);
  }

  @RequirePermission('event:read')
  @Get('listing')
  @ApiOperation({ summary: 'The public announcement page' })
  getListing(@Param('eventId') eventId: string) {
    return this.setup.getListing(eventId);
  }

  @RequirePermission('event:write')
  @Put('listing')
  @ApiOperation({ summary: 'Create or edit the announcement page' })
  upsertListing(@Param('eventId') eventId: string, @Body() dto: UpsertListingDto) {
    return this.setup.upsertListing(eventId, dto);
  }

  @RequirePermission('event:write')
  @Post('listing/publish')
  @ApiOperation({
    summary: 'Make the announcement public',
    description: 'Refused for a private event, without a headline, or once the event has started.',
  })
  publishListing(@Param('eventId') eventId: string) {
    return this.setup.publishListing(eventId);
  }

  @RequirePermission('event:write')
  @Post('listing/unpublish')
  @ApiOperation({ summary: 'Take the announcement down; tickets already sold are unaffected' })
  unpublishListing(@Param('eventId') eventId: string) {
    return this.setup.unpublishListing(eventId);
  }

  @RequirePermission('operations:read')
  @Get('ticket-orders')
  @ApiOperation({ summary: 'Orders on this event, newest first' })
  listOrders(@Param('eventId') eventId: string, @Query() query: OrderStatusQuery) {
    return this.cancellation.listOrders(eventId, query.status);
  }

  /**
   * Money leaves the business here, so it needs the permission that governs
   * money rather than the one that governs the event.
   */
  @RequirePermission('billing:write')
  @Post('ticket-orders/:orderId/cancel')
  @ApiOperation({
    summary: 'Cancel an order and refund it',
    description:
      'Voids every ticket and refunds the payment, exactly once. Refused if any ' +
      'ticket was already admitted at the door. Safe to retry.',
  })
  cancelOrder(@Param('eventId') eventId: string, @Param('orderId') orderId: string) {
    return this.cancellation.cancel(eventId, orderId);
  }
}
