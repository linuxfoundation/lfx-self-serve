// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_TRAINEES_RESPONSE, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  OrgPeopleAllTraineeRow,
  OrgPeopleTrainingRow,
  OrgTraineeCourseOption,
  OrgTraineeDetailRow,
  OrgTraineeFoundationOption,
  OrgTraineeRow,
  OrgTraineesResponse,
  TraineeCourseOptionRow,
  TraineeFoundationOptionRow,
} from '@lfx-one/shared/interfaces';

import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

/** Trainees tab data access — single bundled GET that backs the filter trio, four stat cards, main row, and lazy expanded section client-side. */
export class OrgPeopleTraineesService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Bundled rows + details + filter dropdowns. Four parallel Snowflake queries; stats are recomputed client-side from filtered details so the server ships none. */
  public async getTrainees(accountId: string): Promise<OrgTraineesResponse> {
    if (!accountId) {
      return { ...EMPTY_ORG_TRAINEES_RESPONSE };
    }

    const { traineeRows, detailRows, foundationRows, courseRows } = await withOrgCache(
      accountId,
      'people-trainees',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchTraineesRaw(accountId),
      isTraineesRaw
    );

    const trainees: OrgTraineeRow[] = traineeRows.map((row) => ({
      personKey: row.PERSON_KEY,
      lfid: row.LFID,
      cdpMemberId: row.CDP_MEMBER_ID,
      name: row.NAME ?? '',
      title: row.TITLE,
      email: row.EMAIL,
    }));

    // Drop null-ACTIVITY_TS rows; coercing to '' would corrupt downstream lex sorts and most-recent derivations.
    const details: OrgTraineeDetailRow[] = detailRows.flatMap<OrgTraineeDetailRow>((row) => {
      if (row.STATUS !== 'Enrolled' && row.STATUS !== 'Certified') return [];
      const activityTs = toIsoTimestamp(row.ACTIVITY_TS);
      if (!activityTs) return [];
      return [
        {
          personKey: row.PERSON_KEY,
          status: row.STATUS === 'Certified' ? 'Certified' : 'Enrolled',
          courseOrCertId: row.COURSE_OR_CERT_ID,
          // COURSE_ID is 100% populated for both enrolled and certified rows (verified Red Hat 2026-06-01),
          // but fall back to COURSE_OR_CERT_ID so the client-side `(personKey, courseId)` grouping is never keyed on '' / undefined.
          courseId: row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
          courseName: row.COURSE_NAME ?? row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
          foundationId: row.FOUNDATION_ID,
          foundationName: row.FOUNDATION_NAME,
          activityTs,
        },
      ];
    });

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
      foundationOptions,
      courseOptions,
    };
  }

  private async fetchTraineesRaw(accountId: string): Promise<{
    traineeRows: OrgPeopleAllTraineeRow[];
    detailRows: OrgPeopleTrainingRow[];
    foundationRows: TraineeFoundationOptionRow[];
    courseRows: TraineeCourseOptionRow[];
  }> {
    const [traineeRows, detailRows, foundationRows, courseRows] = await Promise.all([
      this.fetchTraineeRows(accountId),
      this.fetchDetailRows(accountId),
      this.fetchFoundationOptions(accountId),
      this.fetchCourseOptions(accountId),
    ]);
    return { traineeRows, detailRows, foundationRows, courseRows };
  }

  private async fetchTraineeRows(accountId: string): Promise<OrgPeopleAllTraineeRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        LFID,
        CDP_MEMBER_ID,
        NAME,
        TITLE,
        EMAIL
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

  private async fetchFoundationOptions(accountId: string): Promise<TraineeFoundationOptionRow[]> {
    const query = `
      SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
        AND FOUNDATION_ID IS NOT NULL
        AND FOUNDATION_NAME IS NOT NULL
      ORDER BY FOUNDATION_NAME ASC
    `;
    const result = await this.snowflakeService.execute<TraineeFoundationOptionRow>(query, [accountId]);
    return result.rows;
  }

  private async fetchCourseOptions(accountId: string): Promise<TraineeCourseOptionRow[]> {
    const query = `
      SELECT DISTINCT COURSE_ID, COURSE_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
        AND COURSE_ID IS NOT NULL
        AND COURSE_NAME IS NOT NULL
      ORDER BY COURSE_NAME ASC
    `;
    const result = await this.snowflakeService.execute<TraineeCourseOptionRow>(query, [accountId]);
    return result.rows;
  }
}

function isTraineesRaw(value: unknown): boolean {
  const v = value as { traineeRows?: unknown; detailRows?: unknown; foundationRows?: unknown; courseRows?: unknown } | null;
  return !!v && Array.isArray(v.traineeRows) && Array.isArray(v.detailRows) && Array.isArray(v.foundationRows) && Array.isArray(v.courseRows);
}

/** Normalize Snowflake `Date | string | null` to a full ISO string, or null when missing / unparseable; preserves time-of-day so client-side time-window predicates and tiebreaker chains stay precise. */
function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    // Treat Snowflake NTZ strings (no timezone marker) as UTC, not server-local - same drift `toIsoDate` prevents on the date helper.
    const isoLike = value.includes(' ') ? value.replace(' ', 'T') : value;
    const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(isoLike) ? isoLike : `${isoLike}Z`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return null;
}
