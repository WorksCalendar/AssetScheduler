import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash2, Check, Camera, Pencil, ArrowUp, ArrowDown, ChevronDown } from 'lucide-react';

// Lazy-loaded so Phase 2's workflow templates + persistence hook +
// visual builder modal never touch the main chunk for hosts that
// don't open the Approval Flows tab.
const ApprovalFlowsTab = lazy(() => import('./ApprovalFlowsTab'));
import {
  FIELD_TYPES,
  APPROVAL_STAGE_IDS,
  APPROVAL_ACTIONS,
} from '../core/configSchema';
import type {
  ConfigPanelProps,
  ConfigPanelTabId,
  SaveViewOptions,
  SavedViewDraft,
  SavedViewFilters,
  UpdateConfig,
  WorksCalendarConfig,
} from '../types/ui';
import type { NormalizedEvent } from '../types/events';
import type { FilterField } from '../filters/filterSchema';
import { CONFLICT_RULE_TYPES } from 'works-calendar-engine';
import { DEFAULT_CATEGORIES } from '../types/assets.ts';
import type { CategoryDef, CategoriesConfig } from '../types/assets.ts';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useSavedFlash, useFlashWrapped, withFlash } from '../hooks/useSavedFlash';
import { serializeFilters } from '../hooks/useSavedViews';
import { THEME_FAMILIES, THEME_META, normalizeTheme } from '../styles/themes';
import SourcePanel from './SourcePanel';
import AdvancedFilterBuilder from './AdvancedFilterBuilder';
import SavedFlash from './SavedFlash';
import { getAssetStatus } from './assetStatus';
import styles from './ConfigPanel.module.css';

/**
 * Preset "Accountable Manager" titles offered in the Employees tab. Not
 * meant to be exhaustive — owners can still leave the select on the first
 * option if a person owns an unlisted managerial role for a base, and adding
 * a new title later is a one-line change.
 */
const MANAGER_TITLES = [
  'Base Manager',
  'Ops Manager',
  'Maintenance Manager',
  'Safety Manager',
  'Training Manager',
  'Scheduler',
];

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'setup',       label: 'Setup' },
  { id: 'hoverCard',   label: 'Event Details' },
  { id: 'eventFields', label: 'Event Fields' },
  { id: 'categories',  label: 'Event Colors' },
  { id: 'assets',      label: 'Assets' },
  { id: 'display',     label: 'Layout & Labels' },
  { id: 'feeds',       label: 'Feeds' },
  { id: 'templates',   label: 'Templates' },
  { id: 'smartViews',  label: 'Saved Views' },
  { id: 'team',        label: 'Employees' },
  { id: 'approvals',   label: 'Approvals' },
  { id: 'approvalFlows', label: 'Approval Flows' },
  { id: 'conflicts',   label: 'Conflicts' },
  { id: 'requestForm', label: 'Request Form' },
];

// Tabs are presented in a vertical sidebar grouped into accordion sections.
// Sections are organized by user intent ("what do I want to change?") rather
// than implementation. Tab ids are preserved so deep-links (initialTab="assets")
// and tests targeting role="tab" still work.
const SECTIONS = [
  { id: 'appearance',   label: 'Appearance',     tabs: ['setup', 'categories'] },
  { id: 'layout',       label: 'Layout & Labels', tabs: ['display'] },
  { id: 'eventDisplay', label: 'Event Display',  tabs: ['hoverCard', 'eventFields'] },
  { id: 'data',         label: 'Data',           tabs: ['assets', 'team', 'feeds', 'templates'] },
  { id: 'savedViews',   label: 'Saved Views',    tabs: ['smartViews'] },
  { id: 'workflows',    label: 'Workflows',      tabs: ['approvals', 'approvalFlows', 'conflicts', 'requestForm'] },
];

function sectionContaining(tabId: ConfigPanelTabId | string) {
  return SECTIONS.find(s => s.tabs.includes(tabId))?.id ?? SECTIONS[0]!.id;
}

// Settings search index. Maps user-facing field/feature names to the tab
// they live on. Synonyms (multiple entries with the same `tabId`) are
// intentional — search by intent, not by current tab name.
const SEARCH_INDEX: Array<{ label: string; keywords?: string; tabId: string }> = [
  // Appearance
  { label: 'Calendar name',                 tabId: 'setup',      keywords: 'title' },
  { label: 'Event colors',                  tabId: 'categories', keywords: 'category color pill' },
  { label: 'Per-category color',            tabId: 'categories', keywords: 'color picker' },
  { label: 'Default category',              tabId: 'categories' },
  { label: 'Pill style',                    tabId: 'categories', keywords: 'fill border' },

  // Layout & Labels
  { label: 'Default view',                  tabId: 'display',    keywords: 'starting initial' },
  { label: 'Visible view tabs',             tabId: 'display',    keywords: 'enabled hide month week day agenda schedule' },
  { label: 'Week start day',                tabId: 'display',    keywords: 'sunday monday' },
  { label: 'Day view start hour',           tabId: 'display',    keywords: 'business hours range' },
  { label: 'Day view end hour',             tabId: 'display',    keywords: 'business hours range' },
  { label: 'Show week numbers',             tabId: 'display' },
  { label: 'Enlarge month row on hover',    tabId: 'display' },
  { label: 'Panels & chrome',               tabId: 'display',    keywords: 'toolbar header left rail right panel view tabs hide show layout chrome' },
  { label: 'Filter group labels',           tabId: 'display',    keywords: 'rename categories people sources more' },
  { label: 'Location label (Base / Region)', tabId: 'team',      keywords: 'rename base station region' },
  { label: 'Asset label (Aircraft / Vehicle / Equipment)', tabId: 'team', keywords: 'rename asset aircraft vehicle equipment fleet' },

  // Event Display
  { label: 'Hover card fields',             tabId: 'hoverCard',  keywords: 'show hide time category resource notes' },
  { label: 'Custom event fields',           tabId: 'eventFields', keywords: 'per-category fields form' },

  // Data
  { label: 'Employees',                     tabId: 'team',       keywords: 'people staff team members' },
  { label: 'Roles',                         tabId: 'team' },
  { label: 'Bases / Locations',             tabId: 'team',       keywords: 'station region site' },
  { label: 'Accountable managers',          tabId: 'team' },
  { label: 'Assets / Aircraft',             tabId: 'assets',     keywords: 'fleet equipment vehicles' },
  { label: 'External feeds (iCal / Google)', tabId: 'feeds',     keywords: 'sources subscribe ical' },
  { label: 'Schedule templates',            tabId: 'templates',  keywords: 'shifts patterns recurring' },

  // Saved Views
  { label: 'Saved views',                   tabId: 'smartViews', keywords: 'presets filter chips' },
  { label: 'View presets',                  tabId: 'smartViews', keywords: 'saved smart' },
  { label: 'Filter presets',                tabId: 'smartViews' },

  // Workflow
  { label: 'Approval workflow',             tabId: 'approvals',  keywords: 'tiers stages' },
  { label: 'Approval tiers',                tabId: 'approvals' },
  { label: 'Approval flows',                tabId: 'approvalFlows', keywords: 'stages routing' },
  { label: 'Conflict rules',                tabId: 'conflicts',  keywords: 'overlap mutex rest' },
  { label: 'Request form fields',           tabId: 'requestForm' },
];

type ConfigPanelSectionProps = {
  config: WorksCalendarConfig;
  onUpdate: UpdateConfig;
};

type SmartViewsTabProps = {
  categories: string[];
  resources: string[];
  schema?: readonly FilterField[] | undefined;
  items?: NormalizedEvent[] | undefined;
  onSaveView?: ConfigPanelProps['onSaveView'];
  savedViews?: SavedViewDraft[] | undefined;
  onUpdateView?: ConfigPanelProps['onUpdateView'];
  onDeleteView?: ConfigPanelProps['onDeleteView'];
  initialEditingId?: string | null | undefined;
};

type TeamTabProps = ConfigPanelSectionProps & {
  onEmployeeAdd?: ConfigPanelProps['onEmployeeAdd'];
  onEmployeeDelete?: ConfigPanelProps['onEmployeeDelete'];
};

type TemplateTabProps = {
  templates: NonNullable<ConfigPanelProps['scheduleTemplates']>;
  onCreate?: ConfigPanelProps['onCreateScheduleTemplate'];
  onDelete?: ConfigPanelProps['onDeleteScheduleTemplate'];
  error?: string | null | undefined;
};

type AssetsTabProps = ConfigPanelSectionProps & {
  items?: NormalizedEvent[];
};

type TemplateVisibility = 'private' | 'team' | 'org';
type EventFieldType = (typeof FIELD_TYPES)[number]['value'];
type EventFieldDraft = {
  name: string;
  type: EventFieldType;
  required: boolean;
  options?: string;
};
type EventFieldsByCategory = Record<string, EventFieldDraft[]>;
type CategoriesPatch = Partial<CategoriesConfig>;
type CategoryPatch = Partial<CategoryDef>;
type AssetMeta = {
  sublabel?: string;
  registrationNumber?: string;
  type?: string;
  make?: string;
  model?: string;
  limitations?: string;
};
type AssetDraft = {
  _key?: string;
  id: string;
  label: string;
  group?: string;
  meta?: AssetMeta;
};
type AssetPatch = Partial<Omit<AssetDraft, 'meta'>>;
type AssetMetaPatch = Partial<AssetMeta>;
type SmartViewFilters = Record<string, unknown>;
type ManagerAssignment = { title?: string | undefined; phone?: string | undefined };
type TeamRegionDraft = { id: string; name: string };
type TeamBaseDraft = { id: string; name: string; regionId?: string };
type TeamMemberDraft = {
  id: number;
  name?: string | undefined;
  color?: string | undefined;
  avatar?: string | null | undefined;
  role?: string | undefined;
  base?: string | undefined;
  phone?: string | undefined;
  accountableManagers?: ManagerAssignment[] | undefined;
};
type TeamConfigPatch = {
  members?: TeamMemberDraft[];
  roles?: string[];
  bases?: TeamBaseDraft[];
  regions?: TeamRegionDraft[];
  locationLabel?: string;
  assetsLabel?: string;
};
type ApprovalStageId = (typeof APPROVAL_STAGE_IDS)[number];
type ApprovalActionId = (typeof APPROVAL_ACTIONS)[number];
type ApprovalTierDraft = {
  id: string;
  label: string;
  requires: 'any' | 'all';
  roles: string[];
};
type ApprovalStageRuleDraft = { allow: ApprovalActionId[]; prefix: string };
type ApprovalLabelsDraft = Partial<Record<ApprovalActionId, string>>;
type ApprovalsPatch = {
  enabled?: boolean;
  tiers?: ApprovalTierDraft[];
  rules?: Partial<Record<ApprovalStageId, ApprovalStageRuleDraft>>;
  labels?: ApprovalLabelsDraft;
};
type RequestFieldType = (typeof REQUEST_FIELD_TYPES)[number]['value'];
type RequestFieldDraft = {
  key: string;
  label: string;
  type: RequestFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string;
};
type RequestFormPatch = { fields?: RequestFieldDraft[] };
type ConflictRuleType = (typeof CONFLICT_RULE_TYPES)[number];
type ConflictRuleDraft = {
  id: string;
  type: ConflictRuleType;
  severity?: 'hard' | 'soft' | undefined;
  categories?: string[] | undefined;
  minutes?: number | undefined;
  ignoreCategories?: string[] | undefined;
};
type ConflictsPatch = {
  enabled?: boolean;
  rules?: ConflictRuleDraft[];
};

