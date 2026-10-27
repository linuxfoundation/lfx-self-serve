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

  it('lists in-progress employees from the same 12-month window', async () => {
    await service.getCertificationEmployees(REQ, ACCOUNT, 'course-1', 'in-progress');

    expect(sqls()[0]).toContain(`AND t.STATUS IS DISTINCT FROM 'Certified' AND ${ENROLLED_WINDOW}`);
  });

  it('lists certified employees without a window', async () => {
    await service.getCertificationEmployees(REQ, ACCOUNT, 'course-1', 'certified');

    expect(sqls()[0]).toContain("AND t.STATUS = 'Certified'");
    expect(sqls()[0]).not.toContain('ACTIVITY_TS');
  });
});
