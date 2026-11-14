// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FORMATION_PIPELINE_CLASSIFICATION_CSV_SEPARATOR,
  FORMATION_PIPELINE_CLASSIFICATION_KEYS,
  FORMATION_PIPELINE_CLASSIFICATION_LABELS,
  FORMATION_PIPELINE_CLASSIFICATION_MAX_VALUE_LENGTH,
  FORMATION_PIPELINE_CLASSIFICATION_MAX_VALUES,
  FORMATION_PIPELINE_CLASSIFICATION_PARAMS,
  FORMATION_PIPELINE_COLUMNS,
  FORMATION_PIPELINE_COPY,
  FORMATION_PIPELINE_CSV_FILENAME_PREFIX,
  FORMATION_PIPELINE_DEFAULT_FOUNDATION_KIND,
  FORMATION_PIPELINE_DEFAULT_SORT,
  FORMATION_PIPELINE_DEFAULT_STAGE,
  FORMATION_PIPELINE_FOUNDATION_KINDS,
  FOUNDATION_UID_PATTERN,
  FORMATION_PIPELINE_HIDE_WHEN_EMPTY_STAGES,
  FORMATION_PIPELINE_LIVE_STAGES,
  FORMATION_PIPELINE_PROSPECT_LABEL,
  FORMATION_PIPELINE_LAUNCH_SOON_DAYS,
  FORMATION_PIPELINE_QUERY_PARAMS,
  FORMATION_PIPELINE_STAFF_HIDDEN_STAGES,
  FORMATION_PIPELINE_SEARCH_MAX_LENGTH,
  FORMATION_PIPELINE_STAGE_LABELS,
  FORMATION_PIPELINE_STAGE_SEVERITY,
  FORMATION_PIPELINE_STAGE_UPSTREAM,
  FORMATION_PIPELINE_STAGES,
  FORMATION_PIPELINE_STAT_CAPTIONS,
  FORMATION_PIPELINE_STAT_CARD_STYLE,
  FORMATION_PIPELINE_STAT_STAGES,
} from '../constants/formation-pipeline.constants';
import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type {
  FormationPipelineClassificationKey,
  FormationPipelineClassificationOption,
  FormationPipelineClassificationSelection,
  FormationPipelineCounts,
  FormationPipelineFoundationKindFilter,
  FormationPipelineLaunch,
  FormationPipelinePerson,
  FormationPipelineRow,
  FormationPipelineRowLink,
  FormationPipelineTableRow,
  FormationPipelineSort,
  FormationPipelineStage,
  FormationPipelineStageFilter,
  FormationPipelineUrlState,
  FormationPipelineViewer,
} from '../interfaces/formation-pipeline.interface';
import type { StatCardItem } from '../interfaces/stat-card.interface';
import { formatIsoDateLabel, parseIsoDateAsUtcMidnight, timeAgo } from './date-time.utils';

const MS_PER_DAY = 86_400_000;

/** Splits `items` into arrays of at most `size` (a size below 1 is treated as 1). */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, size);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    batches.push(items.slice(i, i + step));
  }
  return batches;
}

/** Maps an upstream `stage` string to its pipeline key; `null` for `Active` and anything unrecognized. */
export function getPipelineStageKey(stage: string | null | undefined): FormationPipelineStage | null {
  return FORMATION_PIPELINE_STAGES.find((key) => FORMATION_PIPELINE_STAGE_UPSTREAM[key] === stage) ?? null;
}

/** What the formation team reads for a stored stage: a v2 `Prospect` shows as "Draft" (#5619); every other value is shown as stored. The stored value never changes. */
export function getFormationStageDisplayLabel(stage: string): string {
  return stage === FORMATION_PIPELINE_STAGE_UPSTREAM.prospect ? FORMATION_PIPELINE_PROSPECT_LABEL : stage;
}

/** Whether a viewer may see a stage at all: LF staff outside the formation team never see Draft or Confidential (#5544). */
export function isPipelineStageVisible(stage: FormationPipelineStage, viewer: FormationPipelineViewer): boolean {
  return viewer === 'formation_team' || !FORMATION_PIPELINE_STAFF_HIDDEN_STAGES.includes(stage);
}

/** The stages of the live pipeline this viewer sees (the default view). */
export function getPipelineLiveStages(viewer: FormationPipelineViewer): FormationPipelineStage[] {
  return FORMATION_PIPELINE_LIVE_STAGES.filter((stage) => isPipelineStageVisible(stage, viewer));
}

