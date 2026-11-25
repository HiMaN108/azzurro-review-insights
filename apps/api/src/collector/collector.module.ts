import { Module } from '@nestjs/common';
import { CollectorCoreModule } from './collector-core.module.js';
import { CollectorController } from './collector.controller.js';
import { CollectorScheduler } from './collector.scheduler.js';

/** Playwright collector: GraphQL strategy with DOM fallback, dedupe/upsert, ScrapeRun audit, cron schedule. */
@Module({
  imports: [CollectorCoreModule],
  controllers: [CollectorController],
  providers: [CollectorScheduler],
})
export class CollectorModule {}
