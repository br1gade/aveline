import { Module } from '@nestjs/common';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';
import { CheckInService } from './check-in.service';
import { GuestImportService } from './import/guest-import.service';
import { GuestManagementController } from './guest-management.controller';
import { GuestManagementService } from './guest-management.service';

@Module({
  controllers: [GuestsController, GuestManagementController],
  providers: [GuestsService, GuestImportService, CheckInService, GuestManagementService],
  exports: [GuestsService, GuestImportService, CheckInService],
})
export class GuestsModule {}