/** A zeroed {@link FormationPipelineCounts}. */
export function emptyPipelineCounts(): FormationPipelineCounts {
  return { prospect: 0, exploratory: 0, engaged: 0, on_hold: 0, disengaged: 0, confidential: 0, archived: 0, total: 0 };
}

/** Counts rows per stage. */
export function countPipelineRows(rows: readonly FormationPipelineRow[]): FormationPipelineCounts {
  const counts = emptyPipelineCounts();
  for (const row of rows) {
    counts[row.stage] += 1;
    counts.total += 1;
  }
  return counts;
}

/** The one search policy (#5619): trimmed and cut to {@link FORMATION_PIPELINE_SEARCH_MAX_LENGTH}. The input, the live filter, the URL writer and the URL parser all go through it, so a reloaded link matches exactly what was on screen. */
export function normalizePipelineSearch(search: string | null | undefined): string {
  const cut = (search ?? '').trim().slice(0, FORMATION_PIPELINE_SEARCH_MAX_LENGTH);
  // `slice` counts UTF-16 code units: a cut inside a surrogate pair leaves a lone high surrogate, which `encodeURIComponent` throws on and `URLSearchParams` rewrites.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Case-insensitive name match used by both the BFF `q` filter and the UI. An empty query matches everything. */
export function matchesPipelineSearch(name: string, search: string | null | undefined): boolean {
  const needle = normalizePipelineSearch(search).toLowerCase();
  return !needle || name.toLowerCase().includes(needle);
}

/** Rows in the selected stage; `all` keeps every row. */
export function filterPipelineRowsByStage(
  rows: readonly FormationPipelineRow[],
  stage: FormationPipelineStageFilter,
  viewer: FormationPipelineViewer = 'formation_team'
): FormationPipelineRow[] {
  if (stage === 'all') return [...rows];
  if (stage === 'in_pipeline') return rows.filter((row) => getPipelineLiveStages(viewer).includes(row.stage));
  return rows.filter((row) => row.stage === stage);
}

/** Rows of one foundation kind; `all` keeps every row (#5619). */
export function filterPipelineRowsByFoundationKind(rows: readonly FormationPipelineRow[], kind: FormationPipelineFoundationKindFilter): FormationPipelineRow[] {
  return kind === 'all' ? [...rows] : rows.filter((row) => row.foundation_kind === kind);
}

/**
 * A classification array as upstream may send it: only non-empty strings survive, trimmed and de-duplicated, in order. A
 * missing key, `null`, a non-array or an empty array is `[]` (#5619 Part C).
 */
export function normalizePipelineClassification(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  ];
}

/** All three classification filters off. */
export function emptyPipelineClassification(): FormationPipelineClassificationSelection {
  return { technical_activity_type: [], technology: [], industry: [] };
}

/** Whether any classification filter has a value selected. */
export function hasPipelineClassificationFilter(selection: FormationPipelineClassificationSelection): boolean {
  return FORMATION_PIPELINE_CLASSIFICATION_KEYS.some((key) => (selection[key] ?? []).length > 0);
}

/**
 * Rows that pass the classification filters. A row passes a filter when ANY of its values is selected (OR within a filter);
 * the filters combine with each other (AND across). A filter with nothing selected is off; while any is on, a row whose
 * array is empty for it is hidden, and there is no "Not set" option (#5619 Part C).
 * `skip` leaves one filter out, which is how an option list sees the rows "after the other filters".
 */
export function filterPipelineRowsByClassification(
  rows: readonly FormationPipelineRow[],
  selection: FormationPipelineClassificationSelection,
  skip?: FormationPipelineClassificationKey
): FormationPipelineRow[] {
  const active = FORMATION_PIPELINE_CLASSIFICATION_KEYS.filter((key) => key !== skip && (selection[key] ?? []).length > 0);
  if (active.length === 0) return [...rows];
  return rows.filter((row) => active.every((key) => row[key].some((value) => (selection[key] ?? []).includes(value))));
}

/** The values of one classification field present in the rows, sorted, each with the number of rows holding it. */
export function getPipelineClassificationOptions(
  rows: readonly FormationPipelineRow[],
  key: FormationPipelineClassificationKey
): FormationPipelineClassificationOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of row[key]) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => comparePipelineText(a.value, b.value));
}

