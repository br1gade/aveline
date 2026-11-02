import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { requireReaderCompatibility } from './reader-compatibility';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
    await requireReaderCompatibility(this);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
