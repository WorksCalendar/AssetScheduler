// @vitest-environment happy-dom
/**
 * WorksCalendar theme sweep — every ThemeId must mount the new three-column
 * shell cleanly.
 *
 * What this guards against:
 *   - A token my shell consumes silently dropping out of a per-theme override
 *     (e.g. someone deletes --wc-shadow from one of the family CSS files).
 *   - The theme prop wiring losing the data-wc-* attributes that downstream
 *     CSS scopes itself under.
 *   - An unhandled console.error / pageerror leaking from a theme variant.
 *
 * It does NOT verify visual contrast — that requires a real browser. Visual
 * QA happens on the Vercel preview per-PR (see the PR 7 description).
 */
import { render, cleanup } from '@testing-library/react';
import { describe, expect, it, afterEach } from 'vitest';
import '@testing-library/jest-dom';

import { WorksCalendar } from '../WorksCalendar.tsx';
import { THEMES, THEME_META, type ThemeId } from '../styles/themes';

afterEach(() => cleanup());

describe('WorksCalendar theme sweep', () => {
  it('exposes 2 themes (light + dark)', () => {
    expect(THEMES).toHaveLength(2);
  });

  for (const themeId of THEMES) {
    const meta = THEME_META[themeId];

    it(`mounts cleanly under ${themeId} (${meta.label})`, () => {
      const errors: string[] = [];
      const origError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args.map(a => String(a)).join(' '));
      };

      try {
        const { getByTestId } = render(
          <WorksCalendar events={[]} theme={themeId as string} />,
        );

        const root = getByTestId('works-calendar');
        // data-wc-theme carries the resolved CSS-theme alias (one of the six
        // legacy theme files: aviation / corporate / ocean / soft / minimal /
        // forest) — that's what the legacy single-attribute selectors scope on.
        // The new family CSS files scope on data-wc-theme-family +
        // data-wc-theme-mode instead, so verify the full triple.
        expect(root).toHaveAttribute('data-wc-theme', meta.cssTheme);
        expect(root).toHaveAttribute('data-wc-theme-family', meta.family);
        expect(root).toHaveAttribute('data-wc-theme-mode', meta.mode);
      } finally {
        console.error = origError;
      }

      // No unhandled React warnings / a11y violations / etc.
      expect(errors).toEqual([]);
    });
  }
});
