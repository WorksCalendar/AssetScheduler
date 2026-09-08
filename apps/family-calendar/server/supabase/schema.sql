-- Read-only mirror of the home server's calendar.
--
-- Apply this once to a Supabase project (SQL editor, or `supabase db push`).
-- The home server writes here with the service key; phones read with the
-- anon key when they are away from the house. Nothing writes back — the
-- calendar on the home server is the only master.

create table if not exists family_members (
  id           text primary key,
  display_name text        not null,
  color        text        not null,
  sort_order   integer     not null default 0,
  rev          bigint      not null default 0,
  mirrored_at  timestamptz not null default now()
);

-- One row per event SERIES. A recurring event is a single row carrying its
-- RRULE; occurrences are expanded by the reader, not stored.
create table if not exists family_events (
  id          text primary key,
  title       text        not null,
  notes       text        not null default '',
  location    text        not null default '',
  category    text        not null default '',
  -- Household wall-clock time, e.g. '2026-09-08T16:00'. Deliberately text and
  -- not timestamptz: "soccer at 4pm" is 4pm in March and in July, and storing
  -- it as an instant would move it when the clocks change.
  start_wall  text        not null,
  end_wall    text        not null,
  all_day     boolean     not null default false,
  rrule       text        not null default '',
  exdates     jsonb       not null default '[]'::jsonb,
  member_ids  jsonb       not null default '[]'::jsonb,
  reminders   jsonb       not null default '[]'::jsonb,
  updated_at  timestamptz not null,
  rev         bigint      not null,
  -- Tombstone. A phone that has been offline for a week learns about deletions
  -- from these rows; without them it would keep showing cancelled events.
  deleted     boolean     not null default false,
  mirrored_at timestamptz not null default now()
);

create index if not exists family_events_rev_idx     on family_events (rev);
create index if not exists family_events_start_idx   on family_events (start_wall);
create index if not exists family_events_deleted_idx on family_events (deleted);

-- Edited or cancelled single occurrences of a recurring series, keyed by the
-- occurrence's ORIGINAL start.
create table if not exists family_event_overrides (
  series_id     text        not null,
  recurrence_id text        not null,
  cancelled     boolean     not null default false,
  patch         jsonb       not null default '{}'::jsonb,
  rev           bigint      not null,
  deleted       boolean     not null default false,
  mirrored_at   timestamptz not null default now(),
  primary key (series_id, recurrence_id)
);

create index if not exists family_event_overrides_rev_idx on family_event_overrides (rev);

-- Row level security: the anon key may read, and may not write. The home
-- server writes with the service key, which bypasses RLS.
alter table family_members         enable row level security;
alter table family_events          enable row level security;
alter table family_event_overrides enable row level security;

drop policy if exists family_members_read on family_members;
create policy family_members_read on family_members for select using (true);

drop policy if exists family_events_read on family_events;
create policy family_events_read on family_events for select using (true);

drop policy if exists family_event_overrides_read on family_event_overrides;
create policy family_event_overrides_read on family_event_overrides for select using (true);

-- NOTE: `select using (true)` means anyone holding the anon key can read the
-- family's calendar. That is the trade for reading it from a phone on mobile
-- data without running a login. If that is too open, put Supabase Auth in
-- front and narrow these policies to authenticated users.
