import { Module } from '@nestjs/common';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';
import { CheckInService } from './check-in.service';
import { GuestImportService } from './import/guest-import.service';

@Module({
  controllers: [GuestsController],
  providers: [GuestsService, GuestImportService, CheckInService],
  exports: [GuestsService, GuestImportService, CheckInService],
})
export class GuestsModule {}
