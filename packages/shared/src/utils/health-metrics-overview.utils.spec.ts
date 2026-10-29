// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_BASE_PATH, HEALTH_METRICS_TABS } from '../constants/health-metrics-engagement.constants';
import { HEALTH_METRICS_EVENTS_SECTIONS } from '../constants/health-metrics-events.constants';
import { HEALTH_METRICS_MEMBERS_QUERY_PARAMS, HEALTH_METRICS_MEMBERS_SECTIONS } from '../constants/health-metrics-members.constants';
import { HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS, HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import { HEALTH_METRICS_OVERVIEW_EMPTY_COPY, HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS } from '../constants/health-metrics-overview.constants';
import { HEALTH_METRICS_TRAINING_SECTIONS } from '../constants/health-metrics-training.constants';
import {
  buildHealthMetricsOverviewAddPastMeetingUrl,
  buildHealthMetricsOverviewBalanceView,
  buildHealthMetricsOverviewBlankCopy,
  buildHealthMetricsOverviewBoardView,
  buildHealthMetricsOverviewChurnView,
  buildHealthMetricsOverviewCodeView,
  buildHealthMetricsOverviewNewsletterView,
  buildHealthMetricsOverviewEmptyCopy,
  buildHealthMetricsOverviewEventMeta,
  buildHealthMetricsOverviewEventsView,
  buildHealthMetricsOverviewNpsView,
  buildHealthMetricsOverviewOrgsView,
  buildHealthMetricsOverviewTrainingView,
  buildHealthMetricsOverviewPastTrendView,
  buildHealthMetricsOverviewTrendMeta,
  buildHealthMetricsOverviewTrendView,
  buildHealthMetricsYtdRangeLabel,
  sortHealthMetricsOverviewBoardRows,
  toHealthMetricsOverviewKpiStripLayout,
  toHealthMetricsOverviewPastYear,
  toHealthMetricsOverviewRange,
} from './health-metrics-overview.utils';

import type { HealthMetricsEventsAtAGlance, HealthMetricsEventsSponsorship } from '../interfaces/health-metrics-events.interface';
import type { HealthMetricsL2Range } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsOverviewBoard,
  HealthMetricsOverviewChurn,
  HealthMetricsOverviewChurnTotals,
  HealthMetricsOverviewCode,
  HealthMetricsOverviewNewsletterPeriod,
  HealthMetricsOverviewNewsletters,
  HealthMetricsOverviewEvent,
  HealthMetricsOverviewEvents,
  HealthMetricsOverviewNps,
  HealthMetricsOverviewNpsPeriod,
  HealthMetricsOverviewParticipatingOrgs,
  HealthMetricsOverviewParticipatingOrgsPeriod,
} from '../interfaces/health-metrics-overview.interface';
import type { HealthMetricsTrainingEnrollment, HealthMetricsTrainingEnrollmentPeriod } from '../interfaces/health-metrics-training.interface';

/** The same value under every period, with per-period overrides. */
function everyPeriod<T>(value: T, overrides: Partial<Record<HealthMetricsL2Range, T>> = {}): Record<HealthMetricsL2Range, T> {
  return { YTD: value, COMPLETED_YEAR: value, COMPLETED_YEAR_2: value, COMPLETED_YEAR_3: value, ...overrides };
}

describe('toHealthMetricsOverviewRange', () => {
  it('keeps the four periods the views carry and drops any other', () => {
    expect(toHealthMetricsOverviewRange('YTD')).toBe('YTD');
    expect(toHealthMetricsOverviewRange('COMPLETED_YEAR_3')).toBe('COMPLETED_YEAR_3');
    expect(toHealthMetricsOverviewRange('COMPLETED_YEAR_4')).toBeNull();
  });
});

describe('toHealthMetricsOverviewPastYear', () => {
  it('names the calendar year a completed period stands for, and none for YTD', () => {
    const thisYear = new Date().getFullYear();

    expect(toHealthMetricsOverviewPastYear('YTD')).toBeNull();
    expect(toHealthMetricsOverviewPastYear('COMPLETED_YEAR')).toBe(thisYear - 1);
    expect(toHealthMetricsOverviewPastYear('COMPLETED_YEAR_3')).toBe(thisYear - 3);
  });
});

describe('buildHealthMetricsOverviewEmptyCopy', () => {
  it('uses the YTD words, or a past year with the year filled in, as a sentence or a list of reasons', () => {
    expect(buildHealthMetricsOverviewEmptyCopy(HEALTH_METRICS_OVERVIEW_EMPTY_COPY.nps, null)).toEqual({
      icon: 'fa-light fa-clipboard-list',
      title: 'No responses yet',
      text: '',
      reasons: ['The score comes from your latest member satisfaction survey', 'No survey has closed yet this year', 'Send a survey to hear how members feel'],
    });
    expect(buildHealthMetricsOverviewEmptyCopy(HEALTH_METRICS_OVERVIEW_EMPTY_COPY.nps, 2024)).toMatchObject({
      title: 'No survey in 2024',
      text: 'No member satisfaction survey closed this year. Each survey counts toward the year it closes.',
      reasons: [],
    });
  });

  it('names the year in every past-year title, while the balance, a snapshot of today, keeps its present-tense words', () => {
    const { balance, ...periodCards } = HEALTH_METRICS_OVERVIEW_EMPTY_COPY;
    for (const copy of Object.values(periodCards)) {
      expect(copy.ytd.title).not.toContain('{Y}');
      expect(buildHealthMetricsOverviewEmptyCopy(copy, 2023).title).toMatch(/ in 2023$/);
      expect(Boolean(copy.ytd.text) !== copy.ytd.reasons.length > 0).toBe(true);
      expect(Boolean(copy.past.text) !== copy.past.reasons.length > 0).toBe(true);
    }
    expect(buildHealthMetricsOverviewEmptyCopy(balance, 2023).title).toBe('All invoices paid');
  });
});

describe('buildHealthMetricsOverviewBlankCopy', () => {
  it('words the blank Overview for YTD or for a past year', () => {
    expect(buildHealthMetricsOverviewBlankCopy(null)).toMatchObject({ title: 'No health data yet' });
    expect(buildHealthMetricsOverviewBlankCopy(2024)).toEqual({
      title: 'No health data for 2024',
      lead: 'Nothing was recorded for the foundation in 2024.',
      reasons: [
        'The foundation may not have launched yet',
        'Its activity may have been recorded under a parent foundation',
        'A later year may have data to compare',
      ],
    });
  });
});

describe('HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS', () => {
  const sections: Record<string, readonly { key: string }[]> = {
    members: HEALTH_METRICS_MEMBERS_SECTIONS,
    'non-members': HEALTH_METRICS_NON_MEMBERS_SECTIONS,
    events: HEALTH_METRICS_EVENTS_SECTIONS,
    training: HEALTH_METRICS_TRAINING_SECTIONS,
  };
  const params: Record<string, readonly string[]> = {
    members: Object.values(HEALTH_METRICS_MEMBERS_QUERY_PARAMS),
    'non-members': Object.values(HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS),
  };

  it.each(Object.entries(HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS))('%s lands on a real section of a real tab, clearing only that tab’s params', (_key, link) => {
    const [base, tab] = link.commands;
    expect(base).toBe(HEALTH_METRICS_BASE_PATH);
    expect(HEALTH_METRICS_TABS.map((candidate) => candidate.route)).toContain(tab);
    expect(sections[tab].map((section) => section.key)).toContain(link.fragment);
    for (const param of Object.keys(link.queryParams)) expect(params[tab] ?? []).toContain(param);
  });
});

