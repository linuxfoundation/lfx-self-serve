// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static isMissingObjectError = vi.fn(() => false);
    public static getInstance() {
      return { execute };
    }
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { HEALTH_METRICS_OVERVIEW_BOARD_MEMBERS_ROW_CAP, HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP } from '@lfx-one/shared/constants';

import { HealthMetricsOverviewService } from './health-metrics-overview.service';
import { logger } from './logger.service';

import type { Request } from 'express';

const req = {} as Request;
const query = { foundationSlug: 'acme' };
const SUFFIXES = [
  ['YTD', 'ytd'],
  ['COMPLETED_YEAR', 'last_completed_year'],
  ['COMPLETED_YEAR_2', 'prev_completed_year'],
  ['COMPLETED_YEAR_3', '3rd_last_completed_year'],
] as const;

/** One wide row with the same figures under every period, overridden per column where a test needs it. */
function wide(figures: Record<string, unknown>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const columns = SUFFIXES.flatMap(([range]) => Object.entries(figures).map(([key, value]) => [`${key}_${range}`, value]));
  return { ...Object.fromEntries(columns), ...overrides };
}

function sql(index = 0): string {
  return execute.mock.calls[index]?.[0] as string;
}

/** Every bound placeholder has a bind, and the binds are exactly these. */
function expectBinds(index: number, binds: unknown[]): void {
  expect(sql(index).match(/\?/g)).toHaveLength(binds.length);
  expect(execute.mock.calls[index]?.[1]).toEqual(binds);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HealthMetricsOverviewService.getParticipatingOrgs', () => {
  it('reads every period from its own columns, and the engagement split for YTD and last year only', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsOverviewService().getParticipatingOrgs(req, query);

    for (const [range, suffix] of SUFFIXES) {
      expect(sql()).toContain(`active_members_count_${suffix} AS active_members_count_${range}`);
      expect(sql()).toContain(`non_members_count_${suffix} AS non_members_count_${range}`);
    }
    expect(sql()).toContain('member_low_engagement_pct_ytd AS member_low_engagement_pct_YTD');
    expect(sql()).toContain('non_member_high_engagement_count_last_completed_year AS non_member_high_engagement_count_COMPLETED_YEAR');
    expect(sql()).not.toContain('engagement_count_prev_completed_year');
    expectBinds(0, ['acme']);
  });

  it('maps each period, leaving the split null where the view does not model it', async () => {
    execute.mockResolvedValue({
      rows: [
        wide(
          { ACTIVE_MEMBERS_COUNT: 725, NEW_MEMBERS_COUNT: 40, NON_RENEWALS_COUNT: '12', NON_MEMBERS_COUNT: null },
          { MEMBER_HIGH_ENGAGEMENT_COUNT_YTD: 100, MEMBER_LOW_ENGAGEMENT_PCT_YTD: '0.54', NON_MEMBER_LOW_ENGAGEMENT_COUNT_YTD: 7 }
        ),
      ],
    });

    const orgs = await new HealthMetricsOverviewService().getParticipatingOrgs(req, query);

    expect(orgs.measured).toBe(true);
    expect(orgs.periods.YTD).toEqual({
      activeMembers: 725,
      newMembers: 40,
      nonRenewals: 12,
      nonMembers: null,
      memberEngagement: { highCount: 100, mediumCount: null, lowCount: null, highPct: null, mediumPct: null, lowPct: 0.54 },
      nonMemberEngagement: { highCount: null, mediumCount: null, lowCount: 7, highPct: null, mediumPct: null, lowPct: null },
    });
    expect(orgs.periods.COMPLETED_YEAR.memberEngagement).not.toBeNull();
    expect(orgs.periods.COMPLETED_YEAR_2.memberEngagement).toBeNull();
    expect(orgs.periods.COMPLETED_YEAR_3.nonMemberEngagement).toBeNull();
  });

  it('reports an unmeasured foundation when the view has no row', async () => {
    execute.mockResolvedValue({ rows: [] });

    const orgs = await new HealthMetricsOverviewService().getParticipatingOrgs(req, query);

    expect(orgs.measured).toBe(false);
    expect(orgs.periods.YTD).toEqual({
      activeMembers: null,
      newMembers: null,
      nonRenewals: null,
      nonMembers: null,
      memberEngagement: null,
      nonMemberEngagement: null,
    });
  });
});

