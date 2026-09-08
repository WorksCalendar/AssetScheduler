/** Shapes returned by the home server. See ../../server/src/store.js. */

export interface Member {
  id: string;
  displayName: string;
  color: string;
  ntfyTopic: string;
  sortOrder: number;
  rev: number;
}

/**
 * One instance of an event on the calendar.
 *
 * `start` and `end` are HOUSEHOLD WALL-CLOCK strings (`2026-09-08T16:00`), not
 * instants. Practice at 4pm is at 4pm whether the phone reading this is at home
 * or in another timezone, which is the behaviour a family wants and the reason
 * these are strings rather than Dates on the wire.
 */
export interface Occurrence {
  id: string;
  seriesId: string;
  recurrenceId: string;
  title: string;
  notes: string;
  location: string;
  category: string;
  start: string;
  end: string;
  allDay: boolean;
  memberIds: string[];
  reminders: number[];
  recurring: boolean;
  rrule: string;
  repeatText: string;
  overridden: boolean;
  rev: number;
}

/** The stored event behind one or many occurrences. */
export interface Series {
  id: string;
  title: string;
  notes: string;
  location: string;
  category: string;
  start: string;
  end: string;
  allDay: boolean;
  rrule: string;
  exdates: string[];
  memberIds: string[];
  reminders: number[];
  rev: number;
  deleted: boolean;
}

/** What an edit to a recurring event is supposed to mean. */
export type EditScope = 'this' | 'following' | 'all';

export interface EventDraft {
  id?: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  notes: string;
  memberIds: string[];
  reminders: number[];
  rrule: string;
}

/** Where the app is currently reading from. */
export type Connection =
  | { kind: 'home'; rev: number }
  | { kind: 'mirror'; note: string }
  | { kind: 'cache'; since: string }
  | { kind: 'connecting' }
  | { kind: 'offline'; message: string };
