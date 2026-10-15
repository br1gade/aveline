import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../infra/auth/actor';
import { AttendancePolicyService } from './attendance-policy.service';
import { ChangeAttendancePolicyDto, PreviewAttendancePolicyDto } from './dto/attendance-policy.dto';

@ApiTags('events')
@Controller('events/:eventId')
export class AttendancePolicyController {
  constructor(private readonly attendance: AttendancePolicyService) {}

  @RequirePermission('event:write')
  @Post('attendance-policy/preview')
  @ApiOperation({ summary: 'Preview the responses and seats affected by changing attendance mode' })
  preview(@Param('eventId') eventId: string, @Body() dto: PreviewAttendancePolicyDto) {
    return this.attendance.preview(eventId, dto.mode);
  }

  @RequirePermission('event:write')
  @Post('attendance-policy')
  @ApiOperation({ summary: 'Confirm a previewed policy change and request fresh attendance' })
  change(@Param('eventId') eventId: string, @Body() dto: ChangeAttendancePolicyDto) {
    return this.attendance.change(eventId, dto);
  }

  @RequirePermission('guest:read')
  @Get('guests/:guestId/attendance-history')
  @ApiOperation({ summary: 'Read a guest attendance history across policy revisions' })
  history(@Param('eventId') eventId: string, @Param('guestId') guestId: string) {
    return this.attendance.history(eventId, guestId);
  }
}