describe('buildHealthMetricsOverviewOrgsView', () => {
  const split = { highCount: 64, mediumCount: 164, lowCount: 0, highPct: null, mediumPct: null, lowPct: null };
  const period: HealthMetricsOverviewParticipatingOrgsPeriod = {
    activeMembers: 2571,
    newMembers: 734,
    nonRenewals: 270,
    nonMembers: 4088,
    memberEngagement: split,
    nonMemberEngagement: { ...split, highCount: 1, mediumCount: 0, lowCount: 299 },
  };
  const orgs: HealthMetricsOverviewParticipatingOrgs = {
    measured: true,
    periods: everyPeriod(period, { COMPLETED_YEAR_2: { ...period, memberEngagement: null } }),
  };

  it('builds both halves with their KPIs, links and engagement rows', () => {
    const [members, nonMembers] = buildHealthMetricsOverviewOrgsView(orgs, 'YTD').halves;

    expect(members.kpis.map((kpi) => [kpi.label, kpi.value])).toEqual([
      ['Active members', '2,571'],
      ['New members', '734'],
    ]);
    expect(nonMembers.kpis.map((kpi) => [kpi.label, kpi.value])).toEqual([
      ['Non-members', '4,088'],
      ['Non-renewals', '270'],
    ]);
    expect(members.link.fragment).toBe('list');
    expect(nonMembers.link.commands[1]).toBe('non-members');
    expect(members.rows.map((row) => [row.label, row.countLabel, row.pctLabel])).toEqual([
      ['High', '64', '28%'],
      ['Medium', '164', '72%'],
      ['Low', '0', '0%'],
    ]);
    expect(nonMembers.rows[0].pctLabel).toBe('<1%');
  });

  /** Each segment's start on the ring and its drawn length. */
  function spans(donut: { dashArray: string; dashOffset: string }[]): { start: number; length: number }[] {
    return donut.map((segment) => ({ start: Math.abs(Number(segment.dashOffset)), length: Number(segment.dashArray.split(' ')[0]) }));
  }

  /** Every segment ends at least 2px before the next one starts, and the last one ends before the ring closes. */
  function expectNoOverlap(drawn: { start: number; length: number }[]): void {
    drawn.forEach((span, index) => {
      const next = drawn[index + 1]?.start ?? 2 * Math.PI * 36;
      expect(span.start + span.length + 2).toBeLessThanOrEqual(next + 0.01);
    });
  }

  it('draws every level on the 36px ring, 2px short of the next, giving a zero share its own visible 1.5px sliver', () => {
    const { donut } = buildHealthMetricsOverviewOrgsView(orgs, 'YTD').halves[0];
    const shared = 2 * Math.PI * 36 - 3.5;
    const drawn = spans(donut);

    expect(donut.map((segment) => segment.key)).toEqual(['high', 'medium', 'low']);
    expect(drawn[0]).toEqual({ start: 0, length: Number(((64 / 228) * shared - 2).toFixed(2)) });
    expect(drawn[2].length).toBe(1.5);
    expectNoOverlap(drawn);
  });

  it('gives a tiny non-zero share a full sliver and gap, so the next segment never paints over it', () => {
    const tiny = { ...period, memberEngagement: { highCount: 1, mediumCount: 998, lowCount: 1, highPct: null, mediumPct: null, lowPct: null } };
    const drawn = spans(buildHealthMetricsOverviewOrgsView({ measured: true, periods: everyPeriod(tiny) }, 'YTD').halves[0].donut);

    expect(drawn.map((span) => span.length)).toEqual([1.5, expect.any(Number), 1.5]);
    expectNoOverlap(drawn);
  });

  it('leaves an unmeasured level off the ring', () => {
    const partial = { ...period, memberEngagement: { highCount: 100, mediumCount: null, lowCount: null, highPct: null, mediumPct: null, lowPct: null } };
    const { donut } = buildHealthMetricsOverviewOrgsView({ measured: true, periods: everyPeriod(partial) }, 'YTD').halves[0];

    expect(donut.map((segment) => segment.key)).toEqual(['high']);
  });

  it('reads a share between 0.5% and 1% as "<1%", as the design does', () => {
    const tiny = { ...period, memberEngagement: { highCount: 7, mediumCount: 993, lowCount: 0, highPct: null, mediumPct: null, lowPct: null } };
    const [members] = buildHealthMetricsOverviewOrgsView({ measured: true, periods: everyPeriod(tiny) }, 'YTD').halves;

    expect(members.rows.map((row) => row.pctLabel)).toEqual(['<1%', '99%', '0%']);
  });

  it('leaves the split unmeasured for a period the view does not model', () => {
    const half = buildHealthMetricsOverviewOrgsView(orgs, 'COMPLETED_YEAR_2').halves[0];

    expect(half.donut).toEqual([]);
    expect(half.rows.map((row) => row.countLabel)).toEqual(['—', '—', '—']);
  });

  it('is empty without a row or with no organizations at all', () => {
    expect(buildHealthMetricsOverviewOrgsView({ ...orgs, measured: false }, 'YTD').isEmpty).toBe(true);
    const none = { ...period, activeMembers: 0, newMembers: null, nonRenewals: 0, nonMembers: 0 };
    expect(buildHealthMetricsOverviewOrgsView({ measured: true, periods: everyPeriod(none) }, 'YTD').isEmpty).toBe(true);
    expect(buildHealthMetricsOverviewOrgsView(orgs, 'YTD').isEmpty).toBe(false);
  });
});

