import { describe, it, expect } from 'vitest';
import {
  buildThemeId,
  normalizeTheme,
  resolveCssTheme,
  THEMES,
  THEME_FAMILIES,
  THEME_META,
  DEFAULT_THEME,
} from '../themes';

// The theme system was collapsed to a single neutral family ("ops") in two
// modes — Light and Dark. Legacy family/theme names fold onto light/dark.

// ─── THEMES / THEME_FAMILIES ──────────────────────────────────────────────────

describe('THEMES', () => {
  it('contains 2 themes (light + dark)', () => {
    expect(THEMES).toEqual(['ops-light', 'ops-dark']);
  });

  it('every theme id matches family-mode pattern', () => {
    expect(THEMES.every((t) => /^ops-(?:light|dark)$/.test(t))).toBe(true);
  });
});

describe('THEME_FAMILIES', () => {
  it('contains a single family', () => {
    expect(THEME_FAMILIES).toHaveLength(1);
    expect(THEME_FAMILIES[0]!.id).toBe('ops');
  });

  it('each family has id, label, description', () => {
    for (const f of THEME_FAMILIES) {
      expect(typeof f.id).toBe('string');
      expect(typeof f.label).toBe('string');
      expect(typeof f.description).toBe('string');
    }
  });
});

// ─── buildThemeId ─────────────────────────────────────────────────────────────

describe('buildThemeId', () => {
  it('combines family and mode with a hyphen', () => {
    expect(buildThemeId('ops', 'dark')).toBe('ops-dark');
    expect(buildThemeId('ops', 'light')).toBe('ops-light');
  });
});

// ─── normalizeTheme ───────────────────────────────────────────────────────────

describe('normalizeTheme', () => {
  it('returns DEFAULT_THEME when input is undefined', () => {
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
  });

  it('returns DEFAULT_THEME when input is empty string', () => {
    expect(normalizeTheme('')).toBe(DEFAULT_THEME);
  });

  it('maps "light" / "dark" to the ops themes', () => {
    expect(normalizeTheme('light')).toBe('ops-light');
    expect(normalizeTheme('dark')).toBe('ops-dark');
  });

  it('folds legacy light-ish names onto ops-light', () => {
    for (const name of ['minimal', 'corporate', 'soft', 'forest', 'canvas-light', 'grid-light']) {
      expect(normalizeTheme(name)).toBe('ops-light');
    }
  });

  it('folds legacy dark-ish names onto ops-dark', () => {
    for (const name of ['aviation', 'ocean', 'canvas-dark', 'neon-dark', 'grid-dark']) {
      expect(normalizeTheme(name)).toBe('ops-dark');
    }
  });

  it('passes through the canonical ids', () => {
    expect(normalizeTheme('ops-light')).toBe('ops-light');
    expect(normalizeTheme('ops-dark')).toBe('ops-dark');
  });

  it('is case-insensitive', () => {
    expect(normalizeTheme('DARK')).toBe('ops-dark');
    expect(normalizeTheme('Light')).toBe('ops-light');
  });

  it('returns DEFAULT_THEME for unrecognized input', () => {
    expect(normalizeTheme('unknown-theme-xyz')).toBe(DEFAULT_THEME);
  });
});

// ─── THEME_META ───────────────────────────────────────────────────────────────

describe('THEME_META', () => {
  it('has an entry for every theme', () => {
    for (const id of THEMES) {
      expect(THEME_META[id]).toBeDefined();
    }
  });

  it('each entry has required fields', () => {
    for (const [id, meta] of Object.entries(THEME_META)) {
      expect(typeof meta.label).toBe('string');
      expect(typeof meta.description).toBe('string');
      expect(typeof meta.dark).toBe('boolean');
      expect(typeof meta.cssTheme).toBe('string');
      expect(meta.id).toBe(id);
    }
  });

  it('dark theme has dark=true, light has dark=false', () => {
    expect(THEME_META['ops-dark'].dark).toBe(true);
    expect(THEME_META['ops-light'].dark).toBe(false);
  });
});

// ─── resolveCssTheme ──────────────────────────────────────────────────────────

describe('resolveCssTheme', () => {
  it('returns default cssTheme when input is undefined', () => {
    expect(resolveCssTheme(undefined)).toBe(THEME_META[DEFAULT_THEME].cssTheme);
  });

  it('passes through the two shipped CSS names', () => {
    expect(resolveCssTheme('aviation')).toBe('aviation');
    expect(resolveCssTheme('corporate')).toBe('corporate');
  });

  it('resolves a theme id to its cssTheme via THEME_META', () => {
    expect(resolveCssTheme('ops-light')).toBe(THEME_META['ops-light'].cssTheme);
    expect(resolveCssTheme('ops-dark')).toBe(THEME_META['ops-dark'].cssTheme);
  });

  it('folds legacy/unknown input onto a shipped cssTheme', () => {
    expect(resolveCssTheme('light')).toBe(THEME_META['ops-light'].cssTheme);
    expect(resolveCssTheme('dark')).toBe(THEME_META['ops-dark'].cssTheme);
    expect(resolveCssTheme('unknown-xyz')).toBe(THEME_META[DEFAULT_THEME].cssTheme);
  });
});
