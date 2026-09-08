/**
 * Entry point for the family calendar server.
 *
 *   TZ=America/Chicago node --disable-warning=ExperimentalWarning src/index.js
 *
 * The TZ matters. Everything in this calendar is household wall-clock time, and
 * the server's own timezone is what "4pm" resolves against — see time.js.
 */

import { createServer } from 'node:http';

import { loadConfig } from './config.js';
import { createHandler } from './http.js';
import { createMirror } from './mirror.js';
import { createPublisher } from './ntfy.js';
import { buildRoutes } from './routes.js';
import { listMembers } from './store.js';
import { openDatabase } from './db.js';
import { startReminderLoop } from './reminders.js';

/**
 * Build and start the whole thing.
 *
 * Every dependency can be overridden, which is how the tests run the real
 * routes against an in-memory database and a fake ntfy without a network.
 *
 * @param {{
 *   config?: Partial<ReturnType<typeof loadConfig>>,
 *   db?: import('node:sqlite').DatabaseSync,
 *   fetchImpl?: typeof fetch,
 *   log?: (msg: string) => void,
 *   listen?: boolean,
 * }} [overrides]
 * @returns {Promise<{
 *   server: import('node:http').Server, db: import('node:sqlite').DatabaseSync,
 *   config: ReturnType<typeof loadConfig>, port: number, close: () => Promise<void>,
 * }>}
 */
export async function startServer(overrides = {}) {
  const config = { ...loadConfig(), ...overrides.config };
  const log = overrides.log ?? ((msg) => console.log(`[family-calendar] ${msg}`));
  const db = overrides.db ?? openDatabase(config.dbPath);

  const publisher = createPublisher({
    baseUrl: config.ntfyUrl,
    token: config.ntfyToken,
    enabled: config.ntfyEnabled,
    ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
  });

  const mirror = createMirror({
    db,
    url: config.supabase.url,
    serviceKey: config.supabase.serviceKey,
    enabled: config.supabase.enabled,
    ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
    log,
  });

  const router = buildRoutes({ db, config, publisher, mirror, log });
  const server = createServer(
    createHandler(router, {
      apiToken: config.apiToken,
      onError: (err) => log(`unhandled: ${err instanceof Error ? err.stack : String(err)}`),
    }),
  );

  const stopReminders = startReminderLoop({
    db,
    publisher,
    intervalMs: config.reminderTickMs,
    ...(config.appUrl ? { appUrl: config.appUrl } : {}),
    log,
  });
  const stopMirror = mirror.start(config.supabase.intervalMs);

  const port = overrides.listen === false ? 0 : await listen(server, config.port, config.host);

  return {
    server,
    db,
    config,
    port,
    async close() {
      stopReminders();
      stopMirror();
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      db.close();
    },
  };
}

/**
 * @param {import('node:http').Server} server
 * @param {number} port
 * @param {string} host
 * @returns {Promise<number>}
 */
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : port);
    });
  });
}

/**
 * What to subscribe each phone to. Printed on boot because it is the one piece
 * of setup that cannot be discovered from the UI — you need the topic before
 * the notifications can reach you.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof loadConfig>} config
 * @returns {string}
 */
function topicSummary(db, config) {
  const lines = listMembers(db).map(
    (m) => `    ${m.displayName.padEnd(10)} ntfy topic: ${m.ntfyTopic}`,
  );
  return [`  Subscribe each phone in the ntfy app (server ${config.ntfyUrl}):`, ...lines].join('\n');
}

// Run only when executed directly, so importing this module in a test does not
// start listening on the real port.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  startServer()
    .then(({ db, config, port }) => {
      console.log(`[family-calendar] listening on http://${config.host}:${port}`);
      console.log(`[family-calendar] timezone ${config.timezone} — all event times are this clock`);
      console.log(`[family-calendar] database ${config.dbPath}`);
      console.log(topicSummary(db, config));
      if (!config.supabase.enabled) {
        console.log('[family-calendar] Supabase mirror off (set FC_SUPABASE_URL and FC_SUPABASE_SERVICE_KEY)');
      }
    })
    .catch((err) => {
      console.error('[family-calendar] failed to start:', err);
      process.exitCode = 1;
    });
}