describe('buildHealthMetricsOverviewNpsView', () => {
  const period: HealthMetricsOverviewNpsPeriod = {
    npsScore: 80,
    scoreChangePp: 12,
    previousSurveyQuarter: 'Q4 2025',
    lastUpdatedQuarter: 'Q2 2026',
    recipientsCount: 22,
    responsesCount: 15,
    responseRatePct: 0.6818,
    promotersCount: 14,
    passivesCount: 1,
    detractorsCount: 0,
    noResponseCount: 7,
  };
  const nps: HealthMetricsOverviewNps = { periods: everyPeriod<HealthMetricsOverviewNpsPeriod | null>(period, { COMPLETED_YEAR_3: null }) };

  it('reads the survey, the change against the previous wave and the response split', () => {
    const view = buildHealthMetricsOverviewNpsView(nps, 'YTD');

    expect(view.meta).toEqual([
      { label: 'Latest NPS:', value: 'Q2 2026' },
      { label: 'Audience:', value: 'Board' },
      { label: 'Responses:', value: '15 of 22 (68%)' },
    ]);
    expect(view.scoreLabel).toBe('80');
    expect(view.delta).toEqual({ label: '12 pts vs Q4 2025', direction: 'up', good: true });
    expect(view.rows.map((row) => [row.label, row.range, row.countLabel, row.pctLabel])).toEqual([
      ['Promoters', '9–10', '14', '93%'],
      ['Passives', '7–8', '1', '7%'],
      ['Detractors', '0–6', '0', '0%'],
    ]);
    expect(view.noResponseLabel).toBe('7');
    expect(view.ariaLabel).toBe('Net Promoter Score 80 on a scale from -100 to 100');
  });

  it('lights only the band the score falls in, mixing the rest toward white, and points the needle at it', () => {
    const view = buildHealthMetricsOverviewNpsView(nps, 'YTD');

    expect(view.segments.map((segment) => [segment.key, segment.stroke])).toEqual([
      ['very-low', '#FFDDDE'],
      ['low', '#FFDDDE'],
      ['medium', '#FFF0C7'],
      ['high', '#00BC7D'],
    ]);
    expect(view.caps.map((cap) => [cap.key, cap.fill])).toEqual([
      ['start', '#FFDDDE'],
      ['end', '#00BC7D'],
    ]);
    expect(view.needle).not.toBeNull();
    expect(Number(view.needle?.x)).toBeGreaterThan(66);
  });

  it('draws a falling score as a red-arrow decline, without the comparison quarter when the view has none', () => {
    const fell = { periods: everyPeriod<HealthMetricsOverviewNpsPeriod | null>({ ...period, npsScore: -10, scoreChangePp: -1, previousSurveyQuarter: null }) };
    const view = buildHealthMetricsOverviewNpsView(fell, 'YTD');

    expect(view.delta).toEqual({ label: '1 pt', direction: 'down', good: false });
    expect(view.segments.find((segment) => segment.stroke === '#FF6467')?.key).toBe('low');
  });

  it('is empty for a period with no survey sent', () => {
    const view = buildHealthMetricsOverviewNpsView(nps, 'COMPLETED_YEAR_3');

    expect(view.isEmpty).toBe(true);
    expect(view.needle).toBeNull();
    expect(view.segments.map((segment) => segment.stroke)).toEqual(['#FFDDDE', '#FFDDDE', '#FFF0C7', '#C7F0E2']);
  });
});

describe('buildHealthMetricsOverviewChurnView', () => {
  const totals: HealthMetricsOverviewChurnTotals = {
    churnRatePct: 18.2,
    churnRatePctPriorYear: 19,
    churnRateChangePp: -0.8,
    membershipsLost: 282,
    membershipsLostPriorYear: 261,
    membershipsLostChangePct: 0.08,
    valueLostUsd: 1790000,
    valueLostUsdPriorYear: 2600000,
    valueLostChangePct: -0.31,
  };
  const churn: HealthMetricsOverviewChurn = {
    periods: everyPeriod({
      totals,
      tiers: [
        { tier: 'Platinum Membership', label: 'Platinum', churnRatePct: 8, membershipsLost: 1, valueLostUsd: 480000 },
        { tier: 'Gold Membership', label: 'Gold', churnRatePct: 0, membershipsLost: 0, valueLostUsd: 0 },
        { tier: 'Silver Membership', label: 'Silver', churnRatePct: 140, membershipsLost: 281, valueLostUsd: null },
      ],
    }),
  };

  it('compares each KPI with last year, where a fall is good news', () => {
    const { kpis } = buildHealthMetricsOverviewChurnView(churn, 'YTD');

    expect(kpis.map((kpi) => [kpi.label, kpi.value, kpi.delta, kpi.note])).toEqual([
      ['Churn rate', '18%', { label: '1 pt', direction: 'down', good: true }, '19% last year'],
      ['Value lost', '$1.8M', { label: '31%', direction: 'down', good: true }, '$2.6M last year'],
      ['Memberships lost', '282', { label: '8%', direction: 'up', good: false }, '261 last year'],
    ]);
  });

  it('lists every tier, zero churn included, against the overall rate', () => {
    const view = buildHealthMetricsOverviewChurnView(churn, 'YTD');

    expect(view.tiers.map((tier) => [tier.label, tier.rateLabel, tier.rateWidthPct, tier.lostLabel, tier.valueLabel])).toEqual([
      ['Platinum', '8%', 8, '1', '$480K'],
      ['Gold', '0%', 0, '0', '$0'],
      ['Silver', '140%', 100, '281', '—'],
    ]);
    expect(view.overallPct).toBe(18.2);
    expect(view.overallLabel).toBe('Overall churn 18%');
  });

  it('is empty without totals or with nothing lost', () => {
    expect(buildHealthMetricsOverviewChurnView({ periods: everyPeriod({ totals: null, tiers: [] }) }, 'YTD').isEmpty).toBe(true);
    const nothing = { ...totals, churnRatePct: 0, membershipsLost: 0 };
    expect(buildHealthMetricsOverviewChurnView({ periods: everyPeriod({ totals: nothing, tiers: [] }) }, 'YTD').isEmpty).toBe(true);
  });
});

describe('buildHealthMetricsOverviewBalanceView', () => {
  const balance = {
    measured: true,
    outstandingUsd: 1105250,
    overdueMembers: 20,
    highRiskUsd: 1083250,
    highRiskMembers: 18,
    highRiskSharePct: 0.98,
    mediumRiskUsd: 22000,
    mediumRiskMembers: 2,
    mediumRiskSharePct: 0.02,
  };

  it('reads the total, the members at risk and each band', () => {
    const view = buildHealthMetricsOverviewBalanceView(balance);

    expect([view.totalLabel, view.overdueMembersLabel, view.atRiskLabel]).toEqual(['$1,105,250', '20', '18 members']);
    expect(view.rows.map((row) => [row.label, row.daysLabel, row.widthPct, row.membersLabel, row.amountLabel])).toEqual([
      ['High risk', '90+ days', 98, '18', '$1,083,250'],
      ['Medium risk', '60–89 days', 2, '2', '$22,000'],
    ]);
  });

  it('splits the bar by amount when the view has no shares', () => {
    const view = buildHealthMetricsOverviewBalanceView({
      ...balance,
      highRiskUsd: 300,
      mediumRiskUsd: 100,
      highRiskSharePct: null,
      mediumRiskSharePct: null,
      highRiskMembers: 1,
    });

    expect(view.rows.map((row) => row.widthPct)).toEqual([75, 25]);
    expect(view.atRiskLabel).toBe('1 member');
  });

  it('is empty when nothing is overdue, and paid in full only for a measured zero', () => {
    const paid = buildHealthMetricsOverviewBalanceView({ ...balance, outstandingUsd: 0 });
    const unmeasured = buildHealthMetricsOverviewBalanceView({ ...balance, measured: false, outstandingUsd: null });

    expect([paid.isEmpty, paid.isPaidInFull]).toEqual([true, true]);
    expect([unmeasured.isEmpty, unmeasured.isPaidInFull]).toEqual([true, false]);
    expect(buildHealthMetricsOverviewBalanceView(balance).isPaidInFull).toBe(false);
  });
});