describe('HealthMetricsOverviewService.getNps', () => {
  it('reads the Board audience only, binding it after the foundation', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsOverviewService().getNps(req, query);

    expect(sql()).toContain('TRIM(audience_type) = ?');
    expect(sql()).toContain('previous_survey_quarter_ytd AS previous_survey_quarter_YTD');
    expectBinds(0, ['acme', 'Board']);
  });

  it('maps a surveyed period and leaves a period with no recipients null', async () => {
    execute.mockResolvedValue({
      rows: [
        wide(
          {
            NPS_SCORE: 80,
            NPS_SCORE_CHANGE_PP: 12,
            PREVIOUS_SURVEY_QUARTER: 'Q4 2025',
            LAST_UPDATED_QUARTER: ' Q2 2026 ',
            RECIPIENTS_COUNT: 48,
            RESPONSES_COUNT: 10,
            RESPONSE_RATE_PCT: '0.208333',
            PROMOTERS_COUNT: 8,
            PASSIVES_COUNT: 2,
            DETRACTORS_COUNT: 0,
            NO_RESPONSE_COUNT: 38,
          },
          { RECIPIENTS_COUNT_COMPLETED_YEAR_3: 0 }
        ),
      ],
    });

    const nps = await new HealthMetricsOverviewService().getNps(req, query);

    expect(nps.periods.YTD).toEqual({
      npsScore: 80,
      scoreChangePp: 12,
      previousSurveyQuarter: 'Q4 2025',
      lastUpdatedQuarter: 'Q2 2026',
      recipientsCount: 48,
      responsesCount: 10,
      responseRatePct: 0.208333,
      promotersCount: 8,
      passivesCount: 2,
      detractorsCount: 0,
      noResponseCount: 38,
    });
    expect(nps.periods.COMPLETED_YEAR_3).toBeNull();
  });

  it('leaves every period null when the foundation has no Board row', async () => {
    execute.mockResolvedValue({ rows: [] });

    const nps = await new HealthMetricsOverviewService().getNps(req, query);

    expect(Object.values(nps.periods)).toEqual([null, null, null, null]);
  });
});

describe('HealthMetricsOverviewService.getChurn', () => {
  it('orders the all-tiers row first, then tiers by rank and label', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsOverviewService().getChurn(req, query);

    expect(sql()).toContain('ORDER BY is_all_tiers DESC, tier_sort_rank ASC NULLS LAST, membership_tier_label ASC NULLS LAST');
    expect(sql()).toContain('value_lost_change_pct_3rd_last_completed_year AS value_lost_change_pct_COMPLETED_YEAR_3');
    expectBinds(0, ['acme']);
  });

  it('maps the all-tiers row to the totals and the rest to tiers, falling back to the tier name without a label', async () => {
    execute.mockResolvedValue({
      rows: [
        wide(
          { CHURN_RATE_PCT: '20.3896', CHURN_RATE_CHANGE_PP: '2.8571', MEMBERSHIPS_LOST_COUNT: 157, VALUE_LOST_CHANGE_PCT: '-0.31' },
          { IS_ALL_TIERS: true }
        ),
        wide(
          { CHURN_RATE_PCT: '6.6667', MEMBERSHIPS_LOST_COUNT: 1, VALUE_LOST_USD: 50000 },
          { IS_ALL_TIERS: false, MEMBERSHIP_TIER: 'Platinum Membership', MEMBERSHIP_TIER_LABEL: 'Platinum' }
        ),
        wide({ CHURN_RATE_PCT: 0, MEMBERSHIPS_LOST_COUNT: 0 }, { IS_ALL_TIERS: false, MEMBERSHIP_TIER: 'Gold Membership', MEMBERSHIP_TIER_LABEL: null }),
      ],
    });

    const churn = await new HealthMetricsOverviewService().getChurn(req, query);

    expect(churn.periods.YTD.totals).toMatchObject({
      churnRatePct: 20.3896,
      churnRateChangePp: 2.8571,
      membershipsLost: 157,
      valueLostChangePct: -0.31,
      valueLostUsd: null,
    });
    expect(churn.periods.YTD.tiers).toEqual([
      { tier: 'Platinum Membership', label: 'Platinum', churnRatePct: 6.6667, membershipsLost: 1, valueLostUsd: 50000 },
      { tier: 'Gold Membership', label: 'Gold Membership', churnRatePct: 0, membershipsLost: 0, valueLostUsd: null },
    ]);
  });

  it('has no totals when the view has no all-tiers row', async () => {
    execute.mockResolvedValue({ rows: [] });

    const churn = await new HealthMetricsOverviewService().getChurn(req, query);

    expect(churn.periods.YTD).toEqual({ totals: null, tiers: [] });
  });
});

