import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequestActor } from '../../infra/auth/actor';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @ApiOperation({
    summary: 'Register this device for push notifications',
    description: 'Idempotent by token — re-registering updates rather than duplicating.',
  })
  register(@CurrentActor() actor: RequestActor, @Body() dto: RegisterDeviceDto) {
    return this.devices.register(actor.userId, dto);
  }

  @Delete(':token')
  @ApiOperation({ summary: 'Stop sending to this device', description: 'Only a device of your own; any other is 404.' })
  async revoke(@CurrentActor() actor: RequestActor, @Param('token') token: string) {
    await this.devices.revoke(actor.userId, token);
    return { ok: true };
  }
}
