/*
 * Family calendar — living-room wall display.
 *
 * Polls the home server's /api/display feed and draws one day per screen,
 * colour-coded per person, large enough to read from the sofa. Touch the left
 * or right edge to page between days; it goes back to today on its own.
 *
 * WHAT THIS TALKS TO
 *   GET http://<host>:<port>/api/display?days=N
 *   The response is grouped by day and pre-formatted for exactly this screen —
 *   see apps/family-calendar/server/src/display.js. Every poll sends the last
 *   ETag, so an unchanged calendar costs a 304 with no body and no redraw.
 *
 * HONEST FAILURE
 *   A wall calendar that quietly shows last Tuesday is worse than one that says
 *   it is lost. When the server cannot be reached the header turns red and
 *   shows how long the data has been stale, rather than leaving a confident
 *   stale screen up.
 *
 * LIBRARIES (Arduino IDE → Library Manager)
 *   TFT_eSPI      by Bodmer      — panel driver; configure User_Setup.h first
 *   XPT2046_Touchscreen by Paul Stoffregen
 *   ArduinoJson   by Benoit Blanchon (v7)
 *
 * BOARD
 *   Written for the ESP32-2432S028R ("Cheap Yellow Display"), 320x240. Any
 *   ESP32 + 320x240 panel will work — the panel setup lives in TFT_eSPI's
 *   User_Setup.h and the pins this sketch drives are in config.h.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <ArduinoJson.h>

#if __has_include("config_local.h")
  #include "config_local.h"
#else
  #include "config.h"
#endif

// ── screen geometry ─────────────────────────────────────────────────────────

static const int SCREEN_W = 320;
static const int SCREEN_H = 240;
static const int HEADER_H = 34;
static const int FOOTER_H = 18;
static const int ROW_H    = 30;
static const int PAGER_W  = 26;   // touch strip down each edge

// ── colours ─────────────────────────────────────────────────────────────────

static const uint16_t COL_BG      = 0x0000;  // black; highest contrast at a distance
static const uint16_t COL_PANEL   = 0x18E3;  // very dark grey
static const uint16_t COL_TEXT    = 0xFFFF;
static const uint16_t COL_DIM     = 0x8410;  // grey
static const uint16_t COL_HEADER  = 0x1082;
static const uint16_t COL_TODAY   = 0x05BF;  // blue
static const uint16_t COL_ERROR   = 0xF9A6;  // red

TFT_eSPI tft = TFT_eSPI();
SPIClass touchBus(VSPI);
XPT2046_Touchscreen touch(TOUCH_CS_PIN, TOUCH_IRQ_PIN);

// ── what is currently on screen ─────────────────────────────────────────────

static const int MAX_DAYS    = 8;
static const int MAX_EVENTS  = 12;
static const int MAX_MEMBERS = 6;

struct EventRow {
  char    start[6];      // "16:00", empty when the event covers the whole day
  char    end[6];
  char    title[40];
  char    location[28];
  bool    allDay;
  uint16_t colour;
};

struct DayView {
  char     label[20];    // "Tue Sep 8"
  bool     today;
  int      count;
  int      more;         // events the server had to leave out
  EventRow events[MAX_EVENTS];
};

struct MemberView {
  char     name[16];
  uint16_t colour;
};

static DayView    days[MAX_DAYS];
static int        dayCount = 0;
static MemberView members[MAX_MEMBERS];
static int        memberCount = 0;

static String  currentEtag;
static int     page = 0;
static uint32_t lastPollMs = 0;
static uint32_t lastTouchMs = 0;
static uint32_t lastGoodMs = 0;
static bool    everLoaded = false;
static bool    online = false;
static String  lastError;
static int     clockHour = 12;
static char    generatedAt[20] = "";
static bool    needsRedraw = true;

// ── colour helpers ──────────────────────────────────────────────────────────

/** "#2563eb" (or "2563eb") to RGB565. Falls back to grey on anything else. */
static uint16_t hexToColour(const char *hex) {
  if (hex == nullptr) return COL_DIM;
  if (*hex == '#') hex++;
  if (strlen(hex) < 6) return COL_DIM;

  char buf[3] = {0, 0, 0};
  buf[0] = hex[0]; buf[1] = hex[1];
  long r = strtol(buf, nullptr, 16);
  buf[0] = hex[2]; buf[1] = hex[3];
  long g = strtol(buf, nullptr, 16);
  buf[0] = hex[4]; buf[1] = hex[5];
  long b = strtol(buf, nullptr, 16);

  return tft.color565((uint8_t)r, (uint8_t)g, (uint8_t)b);
}