describe('HealthMetricsOverviewService.getOutstandingBalance', () => {
  it('maps the one row, and reports an unmeasured foundation without one', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        {
          OUTSTANDING_BALANCE_USD: '1105250.00',
          OVERDUE_MEMBERS_COUNT: 20,
          HIGH_RISK_BALANCE_USD: '1083250.00',
          HIGH_RISK_MEMBERS_COUNT: 18,
          HIGH_RISK_BALANCE_SHARE_PCT: '0.98',
          MEDIUM_RISK_BALANCE_USD: '22000.00',
          MEDIUM_RISK_MEMBERS_COUNT: 2,
          MEDIUM_RISK_BALANCE_SHARE_PCT: '0.02',
        },
      ],
    });
    execute.mockResolvedValueOnce({ rows: [] });

    const service = new HealthMetricsOverviewService();
    const balance = await service.getOutstandingBalance(req, query);
    const missing = await service.getOutstandingBalance(req, query);

    expectBinds(0, ['acme']);
    expect(balance).toEqual({
      measured: true,
      outstandingUsd: 1105250,
      overdueMembers: 20,
      highRiskUsd: 1083250,
      highRiskMembers: 18,
      highRiskSharePct: 0.98,
      mediumRiskUsd: 22000,
      mediumRiskMembers: 2,
      mediumRiskSharePct: 0.02,
    });
    expect(missing.measured).toBe(false);
    expect(missing.outstandingUsd).toBeNull();
  });
});

