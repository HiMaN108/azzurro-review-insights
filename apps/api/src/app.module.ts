import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import path from 'node:path';
import { PrismaModule } from './prisma/prisma.module.js';
import { LlmModule } from './llm/llm.module.js';
import { HealthController } from './health/health.controller.js';
import { PropertiesModule } from './properties/properties.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { InsightsModule } from './insights/insights.module.js';
import { ClassifierModule } from './classifier/classifier.module.js';
import { CollectorModule } from './collector/collector.module.js';
import { AskModule } from './ask/ask.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(process.cwd(), '../../.env'), '.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    LlmModule,
    PropertiesModule,
    ReviewsModule,
    MetricsModule,
    InsightsModule,
    ClassifierModule,
    CollectorModule,
    AskModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
