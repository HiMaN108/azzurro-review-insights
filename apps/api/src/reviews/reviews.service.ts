import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@azzurro/db';
import { rangeToUtc, TOPIC_KEYS } from '@azzurro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ReviewsQueryDto } from '../common/filters.dto.js';
import { resolveRange } from '../common/range.js';

const ORDER: Record<string, Prisma.ReviewOrderByWithRelationInput[]> = {
  newest: [{ reviewedAt: 'desc' }, { id: 'asc' }],
  oldest: [{ reviewedAt: 'asc' }, { id: 'asc' }],
  lowest: [{ score: 'asc' }, { reviewedAt: 'desc' }],
  highest: [{ score: 'desc' }, { reviewedAt: 'desc' }],
};

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ReviewsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    if (q.topic && !(TOPIC_KEYS as readonly string[]).includes(q.topic)) throw new BadRequestException(`Unknown topic ${q.topic}`);

    // Feed defaults to all time unless a range is given.
    const range = q.from || q.to ? resolveRange(q.from ?? '2000-01-01', q.to) : null;
    const where: Prisma.ReviewWhereInput = {
      ...(range ? { reviewedAt: rangeToUtc(range) } : {}),
      ...(q.properties?.length ? { property: { slug: { in: q.properties } } } : {}),
      ...(q.sentiment ? { sentiment: q.sentiment } : {}),
      ...(q.hasResponse === undefined ? {} : { propertyResponse: q.hasResponse ? { not: null } : null }),
      ...(q.topic ? { topics: { some: { topic: q.topic as Prisma.ReviewTopicWhereInput['topic'], ...(q.polarity ? { polarity: q.polarity } : {}) } } } : {}),
      ...(q.q?.trim()
        ? {
            OR: ['title', 'positiveText', 'negativeText'].map((f) => ({ [f]: { contains: q.q!.trim(), mode: 'insensitive' } })),
          }
        : {}),
    };

    const [total, items] = await this.prisma.client.$transaction([
      this.prisma.client.review.count({ where }),
      this.prisma.client.review.findMany({
        where,
        orderBy: ORDER[q.sort ?? 'newest'],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          externalId: true,
          reviewedAt: true,
          score: true,
          sentiment: true,
          title: true,
          positiveText: true,
          negativeText: true,
          language: true,
          reviewerName: true,
          reviewerCountry: true,
          travellerType: true,
          roomType: true,
          nights: true,
          checkinDate: true,
          stayMonth: true,
          propertyResponse: true,
          property: { select: { slug: true, name: true } },
          topics: { select: { topic: true, polarity: true, evidence: true }, orderBy: { topic: 'asc' } },
        },
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items: items.map((r) => ({ ...r, score: Number(r.score) })),
    };
  }
}