/** The colour for an event, from the first person it belongs to. */
static uint16_t colourForMembers(JsonArrayConst ids, JsonArrayConst memberDefs) {
  for (JsonVariantConst id : ids) {
    for (JsonObjectConst m : memberDefs) {
      if (strcmp(m["id"] | "", id.as<const char *>()) == 0) {
        return hexToColour(m["color"] | "#64748b");
      }
    }
  }
  return COL_DIM;  // nobody named: a whole-household event
}

/** Copy into a fixed buffer, always NUL-terminated. */
static void copyField(char *dest, size_t size, const char *src) {
  if (src == nullptr) { dest[0] = '\0'; return; }
  strncpy(dest, src, size - 1);
  dest[size - 1] = '\0';
}

// ── fetching ────────────────────────────────────────────────────────────────

/**
 * Ask the server for the calendar.
 *
 * Returns true when something was fetched and parsed. A 304 also counts as
 * success — it means what is already on screen is current.
 */
static bool fetchCalendar() {
  if (WiFi.status() != WL_CONNECTED) {
    lastError = "wifi lost";
    return false;
  }

  String url = "http://" CALENDAR_HOST ":" + String(CALENDAR_PORT) +
               "/api/display?days=" + String(CALENDAR_DAYS);
  if (strlen(CALENDAR_TOKEN) > 0) {
    url += "&token=" CALENDAR_TOKEN;
  }

  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(url)) {
    lastError = "bad url";
    return false;
  }

  if (currentEtag.length() > 0) {
    http.addHeader("If-None-Match", currentEtag);
  }
  const char *collect[] = {"ETag"};
  http.collectHeaders(collect, 1);

  int status = http.GET();

  if (status == HTTP_CODE_NOT_MODIFIED) {
    http.end();
    lastError = "";
    lastGoodMs = millis();
    return true;                       // nothing changed; leave the screen alone
  }

  if (status != HTTP_CODE_OK) {
    lastError = status > 0 ? ("http " + String(status)) : "no server";
    http.end();
    return false;
  }

  // Sized for the largest payload this screen asks for: 8 days x 12 events.
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getStream());
  String etag = http.header("ETag");
  http.end();

  if (err) {
    lastError = String("bad json: ") + err.c_str();
    return false;
  }

  JsonArrayConst memberDefs = doc["members"].as<JsonArrayConst>();
  memberCount = 0;
  for (JsonObjectConst m : memberDefs) {
    if (memberCount >= MAX_MEMBERS) break;
    copyField(members[memberCount].name, sizeof(members[0].name), m["name"] | "");
    members[memberCount].colour = hexToColour(m["color"] | "#64748b");
    memberCount++;
  }

  copyField(generatedAt, sizeof(generatedAt), doc["generatedAt"] | "");
  // "2026-09-08T18:13" — the hour is used for the night dimming.
  if (strlen(generatedAt) >= 13) {
    clockHour = atoi(generatedAt + 11);
  }

  dayCount = 0;
  for (JsonObjectConst d : doc["days"].as<JsonArrayConst>()) {
    if (dayCount >= MAX_DAYS) break;
    DayView &day = days[dayCount];
    copyField(day.label, sizeof(day.label), d["label"] | "");
    day.today = d["today"] | false;
    day.more  = d["more"] | 0;
    day.count = 0;

    for (JsonObjectConst e : d["items"].as<JsonArrayConst>()) {
      if (day.count >= MAX_EVENTS) { day.more++; continue; }
      EventRow &row = day.events[day.count];
      copyField(row.start, sizeof(row.start), e["s"] | "");
      copyField(row.end, sizeof(row.end), e["e"] | "");
      copyField(row.title, sizeof(row.title), e["t"] | "");
      copyField(row.location, sizeof(row.location), e["l"] | "");
      row.allDay = e["a"] | false;
      row.colour = colourForMembers(e["m"].as<JsonArrayConst>(), memberDefs);
      day.count++;
    }
    dayCount++;
  }

  if (etag.length() > 0) currentEtag = etag;
  lastError = "";
  lastGoodMs = millis();
  everLoaded = true;
  needsRedraw = true;
  return true;
}

// ── drawing ─────────────────────────────────────────────────────────────────

