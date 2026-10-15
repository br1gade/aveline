import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildPrivateStorage, PRIVATE_STORAGE, PrivateStorageService } from './private-storage';

@Module({
  providers: [{ provide: PRIVATE_STORAGE, inject: [ConfigService], useFactory: buildPrivateStorage }, PrivateStorageService],
  exports: [PrivateStorageService],
})
export class PrivateStorageModule {}