describe('buildHealthMetricsOverviewEventsView', () => {
  function event(overrides: Partial<HealthMetricsOverviewEvent>): HealthMetricsOverviewEvent {
    return {
      eventId: 'e1',
      eventName: 'Acme Summit',
      startDate: '2026-12-08',
      endDate: '2026-12-10',
      city: 'Springfield',
      registrations: 328,
      registrationsGoal: 1000,
      compScore: 'medium',
      acceptedTalks: 0,
      totalProposals: 185,
      cfpStatus: 'Review Complete',
      ranges: [],
      ...overrides,
    };
  }

  const changes = { registrations: null, attendees: null, organizations: null, speakers: null, countries: null, events: -0.24, showUpRatePts: null };
  const glance: HealthMetricsEventsAtAGlance = {
    periods: (['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3'] as const).map((range) => ({
      range,
      registrations: null,
      attendees: null,
      organizations: null,
      speakers: null,
      countries: null,
      events: 20,
      pastEvents: 20,
      showUpRate: null,
      changes: range === 'COMPLETED_YEAR_2' ? null : changes,
    })),
    upcomingEvents: 2,
    hasEvents: true,
  };
  const sponsorship: HealthMetricsEventsSponsorship = {
    periods: (['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3'] as const).map((range) => ({
      range,
      revenueUsd: 3000000,
      goalUsd: range === 'COMPLETED_YEAR_2' ? null : 3500000,
      tierPackages: null,
      addOns: null,
      progressToGoal: range === 'YTD' ? 0.857 : null,
      changes: null,
      tiers: [],
    })),
  };
  const events: HealthMetricsOverviewEvents = {
    upcoming: [
      event({}),
      event({ eventId: 'e2', registrationsGoal: null, compScore: null, totalProposals: 0, cfpStatus: 'In Review', endDate: null, startDate: '2026-12-15' }),
      event({ eventId: 'e3', compScore: 'high', totalProposals: 0, cfpStatus: 'No CFPs Received' }),
    ],
    past: [
      event({ eventId: 'p1', compScore: null, registrations: 900, registrationsGoal: 800, acceptedTalks: 64, totalProposals: 310, ranges: ['COMPLETED_YEAR'] }),
      event({ eventId: 'p2', compScore: null, registrations: 850, ranges: ['COMPLETED_YEAR'] }),
      event({ eventId: 'p4', compScore: null, registrations: 200, registrationsGoal: null, ranges: ['COMPLETED_YEAR'] }),
      event({ eventId: 'p3', compScore: null, ranges: ['COMPLETED_YEAR_2'] }),
    ],
    truncated: false,
  };

  it('splits the total into held and upcoming events, with the change in every period', () => {
    const view = buildHealthMetricsOverviewEventsView(glance, sponsorship, events, 'YTD');

    expect(view.total).toEqual({
      value: '22',
      delta: { label: '24% vs last year', direction: 'down', good: false },
      pastLabel: '20',
      upcomingLabel: '2',
      pastPct: expect.closeTo(90.9, 1),
      upcomingPct: expect.closeTo(9.1, 1),
    });
    expect(view.listTitle).toBe('Upcoming events');
    expect(view.listInfo).toContain('start date in the future');
    expect(view.rows.map((row) => [row.eventId, row.isPast])).toEqual([
      ['e1', false],
      ['e2', false],
      ['e3', false],
    ]);
  });

  it("colors an upcoming event's registrations bar by its pace, with a neutral outlined bar and no status without a goal", () => {
    const [atRisk, noGoal, onTrack] = buildHealthMetricsOverviewEventsView(glance, sponsorship, events, 'YTD').rows;

    expect(atRisk.meta).toBe('Springfield · Dec 8–10, 2026');
    expect(atRisk.registrations).toEqual({
      countLabel: '328',
      sideLabel: 'Goal:',
      sideValue: '1,000',
      widthPct: expect.closeTo(32.8, 5),
      barClass: 'bg-amber-400',
      neutral: false,
      statusLabel: 'At risk',
    });
    expect(noGoal.registrations).toEqual({
      countLabel: '328',
      sideLabel: 'No goal set',
      sideValue: '',
      widthPct: 0,
      barClass: '',
      neutral: true,
      statusLabel: null,
    });
    expect(onTrack.registrations).toMatchObject({ barClass: 'bg-emerald-500', statusLabel: 'On track' });
  });

  it('keeps an upcoming event with a goal but no pace blue', () => {
    const unscored = { ...events, upcoming: [event({ compScore: null })] };

    expect(buildHealthMetricsOverviewEventsView(glance, sponsorship, unscored, 'YTD').rows[0].registrations).toMatchObject({
      barClass: 'bg-blue-500',
      statusLabel: null,
    });
  });

  it('shows accepted speaking proposals against those received, or the call for proposals stage without any', () => {
    const [withProposals, inReview, none] = buildHealthMetricsOverviewEventsView(glance, sponsorship, events, 'YTD').rows;

    expect(withProposals.talks).toEqual({
      hasProposals: true,
      countLabel: '0',
      sideLabel: 'Received:',
      sideValue: '185',
      widthPct: 0,
      barClass: 'bg-blue-500',
      neutral: false,
      note: 'N/A',
    });
    expect(inReview.talks).toMatchObject({ hasProposals: false, note: 'CFP In Review' });
    expect(none.talks.note).toBe('N/A');
  });

  it("lists a past year's events, colored by their share of the goal, with green submitted proposals", () => {
    const view = buildHealthMetricsOverviewEventsView(glance, sponsorship, events, 'COMPLETED_YEAR');

    expect(view.listTitle).toBe('Past events');
    expect(view.listInfo).toContain('selected time period');
    expect(view.total).toMatchObject({ value: '20', pastLabel: '20', upcomingLabel: '0', pastPct: 100, upcomingPct: 0 });
    expect(view.rows.map((row) => [row.eventId, row.isPast, row.registrations.sideLabel, row.registrations.sideValue, row.registrations.barClass])).toEqual([
      ['p1', true, 'Goal:', '800', 'bg-emerald-500'],
      ['p2', true, 'Goal:', '1,000', 'bg-amber-400'],
      ['p4', true, 'No goal set', '', ''],
    ]);
    expect(view.rows[0].talks).toMatchObject({ countLabel: '64', sideLabel: 'Received:', sideValue: '310', barClass: 'bg-emerald-500' });
  });

  it('turns a past event under 80% of its goal red', () => {
    const missed = { ...events, past: [event({ compScore: null, registrations: 799, ranges: ['COMPLETED_YEAR'] })] };

    expect(buildHealthMetricsOverviewEventsView(glance, sponsorship, missed, 'COMPLETED_YEAR').rows[0].registrations).toMatchObject({
      barClass: 'bg-red-400',
      statusLabel: 'Action required',
    });
  });

  it('leaves a past event with no registration count grey and without a status, never missed', () => {
    const unmeasured = { ...events, past: [event({ compScore: null, registrations: null, ranges: ['COMPLETED_YEAR'] })] };

    expect(buildHealthMetricsOverviewEventsView(glance, sponsorship, unmeasured, 'COMPLETED_YEAR').rows[0].registrations).toEqual({
      countLabel: '—',
      sideLabel: 'Goal:',
      sideValue: '1,000',
      widthPct: 0,
      barClass: 'bg-gray-300',
      neutral: false,
      statusLabel: null,
    });
  });

  it("tracks sponsorship against the period's goal, computing progress where the view has none", () => {
    expect(buildHealthMetricsOverviewEventsView(glance, sponsorship, events, 'YTD').sponsorship).toEqual({
      valueLabel: '$3M',
      hasGoal: true,
      goalLabel: '$3.5M',
      widthPct: 85.7,
      barClass: 'bg-blue-500',
      progressLabel: '86% reached · $500K to goal',
    });
    expect(buildHealthMetricsOverviewEventsView(glance, sponsorship, events, 'COMPLETED_YEAR').sponsorship.widthPct).toBeCloseTo(85.71, 1);
    expect(buildHealthMetricsOverviewEventsView(glance, sponsorship, events, 'COMPLETED_YEAR_2').sponsorship).toMatchObject({
      hasGoal: false,
      progressLabel: 'No goal set',
    });
  });

  it('turns the sponsorship bar green once the goal is reached', () => {
    const reached = { periods: sponsorship.periods.map((period) => ({ ...period, revenueUsd: 4000000, progressToGoal: null })) };

    expect(buildHealthMetricsOverviewEventsView(glance, reached, events, 'YTD').sponsorship).toMatchObject({ barClass: 'bg-emerald-500', widthPct: 100 });
  });

  it('leaves the change out for a period the view does not compare', () => {
    expect(buildHealthMetricsOverviewEventsView(glance, sponsorship, events, 'COMPLETED_YEAR_2').total.delta).toBeNull();
  });

  it('is empty with no events, no list and no sponsorship', () => {
    const quiet = { ...glance, upcomingEvents: 0, periods: glance.periods.map((period) => ({ ...period, pastEvents: 0 })) };
    const unsold = { periods: sponsorship.periods.map((period) => ({ ...period, revenueUsd: null })) };

    expect(buildHealthMetricsOverviewEventsView(quiet, unsold, { upcoming: [], past: [], truncated: false }, 'YTD').isEmpty).toBe(true);
  });
});