/** The values of a link's classification param, made safe (a `null` or missing list, as a cleared multi-select can leave on its control, is empty): trimmed, non-empty, within the length bound, de-duplicated, at most the allowed number. */
export function sanitizePipelineClassificationValues(values: readonly string[] | null | undefined): string[] {
  const kept = (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= FORMATION_PIPELINE_CLASSIFICATION_MAX_VALUE_LENGTH);
  return [...new Set(kept)].slice(0, FORMATION_PIPELINE_CLASSIFICATION_MAX_VALUES);
}

/** The selection with every value that no row holds dropped: a link may name a value this data does not have, and an unknown value is not kept. */
export function pruneUnknownPipelineClassification(
  selection: FormationPipelineClassificationSelection,
  rows: readonly FormationPipelineRow[]
): FormationPipelineClassificationSelection {
  const pruned = emptyPipelineClassification();
  for (const key of FORMATION_PIPELINE_CLASSIFICATION_KEYS) {
    const present = new Set(rows.flatMap((row) => row[key]));
    pruned[key] = (selection[key] ?? []).filter((value) => present.has(value));
  }
  return pruned;
}

/** Rows in the live stages this viewer sees (Draft, Exploratory, Engaged, On hold; staff never see Draft). */
export function countLivePipelineRows(counts: FormationPipelineCounts, viewer: FormationPipelineViewer = 'formation_team'): number {
  return getPipelineLiveStages(viewer).reduce((sum, stage) => sum + counts[stage], 0);
}

/** The calendar day of an ISO date or timestamp, as UTC midnight; `null` when absent or unparseable. */
function toUtcDay(value: string | null | undefined): Date | null {
  return value ? parseIsoDateAsUtcMidnight(value.slice(0, 10)) : null;
}

