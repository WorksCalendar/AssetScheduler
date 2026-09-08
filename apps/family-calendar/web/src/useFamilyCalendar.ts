import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { expandSeries } from '@shared/occurrences.js';
import { addDays, formatWall, startOfDay } from '@shared/time.js';

import {
  createEvent as apiCreate,
  deleteEvent as apiDelete,
  fetchMembers,
  fetchMirror,
  fetchOccurrences,
  fetchSeries,
  loadSettings,
  readCache,
  saveSettings,
  updateEvent as apiUpdate,
  writeCache,
  type Settings,
} from './api';
import type { Connection, EditScope, EventDraft, Member, Occurrence, Series } from './types';

/** How far either side of today to keep loaded, so ordinary month-to-month
 *  navigation never waits on the network. */
const WINDOW_BEHIND_DAYS = 60;
const WINDOW_AHEAD_DAYS = 270;

/** How often to ask the home server whether anything changed. The question is
 *  a few bytes; the answer is usually "no". */
const POLL_MS = 20_000;

export interface FamilyCalendar {
  settings: Settings;
  updateSettings: (next: Settings) => void;
  members: Member[];
  occurrences: Occurrence[];
  series: Series[];
  connection: Connection;
  /** Whether writes are possible right now — only on the home server. */
  canEdit: boolean;
  visibleMemberIds: string[];
  toggleMember: (id: string) => void;
  showAllMembers: () => void;
  refresh: () => Promise<void>;
  saveEvent: (draft: EventDraft, scope: EditScope, recurrenceId: string) => Promise<void>;
  removeEvent: (seriesId: string, scope: EditScope, recurrenceId: string) => Promise<void>;
  error: string | null;
  dismissError: () => void;
}

