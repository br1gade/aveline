import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { VendorCategory } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import {
  CurrentActor,
  OrganizationScope,
  Public,
  RequestActor,
  RequirePermission,
  actorCan,
} from '../../infra/auth/actor';
import { BookVendorDto, CreateVendorDto, UpdateBookingDto } from './dto/vendor.dto';
import { VendorBriefsService } from './vendor-briefs.service';
import { VendorsService } from './vendors.service';

class ListVendorsQuery {
  @IsOptional()
  @IsEnum(VendorCategory)
  category?: VendorCategory;
}

@ApiTags('vendors')
@Controller()
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly briefs: VendorBriefsService,
  ) {}

  @RequirePermission('vendor:read')
  @OrganizationScope()
  @Get('vendors')
  @ApiOperation({ summary: 'The partner directory, optionally by category' })
  listVendors(@Query() query: ListVendorsQuery) {
    return this.vendors.listVendors(query.category);
  }

  @RequirePermission('vendor:write')
  @OrganizationScope()
  @Post('vendors')
  @ApiOperation({ summary: 'Add a vendor to the directory' })
  createVendor(@Body() dto: CreateVendorDto) {
    return this.vendors.createVendor(dto);
  }

  @RequirePermission('vendor:read')
  @Get('events/:eventId/vendors')
  @ApiOperation({
    summary: "This event's vendors",
    description: 'Fees are included only for callers holding vendor:fee:read.',
  })
  listBookings(@CurrentActor() actor: RequestActor, @Param('eventId') eventId: string) {
    return this.vendors.listBookings(eventId, maySeeFees(actor));
  }

  @RequirePermission('vendor:write')
  @Post('events/:eventId/vendors')
  @ApiOperation({
    summary: 'Engage a vendor and mint their brief link',
    description:
      'Scopes default to the category’s usual set, so forgetting them narrows ' +
      'what the vendor sees rather than widening it.',
  })
  book(@Param('eventId') eventId: string, @Body() dto: BookVendorDto) {
    return this.vendors.book(eventId, dto);
  }

  @RequirePermission('vendor:write')
  @Patch('events/:eventId/vendors/:bookingId')
  @ApiOperation({ summary: 'Change a booking’s status, scopes or fee' })
  updateBooking(
    @Param('eventId') eventId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: UpdateBookingDto,
  ) {
    return this.vendors.updateBooking(eventId, bookingId, dto);
  }

  @RequirePermission('vendor:write')
  @Post('events/:eventId/vendors/:bookingId/rotate-brief')
  @ApiOperation({
    summary: 'Replace the brief link',
    description: 'The only revocation a capability URL has. The old link stops working.',
  })
  rotate(@Param('eventId') eventId: string, @Param('bookingId') bookingId: string) {
    return this.vendors.rotateBriefToken(eventId, bookingId);
  }

  @RequirePermission('vendor:write')
  @Delete('events/:eventId/vendors/:bookingId')
  @ApiOperation({
    summary: 'Cancel an engagement',
    description: 'Kept as a record, with the brief link rotated so it stops working.',
  })
  cancelBooking(@Param('eventId') eventId: string, @Param('bookingId') bookingId: string) {
    return this.vendors.cancelBooking(eventId, bookingId);
  }

  // The vendor holds a link, not an account — the same capability pattern as a
  // guest invitation.
  @Public()
  @Get('briefs/:briefToken')
  @ApiOperation({
    summary: 'A vendor’s brief',
    description: 'Contains only the sections the booking lists, and says which those are.',
  })
  findBrief(@Param('briefToken') briefToken: string) {
    return this.briefs.findByToken(briefToken);
  }
}

/**
 * `vendor:fee:read` is separate from `vendor:read` so a designer or a junior
 * coordinator can work with the vendor list without seeing commercial terms.
 */
function maySeeFees(actor: RequestActor): boolean {
  return actorCan(actor, 'vendor:fee:read');
}
