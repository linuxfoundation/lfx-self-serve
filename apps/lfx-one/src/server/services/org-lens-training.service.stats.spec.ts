// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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

interface StatsRows {
  cert?: Record<string, unknown>[];
  training?: Record<string, unknown>[];
  activity?: Record<string, unknown>[];
  roster?: Record<string, unknown>[];
}

/** Answers each stats statement by the relation it reads, like Snowflake would for one account. */
function mockStatsRows(rows: StatsRows): void {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes('ORG_TRAINING_ROSTER_MEMBERS')) return { rows: rows.roster ?? [] };
    if (sql.includes('ORG_PEOPLE_TRAINING_COURSES')) return { rows: rows.training ?? [] };
    if (sql.includes('PEOPLE_WITH_TRAINING_ACTIVITY')) return { rows: rows.activity ?? [] };
    return { rows: rows.cert ?? [] };
  });
}

function sqlReading(marker: string): string {
  const sql = execute.mock.calls.map(([statement]) => statement as string).find((statement) => statement.includes(marker));
  if (!sql) throw new Error(`no statement reads ${marker}`);
  return sql;
}

let service: OrgLensTrainingService;

beforeEach(() => {
  vi.clearAllMocks();
  withOrgCache.mockImplementation(async (_account: string, _key: string, _ttl: number, factory: () => Promise<unknown>) => factory());
  service = new OrgLensTrainingService();
});

describe('OrgLensTrainingService — learner numbers on the stats endpoint', () => {
  it('returns roster members, people with training activity and the in-progress snapshot, each with its as-of time', async () => {
    mockStatsRows({
      cert: [{ CERTIFIED_EMPLOYEES: 4, CERTIFICATIONS_EARNED: 6, EMPLOYEES_IN_TRAINING: 0, TRAINING_COURSES_ENROLLED: 0 }],
      training: [
        {
          CERTIFIED_EMPLOYEES: 0,
          CERTIFICATIONS_EARNED: 0,
          EMPLOYEES_IN_TRAINING: 3,
          TRAINING_COURSES_ENROLLED: 5,
          IN_PROGRESS_AS_OF: new Date('2026-10-30T10:15:00.000Z'),
        },
      ],
      activity: [{ PEOPLE_WITH_TRAINING_ACTIVITY: 12, TRAINING_ACTIVITY_AS_OF: new Date('2026-10-30T09:48:21.094Z') }],
      roster: [{ ROSTER_MEMBERS: 40, AS_OF_TS: new Date('2026-10-29T23:00:00.000Z') }],
    });

    const stats = await service.getTrainingStats(ACCOUNT);

    expect(stats).toEqual({
      rosterMembers: 40,
      rosterMembersAsOf: '2026-10-29T23:00:00.000Z',
      peopleWithTrainingActivity: 12,
      trainingActivityAsOf: '2026-10-30T09:48:21.094Z',
      certifiedEmployees: 4,
      certificationsEarned: 6,
      employeesInTraining: 3,
      trainingCoursesEnrolled: 5,
      inProgressAsOf: '2026-10-30T10:15:00.000Z',
    });
    for (const sql of execute.mock.calls.map(([statement]) => statement as string)) {
      expect(sql).toContain('ACCOUNT_ID = ?');
    }
    expect(execute.mock.calls.every(([, binds]) => (binds as string[]).every((bind) => bind === ACCOUNT))).toBe(true);
  });

  it('reports no roster (null, not zero) when the org has no training client row, and keeps the other numbers', async () => {
    mockStatsRows({
      activity: [{ PEOPLE_WITH_TRAINING_ACTIVITY: 7, TRAINING_ACTIVITY_AS_OF: new Date('2026-10-30T09:48:21.094Z') }],
      roster: [],
    });

    const stats = await service.getTrainingStats(ACCOUNT);

    expect(stats.rosterMembers).toBeNull();
    expect(stats.rosterMembersAsOf).toBeNull();
    expect(stats.peopleWithTrainingActivity).toBe(7);
  });

  it('keeps a roster of zero members as zero', async () => {
    mockStatsRows({ roster: [{ ROSTER_MEMBERS: 0, AS_OF_TS: '2026-10-29 23:00:00.000' }] });

    const stats = await service.getTrainingStats(ACCOUNT);

    expect(stats.rosterMembers).toBe(0);
    expect(stats.rosterMembersAsOf).toBe('2026-10-29T23:00:00.000Z');
  });

  it('returns zero activity and no as-of time for an org without training rows', async () => {
    mockStatsRows({ activity: [{ PEOPLE_WITH_TRAINING_ACTIVITY: 0, TRAINING_ACTIVITY_AS_OF: null }], training: [] });

    const stats = await service.getTrainingStats(ACCOUNT);

    expect(stats.peopleWithTrainingActivity).toBe(0);
    expect(stats.trainingActivityAsOf).toBeNull();
    expect(stats.inProgressAsOf).toBeNull();
  });

  it('reads as-of times stored as Snowflake text after a cache round trip', async () => {
    mockStatsRows({ activity: [{ PEOPLE_WITH_TRAINING_ACTIVITY: 2, TRAINING_ACTIVITY_AS_OF: '2026-11-02 01:48:21.094 -0800' }] });

    const stats = await service.getTrainingStats(ACCOUNT);

    expect(stats.trainingActivityAsOf).toBe('2026-11-02T09:48:21.094Z');
  });

  it('counts people with training activity over every status and date, without the people-list join', async () => {
    mockStatsRows({});

    await service.getTrainingStats(ACCOUNT);

    const activitySql = sqlReading('PEOPLE_WITH_TRAINING_ACTIVITY');
    expect(activitySql).toMatch(/COUNT\(DISTINCT PERSON_KEY\)\s+AS PEOPLE_WITH_TRAINING_ACTIVITY/);
    expect(activitySql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING\n');
    expect(activitySql).not.toContain('ACTIVITY_TS');
    expect(activitySql).not.toContain('STATUS');
    expect(activitySql).not.toContain('ORG_PEOPLE_ALL');
  });

  it('caches under the v2 key and rejects an entry stored before the learner numbers existed', async () => {
    mockStatsRows({});

    await service.getTrainingStats(ACCOUNT);

    const [, key, , , accept] = withOrgCache.mock.calls[0] as [string, string, number, unknown, (value: unknown) => boolean];
    expect(key).toBe('training-stats:v2');
    expect(accept({ certRows: [], trainingRows: [] })).toBe(false);
    expect(accept({ certRows: [], trainingRows: [], activityRows: [], rosterRows: [] })).toBe(true);
  });
});
