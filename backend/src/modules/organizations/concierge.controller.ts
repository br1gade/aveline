import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { CreateEventDto } from '../events/dto/create-event.dto';
import { ConciergeService } from './concierge.service';
import { FindOrganizationsQuery, OpenForCustomerDto } from './dto/concierge.dto';

/** Aveline staff setting events up for customers, then handing them over. */
@ApiTags('concierge')
@Controller('concierge/organizations')
export class ConciergeController {
  constructor(private readonly concierge: ConciergeService) {}

  @RequirePermission('concierge:manage')
  @Post()
  @ApiOperation({
    summary: "Open a customer's organization and invite them as its owner (Aveline staff)",
    description: 'Staff do not become members; the customer sets their own password on accepting.',
  })
  open(@CurrentActor() actor: RequestActor, @Body() dto: OpenForCustomerDto) {
    return this.concierge.openForCustomer(actor.userId, dto);
  }

  @RequirePermission('concierge:manage')
  @Post(':organizationId/events')
  @ApiOperation({
    summary: "Create an event in a customer's organization (Aveline staff)",
    description: 'Staff design and run it through their platform role; the customer owns it once they accept.',
  })
  createEvent(
    @Param('organizationId') organizationId: string,
    @CurrentActor() actor: RequestActor,
    @Body() dto: CreateEventDto,
  ) {
    return this.concierge.createEvent(organizationId, actor.userId, dto);
  }

  @RequirePermission('concierge:manage')
  @Get()
  @ApiOperation({ summary: "Find a customer's organization by name (Aveline staff)" })
  find(@Query() query: FindOrganizationsQuery) {
    return this.concierge.find(query.search);
  }
}
