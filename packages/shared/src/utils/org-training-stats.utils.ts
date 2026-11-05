// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_TIME_RANGE_OPTIONS } from '../constants/org-lens-time-range.constants';
import {
  ORG_TRAINING_NO_ROSTER_NOTE,
  ORG_TRAINING_OUTSIDE_NOT_COUNTED_NOTE,
  ORG_TRAINING_STAT_DEFINITIONS,
  ORG_TRAINING_STAT_TILES,
} from '../constants/org-training-stats.constants';
import type { OrgLensTimeRange } from '../interfaces/org-lens-time-range.interface';
import type { OrgTrainingStatDefinition, OrgTrainingStatKey, OrgTrainingStats, OrgTrainingStatTileVm } from '../interfaces/org-training-view.interface';

const AS_OF_DATE_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

/** `as of Nov 2, 2026` (UTC day) for an ISO timestamp; `as-of date unavailable` when there is none or it does not parse. */
export function formatOrgTrainingAsOf(asOf: string | null | undefined): string {
  const date = asOf ? new Date(asOf) : null;
  if (!date || Number.isNaN(date.getTime())) return 'as-of date unavailable';
  return `as of ${AS_OF_DATE_FORMAT.format(date)}`;
}

/** Window text of a range: `Past 2 years`, `All time` → `all time`. */
export function orgTrainingRangeWindow(range: OrgLensTimeRange): string {
  const label = ORG_LENS_TIME_RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range;
  return label === 'All time' ? 'all time' : label;
}

/** The parts of a stat's caption: the capitalised unit, the window (with the stat's own note, if any), and the as-of sentence (null when `asOf` is `undefined`). */
export function orgTrainingStatCaptionParts(
  stat: OrgTrainingStatDefinition,
  range: OrgLensTimeRange,
  asOf?: string | null
): { unit: string; window: string; asOf: string | null } {
  const window = [stat.window ?? orgTrainingRangeWindow(range), stat.caption].filter((part): part is string => !!part).join(' · ');
  return {
    unit: stat.unit.charAt(0).toUpperCase() + stat.unit.slice(1),
    window,
    asOf: asOf === undefined ? null : formatOrgTrainingAsOf(asOf),
  };
}

/** `People · Past 2 years · as of Nov 2, 2026`; the unit and window part alone when `asOf` is `undefined`. */
export function orgTrainingStatCaption(stat: OrgTrainingStatDefinition, range: OrgLensTimeRange, asOf?: string | null): string {
  const parts = orgTrainingStatCaptionParts(stat, range, asOf);
  return [parts.unit, parts.window, parts.asOf].filter((part): part is string => !!part).join(' · ');
}

/** A stat's definition, then unit and window. */
export function orgTrainingStatDefinitionText(stat: OrgTrainingStatDefinition, range: OrgLensTimeRange): string {
  return `${stat.definition} Unit: ${stat.unit}. Window: ${stat.window ?? orgTrainingRangeWindow(range)}.`;
}

/** Tooltip of a number: its definition, then unit, window and as-of date. */
export function orgTrainingStatTooltip(stat: OrgTrainingStatDefinition, range: OrgLensTimeRange, asOf: string | null | undefined): string {
  const formattedAsOf = formatOrgTrainingAsOf(asOf);
  return `${orgTrainingStatDefinitionText(stat, range)} ${formattedAsOf.charAt(0).toUpperCase()}${formattedAsOf.slice(1)}.`;
}