describe('HealthMetricsOverviewService.getEvents', () => {
  function event(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      EVENT_ID: 'e1',
      EVENT_NAME: 'Acme Summit',
      EVENT_START_DATE: '2026-11-19',
      EVENT_END_DATE: '2026-11-20',
      EVENT_CITY: 'Springfield',
      EVENT_IS_PAST: false,
      REGISTRATIONS: 313,
      REGISTRATIONS_GOAL: 700,
      COMP_SCORE: 'High',
      ACCEPTED_TALKS: 0,
      TOTAL_PROPOSALS: 185,
      CFP_STATUS: 'Review Complete',
      PAST_REGISTRATIONS: null,
      PAST_GOAL: null,
      PAST_HAS_GOAL: null,
      PAST_GOAL_MET: null,
      PAST_PACE_STATUS: null,
      IS_IN_PERIOD_YTD: null,
      IS_IN_PERIOD_COMPLETED_YEAR: null,
      IS_IN_PERIOD_COMPLETED_YEAR_2: null,
      IS_IN_PERIOD_COMPLETED_YEAR_3: null,
      ...overrides,
    };
  }

  it('resolves the foundation id from the slug and joins the past-events view, binding the slug for each', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsOverviewService().getEvents(req, query);

    expect(sql()).toContain('INNER JOIN foundation f ON r.project_id = f.foundation_id');
    expect(sql()).toContain('LEFT JOIN past p ON p.event_id = r.event_id');
    for (const [range, suffix] of SUFFIXES) expect(sql()).toContain(`p.is_in_period_${suffix} AS is_in_period_${range}`);
    expect(sql()).toContain(`LIMIT ${HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP + 1}`);
    expectBinds(0, ['acme', 'acme']);
  });

  it('splits upcoming events soonest first from past events newest first', async () => {
    execute.mockResolvedValue({
      rows: [
        event({ EVENT_ID: 'p1', EVENT_IS_PAST: true, IS_IN_PERIOD_COMPLETED_YEAR: true }),
        event({ EVENT_ID: 'p2', EVENT_IS_PAST: true, IS_IN_PERIOD_YTD: true }),
        event({ EVENT_ID: 'u1' }),
        event({ EVENT_ID: 'u2' }),
      ],
    });

    const events = await new HealthMetricsOverviewService().getEvents(req, query);

    expect(events.upcoming.map((row) => row.eventId)).toEqual(['u1', 'u2']);
    expect(events.past.map((row) => [row.eventId, row.ranges])).toEqual([
      ['p2', ['YTD']],
      ['p1', ['COMPLETED_YEAR']],
    ]);
    expect(events.truncated).toBe(false);
  });

  it("maps an upcoming event's goal and pace, treating a zero goal as none", async () => {
    execute.mockResolvedValue({ rows: [event({}), event({ EVENT_ID: 'e2', EVENT_NAME: null, REGISTRATIONS_GOAL: 0, COMP_SCORE: null, EVENT_CITY: null })] });

    const { upcoming } = await new HealthMetricsOverviewService().getEvents(req, query);

    expect(upcoming[0]).toEqual({
      eventId: 'e1',
      eventName: 'Acme Summit',
      startDate: '2026-11-19',
      endDate: '2026-11-20',
      city: 'Springfield',
      registrations: 313,
      registrationsGoal: 700,
      compScore: 'high',
      goalMet: null,
      paceStatus: null,
      acceptedTalks: 0,
      totalProposals: 185,
      cfpStatus: 'Review Complete',
      ranges: [],
    });
    expect(upcoming[1]).toMatchObject({ eventName: 'e2', registrationsGoal: null, compScore: null, city: null });
  });

  it("maps a past event's outcome from the past-events view, which alone decides whether it had a goal", async () => {
    execute.mockResolvedValue({
      rows: [
        event({
          EVENT_ID: 'hit',
          EVENT_IS_PAST: true,
          PAST_REGISTRATIONS: 900,
          PAST_GOAL: 800,
          PAST_HAS_GOAL: true,
          PAST_GOAL_MET: true,
          PAST_PACE_STATUS: 'healthy',
        }),
        event({
          EVENT_ID: 'no-goal',
          EVENT_IS_PAST: true,
          PAST_REGISTRATIONS: 50,
          PAST_GOAL: 800,
          PAST_HAS_GOAL: false,
          PAST_GOAL_MET: false,
          PAST_PACE_STATUS: 'needs_action',
        }),
      ],
    });

    const { past } = await new HealthMetricsOverviewService().getEvents(req, query);

    expect(past[1]).toMatchObject({ eventId: 'hit', registrations: 900, registrationsGoal: 800, goalMet: true, paceStatus: 'healthy', compScore: null });
    expect(past[0]).toMatchObject({ eventId: 'no-goal', registrations: 50, registrationsGoal: null, goalMet: null, paceStatus: null });
  });

  it('flags and warns on a read that hits the row cap', async () => {
    execute.mockResolvedValue({ rows: Array.from({ length: HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP + 1 }, (_, index) => event({ EVENT_ID: `e${index}` })) });

    const events = await new HealthMetricsOverviewService().getEvents(req, query);

    expect(events.truncated).toBe(true);
    expect(events.upcoming).toHaveLength(HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP);
    expect(logger.warning).toHaveBeenCalledWith(req, 'get_overview_events', expect.any(String), expect.objectContaining({ foundation_slug: 'acme' }));
  });
});

