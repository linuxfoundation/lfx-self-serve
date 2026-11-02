// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_TRAINING_NO_ROSTER_NOTE, ORG_TRAINING_STAT_DEFINITIONS, ORG_TRAINING_STAT_TILES } from '../constants/org-training-stats.constants';
import type { OrgTrainingStatDefinition, OrgTrainingStatKey, OrgTrainingStats, OrgTrainingStatTileVm } from '../interfaces/training.interface';

const AS_OF_DATE_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

/** `as of Nov 2, 2026` (UTC day) for an ISO timestamp; `as-of date unavailable` when there is none or it does not parse. */
export function formatOrgTrainingAsOf(asOf: string | null | undefined): string {
  const date = asOf ? new Date(asOf) : null;
  if (!date || Number.isNaN(date.getTime())) return 'as-of date unavailable';
  return `as of ${AS_OF_DATE_FORMAT.format(date)}`;
}

/**
 * Line under a learner or enrollment number: `People · all time · as of Nov 2, 2026`. `window` is the surface's window
 * (the Trainees range) for a stat without a fixed one.
 */
export function orgTrainingStatCaption(stat: OrgTrainingStatDefinition, asOf: string | null | undefined, window?: string): string {
  const unit = stat.unit.charAt(0).toUpperCase() + stat.unit.slice(1);
  return [unit, stat.window ?? window, formatOrgTrainingAsOf(asOf)].filter(Boolean).join(' · ');
}

/** Tooltip of a learner or enrollment number: its definition, then unit, window and as-of date. */
export function orgTrainingStatTooltip(stat: OrgTrainingStatDefinition, asOf: string | null | undefined, window?: string): string {
  const formattedAsOf = formatOrgTrainingAsOf(asOf);
  return `${stat.definition} Unit: ${stat.unit}. Window: ${stat.window ?? window ?? 'not stated'}. ${formattedAsOf.charAt(0).toUpperCase()}${formattedAsOf.slice(1)}.`;
}

/** Each strip stat's number and as-of time; the certification counts share ORG_PEOPLE_TRAINING's build with the activity count. */
function statReading(key: OrgTrainingStatKey, stats: OrgTrainingStats): { value: number | null; asOf: string | null } {
  switch (key) {
    case 'rosterMembers':
      return { value: stats.rosterMembers, asOf: stats.rosterMembersAsOf };
    case 'peopleWithTrainingActivity':
      return { value: stats.peopleWithTrainingActivity, asOf: stats.trainingActivityAsOf };
    case 'certifiedPeople':
      return { value: stats.certifiedEmployees, asOf: stats.trainingActivityAsOf };
    case 'certificationsEarned':
      return { value: stats.certificationsEarned, asOf: stats.trainingActivityAsOf };
    case 'peopleInTraining':
      return { value: stats.employeesInTraining, asOf: stats.inProgressAsOf };
    case 'trainingCoursesInProgress':
      return { value: stats.trainingCoursesEnrolled, asOf: stats.inProgressAsOf };
  }
}

/**
 * The Training & Certifications stat strip, in display order. `stats` null (loading or failed) yields null values with the
 * definitions still stated. A null roster means the org has no training program, which the caption says instead of a count.
 */
export function buildOrgTrainingStatTiles(stats: OrgTrainingStats | null): OrgTrainingStatTileVm[] {
  return ORG_TRAINING_STAT_TILES.map((layout) => {
    const definition = ORG_TRAINING_STAT_DEFINITIONS[layout.key];
    const { value, asOf } = stats ? statReading(layout.key, stats) : { value: null, asOf: null };
    const noRoster = stats !== null && layout.key === 'rosterMembers' && value === null;
    return {
      ...layout,
      label: definition.label,
      value,
      caption: noRoster ? ORG_TRAINING_NO_ROSTER_NOTE : orgTrainingStatCaption(definition, asOf),
      tooltip: noRoster ? `${definition.definition} ${ORG_TRAINING_NO_ROSTER_NOTE}.` : orgTrainingStatTooltip(definition, asOf),
    };
  });
}
