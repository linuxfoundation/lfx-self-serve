// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { DashboardMetricCard, EdEvolutionData } from '../interfaces';

import { buildEdEvolutionMetrics } from './dashboard-metrics.constants';

/**
 * The ED Marketing Overview swallows each card's request error and substitutes a fallback,
 * so the fallback's SHAPE is what decides whether a failure reads as an outage or as a
 * measurement. A zero-filled fallback renders "0" — indistinguishable from a real zero once
 * the error is gone.
 *
 * Reproduced on Agentic AI Foundation: /api/analytics/brand-reach failed inside the
 * dashboard's ~22-request burst on a cold load, and the Social card rendered "0 · 0
 * platforms" for a foundation with 17,269 followers across 2 platforms.
 */
describe('buildEdEvolutionMetrics — a failed request must not render as a measurement', () => {
  /**
   * Only the fields these assertions read are populated; the rest of EdEvolutionData is cast
   * in. A fixture spelling out every response would obscure which field drives each card, and
   * would need editing whenever an unrelated response gains a field.
   */
  function dataWith(overrides: Partial<EdEvolutionData>): EdEvolutionData {
    return {
      // Present because the builder dereferences them unconditionally while computing other
      // cards; none of the assertions below read them.
      flywheel: {
        conversionRate: 0,
        changePercentage: 0,
        trend: 'up',
        funnel: {
          eventAttendees: 0,
          convertedToNewsletter: 0,
          convertedToCommunity: 0,
          convertedToWorkingGroup: 0,
          convertedToTraining: 0,
          convertedToCode: 0,
          convertedToWeb: 0,
        },
        reengagement: {
          totalReengaged: 0,
          reengagementRate: 0,
          reengagementMomChange: 0,
          reengagedToNewsletter: 0,
          reengagedToCommunity: 0,
          reengagedToWorkingGroup: 0,
          reengagedToTraining: 0,
          reengagedToCode: 0,
          reengagedToWeb: 0,
        },
        monthlyData: [],
      },
      revenueImpact: undefined,
      paidCampaign: undefined,
      education: undefined,
      memberAcquisition: {
        totalMembers: 0,
        totalMembersMonthlyData: [],
        totalMembersMonthlyLabels: [],
        newMembersThisQuarter: 0,
        newMemberRevenue: 0,
        changePercentage: 0,
        trend: 'up',
        quarterlyData: [],
      },
      memberRetention: { renewalRate: 0, netRevenueRetention: 0, changePercentage: 0, trend: 'up', target: 0, monthlyData: [] },
      engagedCommunity: {
        totalMembers: 0,
        changePercentage: 0,
        trend: 'up',
        breakdown: {
          newsletterSubscribers: 0,
          communityMembers: 0,
          workingGroupMembers: 0,
          certifiedIndividuals: 0,
          webVisitors: 0,
          codeContributors: 0,
          trainingEnrollees: 0,
        },
        monthlyData: [],
      },
      eventGrowth: {
        totalAttendees: 0,
        totalRegistrants: 0,
        totalEvents: 0,
        totalRevenue: 0,
        revenuePerAttendee: 0,
        attendeeYoyChange: 0,
        registrantYoyChange: 0,
        revenueYoyChange: 0,
        trend: 'up',
        monthlyData: [],
        topEvents: [],
      },
      brandHealth: {
        totalMentions: 0,
        sentiment: { positive: 0, neutral: 0, negative: 0 },
        sentimentMomChangePp: 0,
        mentionMomChangePct: null,
        trend: 'up',
        monthlyMentions: [],
        topProjects: [],
        topPositiveMentions: [],
        topNegativeMentions: [],
      },
      emailCtr: {
        currentCtr: 0,
        changePercentage: 0,
        momChangePercentage: null,
        trend: 'up',
        monthlyData: [],
        monthlyLabels: [],
        campaignGroups: [],
        monthlySends: [],
        monthlyOpens: [],
      },
      brandReach: {
        totalSocialFollowers: 17269,
        totalMonthlySessions: 3482,
        activePlatforms: 2,
        changePercentage: 28.18,
        sessionMomChangePct: 0,
        trend: 'up',
        socialPlatforms: [],
        websiteDomains: [],
        weeklyTrend: [],
      },
      pending: false,
      ...overrides,
    } as EdEvolutionData;
  }

  const card = (cards: DashboardMetricCard[], testId: string): DashboardMetricCard | undefined => cards.find((c) => c.testId === testId);

  // The cards below prove the BUILDER handles undefined. This proves the caller can actually
  // produce it: EdEvolutionData must permit undefined for brandReach, so the component's
  // error fallback can be undefined rather than a zero-filled response. Typed at compile
  // time — if the field is narrowed back to a required BrandReachResponse, this stops
  // compiling and the build fails, which is the layer a runtime assertion cannot reach.
  it('permits an undefined brand-reach on the data contract', () => {
    const failed: Pick<EdEvolutionData, 'brandReach'> = { brandReach: undefined };

    expect(failed.brandReach).toBeUndefined();
  });

  it('renders the measured figures when the request succeeded', () => {
    const cards = buildEdEvolutionMetrics(dataWith({}));

    expect(card(cards, 'ed-evo-brand-reach')?.value).toBe('17.3K');
    expect(card(cards, 'ed-evo-brand-reach')?.subtitle).toBe('2 platforms');
    expect(card(cards, 'ed-evo-web-sessions')?.value).toBe('3.5K');
  });

  // The regression itself: undefined is "the request failed", and the card must say so
  // rather than print a zero a reader would take as a count.
  it('says the data is unavailable when the brand-reach request failed', () => {
    const cards = buildEdEvolutionMetrics(dataWith({ brandReach: undefined }));

    const social = card(cards, 'ed-evo-brand-reach');
    expect(social?.value).toBe('—');
    expect(social?.value).not.toBe('0');
    expect(social?.subtitle).toContain('could not be loaded');
    // A change indicator beside an em dash implies a measured movement.
    expect(social?.changePercentage).toBeUndefined();
    expect(social?.trend).toBeUndefined();
  });

  // Both cards read the same response, so both regress together — fixing only the Social
  // card would leave Web printing "0" from the identical failure.
  it('says the data is unavailable on the Web card too', () => {
    const cards = buildEdEvolutionMetrics(dataWith({ brandReach: undefined }));

    const web = card(cards, 'ed-evo-web-sessions');
    expect(web?.value).toBe('—');
    expect(web?.subtitle).toContain('could not be loaded');
    expect(web?.changePercentage).toBeUndefined();
  });

  // While the request is still in flight nothing has failed yet, so the copy must not
  // claim it did — the em dash is shared, the caption is not.
  it('does not claim a failure while the request is still pending', () => {
    const cards = buildEdEvolutionMetrics(dataWith({ brandReach: undefined, pending: true }));

    const social = card(cards, 'ed-evo-brand-reach');
    expect(social?.value).toBe('—');
    expect(social?.subtitle).not.toContain('could not be loaded');
  });

  // The Email card was the one reported from production: AAIF's March campaign had 100 opens
  // at a 76.3% CTR, and a failed request rendered "0 opens · 0.0% CTR" because summing an
  // absent response yields 0. Its signals are dual-signal rows rather than a single value.
  it('says the data is unavailable when the email request failed', () => {
    const cards = buildEdEvolutionMetrics(dataWith({ emailCtr: undefined }));

    const email = card(cards, 'ed-evo-campaign-performance');
    expect(email?.dualSignals?.map((row) => row.value)).toEqual(['—', '—']);
    expect(email?.dualSignals?.some((row) => String(row.value).includes('0 opens'))).toBe(false);
    expect(email?.caption).toContain('could not be loaded');
  });

  // The Adoption card, whose drawer additionally asserts "No community engagement activity
  // detected" — copy that states a finding rather than an outage. AAIF has 27,831 engaged.
  it('says the data is unavailable when the engaged-community request failed', () => {
    const cards = buildEdEvolutionMetrics(dataWith({ engagedCommunity: undefined }));

    const adoption = card(cards, 'ed-evo-engaged-community');
    expect(adoption?.value).toBe('—');
    expect(adoption?.value).not.toBe('0');
    expect(adoption?.subtitle).toContain('could not be loaded');
    expect(adoption?.changePercentage).toBeUndefined();
  });

  // A foundation that genuinely sent nothing must still read as a measured zero, or the fix
  // trades one wrong answer for another.
  it('renders a genuinely empty email month as zero, not as unavailable', () => {
    const cards = buildEdEvolutionMetrics(dataWith({}));

    const email = card(cards, 'ed-evo-campaign-performance');
    expect(email?.dualSignals?.[0]?.value).toBe('0 opens');
    expect(email?.caption).not.toContain('could not be loaded');
  });

  // The other half of the contract: a foundation that genuinely has nothing must still
  // read as zero. Rendering an em dash here would hide a real measurement.
  it('renders a genuine zero as zero, not as unavailable', () => {
    const cards = buildEdEvolutionMetrics(
      dataWith({
        brandReach: {
          totalSocialFollowers: 0,
          totalMonthlySessions: 0,
          activePlatforms: 0,
          changePercentage: 0,
          sessionMomChangePct: 0,
          trend: 'up',
          socialPlatforms: [],
          websiteDomains: [],
          weeklyTrend: [],
        },
      })
    );

    const social = card(cards, 'ed-evo-brand-reach');
    expect(social?.value).toBe('0');
    expect(social?.subtitle).toBe('0 platforms');
    expect(social?.subtitle).not.toContain('could not be loaded');
  });
});
