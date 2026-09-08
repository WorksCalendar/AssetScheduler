/**
 * Configuration, read once from the environment at startup.
 *
 * Everything has a working default except the things that cannot have one —
 * the ntfy topics are generated on first run and written into the database, so
 * a fresh install is `node src/index.js` and nothing else.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function str(name, fallback) {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read the configuration.
 *
 * @returns {{
 *   port: number, host: string, dbPath: string, timezone: string,
 *   apiToken: string, ntfyUrl: string, ntfyToken: string, ntfyEnabled: boolean,
 *   notifyOnChange: boolean, appUrl: string,
 *   reminderTickMs: number, displayDays: number,
 *   supabase: { url: string, serviceKey: string, enabled: boolean, intervalMs: number },
 * }}
 */
export function loadConfig() {
  const supabaseUrl = str('FC_SUPABASE_URL', '');
  const supabaseKey = str('FC_SUPABASE_SERVICE_KEY', '');

  return {
    port: num('FC_PORT', 8090),
    // Binds to every interface by default: the ESP32 on the living-room wall
    // and the phones on home wifi both have to reach it, so loopback-only
    // would make the whole thing useless out of the box.
    host: str('FC_HOST', '0.0.0.0'),
    dbPath: str('FC_DB', join(homedir(), '.family-calendar', 'family.db')),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    apiToken: str('FC_API_TOKEN', ''),
    ntfyUrl: str('FC_NTFY_URL', 'https://ntfy.sh').replace(/\/+$/, ''),
    ntfyToken: str('FC_NTFY_TOKEN', ''),
    ntfyEnabled: str('FC_NTFY_ENABLED', '1') !== '0',
    // Whether saving an event also pings the people it is for. The person who
    // made the change is never notified about it, so this stays useful rather
    // than becoming an echo.
    notifyOnChange: str('FC_NOTIFY_ON_CHANGE', '1') !== '0',
    // Where a tapped notification should open. Set it to whatever address the
    // phones use to reach the web app.
    appUrl: str('FC_APP_URL', ''),
    reminderTickMs: num('FC_REMINDER_TICK_MS', 30_000),
    displayDays: num('FC_DISPLAY_DAYS', 3),
    supabase: {
      url: supabaseUrl.replace(/\/+$/, ''),
      serviceKey: supabaseKey,
      enabled: supabaseUrl !== '' && supabaseKey !== '',
      intervalMs: num('FC_MIRROR_INTERVAL_MS', 60_000),
    },
  };
}
