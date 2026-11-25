import { Controller, Get, Query } from '@nestjs/common';
import { TrendsQueryDto, WeekQueryDto } from '../common/filters.dto.js';
import { resolveRange } from '../common/range.js';
import { MetricsService } from './metrics.service.js';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('overview')
  overview(@Query() q: WeekQueryDto) {
    return this.metrics.overview(q.week, q.properties);
  }

  @Get('trends')
  trends(@Query() q: TrendsQueryDto) {
    return this.metrics.trends(resolveRange(q.from, q.to), q.granularity, q.properties);
  }
}