describe('HealthMetricsOverviewService.getBoard', () => {
  function member(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      MEMBER_KEY: 'k1',
      PERSON_DISPLAY_NAME: 'Pat Doe',
      PERSON_JOB_TITLE: 'CTO',
      ACCOUNT_NAME: 'Acme Corp',
      LOGO_URL: 'https://logos.example/acme.png',
      LAST_ATTENDED_DATE: '2026-09-03',
      ...wide({ MEETINGS_INVITED_COUNT: 0, MEETINGS_ATTENDED_COUNT: 0, ATTENDANCE_PCT: 0 }),
      ...overrides,
    };
  }

  function mockReads(summary: unknown[], members: unknown[]): void {
    execute.mockImplementation(async (statement: string) => ({ rows: statement.includes('BOARD_ATTENDANCE_MEMBERS') ? members : summary }));
  }

  it('reads the board cohort and the members invited in any period', async () => {
    mockReads([], []);

    await new HealthMetricsOverviewService().getBoard(req, query);

    const summarySql = execute.mock.calls.findIndex(([statement]) => !(statement as string).includes('BOARD_ATTENDANCE_MEMBERS'));
    const membersSql = summarySql === 0 ? 1 : 0;
    expectBinds(summarySql, ['acme', 'board']);
    expectBinds(membersSql, ['acme']);
    for (const [, suffix] of SUFFIXES) expect(sql(membersSql)).toContain(`meetings_invited_count_${suffix} > 0`);
    expect(sql(membersSql)).toContain(`LIMIT ${HEALTH_METRICS_OVERVIEW_BOARD_MEMBERS_ROW_CAP + 1}`);
  });

  it('maps each period and keeps a member only in the periods they were invited in', async () => {
    mockReads(
      [
        wide({
          MEETINGS_IN_RANGE_COUNT: 3,
          MEETINGS_IN_RANGE_COUNT_CHANGE_PCT: '-0.571429',
          AVG_ORG_ATTENDANCE_PCT: '0.3777',
          AVG_ORG_ATTENDANCE_CHANGE_PCT: '0.3024',
        }),
      ],
      [
        member({ MEETINGS_INVITED_COUNT_YTD: 3, MEETINGS_ATTENDED_COUNT_YTD: 2, ATTENDANCE_PCT_YTD: '0.666667' }),
        member({ MEMBER_KEY: 'k2', PERSON_JOB_TITLE: 'Unavailable', LOGO_URL: null, LAST_ATTENDED_DATE: null, MEETINGS_INVITED_COUNT_COMPLETED_YEAR: 4 }),
      ]
    );

    const board = await new HealthMetricsOverviewService().getBoard(req, query);

    expect(board.periods.YTD).toEqual({ meetings: 3, meetingsChangePct: -0.571429, avgAttendancePct: 0.3777, avgAttendanceChangePct: 0.3024 });
    expect(board.members[0]).toEqual({
      key: 'k1',
      name: 'Pat Doe',
      jobTitle: 'CTO',
      organization: 'Acme Corp',
      logoUrl: 'https://logos.example/acme.png',
      lastAttendedDate: '2026-09-03',
      attendance: { YTD: { invited: 3, attended: 2, attendancePct: 0.666667 } },
    });
    expect(board.members[1]).toMatchObject({
      jobTitle: null,
      logoUrl: null,
      lastAttendedDate: null,
      attendance: { COMPLETED_YEAR: { invited: 4, attended: 0, attendancePct: 0 } },
    });
  });

  it('leaves every period null when the board has no row', async () => {
    mockReads([], []);

    const board = await new HealthMetricsOverviewService().getBoard(req, query);

    expect(Object.values(board.periods)).toEqual([null, null, null, null]);
    expect(board.members).toEqual([]);
  });
});

describe('HealthMetricsOverviewService.getCode', () => {
  it('maps contributors per period and the all-time roles', async () => {
    execute.mockResolvedValue({
      rows: [
        wide(
          { CONTRIBUTORS_COUNT: 1200, NEW_CONTRIBUTORS_COUNT: '300' },
          { COMMITTERS_COUNT_ALL_TIME: 90, MAINTAINERS_COUNT_ALL_TIME: 40, REVIEWERS_COUNT_ALL_TIME: null }
        ),
      ],
    });

    const code = await new HealthMetricsOverviewService().getCode(req, query);

    expect(sql()).toContain('new_contributors_count_prev_completed_year AS new_contributors_count_COMPLETED_YEAR_2');
    expectBinds(0, ['acme']);
    expect(code).toEqual({
      measured: true,
      periods: {
        YTD: { contributors: 1200, newContributors: 300 },
        COMPLETED_YEAR: { contributors: 1200, newContributors: 300 },
        COMPLETED_YEAR_2: { contributors: 1200, newContributors: 300 },
        COMPLETED_YEAR_3: { contributors: 1200, newContributors: 300 },
      },
      committers: 90,
      maintainers: 40,
      reviewers: null,
    });
  });

  it('reports an unmeasured foundation when the view has no row', async () => {
    execute.mockResolvedValue({ rows: [] });

    const code = await new HealthMetricsOverviewService().getCode(req, query);

    expect(code.measured).toBe(false);
    expect(code.periods.YTD).toEqual({ contributors: null, newContributors: null });
  });
});

describe('HealthMetricsOverviewService read failures', () => {
  it('rejects rather than reporting an empty card', async () => {
    execute.mockRejectedValue(new Error('warehouse down'));
    const service = new HealthMetricsOverviewService();

    const reads: (() => Promise<unknown>)[] = [
      () => service.getParticipatingOrgs(req, query),
      () => service.getNps(req, query),
      () => service.getChurn(req, query),
      () => service.getOutstandingBalance(req, query),
      () => service.getEvents(req, query),
      () => service.getBoard(req, query),
      () => service.getCode(req, query),
    ];
    for (const read of reads) await expect(read()).rejects.toThrow('warehouse down');
  });
});
