/**
 * WorksCalendar — Theme Metadata
 *
 * The calendar ships a single neutral theme in two modes: Light and Dark.
 * (The legacy multi-family system — canvas/corporate/industrial/grid/ops/neon
 * — and the custom-theme builder were removed; `ops` is retained internally as
 * the one surviving token family so the CSS keeps a stable selector.)
 *
 *   import { DEFAULT_THEME, normalizeTheme } from 'works-calendar/themes';
 *   <WorksCalendar theme="dark" />
 *
 * Legacy theme names ("aviation", "corporate", "ops-dark", …) are still
 * accepted via normalizeTheme(), which folds them onto light/dark.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Retained as a single value so the family CSS selector stays stable. */
export type ThemeFamily = 'ops';

export type ThemeMode = 'light' | 'dark';

export type ThemeId = `${ThemeFamily}-${ThemeMode}`;

export interface ThemeFamilyMeta {
  id: ThemeFamily;
  label: string;
  description: string;
}

export interface ThemeDefinition {
  id: ThemeId;
  family: ThemeFamily;
  mode: ThemeMode;
}

// ── Family (single) ──────────────────────────────────────────────────────────

export const THEME_FAMILIES = [
  { id: 'ops', label: 'Default', description: 'Light & dark' },
] as const;

export const THEMES: ThemeId[] = ['ops-light', 'ops-dark'];

// Default — dark is the operations-console look used by the demo.
export const DEFAULT_THEME: ThemeId = 'ops-dark';

// ── Helpers ──────────────────────────────────────────────────────────────────

export function buildThemeId(family: ThemeFamily, mode: ThemeMode): ThemeId {
  return `${family}-${mode}`;
}

const LIGHT_ALIASES = new Set([
  'ops-light', 'light', 'canvas-light', 'corporate-light', 'industrial-light',
  'grid-light', 'neon-light', 'minimal', 'corporate', 'soft', 'forest', 'canvas',
  'grid', 'neon',
]);
const DARK_ALIASES = new Set([
  'ops-dark', 'dark', 'canvas-dark', 'corporate-dark', 'industrial-dark',
  'grid-dark', 'neon-dark', 'aviation', 'ocean', 'midnight',
]);

/**
 * Resolve arbitrary input to a canonical ThemeId (ops-light / ops-dark).
 * Accepts new-style ids, legacy single-word names, "light"/"dark", or
 * undefined. Anything unrecognized falls back to DEFAULT_THEME.
 */
export function normalizeTheme(input?: string): ThemeId {
  if (!input) return DEFAULT_THEME;
  const s = input.toLowerCase();
  if (LIGHT_ALIASES.has(s)) return 'ops-light';
  if (DARK_ALIASES.has(s)) return 'ops-dark';
  return DEFAULT_THEME;
}

// ── Display metadata ─────────────────────────────────────────────────────────

export type ThemePreview = {
  bg: string;
  surface: string;
  accent: string;
  text: string;
  border: string;
};

export interface ThemeMeta extends ThemeDefinition {
  label: string;
  description: string;
  dark: boolean;
  preview: ThemePreview;
  /** CSS theme file selector that goes into `data-wc-theme`. */
  cssTheme: string;
}

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  'ops-light': {
    id: 'ops-light', family: 'ops', mode: 'light',
    label: 'Light',
    description: 'Daytime ops console — clean slate, blue accent.',
    dark: false,
    preview: { bg: '#f8fafc', surface: '#eef2f7', accent: '#0ea5e9', text: '#0f172a', border: '#cbd5e1' },
    cssTheme: 'corporate',
  },
  'ops-dark': {
    id: 'ops-dark', family: 'ops', mode: 'dark',
    label: 'Dark',
    description: 'Instrument-panel aesthetic — readouts on navy.',
    dark: true,
    preview: { bg: '#080c16', surface: '#0d1525', accent: '#00d4ff', text: '#c8e8f0', border: '#1a3a4a' },
    cssTheme: 'aviation',
  },
};

/**
 * Resolve a theme prop down to the CSS theme selector the runtime understands
 * (what goes into `data-wc-theme`). The two shipped CSS files are corporate
 * (light) and aviation (dark); both pass through as-is.
 */
export function resolveCssTheme(input?: string): string {
  if (!input) return THEME_META[DEFAULT_THEME].cssTheme;
  if (input === 'corporate' || input === 'aviation') return input;
  return THEME_META[normalizeTheme(input)].cssTheme;
}

// ── Back-compat aliases for the public API ───────────────────────────────────

/** @deprecated Use THEMES (ThemeId[]) + THEME_META[id] instead. */
export const THEME_IDS: ThemeId[] = THEMES;

/** @deprecated Use THEME_META instead. */
export const THEMES_BY_ID: Record<ThemeId, ThemeMeta> = THEME_META;
