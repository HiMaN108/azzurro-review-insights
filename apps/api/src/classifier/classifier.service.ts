import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { classifyKeywords, KEYWORD_CLASSIFIER_VERSION } from './keyword.classifier.js';

const BATCH = 500;

@Injectable()
export class ClassifierService {
  private readonly log = new Logger(ClassifierService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tags every review that has not been classified with the current classifier version.
   * Idempotent: re-running after a taxonomy change (bump KEYWORD_CLASSIFIER_VERSION) re-tags all.
   */
  async classifyPending({ reclassifyAll = false } = {}): Promise<{ reviews: number; topics: number }> {
    const db = this.prisma.client;
    if (reclassifyAll) {
      await db.$transaction([db.reviewTopic.deleteMany({ where: { method: 'KEYWORD' } }), db.review.updateMany({ data: { classifiedAt: null } })]);
    }
    let reviews = 0;
    let topics = 0;
    for (;;) {
      const batch = await db.review.findMany({
        where: { OR: [{ classifiedAt: null }, { classifierVersion: { not: KEYWORD_CLASSIFIER_VERSION } }] },
        select: { id: true, title: true, positiveText: true, negativeText: true },
        take: BATCH,
      });
      if (!batch.length) break;
      const rows = batch.flatMap((r) =>
        classifyKeywords(r.positiveText, r.negativeText, r.title).map((h) => ({
          reviewId: r.id,
          topic: h.topic,
          polarity: h.polarity,
          method: 'KEYWORD' as const,
          confidence: h.confidence,
          evidence: h.evidence,
          classifierVersion: KEYWORD_CLASSIFIER_VERSION,
        })),
      );
      const ids = batch.map((r) => r.id);
      await db.$transaction([
        db.reviewTopic.deleteMany({ where: { reviewId: { in: ids }, method: 'KEYWORD' } }),
        db.reviewTopic.createMany({ data: rows, skipDuplicates: true }),
        db.review.updateMany({ where: { id: { in: ids } }, data: { classifiedAt: new Date(), classifierVersion: KEYWORD_CLASSIFIER_VERSION } }),
      ]);
      reviews += batch.length;
      topics += rows.length;
    }
    if (reviews) this.log.log(`Classified ${reviews} reviews → ${topics} topic mentions`);
    return { reviews, topics };
  }
}
