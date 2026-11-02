// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CERTIFICATION_PRODUCT_TYPE, TRAINING_PRODUCT_TYPE } from '@lfx-one/shared/constants';
import type { EnrollmentRow } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, getLogoUrls } = vi.hoisted(() => ({
  execute: vi.fn(),
  getLogoUrls: vi.fn(),
}));

vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./ti.service', () => ({ tiService: { getLogoUrls } }));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { TrainingService } from './training.service';

const REQ = {} as Request;

const examRow: EnrollmentRow = {
  ENROLLMENT_ID: 'enrollment-1',
  COURSE_NAME: 'Exam course',
  COURSE_GROUP_DESCRIPTION: null,
  LOGO_URL: null,
  PROJECT_NAME: null,
  LEVEL: 'Intermediate',
  COURSE_SLUG: 'exam-course',
  COURSE_ID: 'course-1',
  STATUS: 'not-started',
  IS_ACTIVE_ENROLLMENT: true,
  ENROLLMENT_TS: '2026-01-15 09:30:00.000',
  TOTAL_TIME: null,
  PRODUCT_TYPE: CERTIFICATION_PRODUCT_TYPE,
};

let service: TrainingService;

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue({ rows: [] });
  getLogoUrls.mockResolvedValue(new Map());
  service = new TrainingService();
});

// The Enrolled Trainings tab lists trainings, plus exams only while the user has no certification certificate for
// the course; once certified, the exam belongs to the Certifications tab alone.
describe('TrainingService.getEnrollments — trainings and uncertified exams', () => {
  it('binds the username and product types to the placeholders they filter', async () => {
    await service.getEnrollments(REQ, 'user-1');

    const [sql, binds] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql.match(/\?/g)).toHaveLength(binds.length);
    expect(sql).toMatch(
      /WHERE e\.USER_NAME = \? AND e\.PRODUCT_TYPE IN \(\?, \?\)\s+AND NOT EXISTS \([\s\S]+WHERE e\.PRODUCT_TYPE = \?[\s\S]+AND c\.PRODUCT_TYPE = \?\s+\)/
    );
    expect(binds).toEqual(['user-1', TRAINING_PRODUCT_TYPE, CERTIFICATION_PRODUCT_TYPE, CERTIFICATION_PRODUCT_TYPE, CERTIFICATION_PRODUCT_TYPE]);
  });

  it('excludes an exam when the user holds a certificate for the same course, current or expired', async () => {
    await service.getEnrollments(REQ, 'user-1');

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toMatch(
      /FROM ANALYTICS\.PLATINUM_LFX_ONE\.USER_CERTIFICATES c\s+WHERE e\.PRODUCT_TYPE = \?\s+AND c\.USER_NAME = e\.USER_NAME\s+AND c\.COURSE_ID = e\.COURSE_ID\s+AND c\.PRODUCT_TYPE = \?/
    );
    expect(sql).not.toContain('EXPIRATION_DATE');
  });

  // Snowflake rejects a correlated EXISTS under OR (https://docs.snowflake.com/en/sql-reference/operators-subquery),
  // and getEnrollments degrades a failed query to an empty tab, so the rule is asserted on the SQL text.
  it('keeps the certificate subquery out of any OR', async () => {
    await service.getEnrollments(REQ, 'user-1');

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql.replace(/\s+/g, ' ')).not.toMatch(/\bOR\s*\(?\s*(NOT\s+)?EXISTS\b/i);
  });

  it('maps the product type and enrollment date onto each enrollment', async () => {
    execute.mockResolvedValue({ rows: [examRow] });

    const [enrollment] = await service.getEnrollments(REQ, 'user-1');

    expect(enrollment.productType).toBe(CERTIFICATION_PRODUCT_TYPE);
    expect(enrollment.enrolledDate).toBe(examRow.ENROLLMENT_TS);
    expect(enrollment.isActiveEnrollment).toBe(true);
  });

  it('returns no enrollments when the Snowflake query fails', async () => {
    execute.mockRejectedValue(new Error('query failed'));

    await expect(service.getEnrollments(REQ, 'user-1')).resolves.toEqual([]);
  });
});
