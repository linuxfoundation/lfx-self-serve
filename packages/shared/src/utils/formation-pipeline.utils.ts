// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FORMATION_PIPELINE_COPY,
  FORMATION_PIPELINE_CSV_FILENAME_PREFIX,
  FORMATION_PIPELINE_HIDE_WHEN_EMPTY_STAGES,
  FORMATION_PIPELINE_LIVE_STAGES,
  FORMATION_PIPELINE_LAUNCH_SOON_DAYS,
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
  FormationPipelineCounts,
  FormationPipelineLaunch,
  FormationPipelinePerson,
  FormationPipelineRow,
  FormationPipelineRowLink,
  FormationPipelineTableRow,
  FormationPipelineSort,
  FormationPipelineStage,
  FormationPipelineStageFilter,
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

/** Case-insensitive name match used by both the BFF `q` filter and the UI. An empty query matches everything. */
export function matchesPipelineSearch(name: string, search: string | null | undefined): boolean {
  const needle = (search ?? '').trim().toLowerCase();
  return !needle || name.toLowerCase().includes(needle);
}

/** Rows in the selected stage; `all` keeps every row. */
export function filterPipelineRowsByStage(rows: readonly FormationPipelineRow[], stage: FormationPipelineStageFilter): FormationPipelineRow[] {
  if (stage === 'all') return [...rows];
  if (stage === 'in_pipeline') return rows.filter((row) => FORMATION_PIPELINE_LIVE_STAGES.includes(row.stage));
  return rows.filter((row) => row.stage === stage);
}

/** Rows in the live pipeline (Draft, Exploratory, Engaged, On hold). */
export function countLivePipelineRows(counts: FormationPipelineCounts): number {
  return FORMATION_PIPELINE_LIVE_STAGES.reduce((sum, stage) => sum + counts[stage], 0);
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

/** Stage pills: `In pipeline` (the default), `All`, then every stage, with counts. Disengaged and Confidential appear only when they hold rows. */
export function buildPipelinePillOptions(counts: FormationPipelineCounts): FilterPillOption[] {
  const stagePills = FORMATION_PIPELINE_STAGES.filter((stage) => counts[stage] > 0 || !FORMATION_PIPELINE_HIDE_WHEN_EMPTY_STAGES.includes(stage)).map(
    (stage) => ({
      id: stage,
      label: `${FORMATION_PIPELINE_STAGE_LABELS[stage]} (${counts[stage]})`,
    })
  );
  return [
    { id: 'in_pipeline', label: `${FORMATION_PIPELINE_COPY.inPipeline} (${countLivePipelineRows(counts)})` },
    { id: 'all', label: `${FORMATION_PIPELINE_COPY.allStages} (${counts.total})` },
    ...stagePills,
  ];
}

/** Stat strip cards for the five headline stages; each card's `action` is the stage key it filters by. */
export function buildPipelineStatCards(
  counts: FormationPipelineCounts,
  rows: readonly FormationPipelineRow[],
  selected: FormationPipelineStageFilter,
  now: Date = new Date()
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
  return FORMATION_PIPELINE_STAT_STAGES.map((stage) => ({
    value: counts[stage],
    label: FORMATION_PIPELINE_STAGE_LABELS[stage],
    subLine: subLines[stage],
    ...FORMATION_PIPELINE_STAT_CARD_STYLE[stage],
    action: stage,
    selected: selected === stage,
  }));
}

/**
 * The formation checklist (keeping the foundation context) when the project has one and it can be shown; otherwise the
 * project's own dashboard. The checklist page renders a frozen checklist (Disengaged) read-only but blocks an Archived
 * project, so an Archived row goes to its dashboard even when a checklist exists.
 */
export function getPipelineRowLink(row: Pick<FormationPipelineRow, 'slug' | 'has_checklist' | 'stage'>): FormationPipelineRowLink {
  return row.has_checklist && row.stage !== 'archived'
    ? { commands: ['/foundation/formations', row.slug], queryParams: null }
    : { commands: ['/project/overview'], queryParams: { project: row.slug } };
}

/** Resolves every display string of a row once. */
export function toPipelineTableRow(row: FormationPipelineRow, now: Date = new Date()): FormationPipelineTableRow {
  const { ed, pm } = getPipelineEdPmLines(row);
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
    ownerLabel: getPipelineOpportunityOwner(row),
    updatedLabel: getPipelineUpdatedLabel(row.updated_at),
    link: getPipelineRowLink(row),
  };
}

/** Relative "Updated" text, or `''` when there is no timestamp. */
export function getPipelineUpdatedLabel(updatedAt: string | null | undefined): string {
  return updatedAt ? timeAgo(updatedAt) : '';
}

const PIPELINE_CSV_HEADER: string[] = [
  'Project',
  'Foundation',
  'Stage',
  'Expected launch',
  'Formation date',
  'Legal entity',
  'ED',
  'PM',
  'Opportunity owner',
  'Updated',
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
      date(row.formation_date),
      row.legal_entity_name ?? '',
      personName(row.executive_director),
      personName(row.program_manager),
      getPipelineOpportunityOwner(row),
      row.updated_at ?? '',
    ]),
  ];
}

/** `formation-pipeline-YYYY-MM-DD.csv` for the given day (UTC). */
export function getPipelineCsvFilename(now: Date = new Date()): string {
  return `${FORMATION_PIPELINE_CSV_FILENAME_PREFIX}${now.toISOString().slice(0, 10)}.csv`;
}
