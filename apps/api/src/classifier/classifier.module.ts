import { Module } from '@nestjs/common';
import { ClassifierService } from './classifier.service.js';

/** Keyword classifier (transparent baseline); writes ReviewTopic rows. */
@Module({ providers: [ClassifierService], exports: [ClassifierService] })
export class ClassifierModule {}
