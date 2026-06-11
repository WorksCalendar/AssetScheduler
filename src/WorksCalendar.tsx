/**
 * WorksCalendar — main component.
 */
import {
  useImperativeHandle, forwardRef, lazy, Suspense, useMemo, useRef, useState, useEffect,
} from 'react';
import type { ForwardedRef } from 'react';

import type { WorksCalendarProps, CalendarApi, WorksCalendarEvent } from './WorksCalendar.types';
export type { WorksCalendarEvent, CalendarView, CalendarRole, ScheduleInstantiationLimits, CalendarApi, WorksCalendarProps, DispatchMissionCandidate, DispatchMissionReadiness, DispatchEvaluator } from './WorksCalendar.types';
import { DEFAULT_SCHEDULE_INSTANTIATION_LIMITS } from './core/calendarViewConfig';

import { useCalendarSetup }      from './hooks/useCalendarSetup';
import { useCalendarWorkspace }  from './hooks/useCalendarWorkspace';
import { useCalendarDataPipeline } from './hooks/useCalendarDataPipeline';
import { useCalendarMutations }  from './hooks/useCalendarMutations';
import { useModalState }         from './hooks/useModalState';
import { useTouchSwipe }         from './hooks/useTouchSwipe';
import { useKeyboardShortcuts }  from './hooks/useKeyboardShortcuts';
import { CalendarContext }       from './core/CalendarContext';
import type { CalendarContextValue } from './types/ui';
import { captureSavedViewFields } from './core/viewScope';
import { AppShell }              from './ui/AppShell';
import FilterGroupSidebar        from './ui/FilterGroupSidebar';
import MiniCalendar               from './ui/MiniCalendar';
import CalendarLegend             from './ui/CalendarLegend';
import BulkActionBar              from './ui/BulkActionBar';
import OfflineIndicator           from './ui/OfflineIndicator';
import { useBulkSelect }          from './hooks/useBulkSelect';
import { useReminders }           from './hooks/useReminders';
import CalendarModals            from './ui/CalendarModals';
import CalendarToolbar           from './ui/CalendarToolbar';
import CalendarViewGrid          from './ui/CalendarViewGrid';
import type { AssetTypeDef, RequirementTemplate } from './ui/SetupLanding';
const SetupLanding = lazy(() => import('./ui/SetupLanding'));
import { CalendarLeftRail, CalendarRightPanel, hasRightPanelContent } from './ui/CalendarSideRails';
import { ViewSwitcher }                from './ui/ViewSwitcher';
import SavedFlash                from './ui/SavedFlash';
import CalendarErrorBoundary     from './ui/CalendarErrorBoundary';

import styles from './WorksCalendar.module.css';
import './styles/family/index.css';

// Views whose layout is a vertical calendar grid/list, so a horizontal
// touch swipe unambiguously maps to "previous / next period". Timeline-style
// views (timeline, base, assets) are intentionally excluded — they scroll
// horizontally and a swipe there would fight the scroll container.
const SWIPE_NAV_VIEWS = new Set(['month', 'week', 'day', 'agenda', 'schedule']);

