/**
 * Usage:
 *   pnpm classify               keyword tags for untagged reviews
 *   pnpm classify --all         re-tag everything with keywords (after editing the taxonomy)
 *   pnpm classify --ai          AI tags, newest first, within the free-tier budget (needs LLM_API_KEY)
 *   pnpm classify --ai --limit 50
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ClassifierModule } from '../classifier/classifier.module.js';
import { AiClassifierService } from '../classifier/ai-classifier.service.js';
import { ClassifierService } from '../classifier/classifier.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: [path.resolve(process.cwd(), '../../.env'), '.env'] }), PrismaModule, ClassifierModule] })
class ClassifyCliModule {}

const { values } = parseArgs({ options: { all: { type: 'boolean', default: false }, ai: { type: 'boolean', default: false }, limit: { type: 'string' } } });
const app = await NestFactory.createApplicationContext(ClassifyCliModule, { logger: ['log', 'warn', 'error'] });
try {
  const res = await app.get(ClassifierService).classifyPending({ reclassifyAll: values.all });
  console.log(`Keyword-classified ${res.reviews} reviews, ${res.topics} topic mentions`);
  if (values.ai) {
    const ai = app.get(AiClassifierService);
    if (!ai.enabled) {
      console.error('AI classification is off: set LLM_API_KEY in .env (see README → AI tagging).');
      process.exitCode = 1;
    } else {
      const s = await ai.run({ limit: values.limit ? Number(values.limit) : undefined });
      console.log(`AI-tagged ${s.processed} reviews (${s.urgent} urgent), ${s.remaining} pending, stopped: ${s.stoppedReason}`);
      if (s.stoppedReason === 'error') process.exitCode = 1;
    }
  }
} finally {
  await app.close();
}
