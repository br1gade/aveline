import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
    const gate = await this.runtimeCompatibility.findUnique({ where: { id: 'organization-context' } });
    if (!gate || gate.minimumRevision > 2) throw new Error('Unsupported organization schema revision');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