const WorksCalendarImpl = forwardRef<CalendarApi, WorksCalendarProps>(function WorksCalendarImpl(
  {
    // ── Data ──
    events:     rawEvents   = [],
    fetchEvents,
    icalFeeds,
    icsSubscriptions,
    onImport,
    scheduleTemplates = [],
    scheduleTemplateAdapter,
    scheduleInstantiationLimits = DEFAULT_SCHEDULE_INSTANTIATION_LIMITS,
    onScheduleTemplateAnalytics,

    // ── Identity ──
    calendarId              = 'default',

    // ── Owner ──
    onConfigSave,

    // ── Dev mode ──
    devMode                 = false,

    // ── Layout density (responsive override) ──
    density,

    // ── Notes ──
    notes       = {},
    onNoteSave,
    onNoteDelete,

    // ── Event callbacks ──
    onEventClick: onEventClickProp,
    onEventSave,
    onEventMove,
    onEventResize,
    onEventDelete,
    onEventGroupChange,
    onEventChange,
    onCommentAdd,
    onReminder,
    currentUserName,
    onDateSelect,
    onViewChange,
    enableApprovalFlowsTab: _enableApprovalFlowsTab = true,

    // ── Supabase realtime ──
    supabaseUrl,
    supabaseKey,
    supabaseTable,
    supabaseFilter,

    // ── Access control ──
    role        = 'admin',

    // ── Employees ──
    employees   = [],
    onEmployeeAdd,
    onEmployeeDelete,
    onEmployeeAction,
    onAvailabilitySave,
    onScheduleSave,

    // ── Validation ──
    blockedWindows,

    // ── Appearance ──
    timezone: timezoneProp,
    showTimezonePicker = false,
    onTimezoneChange,
    theme,
    colorRules,
    businessHours,

    // ── Custom rendering ──
    renderEvent,
    renderHoverCard,
    renderToolbar,
    leftRailExtras,
    rightPanelExtras,
    renderFilterBar,
    renderSavedViewsBar,
    focusChips,
    dispatchMissions,
    dispatchEvaluator,
    onDispatchAssign,
    getRouteWaypoints,
    dispatchRoutes,
    emptyState,

    // ── Filter schema ──
    filterSchema,
    cascadeConfig,

    // ── UI toggles ──
    showAddButton           = false,
    showSearch              = false,
    showMiniCalendar        = false,
    showCalendarLegend      = false,
    showOfflineIndicator    = false,
    showToolbar,
    showLeftRail,
    showRightPanel,
    showViewSwitcher,
    hideEventTemplates       = false,
    eventTemplates,
    eventResourceSuggestions,
    showSetupLanding        = false,

    // ── Initial view ──
    initialView,

    // ── Week start day ──
    weekStartDay: weekStartDayProp,

    // ── Grouping ──
    groupBy,
    sort,
    showAllGroups,

    // ── Assets view ──
    locationProvider,
    categoriesConfig,
    assets,
    strictAssetFiltering,
    assetRequestCategories,
    onConflictCheck: _onConflictCheck,
    onApprovalAction,
    renderAssetLocation,
    renderPoolLocation,
    renderAssetBadges,
    maintenanceRules,
    renderConflictBody: _renderConflictBody,

    // ── Resource pools ──
    pools: rawPools,
    onPoolsChange,

    // ── Branding ──
    logoSrc,
    logoAlt,
    backgroundImage,
  }: WorksCalendarProps,
  ref: ForwardedRef<CalendarApi>,
) {
  const {
    ownerCfg, weekStartDay, rootStyle, rawTheme,
    effectiveTheme, themeFamily, themeMode, calendarTitle,
    configuredEmployees, effectiveAssets, resolveResourceLabel,
    schema, cal, handleEmployeeAddInternal, handleEmployeeDeleteInternal,
  } = useCalendarSetup({
    calendarId, role, onConfigSave, devMode, weekStartDayProp,
    theme, backgroundImage, filterSchema, employees, assets, initialView,
    onViewChange, onEmployeeAdd, onEmployeeDelete,
  });

  const {
    perms, eventOptions, savedViews,
    shouldShowSetup, handleSetupSkip, handleReopenSetup, handleSetupFinish,
    activeGroupBy, setActiveGroupBy, activeSort, setActiveSort,
    activeShowAllGroups, setActiveShowAllGroups, sidebarGroupLevels, handleSidebarGroupLevelsChange,
    sidebarOpen, setSidebarOpen, sidebarInitialTab, setSidebarInitialTab,
    handleScopeClick, handleSidebarFiltersChange,
    cascadeSelections, handleCascadeSelectionsChange,
    activeAssetsZoom, setActiveAssetsZoom, activeAssetsCollapsed, setActiveAssetsCollapsed,
    selectedBaseIds, setSelectedBaseIds, effectiveLocationProvider,
    savedViewActiveId, savedViewDirty, handleApplyView, handleClearFilters,
    handleDeleteView, handleSidebarSaveView,
  } = useCalendarWorkspace({
    calendarId, cal, schema, ownerCfg,
    cascadeConfig, groupBy, sort: sort ?? null, showAllGroups: !!showAllGroups,
    locationProvider, showSetupLanding, weekStartDay, role,
  });

  const { selectedIds: selectedEventIds, selectEvent, selectAll: selectAllEvents, clearSelection } = useBulkSelect();

  const mergedIcalFeeds = useMemo(() => {
    const subFeeds = (icsSubscriptions ?? []).map(url => ({ url }));
    return [...(icalFeeds ?? []), ...subFeeds];
  }, [icalFeeds, icsSubscriptions]);

  const {
    engine, undoManager, engineVer,
    expandedEvents, approvalRequestEvents,
    applyEngineOp, applyWithRecurringCheck, getSavedEventPayload,
    pendingAlert, setPendingAlert, recurringPrompt,
    announcerRef, fetchLoading, sourceStore, feedErrors, isFetchingFeeds,
    configuredBases, configuredRegions, profileLabels, locationLabel, assetsLabel,
    VIEWS, scopedEvents, categories, eventFormCats,
    resolvedAssetRequestCategories, canRequestAsset,
    resources, filterBarSchema, visibleEvents, onShiftIds,
  } = useCalendarDataPipeline({
    cal, ownerCfg, weekStartDay,
    rawEvents, fetchEvents, icalFeeds: mergedIcalFeeds, calendarId,
    supabaseUrl, supabaseKey, supabaseTable, supabaseFilter,
    rawPools, businessHours, blockedWindows, onPoolsChange,
    configuredEmployees, effectiveAssets, selectedBaseIds,
    assetRequestCategories, categoriesConfig, schema, activeSort, initialView,
  });

  const {
    selectedEvent, setSelectedEvent,
    formEvent, setFormEvent,
    conflictingEventIds, handleLiveConflicts,
    assetRequestOpen, setAssetRequestOpen,
    importOpen, setImportOpen,
    importMsg, setImportMsg,
    importFlash,
    scheduleOpen, setScheduleOpen,
    availabilityState, setAvailabilityState,
    scheduleEditorState, setScheduleEditorState,
    pillHoverTitle,
    editMode, setEditMode,
    helpOpen, setHelpOpen,
    inlineEditTarget, setInlineEditTarget,
    lastClickCoordsRef,
    editModeRef,
  } = useModalState();

  const rootRef = useRef<HTMLDivElement>(null);

  const [internalTimezone, setInternalTimezone] = useState<string | undefined>(timezoneProp);
  // Sync when the host changes the controlled prop (e.g. restoring a saved preference)
  useEffect(() => { setInternalTimezone(timezoneProp); }, [timezoneProp]);
  const timezone = internalTimezone;
  const handleTimezoneChange = (tz: string) => { setInternalTimezone(tz); onTimezoneChange?.(tz); };

  const {
    templateError, visibleScheduleTemplates, mergedScheduleTemplates,
    buildSchedulePreview, handleScheduleInstantiate,
    handleCreateScheduleTemplate, handleDeleteScheduleTemplate,
    emitEventSave: _emitEventSave, checkEventConflicts,
    handleEventSave, handleEventMove, handleEventResize,
    handleEventGroupChange, handleEventDelete, handleInlineSave, handleInlineDelete,
    handleEventClick, handleEditFromHoverCard, handleImport,
    handleShiftStatusChange, handleCoverageAssign, handleEmployeeAction,
    handleAvailabilitySave, handleScheduleEditorSave,
    hasAddButton, hasScheduleTemplates, hasImport, isEmpty,
    handleDateSelect, handleScheduleDateSelect, handlePoolDateSelect,
  } = useCalendarMutations({
    scheduleTemplates, scheduleInstantiationLimits, scheduleTemplateAdapter, onScheduleTemplateAnalytics,
    role, ownerCfg, businessHours, blockedWindows,
    applyEngineOp, applyWithRecurringCheck, getSavedEventPayload, engine, engineVer,
    expandedEvents, visibleEvents, undoManager, announcerRef, rootRef, sourceStore,
    onEventSave, onEventMove, onEventResize, onEventDelete, onEventGroupChange, onEventChange,
    onAvailabilitySave, onScheduleSave, onEmployeeAction,
    onEventClickProp, onDateSelect, onImport,
    configuredEmployees, devMode, showAddButton, perms,
    inlineEditTarget, setFormEvent, setInlineEditTarget, setSelectedEvent,
    editModeRef, lastClickCoordsRef, importFlash, setImportOpen, setImportMsg,
    setAvailabilityState, setScheduleEditorState, setScheduleOpen,
  });

  // Use expandedEvents (pre-filter) so reminders fire even when the event is
  // currently hidden by an active filter condition.
  useReminders(expandedEvents, onReminder);

  const api = useMemo((): CalendarApi => ({
    navigateTo:       (date)  => cal.setCurrentDate(date),
    setView:          (v)     => cal.setView(v),
    goToToday:        ()      => cal.goToToday(),
    openEvent:        (id)    => { const ev = expandedEvents.find(e => e.id === id); if (ev) setSelectedEvent(ev); },
    getVisibleEvents: ()      => visibleEvents as unknown as WorksCalendarEvent[],
    clearFilters:     ()      => cal.clearFilters(),
    addEvent:         (d = {}) => setFormEvent(d),
    undo:             ()      => undoManager.undo(),
    redo:             ()      => undoManager.redo(),
    get canUndo()             { return undoManager.canUndo; },
    get canRedo()             { return undoManager.canRedo; },
    printView:        ()      => window.print(),
    get selectedEventIds()  { return selectedEventIds; },
    selectEvent,
    selectAll:        ()      => selectAllEvents(visibleEvents),
    clearSelection,
  }), [cal, expandedEvents, visibleEvents, undoManager, setSelectedEvent, setFormEvent, selectedEventIds, selectEvent, selectAllEvents, clearSelection]);

  useImperativeHandle(ref, () => api, [api]);

  const ctxValue = useMemo((): CalendarContextValue => ({
    renderEvent: renderEvent as CalendarContextValue['renderEvent'],
    renderHoverCard: renderHoverCard as CalendarContextValue['renderHoverCard'],
    colorRules, businessHours, emptyState, permissions: perms, editMode, conflictingEventIds,
    ...(timezone !== undefined ? { displayTimezone: timezone } : {}),
  }), [renderEvent, renderHoverCard, colorRules, businessHours, emptyState, perms, editMode, conflictingEventIds, timezone]);

  const swipeAreaRef = useRef<HTMLDivElement | null>(null);
  useTouchSwipe({
    targetRef: swipeAreaRef,
    enabled: SWIPE_NAV_VIEWS.has(cal.view),
    onSwipeLeft: () => cal.navigate(1),
    onSwipeRight: () => cal.navigate(-1),
  });
  useKeyboardShortcuts({ setView: cal.setView, navigate: cal.navigate, goToToday: cal.goToToday, openHelp: () => setHelpOpen(true) });

  const sharedViewProps = {
    currentDate: cal.currentDate, events: visibleEvents,
    onEventClick: handleEventClick, onEventMove: handleEventMove,
    onEventResize: handleEventResize, onEventGroupChange: handleEventGroupChange,
    onDateSelect: handleDateSelect, config: ownerCfg.config, weekStartDay,
    pillHoverTitle, groupBy: activeGroupBy, sort: activeSort, showAllGroups: activeShowAllGroups,
  };

  const savedViewCaptureCtx = {
    groupBy: activeGroupBy, sort: activeSort, showAllGroups: activeShowAllGroups,
    zoomLevel: activeAssetsZoom, collapsedGroups: activeAssetsCollapsed, selectedBaseIds,
  };

  if (shouldShowSetup) {
    return (
      <CalendarErrorBoundary>
        <div className={styles['root']} data-wc-theme={effectiveTheme} data-wc-theme-family={themeFamily} data-wc-theme-mode={themeMode} data-wc-density={density ?? undefined} data-testid="works-calendar-setup" style={rootStyle}>
          <Suspense fallback={null}>
            <SetupLanding
              onSkip={handleSetupSkip}
              onFinish={handleSetupFinish}
              initialName={ownerCfg.config?.['title']}
              initialTheme={ownerCfg.config?.['setup']?.preferredTheme ?? rawTheme}
              initialAssetTypes={ownerCfg.config?.['assetTypes'] as AssetTypeDef[]}
              initialRequirementTemplates={ownerCfg.config?.['requirementTemplates'] as Record<string, RequirementTemplate>}
            />
          </Suspense>
        </div>
      </CalendarErrorBoundary>
    );
  }

  return (
    <CalendarErrorBoundary>
      <CalendarContext.Provider value={ctxValue}>
        <div ref={rootRef} className={styles['root']} data-wc-theme={effectiveTheme} data-wc-theme-family={themeFamily} data-wc-theme-mode={themeMode} data-wc-density={density ?? undefined} data-testid="works-calendar" data-wc-edit-mode={editMode ? '' : undefined} data-print-root="" style={rootStyle}>
          {devMode && (
            <div role="alert" style={{ background: '#fef08a', color: '#713f12', fontWeight: 600, fontSize: 12, padding: '4px 12px', textAlign: 'center', zIndex: 9999 }}>
              ⚠ DEV MODE — all users have admin access. Do not use in production.
            </div>
          )}
          {showOfflineIndicator && <OfflineIndicator />}
          <div className={styles['transientToast']} aria-hidden={!importFlash.flash}>
            <SavedFlash visible={importFlash.flash} label={importMsg} />
          </div>
          {(() => {
          // Views can opt into owning their full pane (no host header,
          // rails, sub-toolbar) — the view paints everything and gets a
          // ViewSwitcher node to slot into its own header.
          const currentViewDef = VIEWS.find((v) => v.id === cal.view);
          const viewOwnsChrome = currentViewDef?.ownsChrome === true;
          // Chrome visibility: explicit show* prop wins, else the persisted
          // display.chrome setting, else true (full chrome — historical default).
          const chromeCfg = (ownerCfg.config?.['display'] as { chrome?: Record<string, unknown> } | undefined)?.chrome;
          const resolveChrome = (prop: boolean | undefined, key: string): boolean =>
            prop ?? (typeof chromeCfg?.[key] === 'boolean' ? (chromeCfg[key] as boolean) : true);
          const chromeLeftRail     = resolveChrome(showLeftRail, 'leftRail');
          const chromeRightPanel   = resolveChrome(showRightPanel, 'rightPanel');
          const chromeToolbar      = resolveChrome(showToolbar, 'toolbar');
          const chromeViewSwitcher = resolveChrome(showViewSwitcher, 'viewSwitcher');
          const viewSwitcherForView = viewOwnsChrome && chromeViewSwitcher ? (
            <ViewSwitcher views={VIEWS} currentView={cal.view} onViewChange={(id) => cal.setView(id as typeof cal.view)} />
          ) : null;
          return (
          <AppShell
            {...(viewOwnsChrome || !chromeLeftRail ? {} : { leftRail: <CalendarLeftRail
              ownerCfg={ownerCfg}
              leftRailExtras={leftRailExtras}
              setSidebarInitialTab={setSidebarInitialTab}
              setSidebarOpen={setSidebarOpen}
              hasAddButton={hasAddButton}
              hasScheduleTemplates={hasScheduleTemplates}
              hasImport={hasImport}
              visibleEvents={visibleEvents}
              onAddEvent={() => setFormEvent({})}
              onAddSchedule={() => {
                setScheduleOpen(true);
                onScheduleTemplateAnalytics?.({
                  event: 'schedule_dialog_opened',
                  at: new Date().toISOString(),
                  templateCount: visibleScheduleTemplates.length,
                });
              }}
              onOpenImport={() => setImportOpen(true)}
              editMode={editMode}
              onToggleEditMode={() => { setEditMode((v) => !v); setInlineEditTarget(null); }}
            /> })}
            {...(viewOwnsChrome || !chromeRightPanel || !hasRightPanelContent(configuredEmployees, rightPanelExtras) ? {} : { rightPanel: <CalendarRightPanel configuredEmployees={configuredEmployees} onShiftIds={onShiftIds} rightPanelExtras={rightPanelExtras} /> })}
            header={viewOwnsChrome || !chromeToolbar ? <></> :
              <CalendarToolbar cal={cal} ownerCfg={ownerCfg} api={api}
                showViewSwitcher={chromeViewSwitcher}
                renderToolbar={renderToolbar} renderSavedViewsBar={renderSavedViewsBar} renderFilterBar={renderFilterBar}
                focusChips={focusChips} logoSrc={logoSrc} logoAlt={logoAlt}
                devMode={devMode} calendarTitle={calendarTitle} fetchLoading={fetchLoading}
                editMode={editMode} setEditMode={setEditMode} setInlineEditTarget={setInlineEditTarget}
                setHelpOpen={setHelpOpen}
                savedViews={savedViews} savedViewActiveId={savedViewActiveId} savedViewDirty={savedViewDirty}
                handleApplyView={handleApplyView} handleDeleteView={handleDeleteView} handleClearFilters={handleClearFilters}
                savedViewCaptureCtx={savedViewCaptureCtx} activeGroupBy={activeGroupBy}
                VIEWS={VIEWS} setSidebarOpen={setSidebarOpen} setSidebarInitialTab={setSidebarInitialTab}
                handleScopeClick={handleScopeClick} schema={schema} filterBarSchema={filterBarSchema}
                scopedEvents={scopedEvents} locationLabel={locationLabel} assetsLabel={assetsLabel} weekStartDay={weekStartDay}
                hasAddButton={hasAddButton} hideEventTemplates={hideEventTemplates} showSearch={showSearch}
                {...(eventTemplates !== undefined ? { eventTemplates } : {})}
                {...(showTimezonePicker ? {
                  showTimezonePicker: true as const,
                  onTimezoneChange: handleTimezoneChange,
                  ...(timezone !== undefined ? { displayTimezone: timezone } : {}),
                } : {})}
              />
            }
            main={<>
              <CalendarViewGrid cal={cal} ownerCfg={ownerCfg} perms={perms} schema={schema} filterBarSchema={filterBarSchema}
                viewOwnsChrome={viewOwnsChrome} viewSwitcher={viewSwitcherForView}
                sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} sidebarGroupLevels={sidebarGroupLevels}
                hasAddButton={hasAddButton} hasScheduleTemplates={hasScheduleTemplates} hasImport={hasImport}
                profileLabels={profileLabels} visibleScheduleTemplates={visibleScheduleTemplates} onScheduleTemplateAnalytics={onScheduleTemplateAnalytics}
                visibleEvents={visibleEvents} expandedEvents={expandedEvents} approvalRequestEvents={approvalRequestEvents}
                isEmpty={isEmpty} emptyState={emptyState} sharedViewProps={sharedViewProps}
                swipeAreaRef={swipeAreaRef} lastClickCoordsRef={lastClickCoordsRef} editMode={editMode}
                activeGroupBy={activeGroupBy} activeSort={activeSort} activeShowAllGroups={activeShowAllGroups}
                configuredEmployees={configuredEmployees} effectiveAssets={effectiveAssets}
                configuredBases={configuredBases} configuredRegions={configuredRegions}
                locationLabel={locationLabel} assetsLabel={assetsLabel}
                selectedBaseIds={selectedBaseIds} setSelectedBaseIds={setSelectedBaseIds}
                categoriesConfig={categoriesConfig} rawPools={rawPools}
                strictAssetFiltering={strictAssetFiltering} resolveResourceLabel={resolveResourceLabel}
                activeAssetsZoom={activeAssetsZoom} setActiveAssetsZoom={setActiveAssetsZoom}
                activeAssetsCollapsed={activeAssetsCollapsed} setActiveAssetsCollapsed={setActiveAssetsCollapsed}
                effectiveLocationProvider={effectiveLocationProvider}
                renderAssetLocation={renderAssetLocation} renderPoolLocation={renderPoolLocation} renderAssetBadges={renderAssetBadges}
                dispatchMissions={dispatchMissions} dispatchEvaluator={dispatchEvaluator}
                onDispatchAssign={onDispatchAssign} onApprovalAction={onApprovalAction} canRequestAsset={canRequestAsset}
                getRouteWaypoints={getRouteWaypoints}
                dispatchRoutes={dispatchRoutes}
                setFormEvent={setFormEvent} setScheduleOpen={setScheduleOpen} setImportOpen={setImportOpen}
                setAssetRequestOpen={setAssetRequestOpen} setActiveGroupBy={setActiveGroupBy}
                handleClearFilters={handleClearFilters} handleScheduleDateSelect={handleScheduleDateSelect}
                handlePoolDateSelect={handlePoolDateSelect} handleEmployeeAddInternal={handleEmployeeAddInternal}
                handleEmployeeDeleteInternal={handleEmployeeDeleteInternal}
                handleShiftStatusChange={handleShiftStatusChange} handleCoverageAssign={handleCoverageAssign}
                handleEmployeeAction={handleEmployeeAction} handleEventClick={handleEventClick}
              />
              {selectedEventIds.size > 0 && (
                <BulkActionBar
                  count={selectedEventIds.size}
                  totalCount={visibleEvents.length}
                  onSelectAll={() => selectAllEvents(visibleEvents)}
                  onDelete={() => {
                    // Recurring events require a scope-confirmation dialog
                    // (applyWithRecurringCheck stores a single prompt at a time),
                    // so batching them overwrites earlier prompts. Only bulk-delete
                    // non-recurring events; recurring ones must be deleted individually.
                    const eventById = new Map(expandedEvents.map(e => [e.id, e]));
                    for (const id of selectedEventIds) {
                      const ev = eventById.get(id);
                      if (!ev || ev._recurring || ev.rrule) continue;
                      handleEventDelete(id);
                    }
                    clearSelection();
                  }}
                  onClear={clearSelection}
                />
              )}
            </>}
          />
          );
          })()}

          <FilterGroupSidebar
            open={sidebarOpen}
            initialTab={sidebarInitialTab}
            onClose={() => setSidebarOpen(false)}
            groupLevels={sidebarGroupLevels}
            onGroupLevelsChange={handleSidebarGroupLevelsChange}
            sort={activeSort ?? []}
            onSortChange={(next) => setActiveSort(next.length > 0 ? next : null)}
            showAllGroups={activeShowAllGroups}
            onShowAllGroupsChange={setActiveShowAllGroups}
            {...(cascadeConfig ? { cascadeConfig } : {})}
            cascadeSelections={cascadeSelections}
            onCascadeSelectionsChange={handleCascadeSelectionsChange}
            schema={filterBarSchema}
            items={scopedEvents}
            onFiltersChange={handleSidebarFiltersChange}
            views={savedViews.views}
            activeViewId={savedViewActiveId}
            isViewDirty={savedViewDirty}
            onApplyView={handleApplyView}
            onSaveView={handleSidebarSaveView}
            onResaveView={(id) => savedViews.resaveView(id, cal.filters, cal.view, activeGroupBy, captureSavedViewFields(cal.view, savedViewCaptureCtx))}
            onUpdateView={savedViews.updateView}
            onDeleteView={handleDeleteView}
            onToggleViewVisibility={savedViews.toggleStripVisibility}
            locationLabel={locationLabel}
            assetsLabel={assetsLabel}
            {...(showMiniCalendar ? {
              headerSlot: (
                <MiniCalendar
                  currentDate={cal.currentDate}
                  onDateSelect={(d) => { cal.setCurrentDate(d); }}
                  weekStartDay={weekStartDay}
                  eventDates={visibleEvents.map(e => e.start instanceof Date ? e.start : new Date(e.start))}
                />
              ),
            } : {})}
            {...(showCalendarLegend ? {
              footerSlot: (
                <CalendarLegend
                  sources={sourceStore.sources
                    .filter(s => s.label && s.color)
                    .map(s => {
                      const count = visibleEvents.filter(e => (e as { _sourceId?: string })._sourceId === s.id).length;
                      return {
                        id: s.id,
                        label: s.label ?? '',
                        color: s.color ?? '#3b82f6',
                        enabled: s.enabled ?? true,
                        ...(count > 0 ? { eventCount: count } : {}),
                      };
                    })}
                  onToggle={sourceStore.toggleSource}
                  onColorChange={(id, color) => sourceStore.updateSource(id, { color })}
                />
              ),
            } : {})}
          />

          <CalendarModals
            selectedEvent={selectedEvent}
            setSelectedEvent={setSelectedEvent}
            renderHoverCard={renderHoverCard}
            ownerConfig={ownerCfg.config}
            notes={notes}
            onNoteSave={onNoteSave}
            onNoteDelete={onNoteDelete}
            canEditEvent={perms.canEditEvent}
            handleEditFromHoverCard={handleEditFromHoverCard}
            resolveResourceLabel={resolveResourceLabel}
            formEvent={formEvent}
            setFormEvent={setFormEvent}
            canAddEvent={perms.canAddEvent}
            eventFormCats={eventFormCats}
            eventOptions={eventOptions}
            handleEventSave={handleEventSave}
            handleEventDelete={handleEventDelete}
            onEventDelete={onEventDelete}
            canDeleteEvent={perms.canDeleteEvent}
            permissions={perms}
            canManageOptions={perms.canManageOptions}
            maintenanceRules={maintenanceRules}
            checkEventConflicts={checkEventConflicts}
            handleLiveConflicts={handleLiveConflicts}
            resolvedAssetRequestCategories={resolvedAssetRequestCategories}
            rawPools={rawPools ?? []}
            hideEventTemplates={hideEventTemplates}
            eventResourceSuggestions={eventResourceSuggestions}
            assetRequestOpen={assetRequestOpen}
            setAssetRequestOpen={setAssetRequestOpen}
            canRequestAsset={canRequestAsset}
            effectiveAssets={effectiveAssets}
            currentDate={cal.currentDate}
            requirementTemplates={ownerCfg.config?.['requirementTemplates']}
            availabilityState={availabilityState}
            setAvailabilityState={setAvailabilityState}
            handleAvailabilitySave={handleAvailabilitySave}
            scheduleEditorState={scheduleEditorState}
            setScheduleEditorState={setScheduleEditorState}
            onCallCategory={ownerCfg.config?.['onCallCategory'] ?? 'on-call'}
            handleScheduleEditorSave={handleScheduleEditorSave}
            importOpen={importOpen}
            setImportOpen={setImportOpen}
            handleImport={handleImport as (imported: unknown, meta: unknown) => void}
            scheduleOpen={scheduleOpen}
            setScheduleOpen={setScheduleOpen}
            visibleScheduleTemplates={visibleScheduleTemplates}
            buildSchedulePreview={buildSchedulePreview}
            handleScheduleInstantiate={handleScheduleInstantiate}
            recurringPrompt={recurringPrompt}
            pendingAlert={pendingAlert}
            setPendingAlert={setPendingAlert}
            configOpen={ownerCfg.configOpen}
            calendarId={calendarId}
            categories={categories}
            resources={resources}
            schema={schema}
            expandedEvents={expandedEvents}
            configInitialTab={ownerCfg.configInitialTab ?? undefined}
            smartViewEditId={ownerCfg.smartViewEditId ?? undefined}
            updateConfig={ownerCfg.updateConfig}
            closeConfig={ownerCfg.closeConfig}
            showSetupLanding={!!showSetupLanding}
            handleReopenSetup={handleReopenSetup}
            savedViews={savedViews}
            handleDeleteView={handleDeleteView}
            isOwner={ownerCfg.isOwner}
            openConfigToTab={ownerCfg.openConfigToTab}
            sourceStore={sourceStore}
            feedErrors={feedErrors}
            isFetchingFeeds={isFetchingFeeds}
            mergedScheduleTemplates={mergedScheduleTemplates}
            handleCreateScheduleTemplate={handleCreateScheduleTemplate}
            handleDeleteScheduleTemplate={handleDeleteScheduleTemplate}
            templateError={templateError}
            onEmployeeAdd={handleEmployeeAddInternal}
            onEmployeeDelete={handleEmployeeDeleteInternal}
            canManagePeople={perms.canManagePeople}
            helpOpen={helpOpen}
            setHelpOpen={setHelpOpen}
            assetsLabel={assetsLabel}
            announcerRef={announcerRef}
            inlineEditTarget={inlineEditTarget}
            setInlineEditTarget={setInlineEditTarget}
            handleInlineSave={handleInlineSave}
            handleInlineDelete={handleInlineDelete}
            onCommentAdd={onCommentAdd}
            currentUserName={currentUserName}
          />
        </div>
      </CalendarContext.Provider>
    </CalendarErrorBoundary>
  );
});

/**
 * SSR-safe wrapper. During server rendering and the first client render
 * (before hydration completes), returns a static placeholder so consumer
 * frameworks (Next.js, Remix) don't get a hydration mismatch between the
 * empty SSR output and the localStorage-backed client state. After mount,
 * delegates to the real implementation.
 */
export const WorksCalendar = forwardRef<CalendarApi, WorksCalendarProps>(function WorksCalendar(props, ref) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) {
    return (
      <div
        className="works-calendar works-calendar--ssr-placeholder"
        role="presentation"
        aria-hidden="true"
        style={{ minHeight: 480 }}
      />
    );
  }
  return <WorksCalendarImpl {...props} ref={ref} />;
});