describe('buildHealthMetricsOverviewEventMeta', () => {
  it.each([
    [{ city: 'Yokohama', startDate: '2026-12-15', endDate: '2026-12-15' }, 'Yokohama · Dec 15, 2026'],
    [{ city: null, startDate: '2026-11-30', endDate: '2026-12-02' }, 'Nov 30 – Dec 2, 2026'],
    [{ city: 'Napa', startDate: '2026-12-30', endDate: '2027-01-02' }, 'Napa · Dec 30, 2026 – Jan 2, 2027'],
    [{ city: 'Napa', startDate: null, endDate: null }, 'Napa'],
  ])('formats %o as %s', (event, expected) => {
    expect(buildHealthMetricsOverviewEventMeta(event)).toBe(expected);
  });
});

describe('buildHealthMetricsOverviewTrendMeta', () => {
  it.each([
    [{ city: 'Yokohama', startDate: '2026-12-15' }, 'Yokohama · Starts Dec 15, 2026'],
    [{ city: null, startDate: '2026-11-30' }, 'Starts Nov 30, 2026'],
    [{ city: 'Napa', startDate: null }, 'Napa'],
  ])('formats %o as %s', (event, expected) => {
    expect(buildHealthMetricsOverviewTrendMeta(event)).toBe(expected);
  });
});

describe('buildHealthMetricsOverviewTrainingView', () => {
  const period: HealthMetricsTrainingEnrollmentPeriod = {
    totals: { enrollments: 131497, certifications: 0, revenueUsd: 4340000 },
    change: null,
    byType: [
      { deliveryType: 'Instructor Led', isListed: true, isListedRevenue: true, enrollments: 337, revenueUsd: 1180000 },
      { deliveryType: 'E-Learning', isListed: true, isListedRevenue: true, enrollments: 112750, revenueUsd: 1640000 },
      { deliveryType: 'Bundle', isListed: false, isListedRevenue: true, enrollments: 0, revenueUsd: 210000 },
      { deliveryType: 'MicroCourse', isListed: false, isListedRevenue: false, enrollments: 18410, revenueUsd: 0 },
    ],
  };
  const enrollment: HealthMetricsTrainingEnrollment = {
    measured: true,
    periods: everyPeriod(period),
    trend: [],
    goals: { enrollments: 150000, revenueUsd: 5000000, enrollmentsProgressYtd: null, revenueProgressYtd: null },
  };

  it('ranks the listed enrollment programs against the largest one', () => {
    const view = buildHealthMetricsOverviewTrainingView(enrollment, 'YTD', 'enrollments');

    expect([view.totalLabel, view.metricLabel, view.goalLabel]).toEqual(['131.5K', 'Enrollments', '88% of 150K goal']);
    expect(view.items.map((item) => [item.label, item.valueLabel, item.shareLabel])).toEqual([
      ['eLearning', '112.8K', '86%'],
      ['Instructor-led', '337', '<1%'],
    ]);
    expect(view.items[0].widthPct).toBe(100);
    expect(view.items[1].widthPct).toBe(1);
    expect(view.progressPath).not.toBe('');
  });

  it("prefers the view's modelled progress for YTD over the plain share of the goal", () => {
    const modelled = { ...enrollment, goals: { ...enrollment.goals, enrollmentsProgressYtd: 1 } };

    expect(buildHealthMetricsOverviewTrainingView(modelled, 'YTD', 'enrollments').goalLabel).toBe('100% of 150K goal');
  });

  it('adds Bundle on the revenue view', () => {
    const view = buildHealthMetricsOverviewTrainingView(enrollment, 'YTD', 'revenue');

    expect(view.totalLabel).toBe('$4.3M');
    expect(view.items.map((item) => item.key)).toEqual(['E-Learning', 'Instructor Led', 'Bundle']);
    expect(view.goalLabel).toBe('87% of $5M goal');
  });

  it('shows a program with no figure as unmeasured, last and without a bar', () => {
    const missing = { ...period, byType: period.byType.map((type) => (type.deliveryType === 'Instructor Led' ? { ...type, revenueUsd: null } : type)) };
    const view = buildHealthMetricsOverviewTrainingView({ ...enrollment, periods: everyPeriod(missing) }, 'YTD', 'revenue');

    expect(view.items.map((item) => [item.key, item.valueLabel, item.shareLabel, item.widthPct])).toEqual([
      ['E-Learning', '$1.6M', '38%', 100],
      ['Bundle', '$210K', '5%', expect.closeTo(12.8, 1)],
      ['Instructor Led', '—', '—', 0],
    ]);
  });

  it('draws no goal outside YTD, where the view models none', () => {
    const view = buildHealthMetricsOverviewTrainingView(enrollment, 'COMPLETED_YEAR', 'enrollments');

    expect(view.goalLabel).toBeNull();
    expect(view.progressPath).toBe('');
    expect(view.ariaLabel).toBe('Enrollments 131.5K');
  });

  it('is empty with neither enrollments nor revenue', () => {
    const none = { ...enrollment, periods: everyPeriod({ ...period, totals: { enrollments: 0, certifications: 0, revenueUsd: null } }) };
    expect(buildHealthMetricsOverviewTrainingView(none, 'YTD', 'enrollments').isEmpty).toBe(true);
  });
});