/** Expected-launch cell content: the date, an "In N days/weeks" hint, and whether it falls within the next 30 days. */
export function getPipelineLaunch(announcementDate: string | null | undefined, now: Date = new Date(), overdueApplies = true): FormationPipelineLaunch {
  const day = toUtcDay(announcementDate);
  if (!day) {
    return { dateLabel: FORMATION_PIPELINE_COPY.notSet, relativeLabel: '', soon: false, overdue: false };
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((day.getTime() - today) / MS_PER_DAY);
  const dateLabel = formatIsoDateLabel((announcementDate as string).slice(0, 10));
  if (days < 0) {
    // A passed date on a project that has not been archived is overdue; an archived one just shows its date.
    return overdueApplies
      ? { dateLabel, relativeLabel: FORMATION_PIPELINE_COPY.overdue, soon: false, overdue: true }
      : { dateLabel, relativeLabel: '', soon: false, overdue: false };
  }
  const soon = days <= FORMATION_PIPELINE_LAUNCH_SOON_DAYS;
  if (days === 0) return { dateLabel, relativeLabel: 'Today', soon, overdue: false };
  if (days < 14) return { dateLabel, relativeLabel: `In ${days} ${days === 1 ? 'day' : 'days'}`, soon, overdue: false };
  const weeks = Math.floor(days / 7);
  if (weeks <= 26) return { dateLabel, relativeLabel: `In ${weeks} weeks`, soon, overdue: false };
  const months = Math.floor(days / 30);
  return { dateLabel, relativeLabel: `In ${months} months`, soon, overdue: false };
}

/** Name of a person, or `''`. */
function personName(person: FormationPipelinePerson | null | undefined): string {
  return person?.name?.trim() || person?.email?.trim() || person?.username?.trim() || '';
}

/** "ED" and "PM" lines for the combined column; unassigned roles read as the design's empty copy. */
export function getPipelineEdPmLines(row: Pick<FormationPipelineRow, 'executive_director' | 'program_manager'>): { ed: string; pm: string } {
  return {
    ed: personName(row.executive_director) || FORMATION_PIPELINE_COPY.notAssigned,
    pm: personName(row.program_manager) || FORMATION_PIPELINE_COPY.noPm,
  };
}

/** The Formation Lead cell: name (falling back to email, then username) and the email for the tooltip; "Not set" when the lead is empty or missing. */
export function getPipelineFormationLead(row: Pick<FormationPipelineRow, 'formation_lead'>): { name: string; email: string } {
  return { name: personName(row.formation_lead) || FORMATION_PIPELINE_COPY.notSet, email: row.formation_lead?.email?.trim() ?? '' };
}

/** Name of the opportunity owner, or `''`. */
export function getPipelineOpportunityOwner(row: Pick<FormationPipelineRow, 'opportunity_owner'>): string {
  return personName(row.opportunity_owner);
}

/** Time of a date string, or `null` when absent or unparseable. */
function timeOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Case- and accent-insensitive text order, pinned to `en` so the server render and the browser agree: with the runtime's
 * default locale the name tie-breaks and the foundation list could order differently on each side and fail hydration.
 */
export function comparePipelineText(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

/** A sortable cell value: absent (`null`) always sorts last, whichever direction. */
function sortValue(row: FormationPipelineRow, key: FormationPipelineSort['key']): string | number | null {
  switch (key) {
    case 'project':
      return row.name;
    case 'stage':
      return FORMATION_PIPELINE_STAGES.indexOf(row.stage);
    case 'expected_launch':
      return timeOf(row.announcement_date);
    case 'formation_lead':
      return personName(row.formation_lead) || null;
    case 'formation_date':
      return timeOf(row.formation_date);
    case 'legal_entity':
      return row.legal_entity_name?.trim() || null;
    case 'ed_pm':
      return personName(row.executive_director) || personName(row.program_manager) || null;
    case 'opportunity_owner':
      return getPipelineOpportunityOwner(row) || null;
    case 'updated':
      return timeOf(row.updated_at);
  }
}

/**
 * Sorts a copy of `rows`. Rows with no value in the sort column come last in either direction; ties fall back to name.
 * The launch column groups first — upcoming dates, then past ones, then unset — whatever the direction; ascending means
 * soonest first among upcoming and most recently passed first among past.
 */
export function sortPipelineRows(rows: readonly FormationPipelineRow[], sort: FormationPipelineSort, now: Date = new Date()): FormationPipelineRow[] {
  const factor = sort.direction === 'asc' ? 1 : -1;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return [...rows].sort((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left === null && right !== null) return 1;
    if (left !== null && right === null) return -1;
    if (left !== null && right !== null && left !== right) {
      if (sort.key === 'expected_launch') {
        const leftUpcoming = (left as number) >= today;
        const rightUpcoming = (right as number) >= today;
        if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
        return (leftUpcoming ? (left as number) - (right as number) : (right as number) - (left as number)) * factor;
      }
      const order = typeof left === 'number' && typeof right === 'number' ? left - right : comparePipelineText(String(left), String(right));
      if (order !== 0) return order * factor;
    }
    return comparePipelineText(a.name, b.name);
  });
}

/** Stage pills: `In pipeline` (the default), `All`, then every stage the viewer sees, with counts. Disengaged and Confidential appear only when they hold rows; staff never get a Draft or Confidential pill. */
export function buildPipelinePillOptions(counts: FormationPipelineCounts, viewer: FormationPipelineViewer = 'formation_team'): FilterPillOption[] {
  const stagePills = FORMATION_PIPELINE_STAGES.filter(
    (stage) => isPipelineStageVisible(stage, viewer) && (counts[stage] > 0 || !FORMATION_PIPELINE_HIDE_WHEN_EMPTY_STAGES.includes(stage))
  ).map((stage) => ({
    id: stage,
    label: `${FORMATION_PIPELINE_STAGE_LABELS[stage]} (${counts[stage]})`,
  }));
  return [
    { id: 'in_pipeline', label: `${FORMATION_PIPELINE_COPY.inPipeline} (${countLivePipelineRows(counts, viewer)})` },
    { id: 'all', label: `${FORMATION_PIPELINE_COPY.allStages} (${counts.total})` },
    ...stagePills,
  ];
}

/** Stat strip cards for the five headline stages; each card's `action` is the stage key it filters by. */
export function buildPipelineStatCards(
  counts: FormationPipelineCounts,
  rows: readonly FormationPipelineRow[],
  selected: FormationPipelineStageFilter,
  now: Date = new Date(),
  viewer: FormationPipelineViewer = 'formation_team'
): StatCardItem[] {
  const withLaunch = rows.filter((row) => row.stage === 'exploratory' && toUtcDay(row.announcement_date)).length;
  const launchingSoon = rows.filter((row) => row.stage === 'engaged' && getPipelineLaunch(row.announcement_date, now).soon).length;
  const subLines: Record<string, string> = {
    prospect: FORMATION_PIPELINE_STAT_CAPTIONS.prospect,
    exploratory: `${withLaunch} with an expected launch date`,
    engaged: `${launchingSoon} launching in the next ${FORMATION_PIPELINE_LAUNCH_SOON_DAYS} days`,
    on_hold: FORMATION_PIPELINE_STAT_CAPTIONS.on_hold,
    archived: FORMATION_PIPELINE_STAT_CAPTIONS.archived,
  };
  return FORMATION_PIPELINE_STAT_STAGES.filter((stage) => isPipelineStageVisible(stage, viewer)).map((stage) => ({
    value: counts[stage],
    label: FORMATION_PIPELINE_STAGE_LABELS[stage],
    subLine: subLines[stage],
    ...FORMATION_PIPELINE_STAT_CARD_STYLE[stage],
    action: stage,
    selected: selected === stage,
  }));
}

/**
 * The formation page (keeping the foundation context) for every row except an Archived one, which goes to the project's own
 * dashboard: the formation page replaces its whole body for an Archived project. A row without a checklist (a Draft project,
 * or a live one formation-service has not started) still opens the formation page, which shows an empty state for it.
 */
export function getPipelineRowLink(row: Pick<FormationPipelineRow, 'slug' | 'stage'>): FormationPipelineRowLink {
  return row.stage === 'archived'
    ? { commands: ['/project/overview'], queryParams: { project: row.slug } }
    : { commands: ['/foundation/formations', row.slug], queryParams: null };
}

/** Resolves every display string of a row once. */
export function toPipelineTableRow(row: FormationPipelineRow, now: Date = new Date()): FormationPipelineTableRow {
  const { ed, pm } = getPipelineEdPmLines(row);
  const lead = getPipelineFormationLead(row);
  const formationDay = row.formation_date?.slice(0, 10);
  return {
    ...row,
    stageLabel: FORMATION_PIPELINE_STAGE_LABELS[row.stage],
    stageSeverity: FORMATION_PIPELINE_STAGE_SEVERITY[row.stage],
    launch: getPipelineLaunch(row.announcement_date, now, row.stage !== 'archived'),
    formationDateLabel: formationDay ? formatIsoDateLabel(formationDay) : '',
    legalEntityLabel: row.legal_entity_name?.trim() ?? '',
    edLine: ed,
    pmLine: pm,
    formationLeadLabel: lead.name,
    formationLeadEmail: lead.email,
    ownerLabel: getPipelineOpportunityOwner(row),
    updatedLabel: getPipelineUpdatedLabel(row.updated_at),
    link: getPipelineRowLink(row),
  };
}

/** Relative "Updated" text, or `''` when there is no timestamp. */
export function getPipelineUpdatedLabel(updatedAt: string | null | undefined): string {
  return updatedAt ? timeAgo(updatedAt) : '';
}

/** `rowsToCsv` neutralizes a formula prefix only at the start of a cell; a multi-value cell holds several values, so each is neutralized before joining (a `;` list separator would otherwise start a new cell in some locales). */
function neutralizeCsvValue(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const PIPELINE_CSV_HEADER: string[] = [
  'Project',
  'Foundation',
  'Stage',
  'Expected launch',
  'Formation lead',
  'Formation date',
  'Legal entity',
  'ED',
  'PM',
  'Opportunity owner',
  'Updated',
  ...FORMATION_PIPELINE_CLASSIFICATION_KEYS.map((key) => FORMATION_PIPELINE_CLASSIFICATION_LABELS[key]),
];

/**
 * Header plus one row per pipeline row, in the table's column order (ED and PM split into two cells), for `downloadCsv`
 * / `rowsToCsv` — which quote cells and neutralize formula prefixes (`=`, `+`, `-`, `@`, tab, CR) on string cells.
 */
export function buildPipelineCsvRows(rows: readonly FormationPipelineRow[]): string[][] {
  const date = (value: string | null): string => (value ? value.slice(0, 10) : '');
  return [
    PIPELINE_CSV_HEADER,
    ...rows.map((row) => [
      row.name,
      row.parent?.name ?? '',
      FORMATION_PIPELINE_STAGE_LABELS[row.stage],
      date(row.announcement_date),
      personName(row.formation_lead),
      date(row.formation_date),
      row.legal_entity_name ?? '',
      personName(row.executive_director),
      personName(row.program_manager),
      getPipelineOpportunityOwner(row),
      row.updated_at ?? '',
      ...FORMATION_PIPELINE_CLASSIFICATION_KEYS.map((key) => row[key].map(neutralizeCsvValue).join(FORMATION_PIPELINE_CLASSIFICATION_CSV_SEPARATOR)),
    ]),
  ];
}

/** `formation-pipeline-YYYY-MM-DD.csv` for the given day (UTC). */
export function getPipelineCsvFilename(now: Date = new Date()): string {
  return `${FORMATION_PIPELINE_CSV_FILENAME_PREFIX}${now.toISOString().slice(0, 10)}.csv`;
}

/** The default filter and sort state: what the page opens on and what the URL omits. */
export function getDefaultPipelineUrlState(): FormationPipelineUrlState {
  return {
    stage: FORMATION_PIPELINE_DEFAULT_STAGE,
    foundationUid: null,
    foundationKind: FORMATION_PIPELINE_DEFAULT_FOUNDATION_KIND,
    search: '',
    classification: emptyPipelineClassification(),
    sort: { ...FORMATION_PIPELINE_DEFAULT_SORT },
  };
}

/**
 * Reads the Pipeline state from query params. Anything unrecognized falls back to the default for that one field, so a stale
 * or hand-edited link still opens the page: an unknown stage or type, a sort column that does not exist, a foundation uid of
 * the wrong shape, a search past the API's length limit (cut to it).
 */
export function parsePipelineUrlState(params: { get(name: string): string | null; getAll(name: string): string[] }): FormationPipelineUrlState {
  const names = FORMATION_PIPELINE_QUERY_PARAMS;
  const state = getDefaultPipelineUrlState();

  const stage = params.get(names.stage);
  if (stage === 'all' || stage === 'in_pipeline' || FORMATION_PIPELINE_STAGES.some((candidate) => candidate === stage)) {
    state.stage = stage as FormationPipelineStageFilter;
  }

  const foundationUid = params.get(names.foundation);
  if (foundationUid && FOUNDATION_UID_PATTERN.test(foundationUid)) {
    state.foundationUid = foundationUid;
  }

  const kind = params.get(names.foundationKind);
  if (FORMATION_PIPELINE_FOUNDATION_KINDS.some((candidate) => candidate === kind)) {
    state.foundationKind = kind as FormationPipelineUrlState['foundationKind'];
  }

  state.search = normalizePipelineSearch(params.get(names.search));

  for (const key of FORMATION_PIPELINE_CLASSIFICATION_KEYS) {
    state.classification[key] = sanitizePipelineClassificationValues(params.getAll(FORMATION_PIPELINE_CLASSIFICATION_PARAMS[key]));
  }

  const sortKey = FORMATION_PIPELINE_COLUMNS.find((column) => column.key === params.get(names.sort))?.key;
  if (sortKey) {
    state.sort = { key: sortKey, direction: params.get(names.direction) === 'desc' ? 'desc' : 'asc' };
  }
  return state;
}

/**
 * The query params for a state, with `null` for every field at its default so a `merge` navigation drops it from the URL
 * and the default view keeps a clean address. The inverse of {@link parsePipelineUrlState}.
 */
export function buildPipelineUrlParams(state: FormationPipelineUrlState): Record<string, string | string[] | null> {
  const names = FORMATION_PIPELINE_QUERY_PARAMS;
  const defaults = getDefaultPipelineUrlState();
  const search = normalizePipelineSearch(state.search);
  const defaultSort = state.sort.key === defaults.sort.key && state.sort.direction === defaults.sort.direction;
  return {
    [names.stage]: state.stage === defaults.stage ? null : state.stage,
    [names.foundation]: state.foundationUid,
    [names.foundationKind]: state.foundationKind === defaults.foundationKind ? null : state.foundationKind,
    [names.search]: search || null,
    ...Object.fromEntries(
      FORMATION_PIPELINE_CLASSIFICATION_KEYS.map((key) => {
        const values = sanitizePipelineClassificationValues(state.classification[key] ?? []);
        return [FORMATION_PIPELINE_CLASSIFICATION_PARAMS[key], values.length ? values : null];
      })
    ),
    [names.sort]: defaultSort ? null : state.sort.key,
    [names.direction]: defaultSort ? null : state.sort.direction,
  };
}

/** Every Pipeline query param set to `null`, for leaving the tab: a `merge` navigation then removes them all. */
export function clearedPipelineUrlParams(): Record<string, null> {
  return Object.fromEntries(Object.values(FORMATION_PIPELINE_QUERY_PARAMS).map((name) => [name, null]));
}
