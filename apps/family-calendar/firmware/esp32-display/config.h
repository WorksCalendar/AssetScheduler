// Everything you need to change for your own house.
//
// Copy this file to `config_local.h` and edit that instead if you would rather
// keep your wifi password out of git; the sketch prefers config_local.h when it
// exists.

#pragma once

// ── Home network ────────────────────────────────────────────────────────────
#define WIFI_SSID       "your-wifi"
#define WIFI_PASSWORD   "your-wifi-password"

// ── The family calendar server ──────────────────────────────────────────────
// The LAN address the home server listens on. Give the machine a static DHCP
// lease first — a wall display that stops working because the router handed the
// Pi a different address is a bad afternoon.
#define CALENDAR_HOST   "192.168.1.20"
#define CALENDAR_PORT   8090

// Only if the server was started with FC_API_TOKEN. Left empty, no token is
// sent (the usual case on a home network).
#define CALENDAR_TOKEN  ""

// How many days the screen can page through, starting with today.
#define CALENDAR_DAYS   4

// ── Behaviour ───────────────────────────────────────────────────────────────
// How often to ask the server whether anything changed. Cheap: unchanged
// polls come back as a 304 with no body at all.
#define POLL_INTERVAL_MS       30000UL

// Return to today this long after the last touch, so the screen on the wall is
// showing today by the time anybody next looks at it.
#define RETURN_TO_TODAY_MS     60000UL

// Dim the backlight overnight. Set NIGHT_START_HOUR == NIGHT_END_HOUR to
// disable. Hours are 0-23 in the household's own timezone, which is the clock
// the server sends.
#define NIGHT_START_HOUR       22
#define NIGHT_END_HOUR         6
#define BACKLIGHT_DAY          255
#define BACKLIGHT_NIGHT        24

// ── Board wiring ────────────────────────────────────────────────────────────
// Defaults are for the ESP32-2432S028R ("Cheap Yellow Display"): 320x240
// ILI9341 panel with an XPT2046 resistive touch controller.
//
// The panel itself is configured in TFT_eSPI's User_Setup.h, NOT here — see the
// README. These are only the pins this sketch drives directly.
#define TFT_BACKLIGHT_PIN      21

// The touch controller sits on its own SPI bus on this board, separate from
// the one the panel uses. These are the CYD's pins; change them for other
// hardware.
#define TOUCH_SCK_PIN          25
#define TOUCH_MISO_PIN         39
#define TOUCH_MOSI_PIN         32
#define TOUCH_CS_PIN           33
#define TOUCH_IRQ_PIN          36

// Raw touch range, used to map a press to a screen coordinate. If paging feels
// mirrored or dead at the edges, run the sketch with SERIAL_TOUCH_DEBUG on and
// copy the numbers it prints.
#define TOUCH_RAW_MIN_X        200
#define TOUCH_RAW_MAX_X        3700
#define TOUCH_RAW_MIN_Y        240
#define TOUCH_RAW_MAX_Y        3800

// Print raw touch coordinates to the serial monitor while calibrating.
#define SERIAL_TOUCH_DEBUG     0
