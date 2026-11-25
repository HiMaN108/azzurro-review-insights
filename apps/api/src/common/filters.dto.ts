import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(value) ? value : undefined;

/** Filters shared by every dashboard endpoint. Dates are Sydney-local YYYY-MM-DD, inclusive. */
export class RangeFilterDto {
  @IsOptional() @Matches(DATE, { message: 'from must be YYYY-MM-DD' }) from?: string;
  @IsOptional() @Matches(DATE, { message: 'to must be YYYY-MM-DD' }) to?: string;
  /** Comma-separated property slugs. Empty = all. */
  @IsOptional() @Transform(csv) @IsString({ each: true }) properties?: string[];
}

export class WeekQueryDto {
  /** Any date inside the week of interest (default: today, Sydney). */
  @IsOptional() @Matches(DATE) week?: string;
  @IsOptional() @Transform(csv) @IsString({ each: true }) properties?: string[];
}

export class TrendsQueryDto extends RangeFilterDto {
  @IsOptional() @IsIn(['week', 'month']) granularity?: 'week' | 'month';
}

export const SENTIMENTS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as const;
export const SORTS = ['newest', 'oldest', 'lowest', 'highest'] as const;

export class ReviewsQueryDto extends RangeFilterDto {
  @IsOptional() @IsIn(SENTIMENTS) sentiment?: (typeof SENTIMENTS)[number];
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsIn(['POSITIVE', 'NEGATIVE']) polarity?: 'POSITIVE' | 'NEGATIVE';
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsIn(SORTS) sort?: (typeof SORTS)[number];
  @IsOptional() @Transform(({ value }) => (value === undefined ? undefined : value === 'true'))
  hasResponse?: boolean;
  @IsOptional() @Transform(({ value }) => (value === undefined ? undefined : value === 'true'))
  urgent?: boolean;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
