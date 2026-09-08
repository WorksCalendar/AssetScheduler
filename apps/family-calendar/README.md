# Family calendar

Three parts, one calendar:

| | |
|---|---|
| `server/` | Home server — SQLite, recurrence, ntfy push, the display feed. Node 22+, no dependencies, no build step. |
| `web/` | Installable web app (PWA) for the phones, built on the `works-calendar` library in this repo. |
| `firmware/esp32-display/` | Arduino sketch for the living-room touchscreen. |

## Times are wall-clock, not instants

Every time in this system is stored as `2026-09-08T16:00` — no timezone, no
offset. "Soccer at 4pm" is 4pm on the kitchen clock in March and in July, and a
phone in another timezone still shows 4pm.

This is why **the server must run with `TZ` set to the household's timezone**.
That setting is what "4pm" resolves against when a reminder has to fire at a real
moment.

## Run the server

```sh
cd server
TZ=America/Chicago npm start        # listens on :8090
npm test                            # 116 tests, no install needed
```

It prints each person's ntfy topic on first boot. Those topics are the only
thing protecting a phone's notifications — they are generated random, they are
never mirrored to the cloud, and `POST /api/members/<id>/rotate-topic` replaces
one that leaks.

Configuration is environment variables, all optional:

| | |
|---|---|
| `FC_PORT` / `FC_HOST` | default `8090` / `0.0.0.0` |
| `FC_DB` | default `~/.family-calendar/family.db` |
| `FC_API_TOKEN` | when set, every request needs it (`Authorization: Bearer`, or `?token=`) |
| `FC_NTFY_URL` / `FC_NTFY_TOKEN` | default `https://ntfy.sh` |
| `FC_NOTIFY_ON_CHANGE` | `0` to only push reminders, not edits |
| `FC_APP_URL` | opened when a notification is tapped |
| `FC_SUPABASE_URL` / `FC_SUPABASE_SERVICE_KEY` | turns on the cloud mirror |

Run it under systemd (or `pm2`, or a `restart: unless-stopped` container) so it
comes back after a power cut. Back it up by copying the `.db` file.

## Run the web app

```sh
npm run build            # in the repo root first — the app uses the built library
cd web
npm install
npm run dev              # or: npm run build && serve dist/
```

Then open Settings in the app and set the home server address (e.g.
`http://192.168.1.20:8090`) and which family member the phone belongs to.
"Add to home screen" installs it.

## Reading it away from home

The home server is not on the internet. To read the calendar on mobile data,
apply `server/supabase/schema.sql` to a Supabase project, give the server
`FC_SUPABASE_URL` and `FC_SUPABASE_SERVICE_KEY`, and put the project URL and
anon key into the app's settings. It is read-only: edits wait for home wifi.

Note that the anon read policy in that schema lets anyone with the anon key read
the family's calendar. Narrow it with Supabase Auth if that is too open.

## Flash the wall display

1. Arduino IDE → install `TFT_eSPI`, `XPT2046_Touchscreen`, `ArduinoJson` (v7).
2. Configure the panel in TFT_eSPI's `User_Setup.h` for your board.
3. Copy `firmware/esp32-display/config.h` to `config_local.h`, fill in wifi and
   the server address, and flash.

Defaults target the ESP32-2432S028R ("Cheap Yellow Display", 320x240). The
sketch has not been compiled or flashed — the pin map and TFT_eSPI setup are the
first things to check if it does not come up.

## API

```
GET    /healthz
GET    /api/members                        PATCH /api/members/:id
GET    /api/events?from=&to=&members=      expanded occurrences
GET    /api/events/series                  the stored events, with their repeat rules
POST   /api/events
PATCH  /api/events/:id?scope=&recurrenceId=
DELETE /api/events/:id?scope=&recurrenceId=
GET    /api/changes?since_rev=             delta sync
GET    /api/display?days=                  the wall screen's feed (ETagged)
POST   /api/notify/test
```

`scope` is `this`, `following`, or `all`, and `recurrenceId` is the occurrence's
original start (`2026-09-15T16:00`). Editing one week of a repeating event writes
an exception; editing "this and following" splits the series in two.