describe('buildHealthMetricsOverviewCodeView', () => {
  const code: HealthMetricsOverviewCode = {
    measured: true,
    periods: everyPeriod({ contributors: 12600, newContributors: 6600 }),
    committers: 41735,
    maintainers: 4982,
    reviewers: 9529,
  };

  it('reads contributors and splits the all-time roles by share', () => {
    const view = buildHealthMetricsOverviewCodeView(code, 'YTD');

    expect(view.kpis.map((kpi) => [kpi.label, kpi.value])).toEqual([
      ['Total contributors', '12.6K'],
      ['New contributors', '6.6K'],
    ]);
    expect(view.roles.map((role) => [role.label, role.valueLabel])).toEqual([
      ['Committers', '41,735'],
      ['Maintainers', '4,982'],
      ['Reviewers', '9,529'],
    ]);
    expect(view.roles.reduce((sum, role) => sum + role.widthPct, 0)).toBeCloseTo(100, 5);
  });

  it('is empty without contributors or roles', () => {
    expect(buildHealthMetricsOverviewCodeView({ ...code, measured: false }, 'YTD').isEmpty).toBe(true);
    const none = { ...code, periods: everyPeriod({ contributors: 0, newContributors: 0 }), committers: null, maintainers: 0, reviewers: null };
    expect(buildHealthMetricsOverviewCodeView(none, 'YTD').isEmpty).toBe(true);
  });
});

describe('buildHealthMetricsOverviewNewsletterView', () => {
  const year = new Date().getFullYear();
  const period: HealthMetricsOverviewNewsletterPeriod = {
    subscribers: 1458,
    subscribersGrowth: 0.39,
    growthBaselineDate: `${year}-01-05`,
    newslettersSent: 10,
    avgOpenRate: 0.43,
    avgClickToOpenRate: 0.09,
    highEngagement: 175,
    mediumEngagement: 496,
    lowEngagement: 787,
    highEngagementShare: 0.12,
    mediumEngagementShare: 0.34,
    lowEngagementShare: 0.54,
    newslettersConsidered: 10,
    mostEngagingName: 'Monthly: Protocol ships',
    mostEngagingClickToOpenRate: 0.12,
  };
  const send = (key: string, sentDate: string, openRate: number | null, clickRate: number | null) => ({
    key,
    name: `Newsletter ${key}`,
    sentDate,
    openRate,
    clickRate,
  });
  const newsletters: HealthMetricsOverviewNewsletters = {
    measured: true,
    periods: everyPeriod<HealthMetricsOverviewNewsletterPeriod | null>(period),
    // Latest first, as the read returns them.
    newsletters: [
      send('n4', `${year}-09-21`, 0.5, 0.06),
      send('n3', `${year}-08-24`, 0.4, null),
      send('n2', `${year}-08-03`, 0.3, 0.03),
      send('unrated', `${year}-07-30`, null, null),
      send('old', `${year - 1}-12-01`, 0.6, 0.2),
    ],
  };

  it('reads the period summary into the KPI strip, with growth since the baseline month', () => {
    const view = buildHealthMetricsOverviewNewsletterView(newsletters, 'YTD');

    expect(view.isEmpty).toBe(false);
    expect(view.kpis.map((kpi) => [kpi.label, kpi.value])).toEqual([
      ['Subscribers', '1,458'],
      ['Newsletters sent', '10'],
      ['Avg. open rate', '43%'],
      ['Avg. click-to-open rate', '9%'],
    ]);
    expect(view.kpis[0]?.delta).toEqual({ label: '39% since Jan', direction: 'up', good: true });
    expect(view.engagementBasis).toBe('Based on opens and clicks across the last 10 newsletters');
    expect(view.mostEngaging).toEqual({ name: 'Monthly: Protocol ships', rateLabel: '12% click-to-open' });
  });

  it('charts the period’s newsletters oldest first, evenly spaced, with the view’s open and click rates', () => {
    const chart = buildHealthMetricsOverviewNewsletterView(newsletters, 'YTD').chart;

    expect(chart?.points.map((point) => point.key)).toEqual(['n2', 'n3', 'n4']);
    expect(chart?.points.map((point) => point.xPct)).toEqual(['0.00', '50.00', '100.00']);
    // The scale tops out at 50%, the highest open rate rounded up to the next 10%.
    expect(chart?.points.map((point) => point.openYPct)).toEqual(['40.00', '20.00', '0.00']);
    expect(chart?.points[0]?.clickYPct).toBe('94.00');
    expect(chart?.points[1]?.clickYPct).toBe('');
    expect(chart?.points[2]?.label).toBe(`Newsletter n4 · Sep 21, ${year} · open 50%, click 6%`);
    expect(chart?.points[1]?.label).toBe(`Newsletter n3 · Aug 24, ${year} · open 40%, click —`);
    expect(chart?.ticks).toEqual([
      { label: 'Aug', xPct: '0.00' },
      { label: 'Sep', xPct: '100.00' },
    ]);
    // The click line skips the newsletter without a click rate rather than drawing it at zero.
    expect(chart?.clickPath.split('L')).toHaveLength(2);
    expect(chart?.openAreaPath.endsWith('L600.0 200 L0.0 200 Z')).toBe(true);
  });

  it('tops the scale out at an exact tenth rather than the next one', () => {
    const exact = { ...newsletters, newsletters: [send('n1', `${year}-03-02`, 0.7, 0.07), send('n2', `${year}-04-02`, 0.35, 0.03)] };
    expect(buildHealthMetricsOverviewNewsletterView(exact, 'YTD').chart?.points.map((point) => point.openYPct)).toEqual(['0.00', '50.00']);
  });

  it('centres a lone newsletter and has no chart when none in the period has an open rate', () => {
    const lone = { ...newsletters, newsletters: [send('n1', `${year}-03-02`, 0.25, 0.05)] };
    expect(buildHealthMetricsOverviewNewsletterView(lone, 'YTD').chart?.points[0]?.xPct).toBe('50.00');

    const unrated = { ...newsletters, newsletters: [send('n1', `${year}-03-02`, null, null)] };
    expect(buildHealthMetricsOverviewNewsletterView(unrated, 'YTD').chart).toBeNull();
  });

  it('splits subscribers by engagement with the view’s shares, keeping a sliver for a level too small to see', () => {
    const engagement = buildHealthMetricsOverviewNewsletterView(newsletters, 'YTD').engagement;

    expect(engagement.map((row) => [row.label, row.description, row.countLabel, row.pctLabel])).toEqual([
      ['High', 'Opened 7+ newsletters and clicked a link', '175', '12%'],
      ['Medium', 'Opened 3–6 newsletters', '496', '34%'],
      ['Low', 'Opened 2 newsletters or fewer', '787', '54%'],
    ]);

    const tiny = {
      ...newsletters,
      periods: everyPeriod<HealthMetricsOverviewNewsletterPeriod | null>({ ...period, highEngagement: 1, highEngagementShare: 0.0001 }),
    };
    expect(buildHealthMetricsOverviewNewsletterView(tiny, 'YTD').engagement[0]?.widthPct).toBe(1.5);
    expect(buildHealthMetricsOverviewNewsletterView(tiny, 'YTD').engagement[0]?.pctLabel).toBe('<1%');
  });

  it('is empty when nothing was sent in the period or the foundation is unmeasured', () => {
    const none = { ...newsletters, periods: everyPeriod<HealthMetricsOverviewNewsletterPeriod | null>({ ...period, newslettersSent: 0 }) };

    expect(buildHealthMetricsOverviewNewsletterView(none, 'YTD').isEmpty).toBe(true);
    expect(buildHealthMetricsOverviewNewsletterView({ ...newsletters, measured: false }, 'YTD').isEmpty).toBe(true);
    expect(
      buildHealthMetricsOverviewNewsletterView({ ...newsletters, periods: everyPeriod<HealthMetricsOverviewNewsletterPeriod | null>(null) }, 'YTD').isEmpty
    ).toBe(true);
  });

  it('drops the growth month and the basis when the view gives neither', () => {
    const bare = {
      ...newsletters,
      periods: everyPeriod<HealthMetricsOverviewNewsletterPeriod | null>({ ...period, growthBaselineDate: null, newslettersConsidered: null }),
    };
    const view = buildHealthMetricsOverviewNewsletterView(bare, 'YTD');

    expect(view.kpis[0]?.delta?.label).toBe('39%');
    expect(view.engagementBasis).toBe('');
  });
});

