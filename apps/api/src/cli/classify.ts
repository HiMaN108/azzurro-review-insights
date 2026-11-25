/** Usage: pnpm classify [--all]   (--all re-tags every review, e.g. after editing the taxonomy) */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ClassifierModule } from '../classifier/classifier.module.js';
import { ClassifierService } from '../classifier/classifier.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: [path.resolve(process.cwd(), '../../.env'), '.env'] }), PrismaModule, ClassifierModule] })
class ClassifyCliModule {}

const { values } = parseArgs({ options: { all: { type: 'boolean', default: false } } });
const app = await NestFactory.createApplicationContext(ClassifyCliModule, { logger: ['log', 'warn', 'error'] });
try {
  const res = await app.get(ClassifierService).classifyPending({ reclassifyAll: values.all });
  console.log(`Classified ${res.reviews} reviews, ${res.topics} topic mentions`);
} finally {
  await app.close();
}
