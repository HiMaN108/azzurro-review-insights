import { Controller, Get } from '@nestjs/common';
import { TOPICS } from '@azzurro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { pickSnapshot } from '../common/snapshot.js';

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
        snapshots: { orderBy: { capturedAt: 'desc' }, take: 20 },
      },
    });
    return props.map(({ snapshots, _count, ...p }) => ({
      ...p,
      storedReviews: _count.reviews,
      booking: pickSnapshot(snapshots),
    }));
  }

  /** Topic taxonomy (labels, descriptions, keywords) so the UI can explain the methodology. */
  @Get('topics')
  topics() {
    return TOPICS;
  }
}
