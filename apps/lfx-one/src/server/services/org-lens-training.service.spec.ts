// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, withOrgCache } = vi.hoisted(() => ({
  execute: vi.fn(),
  withOrgCache: vi.fn(),
}));

vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./valkey.service', () => ({ withOrgCache }));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn() } }));

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgLensTrainingService } from './org-lens-training.service';

const ACCOUNT = SYNTHETIC_ORG_ACCOUNT_ID;
const REQ = {} as Request;
const ENROLLED_WINDOW = "s.LAST_ENROLLED_TS::date >= DATEADD('MONTH', -12, CURRENT_DATE()) AND s.LAST_ENROLLED_TS::date < CURRENT_DATE()";
const STATUS_TABLE = 'FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING_COURSE_STATUS s';
// Only people on the org's people list count: learners outside it may have rows in the training models.
const PEOPLE_LIST_JOIN = /INNER JOIN ANALYTICS\.PLATINUM_LFX_ONE\.ORG_PEOPLE_ALL p\s+ON p\.ACCOUNT_ID = s\.ACCOUNT_ID AND p\.PERSON_KEY = s\.PERSON_KEY/;

function sqls(): string[] {
  return execute.mock.calls.map(([sql]) => sql as string);
}

let service: OrgLensTrainingService;

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue({ rows: [] });
  withOrgCache.mockImplementation(async (_account: string, _key: string, _ttl: number, factory: () => Promise<unknown>) => factory());
  service = new OrgLensTrainingService();
});

// The status table holds courses of any age (the window is the consumer's), so the Certifications tab keeps its own
// 12-month enrollment window or old enrollments would inflate In Progress and list courses nobody at the org is
// working on.
describe('OrgLensTrainingService — Certifications tab window', () => {
  it('counts certificates of any age and only enrollments from the last 12 months', async () => {
    await service.getOrgCertifications(REQ, ACCOUNT, { level: null, pageSize: 10, offset: 0, sortField: 'COURSE_NAME', sortOrder: 'ASC' });

    expect(execute).toHaveBeenCalledTimes(2);
    for (const sql of sqls()) {
      expect(sql).toContain(`AND (s.STATUS = 'Certified' OR (${ENROLLED_WINDOW}))`);
    }
  });

  it('lists in-progress employees from the same 12-month window', async () => {
    await service.getCertificationEmployees(REQ, ACCOUNT, 'course-1', 'in-progress');

    expect(sqls()[0]).toContain(`AND s.STATUS = 'Enrolled' AND (${ENROLLED_WINDOW})`);
  });

  it('lists certified employees without a window', async () => {
    await service.getCertificationEmployees(REQ, ACCOUNT, 'course-1', 'certified');

    expect(sqls()[0]).toContain("AND s.STATUS = 'Certified'");
    expect(sqls()[0]).not.toContain('LAST_ENROLLED_TS');
  });
});

// lf-dbt resolves one status per (person, course), Certified winning over a re-enrollment (lfx-self-serve#4439); the
// tab reads it instead of re-deriving it, so a certified person who re-enrolled counts, and is listed, as certified only.
describe('OrgLensTrainingService — status resolved in lf-dbt', () => {
  it('counts each status from ORG_PEOPLE_TRAINING_COURSE_STATUS, people on the people list only', async () => {
    await service.getOrgCertifications(REQ, ACCOUNT, { level: null, pageSize: 10, offset: 0, sortField: 'COURSE_NAME', sortOrder: 'ASC' });

    for (const sql of sqls()) {
      expect(sql).toContain(STATUS_TABLE);
      expect(sql).toMatch(PEOPLE_LIST_JOIN);
      expect(sql).toMatch(/COUNT_IF\(s\.STATUS = 'Certified'\)\s+AS CERTIFIED_COUNT/);
      expect(sql).toMatch(/COUNT_IF\(s\.STATUS = 'Enrolled'\)\s+AS IN_PROGRESS_COUNT/);
      expect(sql).not.toContain('ORG_PEOPLE_TRAINING t');
    }
  });

  it.each(['certified', 'in-progress'] as const)('lists %s employees by their resolved status, people on the people list only', async (status) => {
    await service.getCertificationEmployees(REQ, ACCOUNT, 'course-1', status);

    expect(sqls()[0]).toContain(STATUS_TABLE);
    expect(sqls()[0]).toMatch(PEOPLE_LIST_JOIN);
    expect(sqls()[0]).not.toContain('HAVING');
    expect(sqls()[0]).not.toContain('ORG_PEOPLE_TRAINING t');
  });

  it('caches under the v4 keys, so entries computed from ORG_PEOPLE_TRAINING miss', async () => {
    await service.getOrgCertifications(REQ, ACCOUNT, { level: null, pageSize: 10, offset: 0, sortField: 'COURSE_NAME', sortOrder: 'ASC' });
    await service.getCertificationEmployees(REQ, ACCOUNT, 'course-1', 'in-progress');

    const keys = withOrgCache.mock.calls.map(([, key]) => key as string);
    expect(keys[0].startsWith('certifications:v4:')).toBe(true);
    expect(keys[1].startsWith('certification-employees:v4:')).toBe(true);
  });
});
