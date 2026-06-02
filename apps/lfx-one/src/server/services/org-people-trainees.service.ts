// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_TRAINEES_RESPONSE } from '@lfx-one/shared/constants';
import type {
  OrgTraineeCourseOption,
  OrgTraineeDetailRow,
  OrgTraineeFoundationOption,
  OrgTraineeRow,
  OrgTraineesResponse,
  OrgTraineeStatsBaseline,
} from '@lfx-one/shared/interfaces';

import { SnowflakeService } from './snowflake.service';

/** Per-(account, person) row from `ORG_PEOPLE_ALL` filtered to trainees (`COURSES_COUNT > 0`). */
interface OrgPeopleAllTraineeRow {
  PERSON_KEY: string;
  LFID: string | null;
  CDP_MEMBER_ID: string | null;
  NAME: string | null;
  TITLE: string | null;
  EMAIL: string | null;
  COURSES_COUNT: number | null;
  CERTIFICATIONS_COUNT: number | null;
}

/** Per-(account, person, course_or_cert) row from `ORG_PEOPLE_TRAINING`. */
interface OrgPeopleTrainingRow {
  PERSON_KEY: string;
  STATUS: string | null;
  COURSE_OR_CERT_ID: string;
  COURSE_ID: string | null;
  COURSE_NAME: string | null;
  ACTIVITY_TS: Date | string | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
}

interface FoundationOptionRow {
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
}

interface CourseOptionRow {
  COURSE_ID: string;
  COURSE_NAME: string;
}

/** Trainees tab data access — single bundled GET that backs the filter trio, four stat cards, main row, and lazy expanded section client-side. */
export class OrgPeopleTraineesService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Bundled rows + details + baseline stats + filter-dropdown payloads.
   * Five parallel Snowflake queries; stats are computed in TS over the
   * returned details so the wire contract stays free of duplicated math.
   */
  public async getTrainees(accountId: string): Promise<OrgTraineesResponse> {
    if (!accountId) {
      return { ...EMPTY_ORG_TRAINEES_RESPONSE };
    }

    const [traineeRows, detailRows, foundationRows, courseRows] = await Promise.all([
      this.fetchTraineeRows(accountId),
      this.fetchDetailRows(accountId),
      this.fetchFoundationOptions(accountId),
      this.fetchCourseOptions(accountId),
    ]);

    const trainees: OrgTraineeRow[] = traineeRows.map((row) => ({
      personKey: row.PERSON_KEY,
      lfid: row.LFID,
      cdpMemberId: row.CDP_MEMBER_ID,
      name: row.NAME ?? '',
      title: row.TITLE,
      email: row.EMAIL,
      coursesCount: row.COURSES_COUNT ?? 0,
      certificationsCount: row.CERTIFICATIONS_COUNT ?? 0,
    }));

    const details: OrgTraineeDetailRow[] = detailRows
      .filter((row) => row.STATUS === 'Enrolled' || row.STATUS === 'Certified')
      .map((row) => ({
        personKey: row.PERSON_KEY,
        status: row.STATUS === 'Certified' ? 'Certified' : 'Enrolled',
        courseOrCertId: row.COURSE_OR_CERT_ID,
        // COURSE_ID is 100% populated for both enrolled and certified rows (verified Red Hat 2026-06-01),
        // but fall back to COURSE_OR_CERT_ID so the client-side `(personKey, courseId)` grouping is never keyed on '' / undefined.
        courseId: row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
        courseName: row.COURSE_NAME ?? row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
        foundationId: row.FOUNDATION_ID,
        foundationName: row.FOUNDATION_NAME,
        activityTs: toIsoTimestamp(row.ACTIVITY_TS) ?? '',
      }));

    const foundationOptions: OrgTraineeFoundationOption[] = foundationRows.map((row) => ({
      foundationId: row.FOUNDATION_ID,
      foundationName: row.FOUNDATION_NAME,
    }));

    const courseOptions: OrgTraineeCourseOption[] = courseRows.map((row) => ({
      courseId: row.COURSE_ID,
      courseName: row.COURSE_NAME,
    }));

    return {
      accountId,
      trainees,
      details,
      stats: computeBaselineStats(details),
      foundationOptions,
      courseOptions,
    };
  }

  private async fetchTraineeRows(accountId: string): Promise<OrgPeopleAllTraineeRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        LFID,
        CDP_MEMBER_ID,
        NAME,
        TITLE,
        EMAIL,
        COURSES_COUNT,
        CERTIFICATIONS_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL
      WHERE ACCOUNT_ID = ? AND COURSES_COUNT > 0
      ORDER BY NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgPeopleAllTraineeRow>(query, [accountId]);
    return result.rows;
  }

  private async fetchDetailRows(accountId: string): Promise<OrgPeopleTrainingRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        STATUS,
        COURSE_OR_CERT_ID,
        COURSE_ID,
        COURSE_NAME,
        ACTIVITY_TS,
        FOUNDATION_ID,
        FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
      ORDER BY PERSON_KEY ASC, ACTIVITY_TS DESC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgPeopleTrainingRow>(query, [accountId]);
    return result.rows;
  }

  private async fetchFoundationOptions(accountId: string): Promise<FoundationOptionRow[]> {
    const query = `
      SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
        AND FOUNDATION_ID IS NOT NULL
        AND FOUNDATION_NAME IS NOT NULL
      ORDER BY FOUNDATION_NAME ASC
    `;
    const result = await this.snowflakeService.execute<FoundationOptionRow>(query, [accountId]);
    return result.rows;
  }

  private async fetchCourseOptions(accountId: string): Promise<CourseOptionRow[]> {
    const query = `
      SELECT DISTINCT COURSE_ID, COURSE_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
        AND COURSE_ID IS NOT NULL
        AND COURSE_NAME IS NOT NULL
      ORDER BY COURSE_NAME ASC
    `;
    const result = await this.snowflakeService.execute<CourseOptionRow>(query, [accountId]);
    return result.rows;
  }
}

/**
 * Recompute baseline stat values from the bundled `details` array — same math
 * the client runs on filter change, so initial paint and live filtering use a
 * single source of truth. Trainees = distinct person_key, coursesEnrolled =
 * distinct (person, course), certifications = distinct (person, course) where
 * status='Certified', completionRate = certs / courses × 100 (integer, 0 when
 * coursesEnrolled = 0). Matches the brief's locked Item 3 formula and the
 * client `computed()` body verbatim — keep them in lockstep.
 */
function computeBaselineStats(details: OrgTraineeDetailRow[]): OrgTraineeStatsBaseline {
  const trainees = new Set<string>();
  const courseKeys = new Set<string>();
  const certKeys = new Set<string>();

  for (const row of details) {
    trainees.add(row.personKey);
    const composite = `${row.personKey}|${row.courseId}`;
    courseKeys.add(composite);
    if (row.status === 'Certified') {
      certKeys.add(composite);
    }
  }

  const coursesEnrolled = courseKeys.size;
  const certifications = certKeys.size;
  const completionRate = coursesEnrolled === 0 ? 0 : Math.round((certifications / coursesEnrolled) * 100);

  return {
    trainees: trainees.size,
    coursesEnrolled,
    certifications,
    completionRate,
  };
}

/** Normalize Snowflake `Date | string | null` to a full ISO string, or null when missing / unparseable; preserves time-of-day so client-side time-window predicates and tiebreaker chains stay precise. */
function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return null;
}
