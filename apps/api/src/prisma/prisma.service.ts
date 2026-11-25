import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@azzurro/db';

/** Thin wrapper so Prisma is injectable and closed on shutdown. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient = createPrismaClient();
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
