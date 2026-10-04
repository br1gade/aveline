import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { ArrangementService } from './arrangement.service';

@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService, ArrangementService],
  exports: [InvitationsService, ArrangementService],
})
export class InvitationsModule {}
