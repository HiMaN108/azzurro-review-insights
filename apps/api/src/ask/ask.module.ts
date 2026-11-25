import { Module } from '@nestjs/common';
import { InsightsModule } from '../insights/insights.module.js';
import { AskController } from './ask.controller.js';
import { AskService } from './ask.service.js';

/** "Ask the reviews": natural-language questions answered from the review data. */
@Module({ imports: [InsightsModule], controllers: [AskController], providers: [AskService] })
export class AskModule {}
