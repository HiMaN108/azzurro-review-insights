import { Module } from '@nestjs/common';
import { ClassifierModule } from '../classifier/classifier.module.js';
import { CollectorService } from './collector.service.js';

/** Collection logic only (no HTTP, no cron) — reused by the CLI. */
@Module({ imports: [ClassifierModule], providers: [CollectorService], exports: [CollectorService] })
export class CollectorCoreModule {}
