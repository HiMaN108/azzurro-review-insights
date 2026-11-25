/**
 * Usage:
 *   pnpm scrape                       # incremental, all properties
 *   pnpm scrape --full                # walk every page (first load / backfill)
 *   pnpm scrape --property olympic-paddington --strategy dom
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CollectorCoreModule } from '../collector/collector-core.module.js';
import { CollectorService } from '../collector/collector.service.js';
import type { StrategyName } from '../collector/collector.types.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: [path.resolve(process.cwd(), '../../.env'), '.env'] }), PrismaModule, CollectorCoreModule],
})
class ScrapeCliModule {}

const { values } = parseArgs({
  options: {
    full: { type: 'boolean', default: false },
    property: { type: 'string', multiple: true },
    strategy: { type: 'string' },
  },
});
if (values.strategy && !['graphql', 'dom'].includes(values.strategy)) {
  console.error('--strategy must be graphql or dom');
  process.exit(2);
}

const app = await NestFactory.createApplicationContext(ScrapeCliModule, { logger: ['log', 'warn', 'error'] });
app.enableShutdownHooks();
try {
  const results = await app.get(CollectorService).collectAll({
    full: values.full,
    slugs: values.property,
    strategy: values.strategy as StrategyName | undefined,
  });
  console.table(results.map(({ property, status, strategy, pagesFetched, reviewsSeen, reviewsNew, reviewsUpdated, rejected }) => ({ property, status, strategy, pagesFetched, reviewsSeen, reviewsNew, reviewsUpdated, rejected })));
  process.exitCode = results.some((r) => r.status === 'FAILED') ? 1 : 0;
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await app.close();
}