static void drawHeader(const DayView *day) {
  const bool stale = !online || lastError.length() > 0;
  tft.fillRect(0, 0, SCREEN_W, HEADER_H, stale ? COL_ERROR : COL_HEADER);

  tft.setTextColor(COL_TEXT, stale ? COL_ERROR : COL_HEADER);
  tft.setTextDatum(ML_DATUM);
  tft.setTextFont(2);
  tft.drawString(day != nullptr ? day->label : "Family Calendar", 8, HEADER_H / 2);

  tft.setTextDatum(MR_DATUM);
  if (stale) {
    // Say how old the screen is, in the plainest terms available.
    uint32_t ageMin = everLoaded ? (millis() - lastGoodMs) / 60000UL : 0;
    String note = !everLoaded ? String("connecting")
                              : (ageMin < 1 ? String("reconnecting")
                                            : String(ageMin) + " min old");
    tft.drawString(note, SCREEN_W - 8, HEADER_H / 2);
  } else if (day != nullptr && day->today) {
    tft.drawString(String(generatedAt).substring(11), SCREEN_W - 8, HEADER_H / 2);
  } else {
    tft.drawString("", SCREEN_W - 8, HEADER_H / 2);
  }

  if (day != nullptr && day->today) {
    tft.fillRoundRect(SCREEN_W / 2 - 26, 4, 52, 13, 6, COL_TODAY);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(COL_BG, COL_TODAY);
    tft.setTextFont(1);
    tft.drawString("TODAY", SCREEN_W / 2, 11);
  }
}

static void drawFooter() {
  const int y = SCREEN_H - FOOTER_H;
  tft.fillRect(0, y, SCREEN_W, FOOTER_H, COL_PANEL);

  // A colour key, so a glance tells you whose afternoon is busy.
  int x = 8;
  tft.setTextFont(1);
  tft.setTextDatum(ML_DATUM);
  for (int i = 0; i < memberCount && x < SCREEN_W - 70; i++) {
    tft.fillCircle(x + 4, y + FOOTER_H / 2, 4, members[i].colour);
    tft.setTextColor(COL_DIM, COL_PANEL);
    tft.drawString(members[i].name, x + 12, y + FOOTER_H / 2);
    x += 14 + tft.textWidth(members[i].name) + 10;
  }

  // Which day of the run you are looking at.
  tft.setTextDatum(MR_DATUM);
  tft.setTextColor(COL_DIM, COL_PANEL);
  tft.drawString(String(page + 1) + "/" + String(max(dayCount, 1)), SCREEN_W - 8, y + FOOTER_H / 2);
}

static void drawPagerArrows() {
  const int midY = HEADER_H + (SCREEN_H - HEADER_H - FOOTER_H) / 2;
  tft.setTextFont(2);
  tft.setTextDatum(MC_DATUM);

  tft.setTextColor(page > 0 ? COL_DIM : COL_PANEL, COL_BG);
  tft.drawString("<", PAGER_W / 2, midY);

  tft.setTextColor(page < dayCount - 1 ? COL_DIM : COL_PANEL, COL_BG);
  tft.drawString(">", SCREEN_W - PAGER_W / 2, midY);
}

static void drawDay() {
  const DayView *day = (page >= 0 && page < dayCount) ? &days[page] : nullptr;

  tft.fillRect(0, HEADER_H, SCREEN_W, SCREEN_H - HEADER_H - FOOTER_H, COL_BG);
  drawHeader(day);
  drawPagerArrows();

  if (day == nullptr) {
    tft.setTextDatum(MC_DATUM);
    tft.setTextFont(2);
    tft.setTextColor(COL_DIM, COL_BG);
    tft.drawString(everLoaded ? "No days in feed" : "Waiting for the calendar...",
                   SCREEN_W / 2, SCREEN_H / 2);
    drawFooter();
    return;
  }

  if (day->count == 0) {
    tft.setTextDatum(MC_DATUM);
    tft.setTextFont(2);
    tft.setTextColor(COL_DIM, COL_BG);
    tft.drawString("Nothing on", SCREEN_W / 2, SCREEN_H / 2 - 8);
    drawFooter();
    return;
  }

  const int left = PAGER_W;
  const int width = SCREEN_W - 2 * PAGER_W;
  int y = HEADER_H + 4;
  const int bottom = SCREEN_H - FOOTER_H;

  for (int i = 0; i < day->count && y + ROW_H <= bottom; i++) {
    const EventRow &e = day->events[i];

    // A thick bar in the person's colour is what makes the screen readable
    // from the far side of the room — the text is a detail you walk up to.
    tft.fillRoundRect(left, y, 6, ROW_H - 4, 3, e.colour);

    tft.setTextDatum(TL_DATUM);
    tft.setTextFont(2);
    tft.setTextColor(COL_TEXT, COL_BG);

    int textX = left + 12;
    if (!e.allDay && strlen(e.start) > 0) {
      tft.setTextColor(e.colour, COL_BG);
      tft.drawString(e.start, textX, y + 1);
      textX += 46;
      tft.setTextColor(COL_TEXT, COL_BG);
    } else {
      tft.setTextColor(e.colour, COL_BG);
      tft.drawString("all day", textX, y + 1);
      textX += 46;
      tft.setTextColor(COL_TEXT, COL_BG);
    }

    // Clip rather than wrap: one line per event keeps the row count honest.
    String title = e.title;
    const int room = left + width - textX - 4;
    while (title.length() > 1 && tft.textWidth(title) > room) {
      title.remove(title.length() - 1);
    }
    tft.drawString(title, textX, y + 1);

    if (strlen(e.location) > 0 && ROW_H >= 28) {
      tft.setTextFont(1);
      tft.setTextColor(COL_DIM, COL_BG);
      String where = e.location;
      while (where.length() > 1 && tft.textWidth(where) > room) {
        where.remove(where.length() - 1);
      }
      tft.drawString(where, textX, y + 17);
    }

    y += ROW_H;
  }

  if (day->more > 0 && y + 12 <= bottom) {
    tft.setTextFont(1);
    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(COL_DIM, COL_BG);
    tft.drawString("+" + String(day->more) + " more", left + 12, y);
  }

  drawFooter();
}

