import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { VendorBriefsService } from './vendor-briefs.service';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

@Module({
  imports: [OperationsModule],
  controllers: [VendorsController],
  providers: [VendorsService, VendorBriefsService],
  exports: [VendorsService],
})
export class VendorsModule {}
