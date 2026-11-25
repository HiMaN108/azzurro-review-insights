import { BadRequestException } from '@nestjs/common';
import { addDays, daysBetween, startOfWeek, todayInSydney, type DateRange } from '@azzurro/shared';

/** Resolve optional from/to into a validated range (default: last `defaultWeeks` full+current weeks). */
export function resolveRange(from?: string, to?: string, defaultWeeks = 12): DateRange {
  const today = todayInSydney();
  const end = to ?? addDays(startOfWeek(today), 6);
  const start = from ?? addDays(startOfWeek(end), -7 * (defaultWeeks - 1));
  if (start > end) throw new BadRequestException('from must be on or before to');
  if (daysBetween(start, end) > 366 * 5) throw new BadRequestException('Range too large (max 5 years)');
  return { from: start, to: end };
}
