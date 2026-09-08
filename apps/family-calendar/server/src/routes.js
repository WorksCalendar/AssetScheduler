/**
 * The HTTP API.
 *
 * Three consumers, three shapes:
 *
 *  - the phones read `/api/events` (expanded occurrences) and `/api/changes`
 *    (delta sync, so a phone that has been in a pocket all week catches up in
 *    one small response rather than re-downloading the calendar)
 *  - the wall display reads `/api/display`, which is pre-grouped and ETagged
 *  - both write through `/api/events`, with a `scope` telling a recurring edit
 *    whether it means this week, this week onward, or always
 */

import { createRouter, HttpError, sendJson } from './http.js';
import { buildDisplayPayload, displayEtag } from './display.js';
import { currentRev } from './db.js';
import {
  changesSince, createEvent, deleteEvent, getSeries, listMembers, listOccurrences,
  listSeries, rotateMemberTopic, updateEvent, updateMember,
} from './store.js';
import { addDays, dayKey, formatWall, startOfDay } from './time.js';

/**
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   config: ReturnType<import('./config.js').loadConfig>,
 *   publisher: import('./ntfy.js').Publisher,
 *   mirror?: { status: () => Record<string, unknown> },
 *   log?: (msg: string) => void,
 *   startedAt?: Date,
 * }} deps
 * @returns {ReturnType<typeof createRouter>}
 */