function statReading(key: OrgTrainingStatKey, stats: OrgTrainingStats): { value: number | null | undefined; asOf: string | null | undefined } {
  switch (key) {
    case 'rosterMembers':
      return { value: stats.rosterMembers, asOf: stats.rosterMembersAsOf };
    case 'peopleWithTrainingActivity':
      return { value: stats.peopleWithTrainingActivity, asOf: stats.asOf };
    case 'learnersOutsidePeopleList':
      return { value: stats.learnersOutsidePeopleList, asOf: stats.asOf };
    case 'coursesTaken':
      return { value: stats.coursesTaken, asOf: stats.asOf };
    case 'certifications':
      return { value: stats.certifications, asOf: stats.asOf };
    case 'certifiedPeople':
      return { value: stats.certifiedPeople, asOf: stats.asOf };
    case 'trainingsCompleted':
      return { value: stats.trainingsCompleted, asOf: stats.asOf };
    case 'completionRate':
      return { value: stats.completionRatePct, asOf: stats.asOf };
    case 'coursesInProgress':
      return { value: stats.coursesInProgress, asOf: stats.asOf };
    case 'peopleInTraining':
      return { value: stats.peopleInTraining, asOf: stats.asOf };
  }
}

/** A tile's tooltip: the definition with its note, the bare definition while `stats` is absent, or the definition with as-of date. */
function tileTooltip(
  definition: OrgTrainingStatDefinition,
  range: OrgLensTimeRange,
  stats: OrgTrainingStats | null,
  asOf: string | null,
  note: string | null
): string {
  if (note !== null) return `${definition.definition} ${note}.`;
  if (stats === null) return orgTrainingStatDefinitionText(definition, range);
  return orgTrainingStatTooltip(definition, range, asOf);
}

/** A tile's shown value: an em dash for null, a percentage for the completion rate, a grouped number otherwise. */
function tileDisplay(key: OrgTrainingStatKey, value: number | null): string {
  if (value === null) return '—';
  if (key === 'completionRate') return `${value}%`;
  return value.toLocaleString('en-US');
}

/**
 * The shared stat tiles, in display order, for `range`. `stats` null (loading or failed) yields null values with the
 * definitions still stated and no as-of sentence. A roster of exactly null means the org has no training program, and an
 * outside-learners count of exactly null means a filter leaves it uncounted.
 */
export function buildOrgTrainingStatTiles(stats: OrgTrainingStats | null, range: OrgLensTimeRange): OrgTrainingStatTileVm[] {
  return ORG_TRAINING_STAT_TILES.map((layout) => {
    const definition = ORG_TRAINING_STAT_DEFINITIONS[layout.key];
    const reading = stats ? statReading(layout.key, stats) : { value: null, asOf: null };
    // A legacy payload may lack the as-of too: the date is then unavailable.
    const asOf = reading.asOf ?? null;
    // Only an explicit null roster means "no program"; a field a legacy payload lacks (undefined) is just unavailable.
    const noRoster = stats !== null && layout.key === 'rosterMembers' && reading.value === null;
    const notCounted = stats !== null && layout.key === 'learnersOutsidePeopleList' && reading.value === null;
    let note: string | null = null;
    if (noRoster) note = ORG_TRAINING_NO_ROSTER_NOTE;
    else if (notCounted) note = ORG_TRAINING_OUTSIDE_NOT_COUNTED_NOTE;
    const value = typeof reading.value === 'number' && Number.isFinite(reading.value) ? reading.value : null;
    const tooltip = tileTooltip(definition, range, stats, asOf, note);
    const display = tileDisplay(layout.key, value);
    return {
      ...layout,
      label: definition.label,
      value,
      display,
      caption: note ?? orgTrainingStatCaption(definition, range, stats ? asOf : undefined),
      tooltip,
      ariaLabel: `${definition.label}: ${display}. ${tooltip}`,
    };
  });
}

/**
 * Note under the Training table: what "Certified / Completed" and "In progress" count in the selected range, so the
 * table states its own window (no 12-month rule, no snapshot of today).
 */
export function orgTrainingTableNote(range: OrgLensTimeRange): string {
  const window = range === 'all' ? 'at any time' : `in the selected range (${orgTrainingRangeWindow(range)})`;
  return `Certified and Completed count person-course pairs with a certificate dated ${window}. In progress counts pairs enrolled ${window} with no certificate in that range; it is not a snapshot of today. Roster members are live and not filtered.`;
}