describe('buildHealthMetricsOverviewBoardView', () => {
  const board: HealthMetricsOverviewBoard = {
    periods: everyPeriod({ meetings: 3, meetingsChangePct: 0.25, avgAttendancePct: 0.6, avgAttendanceChangePct: -0.1 }, { COMPLETED_YEAR_3: null }),
    members: [
      {
        key: 'k1',
        name: 'Pat Doe',
        jobTitle: 'CTO',
        organization: 'Acme Corp',
        logoUrl: null,
        lastAttendedDate: '2025-12-09',
        attendance: { YTD: { invited: 3, attended: 3, attendancePct: 1 } },
      },
      {
        key: 'k2',
        name: 'Sam Roe',
        jobTitle: null,
        organization: null,
        logoUrl: 'https://logos.example/r.png',
        lastAttendedDate: null,
        attendance: { YTD: { invited: 3, attended: 0, attendancePct: 0 } },
      },
      {
        key: 'k3',
        name: 'Alex Moe',
        jobTitle: null,
        organization: 'Moe Inc',
        logoUrl: null,
        lastAttendedDate: null,
        attendance: { YTD: { invited: 2, attended: 1, attendancePct: null } },
      },
      {
        key: 'k4',
        name: 'Kit Lee',
        jobTitle: null,
        organization: 'Lee Co',
        logoUrl: null,
        lastAttendedDate: null,
        attendance: { COMPLETED_YEAR: { invited: 1, attended: 1, attendancePct: 1 } },
      },
    ],
  };

  it('reads meetings and average attendance against last year, where a rise is good news', () => {
    const { kpis } = buildHealthMetricsOverviewBoardView(board, 'YTD');

    expect(kpis.map((kpi) => [kpi.label, kpi.value, kpi.delta])).toEqual([
      ['Total meetings', '3', { label: '25%', direction: 'up', good: true }],
      ['Average attendance', '60%', { label: '10%', direction: 'down', good: false }],
    ]);
  });

  it("lists the period's invitees, lowest attendance first, coloured by the design's thresholds", () => {
    const { rows } = buildHealthMetricsOverviewBoardView(board, 'YTD');

    expect(rows.map((row) => [row.name, row.attendedLabel, row.pctLabel, row.barClass])).toEqual([
      ['Sam Roe', '0 of 3', '0%', 'bg-red-400'],
      ['Alex Moe', '1 of 2', '50%', 'bg-amber-400'],
      ['Pat Doe', '3 of 3', '100%', 'bg-emerald-500'],
    ]);
    expect(rows[2]).toMatchObject({ initials: 'PD', title: 'CTO', organizationInitial: 'A', lastAttendedLabel: 'Dec 9, 2025' });
    expect(rows[0]).toMatchObject({ organization: '—', organizationInitial: '', lastAttendedLabel: '—' });
  });

  it('sorts by name or attendance either way', () => {
    const { rows } = buildHealthMetricsOverviewBoardView(board, 'YTD');

    expect(sortHealthMetricsOverviewBoardRows(rows, 'name-asc').map((row) => row.name)).toEqual(['Alex Moe', 'Pat Doe', 'Sam Roe']);
    expect(sortHealthMetricsOverviewBoardRows(rows, 'name-desc').map((row) => row.name)).toEqual(['Sam Roe', 'Pat Doe', 'Alex Moe']);
    expect(sortHealthMetricsOverviewBoardRows(rows, 'att-desc').map((row) => row.name)).toEqual(['Pat Doe', 'Alex Moe', 'Sam Roe']);
  });

  it('is empty for a period with no board meetings', () => {
    expect(buildHealthMetricsOverviewBoardView(board, 'COMPLETED_YEAR_3').isEmpty).toBe(true);
  });
});

describe('buildHealthMetricsOverviewAddPastMeetingUrl', () => {
  it("links to PCC's add-past-meeting page for the foundation, and nowhere without one", () => {
    expect(buildHealthMetricsOverviewAddPastMeetingUrl('https://pcc.example', 'f-acme')).toBe(
      'https://pcc.example/project/f-acme/collaboration/meetings/manage-meeting?isPast=true'
    );
    expect(buildHealthMetricsOverviewAddPastMeetingUrl('https://pcc.example', null)).toBeNull();
  });
});