export function buildRoutes(deps) {
  const { db, config, publisher } = deps;
  const log = deps.log ?? (() => {});
  const startedAt = deps.startedAt ?? new Date();
  const router = createRouter();

  // ── health ───────────────────────────────────────────────────────────────

  router.get('/healthz', () => {
    const members = listMembers(db);
    const series = listSeries(db);
    const upcoming = listOccurrences(db, {
      from: formatWall(new Date()),
      to: formatWall(addDays(new Date(), 7)),
    });
    return {
      ok: true,
      rev: currentRev(db),
      timezone: config.timezone,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      members: members.length,
      events: series.length,
      recurringEvents: series.filter((s) => s.rrule !== '').length,
      occurrencesNext7Days: upcoming.length,
      notifications: { enabled: publisher.enabled, server: config.ntfyUrl },
      mirror: deps.mirror ? deps.mirror.status() : { enabled: false },
    };
  });

  // ── members ──────────────────────────────────────────────────────────────

  router.get('/api/members', () => ({ members: listMembers(db) }));

  router.patch('/api/members/:id', async (ctx) => {
    const body = /** @type {Record<string, unknown>} */ (await ctx.body());
    return { member: updateMember(db, ctx.params['id'], body) };
  });

  router.post('/api/members/:id/rotate-topic', (ctx) => ({
    member: rotateMemberTopic(db, ctx.params['id']),
  }));

  // ── events ───────────────────────────────────────────────────────────────

  // Expanded occurrences for a window. `from`/`to` default to the current
  // month-ish, so a bare GET is still useful when poking at it by hand.
  router.get('/api/events', (ctx) => {
    const now = new Date();
    const from = ctx.url.searchParams.get('from') ?? formatWall(addDays(startOfDay(now), -7));
    const to = ctx.url.searchParams.get('to') ?? formatWall(addDays(startOfDay(now), 45));
    const memberIds = splitList(ctx.url.searchParams.get('members'));
    return {
      rev: currentRev(db),
      from,
      to,
      occurrences: listOccurrences(db, { from, to, ...(memberIds.length > 0 ? { memberIds } : {}) }),
    };
  });

  // The series behind the occurrences — what an edit form needs in order to
  // show "repeats weekly on Tuesday" rather than one afternoon in isolation.
  router.get('/api/events/series', () => ({ rev: currentRev(db), events: listSeries(db) }));

  router.get('/api/events/:id', (ctx) => ({ event: getSeries(db, ctx.params['id']) }));

  router.post('/api/events', async (ctx) => {
    const body = /** @type {Record<string, unknown>} */ (await ctx.body());
    const event = createEvent(db, body);
    announce('added', event, actorOf(ctx));
    return { event };
  });

  router.patch('/api/events/:id', async (ctx) => {
    const body = /** @type {Record<string, unknown>} */ (await ctx.body());
    const scope = ctx.url.searchParams.get('scope') ?? asString(body['scope']) ?? 'all';
    const recurrenceId = ctx.url.searchParams.get('recurrenceId') ?? asString(body['recurrenceId']);
    delete body['scope'];
    delete body['recurrenceId'];

    const event = updateEvent(db, ctx.params['id'], body, {
      scope,
      ...(recurrenceId ? { recurrenceId } : {}),
    });
    announce('changed', event, actorOf(ctx));
    return { event };
  });

  router.del('/api/events/:id', (ctx) => {
    const scope = ctx.url.searchParams.get('scope') ?? 'all';
    const recurrenceId = ctx.url.searchParams.get('recurrenceId');
    // Read it before it goes, so the notification can say what was cancelled.
    const before = getSeries(db, ctx.params['id']);
    const result = deleteEvent(db, ctx.params['id'], {
      scope,
      ...(recurrenceId ? { recurrenceId } : {}),
    });
    announce('cancelled', before, actorOf(ctx));
    return result;
  });

  // ── delta sync ───────────────────────────────────────────────────────────

  router.get('/api/changes', (ctx) => {
    const raw = ctx.url.searchParams.get('since_rev') ?? ctx.url.searchParams.get('sinceRev') ?? '0';
    const since = Number(raw);
    if (!Number.isFinite(since) || since < 0) {
      throw new HttpError(400, 'since_rev must be a non-negative number');
    }
    return changesSince(db, since);
  });

  // ── wall display ─────────────────────────────────────────────────────────

  router.get('/api/display', (ctx) => {
    const days = Number(ctx.url.searchParams.get('days') ?? config.displayDays);
    const memberIds = splitList(ctx.url.searchParams.get('members'));
    const payload = buildDisplayPayload(db, {
      days: Number.isFinite(days) ? days : config.displayDays,
      timezone: config.timezone,
      ...(memberIds.length > 0 ? { memberIds } : {}),
    });
    const etag = displayEtag(payload);

    // The screen polls on a short interval all day; almost every poll should
    // cost a 304 and no JSON at all.
    if (ctx.req.headers['if-none-match'] === etag) {
      ctx.res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }).end();
      return undefined;
    }
    sendJson(ctx.res, 200, payload, { ETag: etag, 'Cache-Control': 'no-cache' });
    return undefined;
  });

  // ── notifications ────────────────────────────────────────────────────────

  router.post('/api/notify/test', async (ctx) => {
    const body = /** @type {Record<string, unknown>} */ (await ctx.body());
    const memberId = asString(body['memberId']);
    const member = listMembers(db).find((m) => m.id === memberId);
    if (!member) throw new HttpError(404, `no such family member: ${memberId ?? '(none given)'}`);

    const result = await publisher.publish({
      topic: member.ntfyTopic,
      title: 'Family calendar',
      body: `Test notification for ${member.displayName}. If you can read this, push is working.`,
      tags: ['white_check_mark'],
    });
    if (!result.ok) throw new HttpError(502, `push failed: ${result.error ?? result.status}`);
    return { sent: true, member: member.id };
  });

  return router;

  // ── helpers ──────────────────────────────────────────────────────────────

  /**
   * Tell the people an event concerns that it changed — but never the person
   * who changed it, who was there when it happened.
   *
   * Fire-and-forget on purpose: a slow or unreachable ntfy must not make the
   * phone that saved the event sit and wait.
   *
   * @param {'added' | 'changed' | 'cancelled'} verb
   * @param {{ title: string, start: string, memberIds: string[] }} event
   * @param {string | null} actor
   */
  function announce(verb, event, actor) {
    if (!config.notifyOnChange || !publisher.enabled) return;

    const members = listMembers(db);
    const targets = (event.memberIds.length > 0 ? event.memberIds : members.map((m) => m.id))
      .filter((id) => id !== actor);

    for (const id of targets) {
      const member = members.find((m) => m.id === id);
      if (!member) continue;
      void publisher
        .publish({
          topic: member.ntfyTopic,
          title: `${event.title} — ${verb}`,
          body: `${dayKey(new Date(event.start.slice(0, 10)))} ${event.start.slice(11)}`.trim(),
          priority: 2,
          tags: [verb === 'cancelled' ? 'x' : 'calendar'],
        })
        .then((r) => {
          if (!r.ok) log(`change push to ${id} failed: ${r.error ?? r.status}`);
        })
        .catch((err) => log(`change push to ${id} threw: ${String(err)}`));
    }
  }
}

/**
 * Which family member is making this request, if the client says so. There is
 * no login on a household LAN app; this is a courtesy signal used only to keep
 * a person from being notified about their own edit.
 *
 * @param {import('./http.js').Ctx} ctx
 * @returns {string | null}
 */
function actorOf(ctx) {
  const header = ctx.req.headers['x-family-member'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * @param {string | null} v
 * @returns {string[]}
 */
function splitList(v) {
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

/**
 * @param {unknown} v
 * @returns {string | null}
 */
function asString(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