export default function ConfigPanel({
  config, categories, resources, schema, items,
  onUpdate: onUpdateRaw,
  onClose,
  onSaveView: onSaveViewRaw,
  savedViews,
  onUpdateView: onUpdateViewRaw,
  onDeleteView: onDeleteViewRaw,
  // Source store props (optional — omitted when owner has no source store)
  sources, feedErrors, isFetchingFeeds,
  onAddSource: onAddSourceRaw,
  onRemoveSource: onRemoveSourceRaw,
  onToggleSource: onToggleSourceRaw,
  onUpdateSource: onUpdateSourceRaw,
  scheduleTemplates,
  onCreateScheduleTemplate: onCreateScheduleTemplateRaw,
  onDeleteScheduleTemplate: onDeleteScheduleTemplateRaw,
  scheduleTemplateError,
  // Team-tab hooks: when provided, TeamTab emits add/delete upstream so the
  // parent's employees prop can stay in sync with config-side edits.
  onEmployeeAdd: onEmployeeAddRaw,
  onEmployeeDelete: onEmployeeDeleteRaw,
  // Deep-link: open ConfigPanel focused on a specific tab. Re-applied when
  // the prop changes so consecutive deep-links (e.g. two clicks of "Edit
  // assets" with a different target each time) land on the right tab.
  initialTab,
  // When set, SmartViewsTab opens immediately in edit mode for this view id.
  initialSmartViewEditId,
  // Per-calendar scope for workflow persistence. Defaults to 'default'
  // so hosts that don't multiplex calendars still get stable storage.
  calendarId = 'default',
  // Restart the guided setup; the SetupTab renders a button when set.
  onReopenSetup,
  enableApprovalFlowsTab = true,
}: ConfigPanelProps) {
  // Saved-flash plumbing: every host write committed through this panel
  // pulses the header pill so users see their change land. Wrappers stay
  // referentially stable per raw-callback identity so the downstream
  // useCallback graph doesn't churn on every render.
  const { flash, trigger } = useSavedFlash();
  const onUpdate           = useMemo(() => withFlash(onUpdateRaw, trigger), [onUpdateRaw, trigger]);
  const onSaveView                 = useFlashWrapped(onSaveViewRaw,                 trigger);
  const onUpdateView               = useFlashWrapped(onUpdateViewRaw,               trigger);
  const onDeleteView               = useFlashWrapped(onDeleteViewRaw,               trigger);
  const onAddSource                = useFlashWrapped(onAddSourceRaw,                trigger);
  const onRemoveSource             = useFlashWrapped(onRemoveSourceRaw,             trigger);
  const onToggleSource             = useFlashWrapped(onToggleSourceRaw,             trigger);
  const onUpdateSource             = useFlashWrapped(onUpdateSourceRaw,             trigger);
  const onCreateScheduleTemplate   = useFlashWrapped(onCreateScheduleTemplateRaw,   trigger);
  const onDeleteScheduleTemplate   = useFlashWrapped(onDeleteScheduleTemplateRaw,   trigger);
  const onEmployeeAdd              = useFlashWrapped(onEmployeeAddRaw,              trigger);
  const onEmployeeDelete           = useFlashWrapped(onEmployeeDeleteRaw,           trigger);

  const visibleTabs = useMemo(
    () => (enableApprovalFlowsTab ? TABS : TABS.filter(t => t.id !== 'approvalFlows')),
    [enableApprovalFlowsTab],
  );
  const visibleSections = useMemo(
    () => (enableApprovalFlowsTab
      ? SECTIONS
      : SECTIONS.map(section => ({ ...section, tabs: section.tabs.filter(tabId => tabId !== 'approvalFlows') }))),
    [enableApprovalFlowsTab],
  );
  const tabById = useMemo(() => Object.fromEntries(visibleTabs.map(t => [t.id, t])), [visibleTabs]);

  const [tab, setTab] = useState<string>(() =>
    initialTab && visibleTabs.some(t => t.id === initialTab) ? initialTab : 'setup',
  );
  // Open the section containing the active tab; allow others to be expanded
  // independently. Re-keys when `tab` changes so deep-links auto-expand.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => ({ [(visibleSections.find(s => s.tabs.includes(tab as ConfigPanelTabId))?.id ?? visibleSections[0]!.id)]: true }));
  const [searchQuery, setSearchQuery] = useState('');
  const trapRef = useFocusTrap<HTMLDivElement>(onClose);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as Array<{ label: string; tabId: string; tabLabel: string }>;
    return SEARCH_INDEX
      .filter(entry => {
        const hay = `${entry.label} ${entry.keywords ?? ''} ${tabById[entry.tabId]?.label ?? ''}`.toLowerCase();
        return hay.includes(q);
      })
      .map(entry => ({
        label: entry.label,
        tabId: entry.tabId,
        tabLabel: tabById[entry.tabId]?.label ?? entry.tabId,
      }));
  }, [searchQuery]);

  useEffect(() => {
    if (initialTab && visibleTabs.some(t => t.id === initialTab)) {
      setTab(initialTab);
    }
  }, [initialTab]);

  // Auto-expand the section that owns the active tab whenever it changes.
  useEffect(() => {
    const sid = (visibleSections.find(s => s.tabs.includes(tab as ConfigPanelTabId))?.id ?? visibleSections[0]!.id);
    setOpenSections(prev => (prev[sid] ? prev : { ...prev, [sid]: true }));
  }, [tab]);

  useEffect(() => {
    tabRefs.current[tab]?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [tab]);

  function toggleSection(sid: string) {
    setOpenSections(prev => ({ ...prev, [sid]: !prev[sid] }));
  }

  // Navigate to a tab from search results or the Overview cards. Clears the
  // search so the sidebar returns to its normal section layout, expands the
  // owning section, and switches the active tab.
  function goTo(tabId: string) {
    if (!tabById[tabId]) return;
    setSearchQuery('');
    setOpenSections(prev => ({ ...prev, [sectionContaining(tabId)]: true }));
    setTab(tabId);
  }

  const activeTabLabel = useMemo(() => tabById[tab]?.label ?? '', [tab]);

  return (
    <div className={styles['overlay']} onClick={e => e.target === e.currentTarget && onClose()}>
      <div ref={trapRef} className={styles['panel']} role="dialog" aria-modal="true" aria-label="Calendar settings">
        <div className={styles['panelHead']}>
          <h2 className={styles['panelTitle']}>Calendar Settings</h2>
          <div className={styles['panelHeadRight']}>
            <SavedFlash visible={flash} />
            <button className={styles['closeBtn']} onClick={onClose} aria-label="Close settings">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className={styles['layout']}>
          <nav className={styles['sidebar']} aria-label="Calendar settings sections">
            <div className={styles['sidebarSearchWrap']}>
              <input
                type="search"
                className={styles['sidebarSearch']}
                placeholder="Search settings…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Search settings"
              />
            </div>

            {searchQuery.trim() ? (
              <div className={styles['searchResults']} role="tablist" aria-label="Search results">
                {searchResults.length === 0 && (
                  <div className={styles['searchEmpty']}>No matching settings</div>
                )}
                {searchResults.map((r, i) => (
                  <button
                    key={`${r.tabId}-${i}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === r.tabId}
                    className={[styles['searchResult'], tab === r.tabId && styles['activeTab']].filter(Boolean).join(' ')}
                    onClick={() => goTo(r.tabId)}
                  >
                    <span className={styles['searchResultLabel']}>{r.label}</span>
                    <span className={styles['searchResultTab']}>{r.tabLabel}</span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  ref={(node) => { if (node) tabRefs.current['overview'] = node; }}
                  className={[styles['tab'], styles['overviewTab'], tab === 'overview' && styles['activeTab']].filter(Boolean).join(' ')}
                  onClick={() => setTab('overview')}
                  role="tab"
                  aria-selected={tab === 'overview'}
                >Overview</button>

                {visibleSections.map(section => {
                  const isOpen = !!openSections[section.id];
                  const headerId = `cfg-section-${section.id}-header`;
                  const panelId  = `cfg-section-${section.id}-panel`;
                  return (
                    <div key={section.id} className={styles['sectionGroup']}>
                      <button
                        type="button"
                        id={headerId}
                        className={styles['sectionHeader']}
                        onClick={() => toggleSection(section.id)}
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                      >
                        <ChevronDown
                          size={14}
                          className={[styles['chevron'], isOpen && styles['chevronOpen']].filter(Boolean).join(' ')}
                          aria-hidden="true"
                        />
                        <span className={styles['sectionLabel']}>{section.label}</span>
                      </button>
                      {isOpen && (
                        <div
                          id={panelId}
                          role="tablist"
                          aria-labelledby={headerId}
                          className={styles['sectionTabs']}
                        >
                          {section.tabs.map(tabId => {
                            const t = tabById[tabId];
                            if (!t) return null;
                            return (
                              <button
                                key={t.id}
                                ref={(node) => { if (node) tabRefs.current[t.id] = node; }}
                                className={[styles['tab'], tab === t.id && styles['activeTab']].filter(Boolean).join(' ')}
                                onClick={() => setTab(t.id)}
                                role="tab"
                                aria-selected={tab === t.id}
                              >{t.label}</button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </nav>

          <div className={styles['body']} aria-label={activeTabLabel}>
          {tab === 'overview'    && <OverviewTab goTo={goTo} />}
          {tab === 'setup'       && <SetupTab config={config} onUpdate={onUpdate} onReopenSetup={onReopenSetup} goToTab={setTab} savedViewCount={savedViews?.length ?? 0} />}
          {tab === 'hoverCard'   && <HoverCardTab   config={config} onUpdate={onUpdate} />}
          {tab === 'eventFields' && <EventFieldsTab config={config} categories={categories} onUpdate={onUpdate} />}
          {tab === 'categories'  && <CategoriesTab   config={config} onUpdate={onUpdate} />}
          {tab === 'assets'      && <AssetsTab       config={config} onUpdate={onUpdate} items={items} />}
          {tab === 'display'     && <DisplayTab     config={config} onUpdate={onUpdate} />}
          {tab === 'feeds'       && (
            <SourcePanel
              sources={sources ?? []}
              feedErrors={feedErrors ?? []}
              isFetchingFeeds={!!isFetchingFeeds}
              onAdd={(source) => onAddSource?.(source)}
              onRemove={(id) => onRemoveSource?.(id)}
              onToggle={(id) => onToggleSource?.(id)}
              onUpdate={(id, patch) => onUpdateSource?.(id, patch)}
            />
          )}
          {tab === 'templates'   && (
            <TemplateTab
              templates={scheduleTemplates ?? []}
              onCreate={onCreateScheduleTemplate}
              onDelete={onDeleteScheduleTemplate}
              error={scheduleTemplateError}
            />
          )}
          {tab === 'smartViews'  && (
            <SmartViewsTab
              categories={categories}
              resources={resources}
              schema={schema}
              items={items}
              onSaveView={onSaveView}
              savedViews={savedViews ?? []}
              onUpdateView={onUpdateView}
              onDeleteView={onDeleteView}
              initialEditingId={initialSmartViewEditId}
            />
          )}
          {tab === 'team'        && (
            <TeamTab
              config={config}
              onUpdate={onUpdate}
              onEmployeeAdd={onEmployeeAdd}
              onEmployeeDelete={onEmployeeDelete}
            />
          )}
          {tab === 'approvals'   && <ApprovalsTab   config={config} onUpdate={onUpdate} />}
          {enableApprovalFlowsTab && tab === 'approvalFlows' && (
            <Suspense fallback={<div role="status">Loading…</div>}>
              <ApprovalFlowsTab calendarId={calendarId} />
            </Suspense>
          )}
          {tab === 'conflicts'   && <ConflictsTab   config={config} onUpdate={onUpdate} />}
          {tab === 'requestForm' && <RequestFormTab config={config} onUpdate={onUpdate} />}
          </div>
        </div>
      </div>
    </div>
  );
}

const FAMILY_DESCRIPTORS: Record<string, string> = {
  canvas:     'Clean / product UI',
  corporate:  'Polished SaaS',
  industrial: 'Rugged / practical',
  grid:       'Dense / spreadsheet',
  ops:        'Ops / control room',
  neon:       'Neon / high contrast',
};

/**
 * OverviewTab — pinned first tab in the settings panel. Lists what the user
 * can customize, grouped by user intent, so first-time users discover knobs
 * without hunting through every section.
 *
 * Each card deep-jumps to its target tab via the `goTo` callback so this
 * stays purely navigational — no settings are edited here.
 */
function OverviewTab({ goTo }: { goTo: (tabId: string) => void }) {
  const groups: Array<{ heading: string; cards: Array<{ tabId: string; title: string; desc: string }> }> = [
    {
      heading: 'Appearance',
      cards: [
        { tabId: 'setup',      title: 'Theme',         desc: 'Light / dark.' },
        { tabId: 'categories', title: 'Event Colors',  desc: 'Color and label per category.' },
        { tabId: 'setup',      title: 'Calendar name', desc: 'Title shown in the header.' },
      ],
    },
    {
      heading: 'Layout & Labels',
      cards: [
        { tabId: 'display', title: 'Default view & visible tabs', desc: 'Which view loads first and which tabs are shown.' },
        { tabId: 'display', title: 'Week start, day hours',       desc: 'Sunday/Monday and the visible day-view range.' },
        { tabId: 'display', title: 'Filter labels',               desc: 'Rename "Categories", "People", "Sources", "More".' },
      ],
    },
    {
      heading: 'Event Display',
      cards: [
        { tabId: 'hoverCard',   title: 'Hover card fields', desc: 'Show or hide time, category, resource, notes.' },
        { tabId: 'eventFields', title: 'Custom fields',     desc: 'Per-category fields shown on the event form.' },
      ],
    },
    {
      heading: 'Data',
      cards: [
        { tabId: 'team',      title: 'Employees, roles, bases', desc: 'People and the locations they belong to. Rename "Base" or "Asset" here.' },
        { tabId: 'assets',    title: 'Assets registry',         desc: 'Aircraft, vehicles, or other tracked equipment. Rename the label in Employees.' },
        { tabId: 'feeds',     title: 'External feeds',          desc: 'iCal/Google sources merged into the calendar.' },
        { tabId: 'templates', title: 'Schedule templates',      desc: 'Reusable shift patterns.' },
      ],
    },
    {
      heading: 'Saved Views',
      cards: [
        { tabId: 'smartViews', title: 'View presets', desc: 'Save a set of filters and a view as a one-click preset.' },
      ],
    },
    {
      heading: 'Workflow',
      cards: [
        { tabId: 'approvals',   title: 'Approvals',         desc: 'Tiered approval workflow for events.' },
        { tabId: 'conflicts',   title: 'Conflict rules',    desc: 'Resource-overlap, mutex, min-rest checks.' },
        { tabId: 'requestForm', title: 'Request form',      desc: 'Schema-driven form fields shown to requesters.' },
      ],
    },
  ];

  return (
    <div>
      <h3 className={styles['sectionTitle']}>What you can customize</h3>
      <p className={styles['sectionDesc']}>
        A scannable map of every setting. Click any card to jump straight to it,
        or use the search box in the sidebar to find a specific control.
      </p>
      {groups.map(group => (
        <div key={group.heading} className={styles['overviewGroup']}>
          <div className={styles['overviewHeading']}>{group.heading}</div>
          <div className={styles['overviewCards']}>
            {group.cards.map((card, i) => (
              <button
                key={`${group.heading}-${i}`}
                type="button"
                className={styles['overviewCard']}
                onClick={() => goTo(card.tabId)}
              >
                <span className={styles['overviewCardTitle']}>{card.title}</span>
                <span className={styles['overviewCardDesc']}>{card.desc}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type SetupTabProps = ConfigPanelSectionProps & {
  onReopenSetup?: (() => void) | undefined;
  goToTab: (id: string) => void;
  savedViewCount: number;
};

function SetupTab({
  config,
  onUpdate,
  onReopenSetup,
  goToTab,
  savedViewCount,
}: SetupTabProps) {
  const selectedTheme = normalizeTheme(config['setup']?.preferredTheme ?? 'canvas-light');
  const selectedMeta  = THEME_META[selectedTheme];
  const calendarName  = config['title'] ?? 'My WorksCalendar';

  // Live counts so the hub doubles as an at-a-glance status panel.
  const display       = config['display'] ?? {};
  const team          = config['team'] ?? {};
  const defaultView   = (display['defaultView'] as string | undefined) ?? 'month';
  const enabledViews  = Array.isArray(display['enabledViews']) ? (display['enabledViews'] as string[]) : [];
  const baseLabel     = (team['locationLabel'] as string | undefined) ?? 'Base';
  const formatViewLabel = (id: string) => id === 'base' ? baseLabel : id.charAt(0).toUpperCase() + id.slice(1);
  const visibleViewCount = enabledViews.length > 0 ? enabledViews.length + 2 : 8; // +2 = always-on Month/Week; total = 8
  const baseCount     = Array.isArray(team['bases']) ? (team['bases'] as unknown[]).length : 0;
  const employeeCount = Array.isArray(team['employees']) ? (team['employees'] as unknown[]).length : 0;

  const setCalendarName = (name: string) => onUpdate(c => ({ ...c, title: name }));

  const setPreferredTheme = (themeId: string) => onUpdate(c => ({
    ...c,
    setup: { ...(c['setup'] ?? {}), preferredTheme: themeId },
  }));

  return (
    <div className={styles['section']}>
      <p className={styles['sectionDesc']}>Start setup by naming your calendar and selecting a theme.</p>
      <label className={styles['formRow']}>
        <span>Calendar name</span>
        <input
          className={styles['input']}
          value={calendarName}
          onChange={(e) => setCalendarName(e.target.value)}
          maxLength={64}
          placeholder="My WorksCalendar"
        />
      </label>
      <div className={styles['themeFamilyGrid']}>
        {THEME_FAMILIES.map((family) => {
          const lightMeta = THEME_META[`${family.id}-light`];
          const darkMeta  = THEME_META[`${family.id}-dark`];
          const isSelected = selectedMeta.family === family.id;
          return (
            <div
              key={family.id}
              className={[styles['themeFamilyCard'], isSelected && styles['themeFamilyCardSelected']].filter(Boolean).join(' ')}
            >
              {/* Mini structural preview */}
              <div
                className={styles['themeFamilyPreview']}
                style={{ background: (selectedMeta.family === family.id ? selectedMeta : lightMeta).preview.bg }}
              >
                <div
                  className={styles['themeFamilyAccentBar']}
                  style={{ background: (selectedMeta.family === family.id ? selectedMeta : lightMeta).preview.accent }}
                />
                <div className={styles['themeFamilyPills']}>
                  <span
                    className={styles['themeFamilyPill']}
                    style={{
                      background: (selectedMeta.family === family.id ? selectedMeta : lightMeta).preview.accent,
                      borderRadius: '4px',
                    }}
                  />
                  <span
                    className={styles['themeFamilyPill']}
                    style={{
                      background: (selectedMeta.family === family.id ? selectedMeta : lightMeta).preview.text,
                      opacity: 0.35,
                      borderRadius: '4px',
                    }}
                  />
                </div>
              </div>
              {/* Family name + descriptor */}
              <div className={styles['themeFamilyName']}>
                {family.label}
                {isSelected && <Check size={11} />}
              </div>
              <div className={styles['themeFamilyDesc']}>{FAMILY_DESCRIPTORS[family.id]}</div>
              {/* Light / dark mode toggle */}
              <div className={styles['themeModeToggle']}>
                <button
                  className={[styles['themeModeBtn'], selectedTheme === `${family.id}-light` && styles['themeModeBtnActive']].filter(Boolean).join(' ')}
                  onClick={() => setPreferredTheme(`${family.id}-light`)}
                  aria-pressed={selectedTheme === `${family.id}-light`}
                  title={lightMeta.label}
                >
                  Light
                </button>
                <button
                  className={[styles['themeModeBtn'], selectedTheme === `${family.id}-dark` && styles['themeModeBtnActive']].filter(Boolean).join(' ')}
                  onClick={() => setPreferredTheme(`${family.id}-dark`)}
                  aria-pressed={selectedTheme === `${family.id}-dark`}
                  title={darkMeta.label}
                >
                  Dark
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Setup essentials hub ── */}
      <p className={styles['fieldGroupLabel']} style={{ marginTop: 22 }}>Setup essentials</p>
      <p className={styles['sectionDesc']}>Quick access to the rest of what the guide configures.</p>
      <div className={styles['setupHubGrid']}>
        <button type="button" className={styles['setupHubCard']} onClick={() => goToTab('display')}>
          <span className={styles['setupHubTitle']}>Default view &amp; visible tabs</span>
          <span className={styles['setupHubMeta']}>
            Default: {formatViewLabel(defaultView)} · {visibleViewCount} of 8 tabs shown
          </span>
        </button>
        <button type="button" className={styles['setupHubCard']} onClick={() => goToTab('team')}>
          <span className={styles['setupHubTitle']}>Team &amp; {baseLabel.toLowerCase()}s</span>
          <span className={styles['setupHubMeta']}>
            {employeeCount} {employeeCount === 1 ? 'employee' : 'employees'}
            {' · '}
            {baseCount} {baseCount === 1 ? baseLabel.toLowerCase() : `${baseLabel.toLowerCase()}s`}
          </span>
        </button>
        <button type="button" className={styles['setupHubCard']} onClick={() => goToTab('smartViews')}>
          <span className={styles['setupHubTitle']}>Smart views</span>
          <span className={styles['setupHubMeta']}>
            {savedViewCount} saved {savedViewCount === 1 ? 'view' : 'views'}
          </span>
        </button>
      </div>

      {onReopenSetup && (
        <div className={styles['setupReopenRow']}>
          <div className={styles['setupReopenText']}>
            <strong>Restart setup guide</strong>
            <span>
              Reopens the guided welcome flow with tabs, default view, team,
              and smart-view recipes. Existing settings stay until you change
              them in the guide.
            </span>
          </div>
          <button
            type="button"
            className={styles['setupReopenBtn']}
            onClick={onReopenSetup}
          >
            Restart setup
          </button>
        </div>
      )}
    </div>
  );
}

export function SmartViewsTab({
  categories,
  resources,
  schema = [],
  items = [],
  onSaveView,
  savedViews = [],
  onUpdateView,
  onDeleteView,
  initialEditingId,
}: SmartViewsTabProps) {
  const [editingId, setEditingId] = useState<string | null>(initialEditingId ?? null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null); // id to confirm deletion
  const builderSchema = Array.isArray(schema) ? schema : [];

  const editingView = editingId ? savedViews.find(v => v.id === editingId) : null;

  const handleUpdate = (
    id: string,
    name: string,
    filters: SmartViewFilters,
    conditions: SavedViewDraft['conditions'],
  ) => {
    onUpdateView?.(id, { name, filters: serializeFilters(filters), conditions });
    setEditingId(null);
  };

  return (
    <div className={styles['section']}>
      {/* ── Existing views list ── */}
      {savedViews.length > 0 && (
        <div className={styles['smartViewList']}>
          <p className={styles['sectionDesc']} style={{ marginBottom: 6 }}>Manage existing saved views:</p>
          {savedViews.map(view => (
            <div
              key={view.id}
              className={[styles['smartViewRow'], editingId === view.id && styles['smartViewRowEditing']].filter(Boolean).join(' ')}
            >
              <span className={styles['smartViewName']} style={{ '--chip-color': view.color ?? '#64748b' } as React.CSSProperties}>
                {view.name}
              </span>
              <div className={styles['smartViewActions']}>
                <button
                  className={styles['svActionBtn']}
                  onClick={() => setEditingId(view.id)}
                  title="Edit conditions"
                  aria-label={`Edit ${view.name}`}
                  aria-pressed={editingId === view.id}
                >
                  <Pencil size={13} />
                </button>
                {confirmDel === view.id ? (
                  <>
                    <button
                      className={[styles['svActionBtn'], styles['svDanger']].join(' ')}
                      onClick={() => { onDeleteView?.(view.id); setConfirmDel(null); if (editingId === view.id) setEditingId(null); }}
                      title="Confirm delete"
                      aria-label={`Confirm delete ${view.name}`}
                    >
                      <Check size={13} />
                    </button>
                    <button
                      className={styles['svActionBtn']}
                      onClick={() => setConfirmDel(null)}
                      title="Cancel"
                      aria-label="Cancel delete"
                    >
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <button
                    className={[styles['svActionBtn'], styles['svDanger']].join(' ')}
                    onClick={() => setConfirmDel(view.id)}
                    title={`Delete ${view.name}`}
                    aria-label={`Delete ${view.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Builder (create or edit) ── */}
      <p className={styles['sectionDesc']}>
        {editingView
          ? `Editing conditions for "${editingView.name}"`
          : 'Create saved views once categories and people are configured.'}
      </p>
      <AdvancedFilterBuilder
        key={editingId ?? '__new__'}
        schema={builderSchema}
        items={items}
        categories={categories ?? []}
        resources={resources ?? []}
        onSave={(name: string, filters: SavedViewFilters, conditions: unknown[] | null) => {
          const options: SaveViewOptions = { conditions };
          onSaveView?.(name, filters, options);
        }}
        initialName={editingView?.name ?? ''}
        initialConditions={editingView?.conditions ?? null}
        editingId={editingId}
        onUpdate={handleUpdate}
        onCancelEdit={() => setEditingId(null)}
      />
    </div>
  );
}

export function TeamTab({ config, onUpdate, onEmployeeAdd, onEmployeeDelete }: TeamTabProps) {
  const teamMembers = (config['team']?.members ?? []) as TeamMemberDraft[];
  const roles = (config['team']?.roles ?? []) as string[];
  const bases = (config['team']?.bases ?? []) as TeamBaseDraft[];
  const regions = (config['team']?.regions ?? []) as TeamRegionDraft[];

  // ── Pending new member ──────────────────────────────────────────────────────
  const [pendingName, setPendingName] = useState('');
  const [isAdding,    setIsAdding]    = useState(false);
  const pendingInputRef = useRef<HTMLInputElement | null>(null);

  // ── Role management ─────────────────────────────────────────────────────────
  const [newRole, setNewRole] = useState('');

  // ── Region management ────────────────────────────────────────────────────────
  const [newRegionName, setNewRegionName] = useState('');

  // ── Base management ─────────────────────────────────────────────────────────
  const [newBaseName,   setNewBaseName]   = useState('');
  const [newBaseRegion, setNewBaseRegion] = useState('');

  useEffect(() => {
    if (isAdding) pendingInputRef.current?.focus();
  }, [isAdding]);

  const updateTeam = (patch: TeamConfigPatch) => onUpdate(c => ({
    ...c,
    // TeamMemberDraft narrowly differs from EmployeeRecord on exact-optional
    // fields (name?: string | undefined vs name?: string) but they're the same
    // blob at runtime — see line 933 where we cast on the way in.
    team: { ...(c['team'] ?? {}), ...patch } as NonNullable<WorksCalendarConfig['team']>,
    setup: { ...(c['setup'] ?? {}), completed: true },
  }));

  const updateMembers = (nextMembers: TeamMemberDraft[]) => updateTeam({ members: nextMembers });

  // ── Role helpers ────────────────────────────────────────────────────────────
  const addRole = () => {
    const trimmed = newRole.trim();
    if (!trimmed || roles.includes(trimmed)) return;
    updateTeam({ roles: [...roles, trimmed] });
    setNewRole('');
  };

  const removeRole = (r: string) => {
    updateTeam({ roles: roles.filter(x => x !== r) });
  };

  // ── Region helpers ────────────────────────────────────────────────────────
  const addRegion = () => {
    const trimmed = newRegionName.trim();
    if (!trimmed || regions.some(r => r.name === trimmed)) return;
    const id = `region-${Date.now()}`;
    updateTeam({ regions: [...regions, { id, name: trimmed }] });
    setNewRegionName('');
  };

  const removeRegion = (id: string) => {
    updateTeam({
      regions: regions.filter(r => r.id !== id),
      // Clear regionId on any base that was assigned to the deleted region.
      bases: bases.map(b => {
        if (b.regionId !== id) return b;
        const { regionId: _r, ...rest } = b;
        return rest as TeamBaseDraft;
      }),
    });
  };

  // ── Base helpers ────────────────────────────────────────────────────────────
  const addBase = () => {
    const trimmed = newBaseName.trim();
    if (!trimmed) return;
    const id = `base-${Date.now()}`;
    const newBase: TeamBaseDraft = newBaseRegion
      ? { id, name: trimmed, regionId: newBaseRegion }
      : { id, name: trimmed };
    updateTeam({ bases: [...bases, newBase] });
    setNewBaseName('');
    setNewBaseRegion('');
  };

  const removeBase = (id: string) => {
    updateTeam({ bases: bases.filter(b => b.id !== id) });
    // clear any members assigned to the removed base
    updateMembers(teamMembers.map(m => {
      if (m.base !== id) return m;
      const { base: _b, ...rest } = m;
      return rest as TeamMemberDraft;
    }));
  };

  const renameBase = (id: string, name: string) => {
    updateTeam({ bases: bases.map(b => b.id === id ? { ...b, name } : b) });
  };

  const assignBaseRegion = (id: string, regionId: string) => {
    updateTeam({
      bases: bases.map(b => {
        if (b.id !== id) return b;
        if (!regionId) {
          const { regionId: _r, ...rest } = b;
          return rest as TeamBaseDraft;
        }
        return { ...b, regionId };
      }),
    });
  };

  // ── Member helpers ──────────────────────────────────────────────────────────
  const commitPending = () => {
    const trimmed = pendingName.trim();
    if (!trimmed) { setIsAdding(false); setPendingName(''); return; }
    const nextId = Math.max(0, ...teamMembers.map((member) => Number(member.id) || 0)) + 1;
    const newMember: TeamMemberDraft = { id: nextId, name: trimmed, color: '#8b5cf6', avatar: null };
    updateMembers([...teamMembers, newMember]);
    onEmployeeAdd?.({ id: nextId, name: trimmed, color: '#8b5cf6', avatar: null });
    setPendingName('');
    setIsAdding(false);
  };

  const cancelPending = () => {
    setPendingName('');
    setIsAdding(false);
  };

  const updateMember = (id: number, patch: Partial<TeamMemberDraft>) => {
    updateMembers(teamMembers.map((member) => (member.id === id ? { ...member, ...patch } : member)));
  };

  const removeMember = (id: number) => {
    updateMembers(teamMembers.filter((member) => member.id !== id));
    onEmployeeDelete?.(id);
  };

  const handleProfileUpload = (memberId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const nextAvatar = ev.target?.result;
      if (typeof nextAvatar === 'string') {
        updateMember(memberId, { avatar: nextAvatar });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className={styles['section']}>

      {/* ── Roles ── */}
      <p className={styles['fieldGroupLabel']}>Roles</p>
      <p className={styles['sectionDesc']}>Define the role labels available when adding employees.</p>
      {roles.map((r) => (
        <div key={r} className={styles['fieldRow']}>
          <span className={styles['fieldLabel']}>{r}</span>
          <button className={styles['removeBtn']} onClick={() => removeRole(r)} aria-label={`Remove role ${r}`}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className={styles['inlineAddRow']}>
        <input
          className={styles['input']}
          value={newRole}
          onChange={e => setNewRole(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRole(); } }}
          placeholder="New role label"
        />
        <button className={styles['addFieldBtn']} style={{ marginTop: 0 }} onClick={addRole}>
          <Plus size={13} /> Add
        </button>
      </div>

      {/* ── Regions ── */}
      <p className={styles['fieldGroupLabel']} style={{ marginTop: 16 }}>Regions</p>
      <p className={styles['sectionDesc']}>Optional top-level groupings for bases (e.g. Pacific Northwest, Rocky Mountain). Bases can then be assigned to a region.</p>
      {regions.map((r) => (
        <div key={r.id} className={styles['fieldRow']}>
          <span className={styles['fieldLabel']}>{r.name}</span>
          <button className={styles['removeBtn']} onClick={() => removeRegion(r.id)} aria-label={`Remove region ${r.name}`}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className={styles['inlineAddRow']}>
        <input
          className={styles['input']}
          value={newRegionName}
          onChange={e => setNewRegionName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRegion(); } }}
          placeholder="New region name"
        />
        <button className={styles['addFieldBtn']} style={{ marginTop: 0 }} onClick={addRegion}>
          <Plus size={13} /> Add
        </button>
      </div>

      {/* ── Bases / Locations ── */}
      <p className={styles['fieldGroupLabel']} style={{ marginTop: 16 }}>Bases / Locations</p>
      <p className={styles['sectionDesc']}>Define bases or locations. Employees can be assigned to one and the schedule can be filtered by base.</p>
      <div className={styles['fieldRow']}>
        <label style={{ fontSize: 12, color: 'var(--wc-text-muted)', marginRight: 8 }}>Label these as</label>
        <select
          className={styles['select']}
          value={config['team']?.locationLabel ?? 'Base'}
          onChange={e => updateTeam({ locationLabel: e.target.value })}
          aria-label="Location label"
        >
          <option value="Base">Base</option>
          <option value="Location">Location</option>
          <option value="Station">Station</option>
          <option value="Site">Site</option>
        </select>
      </div>

      {/* ── Asset label ── */}
      <div className={styles['fieldRow']} style={{ marginTop: 6 }}>
        <label style={{ fontSize: 12, color: 'var(--wc-text-muted)', marginRight: 8 }}>Label assets as</label>
        <input
          className={styles['input']}
          value={config['team']?.assetsLabel ?? 'Asset'}
          onChange={e => updateTeam({ assetsLabel: e.target.value || 'Asset' })}
          aria-label="Asset label"
          placeholder="Asset"
          style={{ maxWidth: 180 }}
        />
        <span style={{ fontSize: 11, color: 'var(--wc-text-muted)', marginLeft: 8 }}>
          e.g. Aircraft, Vehicle, Equipment. Plural is "{(config['team']?.assetsLabel ?? 'Asset')}s".
        </span>
      </div>
      {bases.map((b) => (
        <div key={b.id} className={styles['fieldRow']}>
          <input
            className={styles['input']}
            value={b.name}
            onChange={e => renameBase(b.id, e.target.value)}
            placeholder="Base name"
          />
          {regions.length > 0 && (
            <select
              className={styles['select']}
              value={b.regionId ?? ''}
              onChange={e => assignBaseRegion(b.id, e.target.value)}
              aria-label={`Region for ${b.name}`}
              style={{ maxWidth: 160 }}
            >
              <option value="">— no region —</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <button className={styles['removeBtn']} onClick={() => removeBase(b.id)} aria-label={`Remove base ${b.name}`}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className={styles['inlineAddRow']} style={{ flexWrap: 'wrap', gap: 6 }}>
        <input
          className={styles['input']}
          value={newBaseName}
          onChange={e => setNewBaseName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBase(); } }}
          placeholder="New base name"
          style={{ flex: '1 1 140px', minWidth: 120 }}
        />
        {regions.length > 0 && (
          <select
            className={styles['select']}
            value={newBaseRegion}
            onChange={e => setNewBaseRegion(e.target.value)}
            aria-label="Assign to region"
            style={{ flex: '1 1 140px', minWidth: 120 }}
          >
            <option value="">— region (optional) —</option>
            {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <button className={styles['addFieldBtn']} style={{ marginTop: 0 }} onClick={addBase}>
          <Plus size={13} /> Add
        </button>
      </div>

      {/* ── Employees ── */}
      <p className={styles['fieldGroupLabel']} style={{ marginTop: 16 }}>Employees</p>
      <p className={styles['sectionDesc']}>
        Assign a base, a phone number, and optional Accountable Manager titles
        (Base / Ops / Maintenance, etc.). Managers surface in the Base Gantt
        view header so every point-of-contact for a base is one tap away.
      </p>
      {teamMembers.map((member) => {
        const managers: Array<{ title?: string | undefined; phone?: string | undefined }> =
          Array.isArray(member.accountableManagers) ? member.accountableManagers : [];

        const setManagers = (next: ManagerAssignment[]) => updateMember(member.id, { accountableManagers: next });
        const addManager = () => setManagers([...managers, { title: '', phone: '' }]);
        const updateManager = (idx: number, patch: Partial<ManagerAssignment>) =>
          setManagers(managers.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
        const removeManager = (idx: number) => setManagers(managers.filter((_, i) => i !== idx));

        return (
          <div key={member.id} className={styles['memberBlock']}>
            <div className={styles['memberRow']}>
              <label className={styles['avatarPicker']}>
                <div className={styles['avatarFrame']}>
                  {member.avatar ? (
                    <img src={member.avatar} alt={`${member.name || 'Employee'} avatar`} className={styles['avatarImg']} />
                  ) : (
                    <div className={styles['avatarFallback']} style={{ backgroundColor: member.color }}>
                      {(member.name?.trim()?.[0] ?? '?').toUpperCase()}
                    </div>
                  )}
                </div>
                <input type="file" accept="image/*" className={styles['fileInput']} onChange={(e) => handleProfileUpload(member.id, e)} />
                <span className={styles['avatarBadge']}><Camera size={11} /> Photo</span>
              </label>
              <input
                className={styles['input']}
                value={member.name ?? ''}
                onChange={(e) => updateMember(member.id, { name: e.target.value })}
                placeholder="Employee name"
              />
              <button className={styles['removeBtn']} onClick={() => removeMember(member.id)} aria-label={`Remove ${member.name || 'employee'}`}>
                <Trash2 size={13} />
              </button>
            </div>
            <div className={styles['memberMeta']}>
              <select
                className={styles['select']}
                value={member.role ?? ''}
                onChange={e => updateMember(member.id, { role: e.target.value || undefined })}
                aria-label="Role"
              >
                <option value="">— select role —</option>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              {bases.length > 0 && (
                <select
                  className={styles['select']}
                  value={member.base ?? ''}
                  onChange={e => updateMember(member.id, { base: e.target.value || undefined })}
                  aria-label="Base"
                >
                  <option value="">— no base —</option>
                  {bases.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              <input
                className={styles['input']}
                type="tel"
                value={member.phone ?? ''}
                onChange={e => updateMember(member.id, { phone: e.target.value || undefined })}
                placeholder="Phone"
                aria-label="Phone number"
              />
            </div>
            <div className={styles['managerBlock']}>
              <span className={styles['managerBlockLabel']}>Accountable manager titles</span>
              {managers.map((mgr, idx) => (
                <div key={idx} className={styles['managerEntry']}>
                  <select
                    className={styles['select']}
                    value={mgr.title ?? ''}
                    onChange={e => updateManager(idx, { title: e.target.value || undefined })}
                    aria-label="Manager title"
                  >
                    <option value="">— select title —</option>
                    {MANAGER_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                    {mgr.title && !MANAGER_TITLES.includes(mgr.title) && (
                      <option value={mgr.title}>{mgr.title}</option>
                    )}
                  </select>
                  <input
                    className={styles['input']}
                    type="tel"
                    value={mgr.phone ?? ''}
                    onChange={e => updateManager(idx, { phone: e.target.value || undefined })}
                    placeholder="Manager phone (optional)"
                    aria-label="Manager phone"
                  />
                  <button
                    type="button"
                    className={styles['removeBtn']}
                    onClick={() => removeManager(idx)}
                    aria-label="Remove manager assignment"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button type="button" className={styles['managerAddBtn']} onClick={addManager}>
                <Plus size={11} /> Add manager title
              </button>
            </div>
          </div>
        );
      })}
      {isAdding ? (
        <div className={styles['memberRow']}>
          <div className={styles['avatarPicker']}>
            <div className={styles['avatarFrame']}>
              <div className={styles['avatarFallback']} style={{ backgroundColor: '#8b5cf6' }}>
                {(pendingName.trim()?.[0] ?? '?').toUpperCase()}
              </div>
            </div>
          </div>
          <input
            ref={pendingInputRef}
            className={styles['input']}
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitPending(); }
              if (e.key === 'Escape') { e.preventDefault(); cancelPending(); }
            }}
            onBlur={commitPending}
            placeholder="Employee name"
          />
          <button
            className={styles['removeBtn']}
            onMouseDown={(e) => e.preventDefault()}
            onClick={commitPending}
            aria-label="Add employee"
          >
            <Check size={13} />
          </button>
        </div>
      ) : (
        <button className={styles['addFieldBtn']} onClick={() => setIsAdding(true)}>
          <Plus size={13} /> Add employee
        </button>
      )}
    </div>
  );
}

function TemplateTab({ templates, onCreate, onDelete, error }: TemplateTabProps) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<TemplateVisibility>('team');
  const [title, setTitle] = useState('');
  const [startOffsetMinutes, setStartOffsetMinutes] = useState<number | string>(0);
  const [durationMinutes, setDurationMinutes] = useState<number | string>(60);
  const [rrule, setRrule] = useState('FREQ=DAILY');

  function resetForm() {
    setName('');
    setVisibility('team');
    setTitle('');
    setStartOffsetMinutes(0);
    setDurationMinutes(60);
    setRrule('FREQ=DAILY');
  }

  async function handleCreate() {
    if (!onCreate) return;
    const cleanName = name.trim();
    const cleanTitle = title.trim();
    if (!cleanName || !cleanTitle) return;
    await onCreate({
      name: cleanName,
      visibility,
      entries: [{
        title: cleanTitle,
        startOffsetMinutes: Number(startOffsetMinutes) || 0,
        durationMinutes: Math.max(1, Number(durationMinutes) || 1),
        rrule: rrule.trim() || undefined,
      }],
    });
    resetForm();
  }

  return (
    <div className={styles['section']}>
      <p className={styles['sectionDesc']}>Create and govern schedule templates for Add Schedule flows.</p>

      {error && <div className={styles['sectionDesc']} role="alert">{error}</div>}

      <label className={styles['formRow']}>
        <span>Template name</span>
        <input className={styles['input']} value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning coverage" />
      </label>
      <div className={styles['formRow']}>
        <span>Visibility</span>
        <select className={styles['select']} value={visibility} onChange={(e) => setVisibility(e.target.value as TemplateVisibility)}>
          <option value="private">Private</option>
          <option value="team">Team</option>
          <option value="org">Org</option>
        </select>
      </div>
      <label className={styles['formRow']}>
        <span>Default entry title</span>
        <input className={styles['input']} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Primary shift" />
      </label>
      <label className={styles['formRow']}>
        <span>Offset (minutes)</span>
        <input className={styles['input']} type="number" value={startOffsetMinutes} onChange={(e) => setStartOffsetMinutes(e.target.value)} />
      </label>
      <label className={styles['formRow']}>
        <span>Duration (minutes)</span>
        <input className={styles['input']} type="number" min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
      </label>
      <label className={styles['formRow']}>
        <span>RRULE</span>
        <input className={styles['input']} value={rrule} onChange={(e) => setRrule(e.target.value)} />
      </label>
      <button className={styles['addFieldBtn']} onClick={handleCreate} disabled={!onCreate}>Create template</button>

      {templates.map((template) => (
        <div key={template.id} className={styles['fieldRow']}>
          <div>
            <strong>{template.name}</strong>
            <div className={styles['sectionDesc']}>
              {String(template['visibility'] ?? 'org')} · {(Array.isArray(template['entries']) ? template['entries'].length : 0)} entr{((Array.isArray(template['entries']) ? template['entries'].length : 0)) === 1 ? 'y' : 'ies'}
            </div>
          </div>
          <button className={styles['removeBtn']} onClick={() => { if (template.id !== undefined) onDelete?.(template.id); }} disabled={!onDelete || template.id === undefined}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ----- HoverCard tab ----- */
function HoverCardTab({ config, onUpdate }: ConfigPanelSectionProps) {
  const hc = config['hoverCard'] ?? {};
  type HoverCardFieldKey = 'showTime' | 'showCategory' | 'showResource' | 'showMeta' | 'showNotes';

  const toggle = (key: HoverCardFieldKey) =>
    onUpdate(c => {
      const prev = c['hoverCard'] ?? {};
      return { ...c, hoverCard: { ...prev, [key]: !prev[key] } };
    });

  const fields: Array<{ key: HoverCardFieldKey; label: string }> = [
    { key: 'showTime',     label: 'Time' },
    { key: 'showCategory', label: 'Category' },
    { key: 'showResource', label: 'Resource' },
    { key: 'showMeta',     label: 'Custom fields (meta)' },
    { key: 'showNotes',    label: 'Notes' },
  ];

  return (
    <div className={styles['section']}>
      <p className={styles['sectionDesc']}>Choose which fields are visible in the event hover card.</p>
      {fields.map(f => (
        <label key={f.key} className={styles['toggle']}>
          <span>{f.label}</span>
          <input type="checkbox" checked={!!hc[f.key]} onChange={() => toggle(f.key)} />
          <span className={styles['toggleTrack']} />
        </label>
      ))}
    </div>
  );
}

/* ----- EventFields tab ----- */
function EventFieldsTab({ config, categories, onUpdate }: ConfigPanelSectionProps & { categories: string[] }) {
  const [selCat, setSelCat] = useState(categories[0] || '');
  const [newCat, setNewCat] = useState('');

  const eventFields = (config['eventFields'] ?? {}) as EventFieldsByCategory;
  const fields = eventFields[selCat] || [];

  function addField() {
    onUpdate(c => ({
      ...c,
      eventFields: {
        ...c['eventFields'],
        [selCat]: [...(c['eventFields']?.[selCat] || []), { name: '', type: 'text', required: false, options: '' }],
      },
    }));
  }

  function updateField(idx: number, patch: Partial<EventFieldDraft>) {
    onUpdate(c => {
      const arr = [...(((c['eventFields'] ?? {}) as EventFieldsByCategory)[selCat] || [])];
      const existing = arr[idx];
      if (existing !== undefined) arr[idx] = { ...existing, ...patch };
      return { ...c, eventFields: { ...c['eventFields'], [selCat]: arr } };
    });
  }

  function removeField(idx: number) {
    onUpdate(c => {
      const existing = (((c['eventFields'] ?? {}) as EventFieldsByCategory)[selCat] || []) as EventFieldDraft[];
      const arr = existing.filter((_, i) => i !== idx);
      return { ...c, eventFields: { ...c['eventFields'], [selCat]: arr } };
    });
  }

  function addCategory() {
    const cat = newCat.trim();
    if (!cat) return;
    setSelCat(cat);
    setNewCat('');
    onUpdate(c => ({ ...c, eventFields: { ...c['eventFields'], [cat]: [] } }));
  }

  const allCats = Array.from(new Set([...categories, ...Object.keys(eventFields)]));

  return (
    <div className={styles['section']}>
      <p className={styles['sectionDesc']}>Define custom fields per category. These appear in the event add/edit form.</p>

      <div className={styles['catRow']}>
        <select className={styles['select']} value={selCat} onChange={e => setSelCat(e.target.value)}>
          {allCats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className={styles['input']} value={newCat} onChange={e => setNewCat(e.target.value)}
          placeholder="New category…" onKeyDown={e => e.key === 'Enter' && addCategory()} />
        <button className={styles['addBtn']} onClick={addCategory}><Plus size={14} /></button>
      </div>

      {selCat && (
        <>
          {fields.map((f, i) => (
            <div key={i} className={styles['fieldRow']}>
              <input className={styles['input']} value={f.name}
                onChange={e => updateField(i, { name: e.target.value })} placeholder="Field name" />
              <select className={styles['select']} value={f.type}
                onChange={e => updateField(i, { type: e.target.value as EventFieldType })}>
                {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {f.type === 'select' && (
                <input className={styles['input']} value={f.options || ''}
                  onChange={e => updateField(i, { options: e.target.value })}
                  placeholder="Option 1, Option 2, …" />
              )}
              <label className={styles['reqLabel']}>
                <input type="checkbox" checked={!!f.required} onChange={e => updateField(i, { required: e.target.checked })} />
                Required
              </label>
              <button className={styles['removeBtn']} onClick={() => removeField(i)}><Trash2 size={13} /></button>
            </div>
          ))}
          <button className={styles['addFieldBtn']} onClick={addField}><Plus size={13} /> Add field</button>
        </>
      )}
    </div>
  );
}

/* ----- Categories tab ----- */
/**
 * Owner-editable CategoriesConfig. Persists to config.categoriesConfig;
 * WorksCalendar merges `props.categoriesConfig ?? config.categoriesConfig ??
 * { categories: DEFAULT_CATEGORIES }`. Category hue drives AssetsView pill
 * color; id is the key referenced by event.category.
 */
export function CategoriesTab({ config, onUpdate }: ConfigPanelSectionProps) {
  const current = (config['categoriesConfig'] ?? { categories: DEFAULT_CATEGORIES }) as CategoriesConfig;
  const cats = current.categories ?? [];
  const pillStyle = current.pillStyle ?? 'hue';
  const defaultId = current.defaultCategoryId ?? cats[0]?.id ?? '';

  /**
   * Shallow-merges `patch` into `config.categoriesConfig`, seeding the
   * object with `{ categories: DEFAULT_CATEGORIES }` if the owner never
   * set it. Every other mutator in this tab funnels through here so the
   * baseline shape is always preserved.
   */
  const patchConfig = (patch: CategoriesPatch) => onUpdate(c => ({
    ...c,
    categoriesConfig: { ...(c['categoriesConfig'] ?? { categories: DEFAULT_CATEGORIES }), ...patch },
  }));

  /** Replaces the full `categories` array; convenience wrapper over `patchConfig`. */
  const patchCats = (next: CategoryDef[]) => patchConfig({ categories: next });

  /**
   * Patches a single category at `idx` by index. Unknown indices are a
   * no-op because `.map` simply yields an identical array. Callers use
   * this for color / label / id / disabled edits.
   */
  const updateCat = (idx: number, patch: CategoryPatch) => {
    const next = cats.map((cat, i) => (i === idx ? { ...cat, ...patch } : cat));
    patchCats(next);
  };

  /**
   * Appends a new blank category with a deterministic id (`category-<N>`)
   * and a neutral slate color so the owner can immediately customize it.
   * The id uses the post-append length to stay unique without a UUID dep.
   */
  const addCat = () => {
    const n = cats.length + 1;
    patchCats([...cats, { id: `category-${n}`, label: `Category ${n}`, color: '#64748b' }]);
  };

  /** Removes the category at `idx`; history events keep their original category id. */
  const removeCat = (idx: number) => patchCats(cats.filter((_, i) => i !== idx));

  /**
   * Restores the DEFAULT_CATEGORIES seed + default pillStyle + default
   * categoryId in one atomic update. Clones entries so later edits can't
   * mutate the exported `DEFAULT_CATEGORIES` constant.
   */
  const resetToDefaults = () => patchConfig({
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    pillStyle: 'hue',
    defaultCategoryId: DEFAULT_CATEGORIES[0]!.id,
  });

  return (
    <div className={styles['section']}>
      <p className={styles['sectionDesc']}>
        Configure event categories. Color drives pill hue on Assets and Timeline;
        disabling a category hides it from new-event pickers but keeps history intact.
      </p>

      <div className={styles['formRow']}>
        <span>Pill style</span>
        <select
          className={styles['select']}
          value={pillStyle}
          onChange={e => patchConfig({ pillStyle: e.target.value as CategoriesConfig['pillStyle'] })}
          aria-label="Pill style"
        >
          <option value="hue">Hue (full fill)</option>
          <option value="stripe">Stripe (left edge)</option>
          <option value="border">Border only</option>
        </select>
      </div>

      <div className={styles['formRow']}>
        <span>Default category</span>
        <select
          className={styles['select']}
          value={defaultId}
          onChange={e => patchConfig({ defaultCategoryId: e.target.value })}
          aria-label="Default category"
        >
          {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>

      {cats.map((cat, i) => (
        <div key={cat.id + ':' + i} className={styles['fieldRow']} data-category-id={cat.id}>
          <input
            type="color"
            className={styles['input']}
            style={{ width: 52, padding: 2 }}
            value={cat.color}
            onChange={e => updateCat(i, { color: e.target.value })}
            aria-label={`Color for ${cat.label}`}
          />
          <input
            className={styles['input']}
            value={cat.label}
            onChange={e => updateCat(i, { label: e.target.value })}
            placeholder="Label"
            aria-label={`Label for ${cat.id}`}
          />
          <input
            className={styles['input']}
            value={cat.id}
            onChange={e => updateCat(i, { id: e.target.value.trim() || cat.id })}
            placeholder="id"
            aria-label={`Id for ${cat.label}`}
          />
          <label className={styles['reqLabel']}>
            <input
              type="checkbox"
              checked={!!cat.disabled}
              onChange={e => updateCat(i, { disabled: e.target.checked })}
            />
            Disabled
          </label>
          <button
            className={styles['removeBtn']}
            onClick={() => removeCat(i)}
            aria-label={`Remove ${cat.label}`}
          ><Trash2 size={13} /></button>
        </div>
      ))}

      <button className={styles['addFieldBtn']} onClick={addCat}>
        <Plus size={13} /> Add category
      </button>

      <div className={styles['formRow']} style={{ marginTop: 16 }}>
        <span>Reset to shipped defaults</span>
        <button className={styles['addBtn']} onClick={resetToDefaults}>Reset</button>
      </div>
    </div>
  );
}

/* ----- Assets tab ----- */
/**
 * Owner-editable asset registry. Persists to config.assets; WorksCalendar
 * threads `props.assets ?? config.assets` into AssetsView. An empty array
 * preserves the legacy event.resource-derived behavior so the tab is
 * strictly additive — existing calendars keep rendering unchanged until the
 * owner adds at least one asset.
 *
 * Each entry: { id, label, group?, meta: { sublabel? } }
 *   id     — matched against event.resource; stable key, not user-facing.
 *   label  — display name rendered in the AssetsView rowheader.
 *   group  — optional group bucket (e.g. "CJ3", "West"); surfaces in
 *            groupBy dropdowns added by ticket 10.
 *   meta   — free-form; sublabel appears under label in the asset cell.
 */
const REQUIRED_ASSET_META_KEYS = ['registrationNumber', 'type', 'make', 'model'] as const;

function hasAllRequiredAssetFields(asset: AssetDraft | null | undefined) {
  if (!asset) return false;
  const meta = asset.meta ?? {};
  return REQUIRED_ASSET_META_KEYS.every(k => String(meta[k] ?? '').trim().length > 0);
}

function createDraftAsset(nextIndex: number): AssetDraft {
  return {
    _key: `draft-${Date.now()}-${nextIndex}`,
    id: `asset-${nextIndex}`,
    label: `Asset ${nextIndex}`,
    group: '',
    meta: {
      registrationNumber: '',
      type: '',
      make: '',
      model: '',
      limitations: '',
    },
  };
}

export function AssetsTab({ config, onUpdate, items = [] }: AssetsTabProps) {
  const assets = (Array.isArray(config['assets']) ? config['assets'] : []) as AssetDraft[];
  // Draft row for new asset creation. Kept in local state so partially-filled
  // rows never enter config.assets — the only entry point is saveDraft(),
  // which requires all four of registrationNumber/type/make/model (#196).
  const [draftAsset, setDraftAsset] = useState<AssetDraft | null>(null);

  const writeAssets = (next: AssetDraft[]) => onUpdate(c => ({ ...c, assets: next }));

  const addAsset = () => {
    if (draftAsset) return;
    setDraftAsset(createDraftAsset(assets.length + 1));
  };

  const updateDraft = (patch: AssetPatch) => {
    setDraftAsset(prev => (prev ? { ...prev, ...patch } : prev));
  };

  const updateDraftMeta = (metaPatch: AssetMetaPatch) => {
    setDraftAsset(prev => (
      prev ? { ...prev, meta: { ...(prev.meta ?? {}), ...metaPatch } } : prev
    ));
  };

  const cancelDraft = () => setDraftAsset(null);

  const saveDraft = () => {
    if (!draftAsset || !hasAllRequiredAssetFields(draftAsset)) return;
    writeAssets([...assets, draftAsset]);
    setDraftAsset(null);
  };

  const updateAsset = (idx: number, patch: AssetPatch) => {
    writeAssets(assets.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };

  const updateAssetMeta = (idx: number, metaPatch: AssetMetaPatch) => {
    writeAssets(assets.map((a, i) => (
      i === idx ? { ...a, meta: { ...(a.meta ?? {}), ...metaPatch } } : a
    )));
  };

  const removeAsset = (idx: number) => writeAssets(assets.filter((_, i) => i !== idx));

  const moveAsset = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= assets.length) return;
    const next = [...assets];
    const [moved] = next.splice(idx, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    writeAssets(next);
  };

  return (
    <div className={styles['section']}>
      <p className={styles['sectionDesc']}>
        Register the assets that appear as rows in the Assets view. Rows
        follow this order; leave empty to fall back to deriving rows from
        <code> event.resource</code> values.
      </p>

      {assets.map((asset, i) => {
        const status = getAssetStatus(asset.id, items);
        return (
        <div key={asset._key ?? i} className={styles['assetRow']} data-asset-id={asset.id}>
          <div className={styles['assetFields']}>
            <div className={styles['assetField']}>
              <span className={styles['assetFieldLabel']}>Label</span>
              <input
                className={styles['input']}
                value={asset.label ?? ''}
                onChange={e => updateAsset(i, { label: e.target.value })}
                aria-label={`Label for ${asset.id}`}
              />
              <span
                className={[styles['assetStatusBadge'], styles[`assetStatusBadge_${status}`]]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={`Status: ${status}`}
              >
                {status}
              </span>
            </div>
            <div className={styles['assetField']}>
              <span className={styles['assetFieldLabel']}>ID</span>
              <input
                className={styles['input']}
                value={asset.id}
                onChange={e => updateAsset(i, { id: e.target.value.trim() || asset.id })}
                aria-label={`Id for ${asset.label || asset.id}`}
              />
            </div>
            <div className={styles['assetField']}>
              <span className={styles['assetFieldLabel']}>Group</span>
              <input
                className={styles['input']}
                value={asset.group ?? ''}
                onChange={e => updateAsset(i, { group: e.target.value })}
                aria-label={`Group for ${asset.label || asset.id}`}
              />
            </div>
            <div className={styles['assetField']}>
              <span className={styles['assetFieldLabel']}>Sublabel</span>
              <input
                className={styles['input']}
                value={asset.meta?.sublabel ?? ''}
                onChange={e => updateAssetMeta(i, { sublabel: e.target.value })}
                aria-label={`Sublabel for ${asset.label || asset.id}`}
              />
            </div>
            {(() => {
              const regValue = asset.meta?.registrationNumber ?? '';
              const typeValue = asset.meta?.type ?? '';
              const makeValue = asset.meta?.make ?? '';
              const modelValue = asset.meta?.model ?? '';
              const limitationsValue = asset.meta?.limitations ?? '';
              const requiredFields = [
                { key: 'registrationNumber', label: 'Registration Number', value: regValue },
                { key: 'type',               label: 'Type',                value: typeValue },
                { key: 'make',               label: 'Make',                value: makeValue },
                { key: 'model',              label: 'Model',               value: modelValue },
              ];
              return (
                <>
                  {requiredFields.map(f => {
                    const invalid = !String(f.value).trim();
                    const errorId = `asset-${i}-${f.key}-error`;
                    return (
                      <div key={f.key} className={styles['assetField']}>
                        <span className={styles['assetFieldLabel']}>
                          {f.label} <span className={styles['assetFieldRequired']} aria-hidden="true">*</span>
                        </span>
                        <input
                          className={styles['input']}
                          value={f.value}
                          onChange={e => updateAssetMeta(i, { [f.key]: e.target.value })}
                          aria-label={`${f.label} for ${asset.label || asset.id}`}
                          aria-required="true"
                          aria-invalid={invalid || undefined}
                          aria-describedby={invalid ? errorId : undefined}
                          required
                        />
                        {invalid && (
                          <span
                            id={errorId}
                            className={styles['assetFieldError']}
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                          >
                            {f.label} is required.
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <div className={[styles['assetField'], styles['assetFieldWide']].filter(Boolean).join(' ')}>
                    <span className={styles['assetFieldLabel']}>Limitations</span>
                    <textarea
                      className={styles['input']}
                      value={limitationsValue}
                      onChange={e => updateAssetMeta(i, { limitations: e.target.value })}
                      aria-label={`Limitations for ${asset.label || asset.id}`}
                      rows={2}
                    />
                  </div>
                </>
              );
            })()}
          </div>
          <div className={styles['assetActions']}>
            <button
              className={styles['removeBtn']}
              onClick={() => moveAsset(i, -1)}
              disabled={i === 0}
              aria-label={`Move ${asset.label || asset.id} up`}
            ><ArrowUp size={13} /></button>
            <button
              className={styles['removeBtn']}
              onClick={() => moveAsset(i, 1)}
              disabled={i === assets.length - 1}
              aria-label={`Move ${asset.label || asset.id} down`}
            ><ArrowDown size={13} /></button>
            <button
              className={styles['removeBtn']}
              onClick={() => removeAsset(i)}
              aria-label={`Remove ${asset.label || asset.id}`}
            ><Trash2 size={13} /></button>
          </div>
        </div>
        );
      })}

      {draftAsset && (() => {
        const regValue = draftAsset.meta?.registrationNumber ?? '';
        const typeValue = draftAsset.meta?.type ?? '';
        const makeValue = draftAsset.meta?.make ?? '';
        const modelValue = draftAsset.meta?.model ?? '';
        const limitationsValue = draftAsset.meta?.limitations ?? '';
        const requiredFields = [
          { key: 'registrationNumber', label: 'Registration Number', value: regValue },
          { key: 'type',               label: 'Type',                value: typeValue },
          { key: 'make',               label: 'Make',                value: makeValue },
          { key: 'model',              label: 'Model',               value: modelValue },
        ];
        const canSave = hasAllRequiredAssetFields(draftAsset);
        return (
          <div
            className={[styles['assetRow'], styles['assetRowDraft']].filter(Boolean).join(' ')}
            data-asset-draft="true"
            role="group"
            aria-label="New asset draft"
          >
            <div className={styles['assetFields']}>
              <div className={styles['assetField']}>
                <span className={styles['assetFieldLabel']}>Label</span>
                <input
                  className={styles['input']}
                  value={draftAsset.label ?? ''}
                  onChange={e => updateDraft({ label: e.target.value })}
                  aria-label="Label for new asset"
                />
              </div>
              <div className={styles['assetField']}>
                <span className={styles['assetFieldLabel']}>ID</span>
                <input
                  className={styles['input']}
                  value={draftAsset.id}
                  onChange={e => updateDraft({ id: e.target.value.trim() || draftAsset.id })}
                  aria-label="Id for new asset"
                />
              </div>
              <div className={styles['assetField']}>
                <span className={styles['assetFieldLabel']}>Group</span>
                <input
                  className={styles['input']}
                  value={draftAsset.group ?? ''}
                  onChange={e => updateDraft({ group: e.target.value })}
                  aria-label="Group for new asset"
                />
              </div>
              <div className={styles['assetField']}>
                <span className={styles['assetFieldLabel']}>Sublabel</span>
                <input
                  className={styles['input']}
                  value={draftAsset.meta?.sublabel ?? ''}
                  onChange={e => updateDraftMeta({ sublabel: e.target.value })}
                  aria-label="Sublabel for new asset"
                />
              </div>
              {requiredFields.map(f => {
                const invalid = !String(f.value).trim();
                const errorId = `asset-draft-${f.key}-error`;
                return (
                  <div key={f.key} className={styles['assetField']}>
                    <span className={styles['assetFieldLabel']}>
                      {f.label} <span className={styles['assetFieldRequired']} aria-hidden="true">*</span>
                    </span>
                    <input
                      className={styles['input']}
                      value={f.value}
                      onChange={e => updateDraftMeta({ [f.key]: e.target.value })}
                      aria-label={`${f.label} for new asset`}
                      aria-required="true"
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? errorId : undefined}
                      required
                    />
                    {invalid && (
                      <span
                        id={errorId}
                        className={styles['assetFieldError']}
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {f.label} is required.
                      </span>
                    )}
                  </div>
                );
              })}
              <div className={[styles['assetField'], styles['assetFieldWide']].filter(Boolean).join(' ')}>
                <span className={styles['assetFieldLabel']}>Limitations</span>
                <textarea
                  className={styles['input']}
                  value={limitationsValue}
                  onChange={e => updateDraftMeta({ limitations: e.target.value })}
                  aria-label="Limitations for new asset"
                  rows={2}
                />
              </div>
            </div>
            <div className={styles['assetActions']}>
              <button
                type="button"
                className={styles['assetDraftSaveBtn']}
                onClick={saveDraft}
                disabled={!canSave}
                aria-label="Save new asset"
                title={canSave ? 'Save new asset' : 'Fill in required fields to save'}
              ><Check size={13} /></button>
              <button
                type="button"
                className={styles['removeBtn']}
                onClick={cancelDraft}
                aria-label="Cancel new asset"
              ><X size={13} /></button>
            </div>
          </div>
        );
      })()}

      <button
        className={styles['addFieldBtn']}
        onClick={addAsset}
        disabled={!!draftAsset}
        aria-disabled={!!draftAsset || undefined}
        title={draftAsset ? 'Finish the draft asset first' : undefined}
      >
        <Plus size={13} /> Add asset
      </button>
    </div>
  );
}

/* ----- Display tab ----- */
function DisplayTab({ config, onUpdate }: ConfigPanelSectionProps) {
  const d = config['display'] ?? {};
  const labels = config['filterUi']?.groupLabels ?? {};
  const set = (key: string, val: unknown) => onUpdate(c => ({ ...c, display: { ...(c['display'] ?? {}), [key]: val } }));
  const setGroupLabel = (key: 'categories' | 'resources' | 'sources' | 'more', val: string) =>
    onUpdate(c => ({
      ...c,
      filterUi: {
        ...c['filterUi'],
        groupLabels: {
          ...(c['filterUi']?.groupLabels ?? {}),
          [key]: val,
        },
      },
    }));

  const enabledViews: string[] = Array.isArray(d.enabledViews) ? d.enabledViews : [];
  const toggleEnabledView = (id: string, on: boolean) => {
    const next = on
      ? Array.from(new Set([...enabledViews, id]))
      : enabledViews.filter(v => v !== id);
    set('enabledViews', next);
  };

  // Chrome (panels & bars) — every flag defaults to "shown" (true) when
  // absent, so an untouched calendar keeps its full layout.
  const chrome = (d.chrome ?? {}) as Record<string, unknown>;
  const setChrome = (key: string, on: boolean) =>
    set('chrome', { ...chrome, [key]: on });

  return (
    <div className={styles['section']}>
      <div className={styles['formRow']}>
        <span>Default view</span>
        <select className={styles['select']} value={d.defaultView} onChange={e => set('defaultView', e.target.value)}>
          {['month','week','day','agenda','schedule','base','assets','dispatch'].map(v => (
            <option key={v} value={v}>
              {v === 'base'
                ? (config['team']?.locationLabel ?? 'Base')
                : v.charAt(0).toUpperCase() + v.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* ── Visible tabs ── */}
      <p className={styles['fieldGroupLabel']} style={{ marginTop: 12 }}>Visible tabs</p>
      <p className={styles['sectionDesc']}>Month and Week are always on. Toggle the rest to keep the top bar focused on what your team uses.</p>
      {[
        { id: 'day',      label: 'Day' },
        { id: 'agenda',   label: 'Agenda' },
        { id: 'schedule', label: 'Schedule (gantt)' },
        { id: 'base',     label: `${config['team']?.locationLabel ?? 'Base'} (location-first)` },
        { id: 'assets',   label: `${config['team']?.assetsLabel ?? 'Asset'}s` },
        { id: 'dispatch', label: 'Dispatch (readiness board)' },
        { id: 'planner',  label: 'Planner (resource allocation)' },
      ].map(v => (
        <label key={v.id} className={styles['toggle']}>
          <span>{v.label}</span>
          <input
            type="checkbox"
            checked={enabledViews.includes(v.id)}
            onChange={e => toggleEnabledView(v.id, e.target.checked)}
          />
          <span className={styles['toggleTrack']} />
        </label>
      ))}

      <div className={styles['formRow']}>
        <span>Week starts on</span>
        <select className={styles['select']} value={d.weekStartDay} onChange={e => set('weekStartDay', +e.target.value)}>
          <option value={0}>Sunday</option>
          <option value={1}>Monday</option>
        </select>
      </div>

      <label className={styles['formRow']}>
        <span>Day view start (hour)</span>
        <input
          type="number"
          className={styles['input']}
          min={0}
          max={23}
          value={d.dayStart}
          onChange={e => set('dayStart', +e.target.value)}
          style={{ width: 72 }}
        />
      </label>

      <label className={styles['formRow']}>
        <span>Day view end (hour)</span>
        <input
          type="number"
          className={styles['input']}
          min={1}
          max={24}
          value={d.dayEnd}
          onChange={e => set('dayEnd', +e.target.value)}
          style={{ width: 72 }}
        />
      </label>

      <label className={styles['toggle']}>
        <span>Show week numbers</span>
        <input
          type="checkbox"
          checked={!!d.showWeekNumbers}
          onChange={e => set('showWeekNumbers', e.target.checked)}
        />
        <span className={styles['toggleTrack']} />
      </label>

      <label className={styles['toggle']}>
        <span>Enlarge month row on hover</span>
        <input
          type="checkbox"
          checked={!!d.enlargeMonthRowOnHover}
          onChange={e => set('enlargeMonthRowOnHover', e.target.checked)}
        />
        <span className={styles['toggleTrack']} />
      </label>

      {/* ── Panels & chrome ── */}
      <p className={styles['fieldGroupLabel']} style={{ marginTop: 12 }}>Panels &amp; chrome</p>
      <p className={styles['sectionDesc']}>Turn off layout regions you don&apos;t need — handy when embedding the calendar inside a host that already provides its own toolbar or navigation. (The host app can also override these per-page via the <code>show*</code> props.)</p>
      {[
        { key: 'toolbar',      label: 'Top toolbar / header bar' },
        { key: 'viewSwitcher', label: 'View tabs (Month / Week / Day …)' },
        { key: 'leftRail',     label: 'Left icon rail' },
        { key: 'rightPanel',   label: 'Right panel (map + crew on shift)' },
      ].map(c => (
        <label key={c.key} className={styles['toggle']}>
          <span>{c.label}</span>
          <input
            type="checkbox"
            checked={chrome[c.key] !== false}
            onChange={e => setChrome(c.key, e.target.checked)}
          />
          <span className={styles['toggleTrack']} />
        </label>
      ))}

      <div className={styles['section']} style={{ paddingTop: 12 }}>
        <p className={styles['sectionDesc']}>Rename the grouped filter dropdown buttons shown to users.</p>

        <label className={styles['formRow']}>
          <span>Categories label</span>
          <input
            className={styles['input']}
            value={labels.categories ?? 'Categories'}
            onChange={e => setGroupLabel('categories', e.target.value)}
            placeholder="Categories"
          />
        </label>

        <label className={styles['formRow']}>
          <span>People label</span>
          <input
            className={styles['input']}
            value={labels.resources ?? 'People'}
            onChange={e => setGroupLabel('resources', e.target.value)}
            placeholder="People"
          />
        </label>

        <label className={styles['formRow']}>
          <span>Sources label</span>
          <input
            className={styles['input']}
            value={labels.sources ?? 'Sources'}
            onChange={e => setGroupLabel('sources', e.target.value)}
            placeholder="Sources"
          />
        </label>

        <label className={styles['formRow']}>
          <span>More label</span>
          <input
            className={styles['input']}
            value={labels.more ?? 'More'}
            onChange={e => setGroupLabel('more', e.target.value)}
            placeholder="More"
          />
        </label>
      </div>
    </div>
  );
}

/* ----- Approvals tab ----- */
const STAGE_LABELS: Record<ApprovalStageId, string> = {
  requested:      'Requested',
  approved:       'Approved',
  finalized:      'Finalized',
  pending_higher: 'Pending higher tier',
  denied:         'Denied',
};

/**
 * Owner-editable approval policy. Writes to `config.approvals`; runtime
 * surfaces (AssetsView pill prefixes, AuditDrawer menus, #134-15 inline
 * actions) read from the same block so a calendar owner can tune the
 * workflow — add/rename tiers, restrict actions per stage, change pill
 * copy — without redeploying the host app.
 *
 * Shape notes:
 *   approvals.enabled — master off switch; false keeps the whole UX silent.
 *   approvals.tiers[] — ordered; `requires: 'any' | 'all'` controls the
 *                       quorum rule for promotion out of that tier.
 *   approvals.rules   — per-stage `{ allow: ApprovalAction[], prefix }`.
 *   approvals.labels  — per-action button copy shown to approvers.
 */
export function ApprovalsTab({ config, onUpdate }: ConfigPanelSectionProps) {
  const approvals = (config['approvals'] ?? {}) as ApprovalsPatch;
  const enabled   = !!approvals.enabled;
  const tiers = Array.isArray(approvals.tiers) ? approvals.tiers : [];
  const rules = approvals.rules ?? {};
  const labels = approvals.labels ?? {};

  const patch = (next: ApprovalsPatch) => onUpdate(c => ({
    ...c,
    approvals: { ...(c['approvals'] ?? {}), ...next },
  }));

  const writeTiers = (next: ApprovalTierDraft[]) => patch({ tiers: next });
  const writeRules = (next: Partial<Record<ApprovalStageId, ApprovalStageRuleDraft>>) => patch({ rules: next });
  const writeLabels = (next: ApprovalLabelsDraft) => patch({ labels: next });

  const addTier = () => {
    const n = tiers.length + 1;
    writeTiers([...tiers, { id: `tier-${n}`, label: `Tier ${n}`, requires: 'any', roles: [] }]);
  };

  const updateTier = (idx: number, delta: Partial<ApprovalTierDraft>) => {
    writeTiers(tiers.map((t, i) => (i === idx ? { ...t, ...delta } : t)));
  };

  const removeTier = (idx: number) => writeTiers(tiers.filter((_, i) => i !== idx));

  const moveTier = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= tiers.length) return;
    const next = [...tiers];
    const [moved] = next.splice(idx, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    writeTiers(next);
  };

  const toggleAction = (stage: ApprovalStageId, action: ApprovalActionId) => {
    const stageRule = rules[stage] ?? { allow: [], prefix: '' };
    const allow = stageRule.allow ?? [];
    const next  = allow.includes(action)
      ? allow.filter(a => a !== action)
      : [...allow, action];
    writeRules({ ...rules, [stage]: { ...stageRule, allow: next } });
  };

  const setStagePrefix = (stage: ApprovalStageId, prefix: string) => {
    const stageRule = rules[stage] ?? { allow: [], prefix: '' };
    writeRules({ ...rules, [stage]: { ...stageRule, prefix } });
  };

  return (
    <div className={styles['section']}>
      <p className={styles['sectionDesc']}>
        Configure the approval workflow applied to events with
        <code> meta.approvalStage</code>. While disabled, approval pills render
        as plain category pills and no inline actions appear.
      </p>

      <label className={styles['toggle']}>
        <span>Enable approvals workflow</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => patch({ enabled: e.target.checked })}
          aria-label="Enable approvals workflow"
        />
        <span className={styles['toggleTrack']} />
      </label>

      <div className={styles['section']} style={{ paddingTop: 12 }}>
        <p className={styles['sectionDesc']}>
          Tiers are evaluated in order. <code>requires: any</code> promotes on
          the first approver action; <code>all</code> waits for every listed
          role to sign off.
        </p>

        {tiers.map((tier, i) => (
          <div key={tier.id + ':' + i} className={styles['fieldRow']} data-tier-id={tier.id}>
            <input
              className={styles['input']}
              value={tier.label ?? ''}
              onChange={e => updateTier(i, { label: e.target.value })}
              placeholder="Label"
              aria-label={`Label for ${tier.id}`}
            />
            <input
              className={styles['input']}
              value={tier.id}
              onChange={e => updateTier(i, { id: e.target.value.trim() || tier.id })}
              placeholder="id"
              aria-label={`Id for ${tier.label || tier.id}`}
            />
            <select
              className={styles['select']}
              value={tier.requires ?? 'any'}
              onChange={e => updateTier(i, { requires: e.target.value as ApprovalTierDraft['requires'] })}
              aria-label={`Quorum for ${tier.label || tier.id}`}
            >
              <option value="any">Any approver</option>
              <option value="all">All approvers</option>
            </select>
            <input
              className={styles['input']}
              value={(tier.roles ?? []).join(', ')}
              onChange={e => updateTier(i, {
                roles: e.target.value.split(',').map(r => r.trim()).filter(Boolean),
              })}
              placeholder="Roles (comma-separated)"
              aria-label={`Roles for ${tier.label || tier.id}`}
            />
            <button
              className={styles['removeBtn']}
              onClick={() => moveTier(i, -1)}
              disabled={i === 0}
              aria-label={`Move ${tier.label || tier.id} up`}
            ><ArrowUp size={13} /></button>
            <button
              className={styles['removeBtn']}
              onClick={() => moveTier(i, 1)}
              disabled={i === tiers.length - 1}
              aria-label={`Move ${tier.label || tier.id} down`}
            ><ArrowDown size={13} /></button>
            <button
              className={styles['removeBtn']}
              onClick={() => removeTier(i)}
              aria-label={`Remove ${tier.label || tier.id}`}
            ><Trash2 size={13} /></button>
          </div>
        ))}

        <button className={styles['addFieldBtn']} onClick={addTier}>
          <Plus size={13} /> Add tier
        </button>
      </div>

      <div className={styles['section']} style={{ paddingTop: 12 }}>
        <p className={styles['sectionDesc']}>
          Per-stage rules. The prefix rides on the left of the pill label
          (e.g. <code>Req · Flight 202</code>); leave blank for no prefix.
        </p>

        {APPROVAL_STAGE_IDS.map((stage: ApprovalStageId) => {
          const stageRule = rules[stage] ?? { allow: [], prefix: '' };
          return (
            <div key={stage} className={styles['fieldRow']} data-stage-id={stage}>
              <span style={{ minWidth: 120, fontWeight: 600 }}>
                {STAGE_LABELS[stage] ?? stage}
              </span>
              <input
                className={styles['input']}
                value={stageRule.prefix ?? ''}
                onChange={e => setStagePrefix(stage, e.target.value)}
                placeholder="Prefix"
                aria-label={`Prefix for ${stage}`}
                style={{ maxWidth: 120 }}
              />
              {APPROVAL_ACTIONS.map(action => {
                const checked = (stageRule.allow ?? []).includes(action);
                return (
                  <label key={action} className={styles['reqLabel']}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAction(stage, action)}
                      aria-label={`Allow ${action} on ${stage}`}
                    />
                    {action}
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className={styles['section']} style={{ paddingTop: 12 }}>
        <p className={styles['sectionDesc']}>
          Button copy shown to approvers in the audit drawer and inline pill
          menu. Rename these to match your organisation's vocabulary.
        </p>

        {APPROVAL_ACTIONS.map(action => (
          <label key={action} className={styles['formRow']}>
            <span>{action.charAt(0).toUpperCase() + action.slice(1)} label</span>
            <input
              className={styles['input']}
              value={labels[action] ?? ''}
              onChange={e => writeLabels({ ...labels, [action]: e.target.value })}
              placeholder={action}
              aria-label={`${action} button label`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/* ----- Request Form tab ----- */
const REQUEST_FIELD_TYPES = [
  { value: 'text',     label: 'Text' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'number',   label: 'Number' },
  { value: 'date',     label: 'Date' },
  { value: 'datetime', label: 'Datetime' },
  { value: 'select',   label: 'Select' },
  { value: 'checkbox', label: 'Checkbox' },
];

/**
 * Owner-editable RequestForm schema. Writes to `config.requestForm.fields`;
 * src/ui/RequestForm.jsx renders one input per entry. Field types match
 * the RequestForm renderer's built-in handlers — adding a new type means
 * updating both sides.
 */
export function RequestFormTab({ config, onUpdate }: ConfigPanelSectionProps) {
  const schema = (config['requestForm'] ?? {}) as RequestFormPatch;
  const fields = Array.isArray(schema.fields) ? schema.fields : [];

  const patch = (next: RequestFormPatch) => onUpdate(c => ({
    ...c,
    requestForm: { ...(c['requestForm'] ?? {}), ...next },
  }));

  const writeFields = (next: RequestFieldDraft[]) => patch({ fields: next });

  const addField = () => {
    const n = fields.length + 1;
    writeFields([
      ...fields,
      { key: `field-${n}`, label: `Field ${n}`, type: 'text', required: false },
    ]);
  };

  const updateField = (idx: number, delta: Partial<RequestFieldDraft>) =>
    writeFields(fields.map((f, i) => (i === idx ? { ...f, ...delta } : f)));

  const removeField = (idx: number) => writeFields(fields.filter((_, i) => i !== idx));

  const moveField = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    const [moved] = next.splice(idx, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    writeFields(next);
  };

  return (
    <div className={styles['section']}>
      <p className={styles['sectionDesc']}>
        Fields rendered by the request form (src/ui/RequestForm.jsx).
        Changes apply to every open request form on next render — no host
        redeploy required.
      </p>

      {fields.map((field, i) => (
        <div key={field.key + ':' + i} className={styles['fieldRow']} data-field-key={field.key}>
          <input
            className={styles['input']}
            value={field.label ?? ''}
            onChange={e => updateField(i, { label: e.target.value })}
            placeholder="Label"
            aria-label={`Label for ${field.key}`}
          />
          <input
            className={styles['input']}
            value={field.key}
            onChange={e => updateField(i, { key: e.target.value.trim() || field.key })}
            placeholder="key"
            aria-label={`Key for ${field.label || field.key}`}
          />
          <select
            className={styles['select']}
            value={field.type}
            onChange={e => updateField(i, { type: e.target.value as RequestFieldType })}
            aria-label={`Type for ${field.label || field.key}`}
          >
            {REQUEST_FIELD_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {field.type === 'select' && (
            <input
              className={styles['input']}
              value={field.options ?? ''}
              onChange={e => updateField(i, { options: e.target.value })}
              placeholder="Option 1, Option 2, …"
              aria-label={`Options for ${field.label || field.key}`}
            />
          )}
          <input
            className={styles['input']}
            value={field.placeholder ?? ''}
            onChange={e => updateField(i, { placeholder: e.target.value })}
            placeholder="Placeholder"
            aria-label={`Placeholder for ${field.label || field.key}`}
          />
          <label className={styles['reqLabel']}>
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={e => updateField(i, { required: e.target.checked })}
              aria-label={`Required for ${field.label || field.key}`}
            />
            Required
          </label>
          <button
            className={styles['removeBtn']}
            onClick={() => moveField(i, -1)}
            disabled={i === 0}
            aria-label={`Move ${field.label || field.key} up`}
          ><ArrowUp size={13} /></button>
          <button
            className={styles['removeBtn']}
            onClick={() => moveField(i, 1)}
            disabled={i === fields.length - 1}
            aria-label={`Move ${field.label || field.key} down`}
          ><ArrowDown size={13} /></button>
          <button
            className={styles['removeBtn']}
            onClick={() => removeField(i)}
            aria-label={`Remove ${field.label || field.key}`}
          ><Trash2 size={13} /></button>
        </div>
      ))}

      <button className={styles['addFieldBtn']} onClick={addField}>
        <Plus size={13} /> Add field
      </button>
    </div>
  );
}

/* ----- Conflicts tab ----- */
/**
 * Owner-editable conflict rule registry. Writes to `config.conflicts.rules`;
 * src/core/conflictEngine.ts consumes the rules to evaluate a proposed
 * event before it's written, returning Violation[] that ConflictModal
 * surfaces to the user. Rules are pure data so the whole workflow can be
 * re-tuned without a host-app redeploy.
 *
 * Supported types (see conflictEngine.ts for the full union):
 *   resource-overlap — same resource in an overlapping window → violation.
 *   category-mutex   — listed categories cannot coexist on one resource.
 *   min-rest         — minimum gap (in minutes) between same-resource events.
 */
export function ConflictsTab({ config, onUpdate }: ConfigPanelSectionProps) {
  const conflicts = (config['conflicts'] ?? {}) as ConflictsPatch;
  const enabled   = !!conflicts.enabled;
  const rules     = Array.isArray(conflicts.rules) ? conflicts.rules : [];

  const patch = (next: ConflictsPatch) => onUpdate(c => ({
    ...c,
    conflicts: { ...(c['conflicts'] ?? {}), ...next },
  }));

  const writeRules = (next: ConflictRuleDraft[]) => patch({ rules: next });

  const addRule = () => {
    const n = rules.length + 1;
    writeRules([
      ...rules,
      { id: `rule-${n}`, type: 'resource-overlap', severity: 'hard' },
    ]);
  };

  const updateRule = (idx: number, delta: Partial<ConflictRuleDraft>) => {
    writeRules(rules.map((r, i) => (i === idx ? { ...r, ...delta } : r)));
  };

  const removeRule = (idx: number) => writeRules(rules.filter((_, i) => i !== idx));

  return (
    <div className={styles['section']}>
      <p className={styles['sectionDesc']}>
        Conflict rules run before an event write. The engine returns
        violations; the ConflictModal surfaces them. While disabled, no
        rule runs and writes proceed silently.
      </p>

      <label className={styles['toggle']}>
        <span>Enable conflict checks</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => patch({ enabled: e.target.checked })}
          aria-label="Enable conflict checks"
        />
        <span className={styles['toggleTrack']} />
      </label>

      {rules.map((rule, i) => (
        <div key={rule.id + ':' + i} className={styles['fieldRow']} data-rule-id={rule.id}>
          <input
            className={styles['input']}
            value={rule.id}
            onChange={e => updateRule(i, { id: e.target.value.trim() || rule.id })}
            placeholder="id"
            aria-label={`Id for rule ${rule.id}`}
          />
          <select
            className={styles['select']}
            value={rule.type}
            onChange={e => updateRule(i, { type: e.target.value as ConflictRuleType })}
            aria-label={`Type for rule ${rule.id}`}
          >
            {CONFLICT_RULE_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select
            className={styles['select']}
            value={rule.severity ?? 'hard'}
            onChange={e => updateRule(i, { severity: e.target.value as ConflictRuleDraft['severity'] })}
            aria-label={`Severity for rule ${rule.id}`}
          >
            <option value="hard">hard</option>
            <option value="soft">soft</option>
          </select>

          {rule.type === 'category-mutex' && (
            <input
              className={styles['input']}
              value={Array.isArray(rule.categories) ? rule.categories.join(', ') : ''}
              onChange={e => updateRule(i, {
                categories: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              })}
              placeholder="categories (comma-separated)"
              aria-label={`Categories for rule ${rule.id}`}
            />
          )}

          {rule.type === 'min-rest' && (
            <input
              type="number"
              min={0}
              className={styles['input']}
              style={{ width: 88 }}
              value={rule.minutes ?? 0}
              onChange={e => updateRule(i, { minutes: Math.max(0, Number(e.target.value) || 0) })}
              placeholder="minutes"
              aria-label={`Minutes for rule ${rule.id}`}
            />
          )}

          {rule.type === 'resource-overlap' && (
            <input
              className={styles['input']}
              value={Array.isArray(rule.ignoreCategories) ? rule.ignoreCategories.join(', ') : ''}
              onChange={e => updateRule(i, {
                ignoreCategories: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              })}
              placeholder="ignore categories"
              aria-label={`Ignore categories for rule ${rule.id}`}
            />
          )}

          <button
            className={styles['removeBtn']}
            onClick={() => removeRule(i)}
            aria-label={`Remove rule ${rule.id}`}
          ><Trash2 size={13} /></button>
        </div>
      ))}

      <button className={styles['addFieldBtn']} onClick={addRule}>
        <Plus size={13} /> Add rule
      </button>
    </div>
  );
}

