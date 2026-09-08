import { useCallback, useMemo, useState } from 'react';
import { WorksCalendar } from 'works-calendar';
import type { WorksCalendarEvent } from 'works-calendar';
import 'works-calendar/styles';

import { EventDialog } from './EventDialog';
import { MemberBar } from './MemberBar';
import { SettingsDialog } from './SettingsDialog';
import { useFamilyCalendar } from './useFamilyCalendar';
import type { Connection, EditScope, EventDraft, Member, Occurrence } from './types';
import './styles.css';

const CALENDAR_ID = 'family-calendar';

/** Shown on an event with nobody assigned. */
const FAMILY_COLOR = '#64748b';

/**
 * works-calendar reads its own settings from localStorage under
 * `wc-config-{calendarId}`. It ships configured for operations work — Base,
 * Assets and Dispatch tabs, an ops title — so the family-facing subset is
 * seeded here before the calendar first mounts. Seeded once: after that these
 * are the household's to change.
 */
function seedCalendarConfig(): void {
  const key = `wc-config-${CALENDAR_ID}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(
      key,
      JSON.stringify({
        title: 'Family Calendar',
        display: {
          enabledViews: ['month', 'week', 'day', 'agenda'],
          weekStartDay: 0,
          defaultView: 'month',
        },
      }),
    );
  } catch {
    // Storage disabled. The calendar still works, it just shows its stock
    // configuration.
  }
}

export function App() {
  useMemo(seedCalendarConfig, []);
  const cal = useFamilyCalendar();
  const [editing, setEditing] = useState<{ occurrence: Occurrence | null; start: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const colorOf = useCallback(
    (memberIds: string[]): string => {
      const first = cal.members.find((m) => memberIds.includes(m.id));
      return first?.color ?? FAMILY_COLOR;
    },
    [cal.members],
  );

  // The calendar component wants Dates. Household wall-clock strings have no
  // offset, so `new Date('2026-09-08T16:00')` is read as local time — which
  // means 4pm reads as 4pm on every phone, including one in another timezone.
  // That is the behaviour a family wants: practice is at 4pm at home.
  const events = useMemo<WorksCalendarEvent[]>(
    () =>
      cal.occurrences.map((o) => ({
        id: o.id,
        title: o.title,
        start: new Date(o.start),
        end: new Date(o.end),
        allDay: o.allDay,
        color: colorOf(o.memberIds),
        ...(o.category !== '' ? { category: o.category } : {}),
        ...(o.memberIds[0] ? { resource: o.memberIds[0] } : {}),
        meta: {
          seriesId: o.seriesId,
          recurrenceId: o.recurrenceId,
          memberIds: o.memberIds,
          recurring: o.recurring,
          repeatText: o.repeatText,
          location: o.location,
          notes: o.notes,
        },
      })),
    [cal.occurrences, colorOf],
  );

  const byId = useMemo(() => new Map(cal.occurrences.map((o) => [o.id, o])), [cal.occurrences]);

  const openEvent = useCallback(
    (ev: WorksCalendarEvent) => {
      const occurrence = ev.id ? byId.get(ev.id) : undefined;
      if (!occurrence) return;
      setEditing({ occurrence, start: occurrence.start });
    },
    [byId],
  );

  const openNew = useCallback((start: Date) => {
    setEditing({ occurrence: null, start: toWall(start) });
  }, []);

  const handleSave = useCallback(
    async (draft: EventDraft, scope: EditScope, recurrenceId: string) => {
      await cal.saveEvent(draft, scope, recurrenceId);
    },
    [cal],
  );

  const handleDelete = useCallback(
    async (seriesId: string, scope: EditScope, recurrenceId: string) => {
      await cal.removeEvent(seriesId, scope, recurrenceId);
    },
    [cal],
  );

  /**
   * Dragging an event to a new slot.
   *
   * A one-off event just moves. A repeating one opens the form instead, with
   * the new time filled in: dragging cannot say whether you meant this week or
   * every week, and picking one silently is how a whole term of practices ends
   * up on the wrong day.
   */
  const handleMove = useCallback(
    async (ev: WorksCalendarEvent, newStart: Date, newEnd: Date) => {
      const occurrence = ev.id ? byId.get(ev.id) : undefined;
      if (!occurrence) return;

      const moved: Occurrence = { ...occurrence, start: toWall(newStart), end: toWall(newEnd) };
      if (occurrence.recurring) {
        setEditing({ occurrence: moved, start: moved.start });
        return;
      }
      await cal.saveEvent(
        {
          id: occurrence.seriesId,
          title: occurrence.title,
          start: moved.start,
          end: moved.end,
          allDay: occurrence.allDay,
          location: occurrence.location,
          notes: occurrence.notes,
          memberIds: occurrence.memberIds,
          reminders: occurrence.reminders,
          rrule: '',
        },
        'all',
        occurrence.recurrenceId,
      );
    },
    [byId, cal],
  );

  const editingSeries = editing?.occurrence
    ? cal.series.find((s) => s.id === editing.occurrence?.seriesId) ?? null
    : null;

  return (
    <div className="app">
      <header className="app-head">
        <div className="app-title">
          <h1>Family Calendar</h1>
          <ConnectionBadge connection={cal.connection} onRetry={() => void cal.refresh()} />
        </div>

        <MemberBar
          members={cal.members}
          visibleMemberIds={cal.visibleMemberIds}
          onToggle={cal.toggleMember}
          onShowAll={cal.showAllMembers}
        />

        <div className="app-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => openNew(new Date())}
            disabled={!cal.canEdit}
            title={cal.canEdit ? undefined : 'Adding events needs the home server'}
          >
            Add event
          </button>
          <button type="button" className="button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </header>

      {cal.error && (
        <div className="banner banner-error" role="alert">
          <span>{cal.error}</span>
          <button type="button" className="icon-button" onClick={cal.dismissError} aria-label="Dismiss">×</button>
        </div>
      )}

      <main className="app-body">
        <WorksCalendar
          calendarId={CALENDAR_ID}
          events={events}
          initialView="month"
          role="admin"
          showAddButton={false}
          showSearch
          showOfflineIndicator
          showLeftRail={false}
          showRightPanel={false}
          weekStartDay={0}
          onEventClick={openEvent}
          onDateSelect={openNew}
          onEventMove={handleMove}
          renderEvent={(ev) => <EventPill event={ev} members={cal.members} />}
          emptyState={
            <div className="empty">
              <p>Nothing on the calendar yet.</p>
              {cal.canEdit && <p>Tap a day, or “Add event”, to put something on it.</p>}
            </div>
          }
        />
      </main>

      {editing && (
        <EventDialog
          occurrence={editing.occurrence}
          series={editingSeries}
          initialStart={editing.start}
          members={cal.members}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditing(null)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={cal.settings}
          members={cal.members}
          onSave={cal.updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * An event as it appears in a cell, coloured by whose it is.
 *
 * The colour is applied here rather than through the event's `color` field
 * because works-calendar only puts `--ev-color` on the pill it renders itself —
 * supplying a custom renderer means the container falls back to the theme
 * accent and every event comes out the same blue. An event shared by two people
 * gets a hard split down the middle rather than one of the two colours.
 */
function EventPill({ event, members }: { event: WorksCalendarEvent; members: Member[] }) {
  const meta = (event.meta ?? {}) as { memberIds?: string[]; recurring?: boolean; location?: string };
  const ids = meta.memberIds ?? [];

  const colors = ids.length === 0
    ? [FAMILY_COLOR]
    : ids.map((id) => members.find((m) => m.id === id)?.color ?? FAMILY_COLOR);

  const background = colors.length === 1
    ? colors[0]
    : `linear-gradient(90deg, ${colors
        .map((c, i) => `${c} ${(i / colors.length) * 100}%, ${c} ${((i + 1) / colors.length) * 100}%`)
        .join(', ')})`;

  return (
    <span className="pill" style={{ background }}>
      <span className="pill-title">{event.title}</span>
      {meta.recurring && <span className="pill-repeat" title="Repeats">↻</span>}
    </span>
  );
}

function ConnectionBadge({ connection, onRetry }: { connection: Connection; onRetry: () => void }) {
  switch (connection.kind) {
    case 'home':
      return <span className="badge badge-good" title={`Revision ${connection.rev}`}>Home</span>;
    case 'mirror':
      return <span className="badge badge-warn" title={connection.note}>Away — read only</span>;
    case 'cache':
      return (
        <button type="button" className="badge badge-warn" onClick={onRetry}>
          Offline — saved {new Date(connection.since).toLocaleString()}
        </button>
      );
    case 'connecting':
      return <span className="badge">Connecting…</span>;
    default:
      return (
        <button type="button" className="badge badge-bad" onClick={onRetry} title={connection.message}>
          No connection — retry
        </button>
      );
  }
}

/** A Date as the household wall-clock string the API speaks. */
function toWall(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
