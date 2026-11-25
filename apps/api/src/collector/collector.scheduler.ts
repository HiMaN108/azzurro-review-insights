import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { CollectorService } from './collector.service.js';

/** Registers the collection cron from SCRAPE_CRON (Sydney time). Empty value disables it. */
@Injectable()
export class CollectorScheduler implements OnApplicationBootstrap {
  private readonly log = new Logger(CollectorScheduler.name);

  constructor(
    private readonly collector: CollectorService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap() {
    const expr = this.config.get<string>('SCRAPE_CRON')?.trim();
    if (!expr) {
      this.log.log('Scheduled collection disabled (SCRAPE_CRON empty)');
      return;
    }
    const job = CronJob.from({
      cronTime: expr,
      timeZone: 'Australia/Sydney',
      onTick: () => {
        if (this.collector.isRunning) return;
        this.collector.collectAll().catch((e) => this.log.error(`Scheduled run failed: ${(e as Error).message}`));
      },
    });
    this.registry.addCronJob('collect-reviews', job);
    job.start();
    this.log.log(`Scheduled collection: "${expr}" (Australia/Sydney)`);
  }
}
