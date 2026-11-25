import { Controller, Get } from '@nestjs/common';
import { TOPICS } from '@azzurro/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller()
export class PropertiesController {
  constructor(private readonly prisma: PrismaService) {}

  /** The hotels with Booking's latest headline score and category sub-scores. */
  @Get('properties')
  async list() {
    const props = await this.prisma.client.property.findMany({
      orderBy: { name: 'asc' },
      select: {
        slug: true,
        name: true,
        bookingUrl: true,
        _count: { select: { reviews: true } },
        snapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
      },
    });
    return props.map(({ snapshots, _count, ...p }) => ({
      ...p,
      storedReviews: _count.reviews,
      booking: snapshots[0]
        ? { overallScore: snapshots[0].overallScore === null ? null : Number(snapshots[0].overallScore), reviewCount: snapshots[0].reviewCount, subScores: snapshots[0].subScores, capturedAt: snapshots[0].capturedAt }
        : null,
    }));
  }

  /** Topic taxonomy (labels, descriptions, keywords) so the UI can explain the methodology. */
  @Get('topics')
  topics() {
    return TOPICS;
  }
}
