import { Body, Controller, Get, Headers, HttpCode, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CollectorService } from './collector.service.js';

@Controller('collector')
export class CollectorController {
  constructor(
    private readonly collector: CollectorService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Latest run per property — drives the "data last updated" indicator. */
  @Get('status')
  async status() {
    const properties = await this.prisma.client.property.findMany({
      orderBy: { name: 'asc' },
      select: {
        slug: true,
        name: true,
        runs: { orderBy: { startedAt: 'desc' }, take: 1 },
        _count: { select: { reviews: true } },
      },
    });
    const lastSuccess = await this.prisma.client.scrapeRun.groupBy({ by: ['propertyId'], where: { status: { in: ['SUCCESS', 'PARTIAL'] } }, _max: { finishedAt: true } });
    const props = await this.prisma.client.property.findMany({ select: { id: true, slug: true } });
    const successBySlug = new Map(lastSuccess.map((r) => [props.find((p) => p.id === r.propertyId)?.slug, r._max.finishedAt]));
    return {
      running: this.collector.isRunning,
      properties: properties.map((p) => ({
        slug: p.slug,
        name: p.name,
        storedReviews: p._count.reviews,
        lastSuccessfulAt: successBySlug.get(p.slug) ?? null,
        lastRun: p.runs[0] ?? null,
      })),
    };
  }

  /** Manual trigger (protected). Returns immediately; poll /collector/status. */
  @Post('run')
  @HttpCode(202)
  run(@Headers('x-admin-token') token: string | undefined, @Body() body: { full?: boolean; slugs?: string[] } = {}) {
    const expected = this.config.get<string>('ADMIN_TOKEN') ?? '';
    if (!expected || !token || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      throw new UnauthorizedException('Invalid admin token');
    }
    if (this.collector.isRunning) throw new ServiceUnavailableException('A collection run is already in progress');
    void this.collector.collectAll({ full: !!body.full, slugs: body.slugs }).catch(() => {});
    return { started: true };
  }
}