describe('buildHealthMetricsOverviewTrendView', () => {
  const row: HealthMetricsOverviewEvent = {
    eventId: 'e1',
    eventName: 'Acme Summit',
    startDate: '2026-12-08',
    endDate: null,
    city: null,
    registrations: 328,
    registrationsGoal: 1000,
    compScore: 'medium',
    acceptedTalks: null,
    totalProposals: null,
    cfpStatus: null,
    ranges: [],
  };
  const headline = {
    eventId: 'e1',
    eventName: 'Acme Summit',
    eventStartDate: '2026-12-08',
    forecastAvg: 620,
    forecastLow: 560,
    forecastHigh: 680,
    registrationsNow: 330,
    priorYearSamePoint: 300,
    goal: 1000,
    daysLeft: 46,
    isNewEvent: false,
  };
  const point = (daysToEvent: number, actual: number | null, forecast: number | null, priorYear: number | null) => ({
    daysToEvent,
    actual,
    forecastAvg: forecast,
    forecastLow: forecast === null ? null : forecast - 50,
    forecastHigh: forecast === null ? null : forecast + 50,
    priorYear,
  });
  const series = {
    format: 'In Person',
    points: [point(-200, 10, null, 5), point(-90, 200, null, 180), point(-46, 330, null, 300), point(-20, null, 500, 420), point(0, null, 620, 600)],
  };

  it('reads the headline figures, with the predicted range beside the prediction, falling back to the list row without a forecast', () => {
    const view = buildHealthMetricsOverviewTrendView(row, headline, series);

    expect(view.kpis.map((kpi) => [kpi.label, kpi.value, kpi.range])).toEqual([
      ['Current', '330', null],
      ['Same point last year', '300', null],
      ['Predicted', '620', { high: '680', low: '560' }],
    ]);
    expect([view.goalLabel, view.daysTitle, view.daysLabel]).toEqual(['1,000', 'Days left', '46']);
    const fallback = buildHealthMetricsOverviewTrendView(row, null, null);
    expect([...fallback.kpis.map((kpi) => kpi.value), fallback.goalLabel, fallback.daysLabel]).toEqual(['328', '—', '—', '1,000', '—']);
    expect(fallback.kpis[2].range).toBeNull();
  });

  it('rounds the scale up to at most 5 even steps, with ticks every 30 days', () => {
    const view = buildHealthMetricsOverviewTrendView(row, headline, series);

    // The goal of 1,000 plus 5% headroom rounds up to 5 steps of 250.
    expect(view.yTicks.map((tick) => tick.label)).toEqual(['1,250', '1,000', '750', '500', '250', '0']);
    expect(view.yTicks[1]).toMatchObject({ pct: '20.00', y: '44.0' });
    expect(view.xTicks.map((tick) => tick.label)).toEqual(['180', '150', '120', '90', '60', '30', '0']);
    expect(view.xTicks[6].pct).toBe('100.00');
  });

  it('keeps whole-number steps on a small scale', () => {
    const small = { format: 'In Person', points: [point(-30, 1, null, 2), point(-10, 3, null, null)] };
    const view = buildHealthMetricsOverviewTrendView({ ...row, registrationsGoal: null }, null, small);

    expect(view.yTicks.map((tick) => tick.label)).toEqual(['4', '3', '2', '1', '0']);
  });

  it('plots the last 180 days, joining the prediction to the last actual figure at today', () => {
    const view = buildHealthMetricsOverviewTrendView(row, headline, series);

    expect(view.currentPath.startsWith('M300.0')).toBe(true);
    expect(view.currentPath.split('L')).toHaveLength(2);
    expect(view.predictedPath.startsWith('M446.7')).toBe(true);
    expect(view.predictedPath.endsWith(`600.0 ${(220 - (620 / 1250) * 220).toFixed(1)}`)).toBe(true);
    expect(view.bandPath.endsWith(' Z')).toBe(true);
    expect([view.todayX, view.todayPct]).toEqual(['446.7', '74.44']);
    expect(view.goalY).toBe('44.0');
  });

  it('draws no goal line without a goal', () => {
    expect(buildHealthMetricsOverviewTrendView({ ...row, registrationsGoal: null }, { ...headline, goal: null }, series).goalY).toBeNull();
  });

  it('draws only what it has without a curve', () => {
    const view = buildHealthMetricsOverviewTrendView(row, headline, null);

    expect([view.currentPath, view.predictedPath, view.bandPath, view.lastYearPath, view.todayX]).toEqual(['', '', '', '', null]);
  });
});

describe('buildHealthMetricsOverviewPastTrendView', () => {
  const row: HealthMetricsOverviewEvent = {
    eventId: 'p1',
    eventName: 'Acme Summit',
    startDate: '2026-06-02',
    endDate: null,
    city: null,
    registrations: 512,
    registrationsGoal: 500,
    compScore: null,
    acceptedTalks: null,
    totalProposals: null,
    cfpStatus: null,
    ranges: ['YTD'],
  };
  const point = (daysToEvent: number, actual: number, priorYear: number | null) => ({
    daysToEvent,
    actual,
    forecastAvg: null,
    forecastLow: null,
    forecastHigh: null,
    priorYear,
  });
  const inPerson = { format: 'In Person', points: [point(-120, 40, 30), point(-30, 300, 260), point(0, 480, 410)] };
  const virtual = { format: 'Virtual', points: [point(-30, 10, null), point(0, 30, 20)] };
  const curve = { eventId: 'p1', formats: [inPerson, virtual] };

  it("reads the event's final count against last year's, which adds each format's last day", () => {
    const view = buildHealthMetricsOverviewPastTrendView(row, curve, inPerson);

    expect(view.kpis.map((kpi) => [kpi.label, kpi.value])).toEqual([
      ['Current', '512'],
      ['Same point last year', '430'],
      ['Final', '512'],
    ]);
    expect([view.goalLabel, view.daysTitle, view.daysLabel, view.todayPct]).toEqual(['500', 'Event held', '0', null]);
  });

  it('draws the history and last year with no forecast or today line', () => {
    const view = buildHealthMetricsOverviewPastTrendView(row, curve, inPerson);

    expect(view.currentPath.split('L')).toHaveLength(3);
    expect(view.lastYearPath).not.toBe('');
    expect([view.predictedPath, view.bandPath, view.todayX]).toEqual(['', '', null]);
    expect(view.goalY).not.toBeNull();
  });

  it('leaves last year out without a curve', () => {
    expect(buildHealthMetricsOverviewPastTrendView(row, null, null).kpis[1].value).toBe('—');
  });
});

describe('toHealthMetricsOverviewKpiStripLayout', () => {
  it('keeps a row while every item has 170px, and before the strip is measured', () => {
    expect(toHealthMetricsOverviewKpiStripLayout(null, 4)).toBe('row');
    expect(toHealthMetricsOverviewKpiStripLayout(340, 2)).toBe('row');
  });

  it('stacks a narrower strip in one column', () => {
    expect(toHealthMetricsOverviewKpiStripLayout(339, 2)).toBe('stack');
    expect(toHealthMetricsOverviewKpiStripLayout(500, 3)).toBe('stack');
  });

  it('makes four items a 2 × 2 grid while two columns still have 170px each, and stacks them below that', () => {
    expect(toHealthMetricsOverviewKpiStripLayout(600, 4)).toBe('grid');
    expect(toHealthMetricsOverviewKpiStripLayout(339, 4)).toBe('stack');
  });
});

describe('buildHealthMetricsYtdRangeLabel', () => {
  it('spans January 1 to the given day of its year', () => {
    expect(buildHealthMetricsYtdRangeLabel(new Date(2026, 9, 22))).toBe('Jan 1 – Oct 22, 2026');
  });

  it('reads a single day on January 1', () => {
    expect(buildHealthMetricsYtdRangeLabel(new Date(2027, 0, 1))).toBe('Jan 1 – Jan 1, 2027');
  });
});