export function useFamilyCalendar(): FamilyCalendar {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [members, setMembers] = useState<Member[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [connection, setConnection] = useState<Connection>({ kind: 'connecting' });
  const [visibleMemberIds, setVisibleMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The last revision seen from the home server. Polling compares against it
  // so an unchanged calendar costs one small response instead of a reload.
  const revRef = useRef(-1);

  const range = useMemo(() => {
    const today = startOfDay(new Date());
    return {
      from: formatWall(addDays(today, -WINDOW_BEHIND_DAYS)),
      to: formatWall(addDays(today, WINDOW_AHEAD_DAYS)),
    };
  }, []);

  const applySnapshot = useCallback(
    (next: { members: Member[]; occurrences: Occurrence[]; series: Series[] }) => {
      setMembers(next.members);
      setOccurrences(next.occurrences);
      setSeries(next.series);
      writeCache({ ...next, savedAt: new Date().toISOString() });
    },
    [],
  );

  /** Read the home server. Throws if it cannot be reached. */
  const loadFromHome = useCallback(async () => {
    const [memberList, events, seriesList] = await Promise.all([
      fetchMembers(settings),
      fetchOccurrences(settings, range.from, range.to),
      fetchSeries(settings),
    ]);
    revRef.current = events.rev;
    applySnapshot({ members: memberList, occurrences: events.occurrences, series: seriesList });
    setConnection({ kind: 'home', rev: events.rev });
  }, [settings, range, applySnapshot]);

  /** Read the Supabase mirror and expand it with the server's own code. */
  const loadFromMirror = useCallback(async () => {
    const { members: memberList, series: seriesList } = await fetchMirror(settings);
    const expanded = expandSeries(seriesList, [], range);
    revRef.current = -1;
    applySnapshot({ members: memberList, occurrences: expanded, series: seriesList });
    setConnection({ kind: 'mirror', note: 'Away from home — showing the cloud copy. Edits need home wifi.' });
  }, [settings, range, applySnapshot]);

  const refresh = useCallback(async () => {
    try {
      await loadFromHome();
      setError(null);
      return;
    } catch (homeErr) {
      if (settings.supabaseUrl && settings.supabaseAnonKey) {
        try {
          await loadFromMirror();
          setError(null);
          return;
        } catch {
          // Fall through to the cache; the mirror being unreachable too means
          // this phone has no network at all, which the cache is there for.
        }
      }

      const cached = readCache();
      if (cached) {
        setMembers(cached.members);
        setOccurrences(cached.occurrences);
        setSeries(cached.series);
        setConnection({ kind: 'cache', since: cached.savedAt });
        return;
      }

      const message = homeErr instanceof Error ? homeErr.message : String(homeErr);
      setConnection({ kind: 'offline', message });
    }
  }, [loadFromHome, loadFromMirror, settings.supabaseUrl, settings.supabaseAnonKey]);

  // First load, and again whenever the connection settings change.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the member filter in step with who exists, without clobbering a
  // filter the user has set.
  useEffect(() => {
    setVisibleMemberIds((current) => {
      if (current.length === 0) return members.map((m) => m.id);
      const known = new Set(members.map((m) => m.id));
      const kept = current.filter((id) => known.has(id));
      return kept.length === 0 ? members.map((m) => m.id) : kept;
    });
  }, [members]);

  // Poll for changes. Cheap: the server answers with a revision number and,
  // when nothing has moved, nothing else.
  useEffect(() => {
    if (connection.kind !== 'home') return undefined;

    const handle = setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const base = settings.homeUrl.replace(/\/+$/, '');
        const headers: Record<string, string> = {};
        if (settings.apiToken) headers['Authorization'] = `Bearer ${settings.apiToken}`;
        const res = await fetch(`${base}/api/changes?since_rev=${revRef.current}`, {
          headers,
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return;
        const body = (await res.json()) as { rev: number };
        if (body.rev > revRef.current) await loadFromHome();
      } catch {
        // A poll that fails is not worth reporting; the next one will try
        // again, and a real outage shows up when the user acts.
      }
    }, POLL_MS);

    return () => clearInterval(handle);
  }, [connection.kind, settings.homeUrl, settings.apiToken, loadFromHome]);

  const updateSettings = useCallback((next: Settings) => {
    saveSettings(next);
    setSettings(next);
    revRef.current = -1;
  }, []);

  const toggleMember = useCallback((id: string) => {
    setVisibleMemberIds((current) =>
      current.includes(id) ? current.filter((m) => m !== id) : [...current, id],
    );
  }, []);

  const showAllMembers = useCallback(() => {
    setVisibleMemberIds(members.map((m) => m.id));
  }, [members]);

  const saveEvent = useCallback(
    async (draft: EventDraft, scope: EditScope, recurrenceId: string) => {
      try {
        if (draft.id) {
          await apiUpdate(settings, draft.id, draft, scope, recurrenceId);
        } else {
          await apiCreate(settings, draft);
        }
        await loadFromHome();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [settings, loadFromHome],
  );

  const removeEvent = useCallback(
    async (seriesId: string, scope: EditScope, recurrenceId: string) => {
      try {
        await apiDelete(settings, seriesId, scope, recurrenceId);
        await loadFromHome();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [settings, loadFromHome],
  );

  const visible = useMemo(() => {
    if (visibleMemberIds.length === 0 || visibleMemberIds.length === members.length) return occurrences;
    const wanted = new Set(visibleMemberIds);
    return occurrences.filter((o) =>
      // An event with nobody named is the whole household's, so it survives
      // every filter rather than disappearing when you focus on one person.
      o.memberIds.length === 0 || o.memberIds.some((m) => wanted.has(m)),
    );
  }, [occurrences, visibleMemberIds, members.length]);

  return {
    settings,
    updateSettings,
    members,
    occurrences: visible,
    series,
    connection,
    canEdit: connection.kind === 'home',
    visibleMemberIds,
    toggleMember,
    showAllMembers,
    refresh,
    saveEvent,
    removeEvent,
    error,
    dismissError: () => setError(null),
  };
}
