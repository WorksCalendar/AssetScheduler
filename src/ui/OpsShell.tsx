/**
 * OpsShell — ops-console application shell.
 *
 * A presentational chrome inspired by the MX Connect / Ops Console layout:
 *   ┌──────────────────────────────────────────────┐
 *   │  banner: logo · title/subtitle · persona · ☾  │
 *   ├──────────────────────────────────────────────┤
 *   │  body (active view fills this region)         │
 *   ├──────────────────────────────────────────────┤
 *   │  bottom tab bar: Map · Schedule · Assets · …  │
 *   └──────────────────────────────────────────────┘
 *
 * Headless: it owns no view state. The host passes the tab list, the active
 * id, a change handler, and the active view as `children`. Theming is a flat
 * light/dark switch (no theme families) plus a configurable banner colour /
 * gradient and an optional logo + persona chip.
 */
import type { ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import cls from './OpsShell.module.css';

export type OpsThemeMode = 'light' | 'dark';

export interface OpsTab {
  /** Stable id — also the calendar view id the host switches to. */
  id: string;
  label: string;
  icon: ReactNode;
  /** Optional notification count rendered as a badge. */
  badge?: number;
}

export interface OpsBanner {
  title: string;
  subtitle?: string;
  /** Solid colour or any CSS background value (e.g. a linear-gradient). */
  background?: string;
  logoSrc?: string;
  logoAlt?: string;
  /** Two-letter fallback shown when no logo image is provided. */
  logoText?: string;
}

export interface OpsPersona {
  name: string;
  role?: string;
  /** Initials for the avatar; derived from `name` when omitted. */
  initials?: string;
}

export interface OpsShellProps {
  banner: OpsBanner;
  persona?: OpsPersona;
  tabs: readonly OpsTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  mode: OpsThemeMode;
  onToggleMode?: () => void;
  /**
   * Persistent notification strip rendered directly under the banner, above
   * the sub-header — so it shows on every tab. Pair with {@link OpsAlertBar}.
   */
  notice?: ReactNode;
  /**
   * Optional bar rendered between the banner and the body — the home for an
   * active view's title/icon so views without their own header (e.g.
   * Locations) don't have to crowd their content with one. Pair with
   * {@link OpsViewHeader}.
   */
  subHeader?: ReactNode;
  children: ReactNode;
}

export interface OpsViewHeaderProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  /** Right-aligned content (filters, actions). */
  actions?: ReactNode;
}

/** Standardised view title bar for the OpsShell sub-header slot. */
export function OpsViewHeader({ icon, title, subtitle, actions }: OpsViewHeaderProps) {
  return (
    <div className={cls['viewHead']}>
      {icon && <div className={cls['viewHeadIcon']}>{icon}</div>}
      <div className={cls['viewHeadText']}>
        <div className={cls['viewHeadTitle']}>{title}</div>
        {subtitle && <div className={cls['viewHeadSub']}>{subtitle}</div>}
      </div>
      {actions && <div className={cls['viewHeadActions']}>{actions}</div>}
    </div>
  );
}

const DEFAULT_BANNER_BG =
  'linear-gradient(90deg, #1e3a8a 0%, #5b21b6 45%, #db5b6b 78%, #fb9a6b 100%)';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export function OpsShell({
  banner,
  persona,
  tabs,
  activeTab,
  onTabChange,
  mode,
  onToggleMode,
  notice,
  subHeader,
  children,
}: OpsShellProps) {
  return (
    <div className={cls['root']} data-ops-theme={mode}>
      <header
        className={cls['banner']}
        style={{ background: banner.background ?? DEFAULT_BANNER_BG }}
      >
        <div className={cls['brand']}>
          {banner.logoSrc ? (
            <img className={cls['logo']} src={banner.logoSrc} alt={banner.logoAlt ?? banner.title} />
          ) : (
            <div className={cls['logoFallback']} aria-hidden="true">
              {(banner.logoText ?? initialsOf(banner.title)).slice(0, 2)}
            </div>
          )}
          <div className={cls['titleBlock']}>
            <div className={cls['title']}>{banner.title}</div>
            {banner.subtitle && <div className={cls['subtitle']}>{banner.subtitle}</div>}
          </div>
        </div>

        <div className={cls['spacer']} />

        {onToggleMode && (
          <button
            type="button"
            className={cls['modeBtn']}
            onClick={onToggleMode}
            aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={mode === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        )}

        {persona && (
          <div className={cls['persona']} title={persona.role ? `${persona.name} · ${persona.role}` : persona.name}>
            <div className={cls['avatar']}>{persona.initials ?? initialsOf(persona.name)}</div>
            <div className={cls['personaText']}>
              <div className={cls['personaName']}>{persona.name}</div>
              {persona.role && <div className={cls['personaRole']}>{persona.role}</div>}
            </div>
          </div>
        )}
      </header>

      {notice}

      {subHeader && <div className={cls['subbar']}>{subHeader}</div>}

      <div className={cls['body']}>{children}</div>

      <nav className={cls['tabbar']} role="tablist" aria-label="Views">
        {tabs.map((t) => {
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-active={active}
              className={cls['tab']}
              onClick={() => onTabChange(t.id)}
            >
              <span className={cls['tabIcon']}>{t.icon}</span>
              <span className={cls['tabLabel']}>{t.label}</span>
              {t.badge != null && t.badge > 0 && (
                <span className={cls['tabBadge']}>{t.badge > 99 ? '99+' : t.badge}</span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default OpsShell;
