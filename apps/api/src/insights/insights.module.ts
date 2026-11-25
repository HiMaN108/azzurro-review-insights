import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';

/** GET /insights/topics — topic share of complaints/praise + plain-English insight sentences. */
@Module({ controllers: [InsightsController], providers: [InsightsService], exports: [InsightsService] })
export class InsightsModule {}
