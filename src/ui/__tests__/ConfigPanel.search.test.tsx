// @vitest-environment happy-dom
/**
 * ConfigPanel — sidebar search & Overview tab.
 *
 * The sidebar exposes a search box that lets a user find any setting by
 * intent ("color", "rename", "default view") without hunting through
 * sections. The Overview tab is pinned at the top and lists every section
 * with deep-links — both surfaces are the discoverability layer.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';

import ConfigPanel from '../ConfigPanel';
import { DEFAULT_CONFIG } from '../../core/configSchema';

function mount(props = {}) {
  return render(
    <ConfigPanel
      config={DEFAULT_CONFIG}
      schema={[]}
      items={[]}
      categories={[]}
      resources={[]}
      onUpdate={vi.fn()}
      onClose={vi.fn()}
      savedViews={[]}
      onUpdateView={vi.fn()}
      onDeleteView={vi.fn()}
      {...props}
    />,
  );
}

// ─── Search ───────────────────────────────────────────────────────────────────

describe('ConfigPanel — sidebar search', () => {
  it('renders a search input in the sidebar', () => {
    mount();
    expect(screen.getByLabelText('Search settings')).toBeInTheDocument();
  });

  it('typing a query replaces the section list with matching results', () => {
    mount();
    // Section headers are visible by default.
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'color' } });
    // Section headers should disappear while a query is active.
    expect(screen.queryByRole('button', { name: 'Appearance' })).not.toBeInTheDocument();
    // Results matching "color" should render (multiple — "Event colors",
    // "Per-category color", etc. — all valid matches).
    expect(screen.getAllByText(/colors?/i).length).toBeGreaterThan(0);
  });

  it('matches by user intent keyword, not just by literal label', () => {
    mount();
    // "rename" isn't in any displayed label but is a keyword on the
    // location-label and filter-label entries.
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'rename' } });
    expect(screen.getByText(/Filter group labels/i)).toBeInTheDocument();
    expect(screen.getByText(/Location label/i)).toBeInTheDocument();
  });

  it('shows "No matching settings" when nothing matches', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'zzzznomatch' } });
    expect(screen.getByText(/No matching settings/i)).toBeInTheDocument();
  });

  it('clicking a result switches to that tab and clears the query', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'colors' } });
    // Pick the first result and click it.
    fireEvent.click(screen.getAllByRole('tab').find(el => el.textContent?.includes('Event Colors'))!);
    // Query should be cleared (section list returns).
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
    // Event Colors tab should be active in the regular sidebar.
    const colorsTab = screen.getByRole('tab', { name: 'Event Colors' });
    expect(colorsTab).toHaveAttribute('aria-selected', 'true');
  });
});

// ─── Overview tab ─────────────────────────────────────────────────────────────

describe('ConfigPanel — Overview tab', () => {
  it('renders an Overview tab pinned at the top of the sidebar', () => {
    mount();
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
  });

  it('clicking Overview shows the "What you can customize" body', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByText(/What you can customize/i)).toBeInTheDocument();
  });

  it('renders a card for major customization areas', () => {
    mount({ initialTab: 'overview' });
    // The Overview body heading "What you can customize" is unique to the
    // Overview tab — other section headings (e.g. "Appearance") are also
    // sidebar buttons, so rely on the unique heading + at least one card.
    expect(screen.getByText(/What you can customize/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Theme.*Light \/ dark/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View presets/i })).toBeInTheDocument();
  });

  it('clicking an Overview card jumps to that tab', () => {
    mount({ initialTab: 'overview' });
    // The "Theme" card is a button inside Appearance; it jumps to the Setup
    // tab, which now hosts the light/dark picker.
    fireEvent.click(screen.getByRole('button', { name: /Theme.*Light \/ dark/i }));
    expect(screen.getByRole('tab', { name: 'Setup' })).toHaveAttribute('aria-selected', 'true');
  });

  it('jumping from Overview auto-expands the destination section', () => {
    mount({ initialTab: 'overview' });
    // Saved Views starts collapsed because Overview is the initial tab.
    expect(screen.queryByRole('tab', { name: 'Saved Views' })).not.toBeInTheDocument();
    // Click the saved-views card.
    fireEvent.click(screen.getByRole('button', { name: /View presets/i }));
    // Saved Views section is now expanded and the tab is active.
    expect(screen.getByRole('tab', { name: 'Saved Views' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Saved Views' })).toHaveAttribute('aria-selected', 'true');
  });
});

// ─── New section taxonomy ─────────────────────────────────────────────────────

describe('ConfigPanel — section taxonomy', () => {
  it('exposes the six outcome-grouped sections', () => {
    mount();
    for (const label of ['Appearance', 'Layout & Labels', 'Event Display', 'Data', 'Saved Views', 'Workflows']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('Appearance contains Setup and Event Colors', () => {
    mount();
    // Appearance is open by default; its tabs should be present.
    expect(screen.getByRole('tab', { name: 'Setup' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Event Colors' })).toBeInTheDocument();
  });

  it('Saved Views contains the Saved Views tab (renamed from Smart Views)', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Saved Views' }));
    expect(screen.getByRole('tab', { name: 'Saved Views' })).toBeInTheDocument();
  });
});
