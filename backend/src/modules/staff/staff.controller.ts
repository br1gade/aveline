import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { GrantStaffRoleDto } from './dto/staff.dto';
import { StaffService } from './staff.service';

/** Aveline's own staff, managed by an admin. The first admin is made with the ops command. */
@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @RequirePermission('staff:manage')
  @Get()
  @ApiOperation({ summary: 'Every active staff account (admins only)' })
  list() {
    return this.staff.list();
  }

  @RequirePermission('staff:manage')
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Make a registered, verified account staff, or change its role (admins only)',
    description: 'Idempotent. Applies on the account\'s next request. An admin cannot change their own role.',
  })
  grant(@CurrentActor() actor: RequestActor, @Body() dto: GrantStaffRoleDto) {
    return this.staff.grant(dto.email, dto.role, actor.userId);
  }

  @RequirePermission('staff:manage')
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Return a staff account to an ordinary one (admins only)',
    description: 'Applies on the account\'s next request. An admin cannot revoke their own role.',
  })
  revoke(@CurrentActor() actor: RequestActor, @Param('userId') userId: string): Promise<void> {
    return this.staff.revoke(userId, actor.userId);
  }
}
