import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import type { Request } from 'express';
import { AskService } from './ask.service.js';

class AskDto {
  @IsString() @Length(3, 500, { message: 'Please write a question between 3 and 500 characters.' }) question!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsString({ each: true })
  properties?: string[];
}

@Controller('ask')
export class AskController {
  constructor(private readonly ask: AskService) {}

  /** Ask a question about the reviews. Cached per question + filters per day; rate-limited per client. */
  @Post()
  create(@Body() body: AskDto, @Req() req: Request) {
    return this.ask.ask(body, req.ip ?? 'unknown');
  }

  @Get('history')
  history(@Query('limit') limit?: string) {
    return this.ask.history(Number(limit) || 10);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.ask.get(id);
  }
}
