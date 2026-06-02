// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import type { OrgTrainingStats } from '@lfx-one/shared/interfaces';

import { SnowflakeService } from './snowflake.service';

interface OrgTrainingStatsRow {
  CERTIFIED_EMPLOYEES: number;
  CERTIFICATIONS_EARNED: number;
  EMPLOYEES_IN_TRAINING: number;
  TRAINING_COURSES_ENROLLED: number;
}

/** Aggregates training & certification counts from ORG_PEOPLE_TRAINING for an org account. */
export class OrgLensTrainingService {
  private readonly snowflakeService = SnowflakeService.getInstance();

  public async getTrainingStats(accountId: string): Promise<OrgTrainingStats> {
    // Two metric families, each split into a distinct-people count and a record count:
    //   CERTIFIED_EMPLOYEES       — distinct people who completed ≥1 certification
    //   CERTIFICATIONS_EARNED     — total certification records (ignores who earned them)
    //   EMPLOYEES_IN_TRAINING     — distinct people enrolled in ≥1 training (non-certified)
    //   TRAINING_COURSES_ENROLLED — total training enrollment records (ignores who enrolled)
    //
    // STATUS is nullable. Only the exact string 'Certified' counts as certified; every other
    // value — including NULL — is treated as training. `IS DISTINCT FROM` is used (rather than
    // `!=`) so NULL rows fall into the training branch instead of being silently dropped, which
    // matches the people-side convention (org-lens-people.service.ts: STATUS === 'Certified').
    const query = `
      SELECT
        COUNT(DISTINCT CASE WHEN STATUS = 'Certified' THEN PERSON_KEY END)              AS CERTIFIED_EMPLOYEES,
        COUNT_IF(STATUS = 'Certified')                                                  AS CERTIFICATIONS_EARNED,
        COUNT(DISTINCT CASE WHEN STATUS IS DISTINCT FROM 'Certified' THEN PERSON_KEY END) AS EMPLOYEES_IN_TRAINING,
        COUNT_IF(STATUS IS DISTINCT FROM 'Certified')                                   AS TRAINING_COURSES_ENROLLED
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
    `;

    const result = await this.snowflakeService.execute<OrgTrainingStatsRow>(query, [accountId]);
    const row = result.rows[0];

    return {
      certifiedEmployees: row?.CERTIFIED_EMPLOYEES ?? 0,
      certificationsEarned: row?.CERTIFICATIONS_EARNED ?? 0,
      employeesInTraining: row?.EMPLOYEES_IN_TRAINING ?? 0,
      trainingCoursesEnrolled: row?.TRAINING_COURSES_ENROLLED ?? 0,
    };
  }
}
