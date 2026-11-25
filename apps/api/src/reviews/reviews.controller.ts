import { Controller, Get, Query } from '@nestjs/common';
import { ReviewsQueryDto } from '../common/filters.dto.js';
import { ReviewsService } from './reviews.service.js';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Query() q: ReviewsQueryDto) {
    return this.reviews.list(q);
  }
}
