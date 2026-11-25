import { Module } from '@nestjs/common';
import { CollectorService } from './collector.service.js';

/** Collection logic only (no HTTP, no cron) — reused by the CLI. */
@Module({ providers: [CollectorService], exports: [CollectorService] })
export class CollectorCoreModule {}