// ── backlight ───────────────────────────────────────────────────────────────

static void applyBacklight() {
#if NIGHT_START_HOUR != NIGHT_END_HOUR
  const bool night = (NIGHT_START_HOUR < NIGHT_END_HOUR)
      ? (clockHour >= NIGHT_START_HOUR && clockHour < NIGHT_END_HOUR)
      : (clockHour >= NIGHT_START_HOUR || clockHour < NIGHT_END_HOUR);
  analogWrite(TFT_BACKLIGHT_PIN, night ? BACKLIGHT_NIGHT : BACKLIGHT_DAY);
#else
  analogWrite(TFT_BACKLIGHT_PIN, BACKLIGHT_DAY);
#endif
}

// ── touch ───────────────────────────────────────────────────────────────────

/** Handle a press. Returns true when the page changed. */
static bool handleTouch() {
  if (!touch.tirqTouched() || !touch.touched()) return false;

  TS_Point p = touch.getPoint();
#if SERIAL_TOUCH_DEBUG
  Serial.printf("touch raw x=%d y=%d z=%d\n", p.x, p.y, p.z);
#endif

  int x = map(p.x, TOUCH_RAW_MIN_X, TOUCH_RAW_MAX_X, 0, SCREEN_W);
  x = constrain(x, 0, SCREEN_W - 1);

  lastTouchMs = millis();
  const int previous = page;

  if (x < PAGER_W * 2) {
    page = max(0, page - 1);
  } else if (x > SCREEN_W - PAGER_W * 2) {
    page = min(dayCount - 1, page + 1);
  } else {
    // A tap in the middle means "is this current?" — ask the server now.
    currentEtag = "";
    lastPollMs = 0;
  }

  // Crude debounce: a resistive panel reports a single press many times.
  delay(180);
  return page != previous;
}

// ── setup / loop ────────────────────────────────────────────────────────────

static void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);       // a sleeping radio adds seconds to every poll
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const uint32_t deadline = millis() + 20000UL;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(250);
  }
  online = WiFi.status() == WL_CONNECTED;
  if (!online) lastError = "no wifi";
}

void setup() {
  Serial.begin(115200);

  pinMode(TFT_BACKLIGHT_PIN, OUTPUT);
  analogWrite(TFT_BACKLIGHT_PIN, BACKLIGHT_DAY);

  tft.init();
  tft.setRotation(1);          // landscape, 320x240
  tft.fillScreen(COL_BG);

  touchBus.begin(TOUCH_SCK_PIN, TOUCH_MISO_PIN, TOUCH_MOSI_PIN, TOUCH_CS_PIN);
  touch.begin(touchBus);
  touch.setRotation(1);

  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(2);
  tft.setTextColor(COL_DIM, COL_BG);
  tft.drawString("Connecting to " WIFI_SSID "...", SCREEN_W / 2, SCREEN_H / 2);

  connectWifi();
  if (fetchCalendar()) {
    online = true;
  }
  drawDay();
}

void loop() {
  const uint32_t now = millis();

  if (handleTouch()) {
    drawDay();
  }

  // Drift back to today once nobody is looking at the other pages.
  if (page != 0 && lastTouchMs != 0 && now - lastTouchMs > RETURN_TO_TODAY_MS) {
    page = 0;
    drawDay();
  }

  if (now - lastPollMs >= POLL_INTERVAL_MS || lastPollMs == 0) {
    lastPollMs = now;

    if (WiFi.status() != WL_CONNECTED) {
      online = false;
      drawHeader(page < dayCount ? &days[page] : nullptr);
      connectWifi();
    }

    const bool wasOnline = online;
    online = fetchCalendar();

    applyBacklight();

    // Redraw when the data changed, or when the connection state did — the
    // header is the only thing telling anyone the screen is stale.
    if (needsRedraw || online != wasOnline) {
      needsRedraw = false;
      drawDay();
    }
  }

  delay(40);
}
