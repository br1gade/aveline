import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GuestManagementService } from './guest-management.service';
import { AddGuestDto, UpdateGuestDto, UpdateHouseholdDto } from './dto/guest-management.dto';
import { RequirePermission } from '../../infra/auth/actor';

/**
 * Keeping a guest list right after it arrives. Separate from
 * `GuestsController`, which reads the list and runs the door, because these
 * are the edits — and every one of them is a change a host may later be asked
 * to account for, which the audit trail records.
 */
@ApiTags('guests')
@Controller('events/:eventId')
export class GuestManagementController {
  constructor(private readonly management: GuestManagementService) {}

  @RequirePermission('guest:write')
  @Post('guests')
  @ApiOperation({
    summary: 'Add one guest',
    description:
      'Into an existing household with a free seat, or — without householdId — ' +
      'into a new household of their own.',
  })
  add(@Param('eventId') eventId: string, @Body() dto: AddGuestDto) {
    return this.management.addGuest(eventId, dto);
  }

  @RequirePermission('guest:write')
  @Patch('guests/:guestId')
  @ApiOperation({
    summary: "Correct a guest's details, or move them to another household",
    description: 'Omitted fields are left alone; an empty email or phone clears it.',
  })
  update(
    @Param('eventId') eventId: string,
    @Param('guestId') guestId: string,
    @Body() dto: UpdateGuestDto,
  ) {
    return this.management.updateGuest(eventId, guestId, dto);
  }

  @RequirePermission('guest:write')
  @Delete('guests/:guestId')
  @ApiOperation({
    summary: 'Remove a guest',
    description:
      'Their answer and seat go with them. Refused once they have been checked in. ' +
      'A household left empty is removed too.',
  })
  remove(@Param('eventId') eventId: string, @Param('guestId') guestId: string) {
    return this.management.removeGuest(eventId, guestId);
  }

  @RequirePermission('guest:write')
  @Patch('households/:householdId')
  @ApiOperation({
    summary: 'Rename a household or change its seats',
    description: 'Seats cannot go below the number of guests already named in it.',
  })
  updateHousehold(
    @Param('eventId') eventId: string,
    @Param('householdId') householdId: string,
    @Body() dto: UpdateHouseholdDto,
  ) {
    return this.management.updateHousehold(eventId, householdId, dto);
  }
}
