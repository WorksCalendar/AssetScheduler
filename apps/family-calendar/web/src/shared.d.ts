/**
 * Types for the recurrence code shared with the home server.
 *
 * The implementation is plain JavaScript with JSDoc (it runs on the server with
 * no build step, which is the point), so the shapes it hands back are declared
 * here for the app's benefit.
 */
declare module '@shared/occurrences.js' {
  import type { Occurrence, Series } from './types';

  export function expandSeries(
    series: Series[],
    overrides: Array<{
      seriesId: string;
      recurrenceId: string;
      cancelled?: boolean;
      patch?: Record<string, unknown>;
      rev?: number;
      deleted?: boolean;
    }>,
    window: { from: string; to: string; memberIds?: string[] },
  ): Occurrence[];
}

declare module '@shared/recurrence.js' {
  export function describeRRule(rrule: string): string;
  export function parseRRule(rrule: string): {
    freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval: number;
    count: number | null;
    until: Date | null;
    byDay: Array<{ ordinal: number | null; day: number }> | null;
    byMonthDay: number[] | null;
    byMonth: number[] | null;
  } | null;
}

declare module '@shared/time.js' {
  export function parseWall(s: string): Date;
  export function formatWall(d: Date): string;
  export function dayKey(d: Date): string;
  export function addDays(d: Date, n: number): Date;
  export function startOfDay(d: Date): Date;
}
