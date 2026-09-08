/**
 * Talking to the calendar.
 *
 * There are two places the events can come from, and the app tries them in
 * order:
 *
 *   1. the home server, over the LAN — the only writable one
 *   2. the Supabase mirror, when the phone is out of the house
 *
 * and one place it falls back to when neither answers: whatever was last read,
 * kept in localStorage so the calendar still opens on a train.
 */

import type { EditScope, EventDraft, Member, Occurrence, Series } from './types';

const SETTINGS_KEY = 'family-calendar.settings.v1';
const CACHE_KEY = 'family-calendar.cache.v1';

export interface Settings {
  /** Home server base URL, e.g. http://192.168.1.20:8090 */
  homeUrl: string;
  /** Optional token, when the server was started with FC_API_TOKEN. */
  apiToken: string;
  /** Which family member is holding this phone. */
  meId: string;
  /** Supabase project URL, for reading away from home. */
  supabaseUrl: string;
  /** Supabase anon key. Read-only by policy — see supabase/schema.sql. */
  supabaseAnonKey: string;
  /** ntfy server the phones subscribe through. */
  ntfyUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  // Same origin by default, which is what you get when the home server is
  // reverse-proxied in front of this app.
  homeUrl: '',
  apiToken: '',
  meId: '',
  supabaseUrl: '',
  supabaseAnonKey: '',
  ntfyUrl: 'https://ntfy.sh',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A private window with storage disabled still gets a working calendar,
    // it just forgets the settings on reload.
  }
}

export interface Snapshot {
  members: Member[];
  occurrences: Occurrence[];
  series: Series[];
  savedAt: string;
}

export function readCache(): Snapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

export function writeCache(snapshot: Snapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Over quota, most likely. The calendar works, it just will not be there
    // offline — not worth interrupting anyone about.
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function base(settings: Settings): string {
  return settings.homeUrl.replace(/\/+$/, '');
}

async function request<T>(settings: Settings, path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (settings.apiToken) headers['Authorization'] = `Bearer ${settings.apiToken}`;
  // Lets the server skip notifying whoever made the change.
  if (settings.meId) headers['X-Family-Member'] = settings.meId;

  const res = await fetch(`${base(settings)}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // Non-JSON error body; the status is all we have.
    }
    throw new HttpError(res.status, detail);
  }
  return (await res.json()) as T;
}

export async function fetchMembers(settings: Settings): Promise<Member[]> {
  const body = await request<{ members: Member[] }>(settings, '/api/members');
  return body.members;
}

export async function fetchOccurrences(
  settings: Settings,
  from: string,
  to: string,
): Promise<{ occurrences: Occurrence[]; rev: number }> {
  return request<{ occurrences: Occurrence[]; rev: number }>(
    settings,
    `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export async function fetchSeries(settings: Settings): Promise<Series[]> {
  const body = await request<{ events: Series[] }>(settings, '/api/events/series');
  return body.events;
}

export async function createEvent(settings: Settings, draft: EventDraft): Promise<void> {
  await request(settings, '/api/events', { method: 'POST', body: JSON.stringify(draft) });
}

export async function updateEvent(
  settings: Settings,
  seriesId: string,
  draft: Partial<EventDraft>,
  scope: EditScope,
  recurrenceId: string,
): Promise<void> {
  const query = new URLSearchParams({ scope });
  if (scope !== 'all') query.set('recurrenceId', recurrenceId);
  await request(settings, `/api/events/${encodeURIComponent(seriesId)}?${query}`, {
    method: 'PATCH',
    body: JSON.stringify(draft),
  });
}

export async function deleteEvent(
  settings: Settings,
  seriesId: string,
  scope: EditScope,
  recurrenceId: string,
): Promise<void> {
  const query = new URLSearchParams({ scope });
  if (scope !== 'all') query.set('recurrenceId', recurrenceId);
  await request(settings, `/api/events/${encodeURIComponent(seriesId)}?${query}`, { method: 'DELETE' });
}

export async function sendTestPush(settings: Settings, memberId: string): Promise<void> {
  await request(settings, '/api/notify/test', {
    method: 'POST',
    body: JSON.stringify({ memberId }),
  });
}

/**
 * Read the Supabase mirror.
 *
 * The mirror holds SERIES, not occurrences — expanding them is the home
 * server's job and duplicating that expansion in the browser would be a second
 * implementation to keep in step. So an away-from-home phone gets a read-only
 * view built from the series it can see, and writes wait until it is back on
 * the home network.
 */
export async function fetchMirror(
  settings: Settings,
): Promise<{ members: Member[]; series: Series[] }> {
  const url = settings.supabaseUrl.replace(/\/+$/, '');
  const headers = {
    apikey: settings.supabaseAnonKey,
    Authorization: `Bearer ${settings.supabaseAnonKey}`,
  };

  const [membersRes, eventsRes] = await Promise.all([
    fetch(`${url}/rest/v1/family_members?select=*&order=sort_order`, {
      headers,
      signal: AbortSignal.timeout(10000),
    }),
    fetch(`${url}/rest/v1/family_events?select=*&deleted=eq.false`, {
      headers,
      signal: AbortSignal.timeout(10000),
    }),
  ]);

  if (!membersRes.ok || !eventsRes.ok) {
    throw new Error(`mirror read failed (${membersRes.status}/${eventsRes.status})`);
  }

  type MirrorMember = {
    id: string; display_name: string; color: string; sort_order: number; rev: number;
  };
  type MirrorEvent = {
    id: string; title: string; notes: string; location: string; category: string;
    start_wall: string; end_wall: string; all_day: boolean; rrule: string;
    exdates: string[]; member_ids: string[]; reminders: number[]; rev: number; deleted: boolean;
  };

  const members = ((await membersRes.json()) as MirrorMember[]).map((m) => ({
    id: m.id,
    displayName: m.display_name,
    color: m.color,
    // The mirror deliberately does not carry topics — they never leave home.
    ntfyTopic: '',
    sortOrder: m.sort_order,
    rev: m.rev,
  }));

  const series = ((await eventsRes.json()) as MirrorEvent[]).map((e) => ({
    id: e.id,
    title: e.title,
    notes: e.notes ?? '',
    location: e.location ?? '',
    category: e.category ?? '',
    start: e.start_wall,
    end: e.end_wall,
    allDay: e.all_day,
    rrule: e.rrule ?? '',
    exdates: e.exdates ?? [],
    memberIds: e.member_ids ?? [],
    reminders: e.reminders ?? [],
    rev: e.rev,
    deleted: e.deleted,
  }));

  return { members, series };
}
