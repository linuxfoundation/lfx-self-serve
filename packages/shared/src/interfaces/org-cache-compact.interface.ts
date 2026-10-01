// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ColumnarTable } from './compact-cache.interface';
import type { HealthScore, InfluenceBand, InfluenceTrendDirection, OrgLensProjectMetricsState } from './org-lens-projects.interface';

// Stored (Valkey) shapes for the per-org, 1-hour Org Lens caches (GH-1906). None of these is a wire
// shape: each service rebuilds the exact response it returns today from the compact value on read,
// so the browser contract is untouched. A plain comment, not JSDoc: it describes the file, and a
// JSDoc block here would attach itself to whichever declaration happens to come next.
//
// Two mechanisms recur, and both are worth stating once here rather than in five places:
//
// 1. Columnar rows. Warehouse rows are uniform, so `ColumnarTable` carries the field names once
//    instead of on every row. On these payloads the repeated uppercase key names were roughly half
//    the serialized bytes.
//
// 2. Dictionary + parallel index. Where a sub-object repeats across rows (an attendee's event, a
//    trainee's course, a contributor's project, a project's people), the distinct values are stored
//    once in a `ColumnarTable` and every row references one by position in a sibling `number[]`.
//    The index is deliberately kept *out* of the row table rather than tucked in as an extra
//    column: that keeps the row decode purely `k`-driven (`fromColumnar`), and it lets a shape
//    guard prove every index is in range before decode, so rebuilding is total, not best-effort.
//
// Every dictionary here is keyed, via `tupleKey`, on the WHOLE tuple of the fields it deduplicates,
// never on the natural id alone. Deduping on `EVENT_ID` (say) would silently collapse two rows that
// share an id but disagree on a name or a date onto the first one seen, which would make the
// rebuilt response differ from the uncached one — the single invariant this whole compaction must
// not break. Keying on the tuple costs nothing in practice (rows that agree still collapse) and
// makes the round trip exact by construction.
//
// The server-internal warehouse row shapes these caches store live in the files that own them —
// `org-people.internal.interface.ts` for the roster, and the trainee, event-attendee and
// contributor interface files for theirs.

/** Cached form of `OrgLensProjectsResponse`. */
export interface CompactOrgLensProjectsCache {
  orgSlug: string;
  orgName: string;
  dataUpdatedAt: string;
  /**
   * Every distinct `{id, name, avatarUrl}` in the whole response, once. This is the reason the
   * payload fits: a person is repeated in every project they touch, so the reference count runs an
   * order of magnitude above the number of distinct people.
   */
  people: ColumnarTable;
  /** One row per project, with `foundation`/`trend`/`changeDriver` flattened and the three people arrays removed. */
  projects: ColumnarTable;
  /** Per project (aligned to `projects.r`), indices into `people.r` for that project's maintainers. */
  maintainers: number[][];
  /** Per project (aligned to `projects.r`), indices into `people.r` for that project's contributors. */
  contributors: number[][];
  /** Per project (aligned to `projects.r`), indices into `people.r` for that project's participants. */
  participants: number[][];
}

/**
 * One project as stored: `foundation`, `trend` and `changeDriver` flattened to scalars (so the row
 * is columnar-able) and the three people arrays lifted out into
 * `CompactOrgLensProjectsCache.people` + the per-role index lists.
 */
export interface CompactOrgLensProjectRow {
  slug: string;
  name: string;
  logoUrl: string;
  foundationSlug: string;
  foundationName: string;
  foundationLogoUrl: string;
  health: HealthScore;
  healthOverallScore: number | null;
  healthMaxScore: number | null;
  healthCoveredCategoryCount: number | null;
  healthMaintainer: number | null;
  healthSecurity: number | null;
  healthDevelopment: number | null;
  technicalInfluence: InfluenceBand;
  ecosystemInfluence: InfluenceBand;
  influenceScore: number;
  priorYearScore: number;
  trendDeltaPct: number;
  trendTechnicalDeltaPct: number;
  trendEcosystemDeltaPct: number;
  trendDirection: InfluenceTrendDirection;
  trendSeries: number[];
  commits1y: number;
  changeDriverLabel: string;
  changeDriverDirection: InfluenceTrendDirection;
  description: string;
  metricsState: OrgLensProjectMetricsState;
  /**
   * Optional, exactly as on `OrgLensProject`: `mapProject` never sets it and only the no-activity
   * fallback rows do. Left optional rather than widened to `boolean | null` because `toColumnar`
   * already stores an absent field distinctly from a null one, so the round trip restores absence
   * as absence without this shape having to encode it.
   */
  noActivityYet?: boolean;
}

/** Cached form of the Org Lens "All Employees" raw warehouse reads. */
export interface CompactOrgAllEmployeesRawCache {
  /**
   * `ACCOUNT_ID`, hoisted off every roster row: the query filters on it, so it is identical on all
   * of them. Restored onto each row at decode. `null` only when the roster is empty.
   */
  accountId: string | null;
  /** Roster rows, columnar and without `ACCOUNT_ID`. */
  rowsRaw: ColumnarTable;
  /** The single-row `ORG_PEOPLE_ALL_STATS` aggregate, columnar for shape uniformity. */
  statsRaw: ColumnarTable;
  /** Distinct `(FOUNDATION_ID, FOUNDATION_NAME)` pairs, columnar. */
  foundationRaw: ColumnarTable;
}

/** Cached form of the Event Attendees raw warehouse reads. */
export interface CompactOrgEventAttendeesRawCache {
  attendeeRows: ColumnarTable;
  /** Distinct event-level field sets (name, location, city, country, url, dates, foundation), once each. */
  events: ColumnarTable;
  /** Per-(person, event) rows reduced to the fields that actually vary per row: `PERSON_KEY`, `IS_SPEAKER`, `IS_PAST_EVENT`. */
  details: ColumnarTable;
  /** Aligned to `details.r`: which entry of `events.r` each detail row belongs to. */
  detailEvents: number[];
  foundationRows: ColumnarTable;
  eventRows: ColumnarTable;
}

/** Cached form of the Trainees raw warehouse reads. */
export interface CompactOrgTraineesRawCache {
  traineeRows: ColumnarTable;
  /** Distinct course-level field sets (`COURSE_ID`, `COURSE_NAME`, `FOUNDATION_ID`, `FOUNDATION_NAME`), once each. */
  courses: ColumnarTable;
  /** Per-(person, course-or-cert) rows reduced to `PERSON_KEY`, `STATUS`, `COURSE_OR_CERT_ID`, `ACTIVITY_TS`. */
  details: ColumnarTable;
  /** Aligned to `details.r`: which entry of `courses.r` each detail row belongs to. */
  detailCourses: number[];
  foundationRows: ColumnarTable;
  courseRows: ColumnarTable;
}

/** Cached form of the Contributors per-(person, project) aggregate rows. */
export interface CompactOrgContributorRowsCache {
  /** Distinct project-level field sets (project id/name/slug + foundation id/name/slug), once each. */
  projects: ColumnarTable;
  /** Person-grain fields of each aggregate row, columnar and without the project-level fields. */
  rows: ColumnarTable;
  /** Aligned to `rows.r`: which entry of `projects.r` each row belongs to. */
  rowProjects: number[];
}
