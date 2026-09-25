// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CompactOrgLensProjectRow,
  ContributorPersonProjectRow,
  EventAttendeeEventOptionRow,
  EventAttendeeFoundationOptionRow,
  OrgLensProjectPerson,
  OrgPeopleAllEventAttendeeRow,
  OrgPeopleAllRowRaw,
  OrgPeopleAllStatsRow,
  OrgPeopleAllTraineeRow,
  OrgPeopleEventRow,
  OrgPeopleFoundationOptionRow,
  OrgPeopleTrainingRow,
  TraineeCourseOptionRow,
  TraineeFoundationOptionRow,
} from '../interfaces';

/**
 * Stored column lists for the per-org Org Lens compact caches (GH-1906).
 *
 * Each list is the single definition shared by the encoder that writes the table (`toColumnar`) and
 * the guard that validates it on read (`hasExactColumns`). Keeping one list is the point: a guard
 * that checked its own copy of the columns would silently drift from the writer, and the failure
 * mode of that drift is a cache that decodes into objects missing data rather than one that misses.
 *
 * `as const satisfies readonly (keyof Row)[]` gives both halves of that protection — the literal
 * tuple is what `toColumnar` type-checks its key argument against, and the `satisfies` clause fails
 * the build if a column is renamed out from under the list.
 *
 * Order is significant: `hasExactColumns` requires the stored `k` to match position for position, so
 * reordering a list here is a stored-shape change and needs the cache key's version bumped with it.
 */

/** `CompactOrgLensProjectsCache.people` — each distinct person in the response, once. */
export const ORG_LENS_PROJECT_PEOPLE_COLUMNS = ['id', 'name', 'avatarUrl'] as const satisfies readonly (keyof OrgLensProjectPerson)[];

/** `CompactOrgLensProjectsCache.projects` — one row per project, people lifted out. */
export const ORG_LENS_PROJECT_ROW_COLUMNS = [
  'slug',
  'name',
  'logoUrl',
  'foundationSlug',
  'foundationName',
  'foundationLogoUrl',
  'health',
  'healthOverallScore',
  'healthMaxScore',
  'healthCoveredCategoryCount',
  'healthMaintainer',
  'healthSecurity',
  'healthDevelopment',
  'technicalInfluence',
  'ecosystemInfluence',
  'influenceScore',
  'priorYearScore',
  'trendDeltaPct',
  'trendTechnicalDeltaPct',
  'trendEcosystemDeltaPct',
  'trendDirection',
  'trendSeries',
  'commits1y',
  'changeDriverLabel',
  'changeDriverDirection',
  'description',
  'metricsState',
  'noActivityYet',
] as const satisfies readonly (keyof CompactOrgLensProjectRow)[];

/** `CompactOrgAllEmployeesRawCache.rowsRaw` — roster rows without `ACCOUNT_ID`, which is hoisted to the envelope. */
export const ORG_PEOPLE_ALL_ROW_COLUMNS = [
  'PERSON_KEY',
  'LFID',
  'LF_USERNAME',
  'CDP_MEMBER_ID',
  'NAME',
  'TITLE',
  'EMAIL',
  'PHOTO',
  'SEATS_COUNT',
  'BOARD_SEATS_COUNT',
  'COMMITTEE_SEATS_COUNT',
  'COMMITS_COUNT',
  'EVENTS_COUNT',
  'COURSES_COUNT',
  'ENGAGED_FOUNDATION_IDS',
] as const satisfies readonly (keyof OrgPeopleAllRowRaw)[];

/** `CompactOrgAllEmployeesRawCache.statsRaw`. */
export const ORG_PEOPLE_ALL_STATS_COLUMNS = [
  'ACCOUNT_ID',
  'ACTIVE_IN_OSS',
  'IN_GOVERNANCE',
  'CODE_CONTRIBUTORS',
  'EVENT_ATTENDEES',
  'TRAINEES',
] as const satisfies readonly (keyof OrgPeopleAllStatsRow)[];

/** `CompactOrgAllEmployeesRawCache.foundationRaw`. */
export const ORG_PEOPLE_FOUNDATION_OPTION_COLUMNS = ['FOUNDATION_ID', 'FOUNDATION_NAME'] as const satisfies readonly (keyof OrgPeopleFoundationOptionRow)[];

/** `CompactOrgEventAttendeesRawCache.attendeeRows`. */
export const ORG_EVENT_ATTENDEE_ROW_COLUMNS = [
  'PERSON_KEY',
  'LFID',
  'CDP_MEMBER_ID',
  'NAME',
  'TITLE',
  'EMAIL',
] as const satisfies readonly (keyof OrgPeopleAllEventAttendeeRow)[];

