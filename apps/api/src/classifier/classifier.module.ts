import { Module } from '@nestjs/common';
import { AiClassifierService } from './ai-classifier.service.js';
import { ClassifierService } from './classifier.service.js';

/** Keyword classifier (always on) + optional AI classifier (when LLM_API_KEY is set). */
@Module({ providers: [ClassifierService, AiClassifierService], exports: [ClassifierService, AiClassifierService] })
export class ClassifierModule {}
