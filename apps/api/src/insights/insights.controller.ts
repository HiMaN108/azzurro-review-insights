import { Controller, Get, Query } from '@nestjs/common';
import { todayInSydney, weekRange } from '@azzurro/shared';
import { RangeFilterDto } from '../common/filters.dto.js';
import { resolveRange } from '../common/range.js';
import { InsightsService } from './insights.service.js';

@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** Topic breakdown for a range (default: current week) compared with the previous equal-length range. */
  @Get('topics')
  topics(@Query() q: RangeFilterDto) {
    const range = q.from || q.to ? resolveRange(q.from, q.to) : weekRange(todayInSydney());
    return this.insights.topics(range, q.properties);
  }
}