/** `CompactOrgEventAttendeesRawCache.events` — the event-level columns lifted out of every detail row. */
export const ORG_EVENT_DICTIONARY_COLUMNS = [
  'EVENT_ID',
  'EVENT_NAME',
  'EVENT_LOCATION',
  'EVENT_CITY',
  'EVENT_COUNTRY',
  'EVENT_URL',
  'EVENT_START_DATE',
  'EVENT_END_DATE',
  'FOUNDATION_ID',
  'FOUNDATION_NAME',
] as const satisfies readonly (keyof OrgPeopleEventRow)[];

/** `CompactOrgEventAttendeesRawCache.details` — what genuinely varies per (person, event) row. */
export const ORG_EVENT_DETAIL_COLUMNS = ['PERSON_KEY', 'IS_SPEAKER', 'IS_PAST_EVENT'] as const satisfies readonly (keyof OrgPeopleEventRow)[];

/** `CompactOrgEventAttendeesRawCache.foundationRows`. */
export const ORG_EVENT_FOUNDATION_OPTION_COLUMNS = ['FOUNDATION_ID', 'FOUNDATION_NAME'] as const satisfies readonly (keyof EventAttendeeFoundationOptionRow)[];

/** `CompactOrgEventAttendeesRawCache.eventRows`. */
export const ORG_EVENT_OPTION_COLUMNS = ['EVENT_ID', 'EVENT_NAME', 'EVENT_END_DATE'] as const satisfies readonly (keyof EventAttendeeEventOptionRow)[];

/** `CompactOrgTraineesRawCache.traineeRows`. */
export const ORG_TRAINEE_ROW_COLUMNS = [
  'PERSON_KEY',
  'LFID',
  'CDP_MEMBER_ID',
  'NAME',
  'TITLE',
  'EMAIL',
] as const satisfies readonly (keyof OrgPeopleAllTraineeRow)[];

/** `CompactOrgTraineesRawCache.courses` — the course-level columns lifted out of every detail row. */
export const ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS = [
  'COURSE_ID',
  'COURSE_NAME',
  'FOUNDATION_ID',
  'FOUNDATION_NAME',
] as const satisfies readonly (keyof OrgPeopleTrainingRow)[];

/** `CompactOrgTraineesRawCache.details` — what genuinely varies per (person, course-or-cert) row. */
export const ORG_TRAINEE_DETAIL_COLUMNS = [
  'PERSON_KEY',
  'STATUS',
  'COURSE_OR_CERT_ID',
  'ACTIVITY_TS',
] as const satisfies readonly (keyof OrgPeopleTrainingRow)[];

/** `CompactOrgTraineesRawCache.foundationRows`. */
export const ORG_TRAINEE_FOUNDATION_OPTION_COLUMNS = ['FOUNDATION_ID', 'FOUNDATION_NAME'] as const satisfies readonly (keyof TraineeFoundationOptionRow)[];

/** `CompactOrgTraineesRawCache.courseRows`. */
export const ORG_TRAINEE_COURSE_OPTION_COLUMNS = ['COURSE_ID', 'COURSE_NAME'] as const satisfies readonly (keyof TraineeCourseOptionRow)[];

/** `CompactOrgContributorRowsCache.projects` — the project-level columns lifted out of every aggregate row. */
export const ORG_CONTRIBUTOR_PROJECT_COLUMNS = [
  'PROJECT_ID',
  'PROJECT_NAME',
  'PROJECT_SLUG',
  'FOUNDATION_ID',
  'FOUNDATION_NAME',
  'FOUNDATION_SLUG',
] as const satisfies readonly (keyof ContributorPersonProjectRow)[];

/** `CompactOrgContributorRowsCache.rows` — the person-grain columns of each aggregate row. */
export const ORG_CONTRIBUTOR_ROW_COLUMNS = [
  'PERSON_KEY',
  'LFID',
  'LF_USERNAME',
  'CDP_MEMBER_ID',
  'DISPLAY_NAME',
  'TITLE',
  'COMMITS',
  'CODE_ACTIVITIES',
  'LAST_ACTIVE_DATE',
  'IS_DECLARED_MAINTAINER_FOR_PROJECT',
  'IS_DECLARED_MAINTAINER_FOR_ORG',
] as const satisfies readonly (keyof ContributorPersonProjectRow)[];
