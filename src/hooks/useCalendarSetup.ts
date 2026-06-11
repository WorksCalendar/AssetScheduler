import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type React from 'react';
import { addDays, addWeeks, addMonths } from 'date-fns';
import { useOwnerConfig } from './useOwnerConfig';
import { buildDefaultFilterSchema, makeResourceResolver } from '../filters/filterSchema';
import type { FilterField } from '../filters/filterSchema';
import { createInitialFilters, clearFilterValue } from '../filters/filterState';
import { resolveCssTheme, normalizeTheme, THEME_META } from '../styles/themes';
import type { CalendarRole, CalendarView, WorksCalendarProps, EmployeeId, EmployeeRecord } from '../WorksCalendar.types';

export interface UseCalendarSetupInput {
  calendarId: string;
  role: CalendarRole;
  onConfigSave: WorksCalendarProps['onConfigSave'];
  devMode: boolean;
  weekStartDayProp: number | undefined;
  theme: string | undefined;
  backgroundImage: string | undefined;
  filterSchema: WorksCalendarProps['filterSchema'];
  employees: WorksCalendarProps['employees'];
  assets: WorksCalendarProps['assets'];
  initialView: string | undefined;
  onViewChange: WorksCalendarProps['onViewChange'];
  onEmployeeAdd: WorksCalendarProps['onEmployeeAdd'];
  onEmployeeDelete: WorksCalendarProps['onEmployeeDelete'];
}

/** The navigation + filter object threaded through all orchestration hooks. */
export type CalObject = {
  view: string;
  setView: (v: string) => void;
  currentDate: Date;
  setCurrentDate: (d: Date | ((prev: Date) => Date)) => void;
  dayWindow: number | null;
  setDayWindow: (w: number | null | ((prev: number | null) => number | null)) => void;
  filters: Record<string, unknown>;
  navigate: (direction: number) => void;
  goToToday: () => void;
  replaceFilters: (newFilters: Record<string, unknown>) => void;
  clearFilters: () => void;
  setFilter: (key: string, value: unknown) => void;
  toggleFilter: (key: string, value: unknown) => void;
  clearFilter: (key: string) => void;
};

export function useCalendarSetup({
  calendarId, role, onConfigSave, devMode,
  weekStartDayProp, theme, backgroundImage,
  filterSchema, employees, assets, initialView,
  onViewChange, onEmployeeAdd, onEmployeeDelete,
}: UseCalendarSetupInput) {
  const ownerCfg = useOwnerConfig({ calendarId, role, onConfigSave, devMode });
  const weekStartDay = (weekStartDayProp ?? ownerCfg.config?.['display']?.weekStartDay ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const rootStyle = useMemo<React.CSSProperties>(() => ({
    ...(backgroundImage ? ({ '--wc-bg-image': `url(${backgroundImage})` } as React.CSSProperties) : {}),
  }), [backgroundImage]);
  const rawTheme = theme || ownerCfg.config?.['setup']?.preferredTheme || 'ops-light';
  const effectiveTheme = resolveCssTheme(rawTheme);
  const themeId = normalizeTheme(rawTheme);
  const themeFamily = THEME_META[themeId].family;
  const themeMode   = THEME_META[themeId].mode;
  const calendarTitle = ownerCfg.config?.['title'] || 'My WorksCalendar';

  const configuredEmployees = useMemo(() => {
    const configMembers = ownerCfg.config?.['team']?.members ?? [];
    const parentMembers = Array.isArray(employees) ? employees : [];
    if (configMembers.length === 0) return parentMembers;
    if (parentMembers.length === 0) return configMembers;
    const configById = new Map(configMembers.map((m: EmployeeRecord) => [String(m.id), m]));
    const parentOnly = parentMembers.filter((m) => !configById.has(String(m.id)));
    return [...configMembers, ...parentOnly];
  }, [employees, ownerCfg.config?.['team']?.members]);

  const effectiveAssets = assets ?? (ownerCfg.config?.['assets'] as typeof assets);
  const resolveResourceLabel = useMemo(
    () => makeResourceResolver({ employees: configuredEmployees, assets: effectiveAssets ?? [] }),
    [configuredEmployees, effectiveAssets],
  );
  const schema = useMemo(
    () => filterSchema ?? buildDefaultFilterSchema({ employees: configuredEmployees, assets: effectiveAssets ?? [] }),
    [filterSchema, configuredEmployees, effectiveAssets],
  );

  const [view, _setViewState]         = useState<string>(initialView ?? 'month');
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [filters, _setFilters]        = useState<Record<string, unknown>>(() => createInitialFilters(schema));
  const [dayWindow, setDayWindow]     = useState<number | null>(null);

  const navigate = useCallback((direction: number) => {
    setCurrentDate(prev => {
      switch (view) {
        case 'week': return addWeeks(prev, direction);
        case 'day':  return addDays(prev, direction);
        default:     return addMonths(prev, direction);
      }
    });
  }, [view]);

  const goToToday    = useCallback(() => setCurrentDate(new Date()), []);
  const setView      = useCallback((v: string) => _setViewState(v), []);
  const replaceFilters = useCallback((newFilters: Record<string, unknown>) => _setFilters(newFilters), []);
  const clearFilters = useCallback(() => _setFilters(createInitialFilters(schema)), [schema]);
  const setFilter    = useCallback((key: string, value: unknown) => _setFilters(f => ({ ...f, [key]: value })), []);
  const toggleFilter = useCallback((key: string, value: unknown) => {
    _setFilters(f => {
      const current = f[key];
      const next = current instanceof Set ? new Set<unknown>(current) : new Set<unknown>();
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...f, [key]: next };
    });
  }, []);
  const clearFilter = useCallback((key: string) => {
    const field = schema.find((fd: FilterField) => fd.key === key);
    _setFilters(f => ({ ...f, [key]: clearFilterValue(field) }));
  }, [schema]);

  const cal = {
    view, setView,
    currentDate, setCurrentDate,
    dayWindow, setDayWindow,
    filters,
    navigate, goToToday,
    replaceFilters, clearFilters, setFilter, toggleFilter, clearFilter,
  };

  const lastViewRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastViewRef.current === null) { lastViewRef.current = view; return; }
    if (lastViewRef.current === view) return;
    lastViewRef.current = view;
    onViewChange?.(view as CalendarView);
  }, [view, onViewChange]);

  const handleEmployeeAddInternal = useCallback((member: EmployeeRecord) => {
    ownerCfg.updateConfig(c => {
      const existing = c['team']?.members ?? [];
      if (existing.some((m: EmployeeRecord) => String(m.id) === String(member.id))) return c;
      return { ...c, team: { ...(c['team'] ?? {}), members: [...existing, member] }, setup: { ...(c['setup'] ?? {}), completed: true } };
    });
    onEmployeeAdd?.(member);
  }, [ownerCfg.updateConfig, onEmployeeAdd]);

  const handleEmployeeDeleteInternal = useCallback((id: EmployeeId) => {
    ownerCfg.updateConfig(c => ({
      ...c,
      team: { ...(c['team'] ?? {}), members: (c['team']?.members ?? []).filter((m: EmployeeRecord) => String(m.id) !== String(id)) },
    }));
    onEmployeeDelete?.(id);
  }, [ownerCfg.updateConfig, onEmployeeDelete]);

  return {
    ownerCfg, weekStartDay, rootStyle, rawTheme,
    effectiveTheme, themeFamily, themeMode, calendarTitle,
    configuredEmployees, effectiveAssets, resolveResourceLabel,
    schema, cal, handleEmployeeAddInternal, handleEmployeeDeleteInternal,
  };
}
