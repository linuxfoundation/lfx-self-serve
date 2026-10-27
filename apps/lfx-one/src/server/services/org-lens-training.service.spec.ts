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

import { OrgLensTrainingService } from './org-lens-training.service';

const ACCOUNT = '0014100000Te2ovAAB';
const REQ = {} as Request;
const ENROLLED_WINDOW = "t.ACTIVITY_TS::date >= DATEADD('MONTH', -12, CURRENT_DATE()) AND t.ACTIVITY_TS::date < CURRENT_DATE()";

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

// ORG_PEOPLE_TRAINING holds enrollments of any age (the People › Trainees ranges read them), so the Certifications tab
// has to keep its own 12-month enrollment window or old enrollments would inflate In Progress and list courses nobody
// at the org is working on.
describe('OrgLensTrainingService — Certifications tab window', () => {
  it('counts certificates of any age and only enrollments from the last 12 months', async () => {
    await service.getOrgCertifications(REQ, ACCOUNT, { level: null, pageSize: 10, offset: 0, sortField: 'COURSE_NAME', sortOrder: 'ASC' });

    expect(execute).toHaveBeenCalledTimes(2);
    for (const sql of sqls()) {
      expect(sql).toContain(`AND (t.STATUS = 'Certified' OR (${ENROLLED_WINDOW}))`);
    }
  });

  it('lists in-progress employees from the same 12-month window, without anyone certified in the course', async () => {
    await service.getCertificationEmployees(REQ, ACCOUNT, 'course-1', 'in-progress');

    expect(sqls()[0]).toContain(`AND (t.STATUS = 'Certified' OR (${ENROLLED_WINDOW}))`);
    expect(sqls()[0]).toMatch(/GROUP BY p\.PERSON_KEY, p\.NAME, p\.TITLE\s+HAVING COUNT_IF\(t\.STATUS = 'Certified'\) = 0/);
  });

  it('lists certified employees without a window', async () => {
    await service.getCertificationEmployees(REQ, ACCOUNT, 'course-1', 'certified');

    expect(sqls()[0]).toContain("AND t.STATUS = 'Certified'");
    expect(sqls()[0]).not.toContain('ACTIVITY_TS');
    expect(sqls()[0]).not.toContain('HAVING');
  });
});

// Since lf-dbt#3118 a person can carry a certificate row and a later re-enrollment row for one course: they count,
// and are listed, as certified only.
describe('OrgLensTrainingService — one status per person and course', () => {
  it('counts in progress as the people in the course minus the certified ones', async () => {
    await service.getOrgCertifications(REQ, ACCOUNT, { level: null, pageSize: 10, offset: 0, sortField: 'COURSE_NAME', sortOrder: 'ASC' });

    for (const sql of sqls()) {
      expect(sql).toMatch(/COUNT\(DISTINCT CASE WHEN t\.STATUS = 'Certified' THEN t\.PERSON_KEY END\)\s+AS CERTIFIED_COUNT/);
      expect(sql).toMatch(
        /COUNT\(DISTINCT t\.PERSON_KEY\) - COUNT\(DISTINCT CASE WHEN t\.STATUS = 'Certified' THEN t\.PERSON_KEY END\)\s+AS IN_PROGRESS_COUNT/
      );
      expect(sql).not.toContain("IS DISTINCT FROM 'Certified'");
    }
  });

  it('caches under the v3 keys, so counts stored before the change miss', async () => {
    await service.getOrgCertifications(REQ, ACCOUNT, { level: null, pageSize: 10, offset: 0, sortField: 'COURSE_NAME', sortOrder: 'ASC' });
    await service.getCertificationEmployees(REQ, ACCOUNT, 'course-1', 'in-progress');

    const keys = withOrgCache.mock.calls.map(([, key]) => key as string);
    expect(keys[0].startsWith('certifications:v3:')).toBe(true);
    expect(keys[1].startsWith('certification-employees:v3:')).toBe(true);
  });
});
