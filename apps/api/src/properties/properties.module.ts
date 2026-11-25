import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller.js';

/** GET /properties, GET /topics */
@Module({ controllers: [PropertiesController] })
export class PropertiesModule {}
