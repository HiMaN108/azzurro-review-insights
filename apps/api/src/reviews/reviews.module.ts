import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

/** GET /reviews — paginated feed with property/date/sentiment/topic/search filters. */
@Module({ controllers: [ReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}
