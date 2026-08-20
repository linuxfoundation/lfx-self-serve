// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, Type } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { DRAWER_UNAVAILABLE_BODY, DRAWER_UNAVAILABLE_HEADING } from '@lfx-one/shared/constants';
import { ProjectContext } from '@lfx-one/shared/interfaces';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BrandHealthDrawerComponent } from './brand-health-drawer/brand-health-drawer.component';
import { BrandReachDrawerComponent } from './brand-reach-drawer/brand-reach-drawer.component';
import { EmailCtrDrawerComponent } from './email-ctr-drawer/email-ctr-drawer.component';
import { EngagedCommunityDrawerComponent } from './engaged-community-drawer/engaged-community-drawer.component';
import { WebsiteVisitsDrawerComponent } from './website-visits-drawer/website-visits-drawer.component';
import { FlywheelConversionDrawerComponent } from './flywheel-conversion-drawer/flywheel-conversion-drawer.component';
import { MemberAcquisitionDrawerComponent } from './member-acquisition-drawer/member-acquisition-drawer.component';
import { MemberRetentionDrawerComponent } from './member-retention-drawer/member-retention-drawer.component';

/**
 * The card layer renders "—  Data unavailable" when a request fails, but each drawer keeps
 * its own empty state — and that copy asserted a FINDING ("No brand mention activity
 * detected") plus advice derived from it ("Engage with marketing ops…"). On a failed
 * request the card and the drawer behind it therefore contradicted each other, and the
 * drawer was the one stating a measurement that was never taken.
 *
 * These drawers take a zero-filled shape when their response is undefined (their inputs
 * are non-optional), so the zero-filled data alone cannot distinguish the two cases — the
 * `unavailable` input is what carries it.
 */
describe('ED drill-down drawers — a failed request must not read as no activity', () => {
  // Each drawer's own zero-filled empty shape, i.e. exactly what the parent passes when
  // the response is undefined. The assertions below turn ONLY `unavailable` on and off,
  // so any difference in output is attributable to that input alone.
  const drawers: {
    name: string;
    component: Type<unknown>;
    inputs: Record<string, unknown>;
    measuredCopy: string;
    // A NON-zero shape for the same drawer, plus a figure that must not survive on screen.
    // Zero-filled fixtures alone cannot tell a suppressed body from one rendering zeros —
    // that blind spot let two drawers ship their stats above the "unavailable" banner.
    nonZero?: { inputs: Record<string, unknown>; staleFigures: string[] };
  }[] = [
    {
      name: 'Sentiment',
      component: BrandHealthDrawerComponent,
      measuredCopy: 'No brand mention activity detected',
      nonZero: {
        staleFigures: ['80,799', 'Mentions Trend'],
        inputs: {
          data: {
            totalMentions: 80799,
            sentiment: { positive: 60, neutral: 30, negative: 10 },
            sentimentMomChangePp: 2.5,
            mentionMomChangePct: 12,
            trend: 'up',
            monthlyMentions: [{ label: 'Jan', value: 80799 }],
            topProjects: [{ name: 'pytorch', mentions: 500 }],
            topPositiveMentions: [],
            topNegativeMentions: [],
          },
        },
      },
      inputs: {
        data: {
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
      },
    },
    {
      name: 'Adoption',
      component: EngagedCommunityDrawerComponent,
      measuredCopy: 'No community engagement activity detected',
      nonZero: {
        staleFigures: ['27.8K', '12.5'],
        inputs: {
          data: {
            totalMembers: 27831,
            changePercentage: 12.5,
            trend: 'up',
            breakdown: {
              newsletterSubscribers: 10000,
              communityMembers: 8000,
              workingGroupMembers: 1000,
              certifiedIndividuals: 500,
              webVisitors: 7000,
              codeContributors: 1000,
              trainingEnrollees: 331,
            },
            monthlyData: [{ label: 'Jan', value: 27831 }],
          },
          brandReachData: {
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
        },
      },
      inputs: {
        data: {
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
        brandReachData: {
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
      },
    },
    {
      name: 'Flywheel',
      component: FlywheelConversionDrawerComponent,
      measuredCopy: 'No flywheel conversion activity detected',
      nonZero: {
        staleFigures: ['43.7', '61.2'],
        inputs: {
          data: {
            conversionRate: 43.7,
            changePercentage: 5,
            trend: 'up',
            funnel: {
              eventAttendees: 1000,
              convertedToNewsletter: 400,
              convertedToCommunity: 300,
              convertedToWorkingGroup: 100,
              convertedToTraining: 80,
              convertedToCode: 70,
              convertedToWeb: 50,
            },
            reengagement: {
              totalReengaged: 612,
              reengagementRate: 61.2,
              reengagementMomChange: 3,
              reengagedToNewsletter: 200,
              reengagedToCommunity: 150,
              reengagedToWorkingGroup: 100,
              reengagedToTraining: 62,
              reengagedToCode: 50,
              reengagedToWeb: 50,
            },
            monthlyData: [{ label: 'Jan', value: 43.7 }],
          },
        },
      },
      inputs: {
        data: {
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
      },
    },
    {
      name: 'Members',
      component: MemberAcquisitionDrawerComponent,
      measuredCopy: 'No membership activity detected',
      inputs: {
        data: {
          totalMembers: 0,
          totalMembersMonthlyData: [],
          totalMembersMonthlyLabels: [],
          newMembersThisQuarter: 0,
          newMemberRevenue: 0,
          changePercentage: 0,
          trend: 'up',
          quarterlyData: [],
        },
        retentionData: { renewalRate: 0, netRevenueRetention: 0, changePercentage: 0, trend: 'up', target: 0, monthlyData: [] },
        // revenueImpactData is intentionally omitted: it is a non-optional input with its
        // own zero-filled default, and passing undefined would exercise a state the parent
        // cannot produce.
      },
      nonZero: {
        // Every live figure in the drawer, not just the headline: the first fix guarded the
        // stat block alone and left retention stats, insight blocks and charts rendering.
        staleFigures: ['1.2K', '92.5', '104.2'],
        inputs: {
          data: {
            totalMembers: 1234,
            totalMembersMonthlyData: [1234],
            totalMembersMonthlyLabels: ['Jan'],
            newMembersThisQuarter: 12,
            newMemberRevenue: 500000,
            changePercentage: 8,
            trend: 'up',
            quarterlyData: [{ quarter: 'Q1', newMembers: 12, revenue: 500000 }],
          },
          retentionData: {
            renewalRate: 92.5,
            netRevenueRetention: 104.2,
            changePercentage: 3,
            trend: 'up',
            target: 90,
            monthlyData: [{ label: 'Jan', value: 92.5 }],
          },
        },
      },
    },
    {
      // NOT RENDERED ANYWHERE TODAY. MemberRetentionDrawerComponent is referenced by no
      // template — retention reaches the user through member-acquisition-drawer's
      // `retentionData` input instead. These two cases therefore do not cover the live
      // retention path; they keep the orphaned component consistent with its five siblings
      // so it does not ship the old defect if it is ever wired up.
      name: 'Retention',
      component: MemberRetentionDrawerComponent,
      measuredCopy: 'No retention activity detected',
      inputs: {
        data: { renewalRate: 0, netRevenueRetention: 0, changePercentage: 0, trend: 'up', target: 0, monthlyData: [] },
      },
      nonZero: {
        staleFigures: ['92.5', '104.2'],
        inputs: {
          data: {
            renewalRate: 92.5,
            netRevenueRetention: 104.2,
            changePercentage: 3,
            trend: 'up',
            target: 90,
            monthlyData: [{ label: 'Jan', value: 92.5 }],
          },
        },
      },
    },
  ];

  async function render(component: Type<unknown>, inputs: Record<string, unknown>, unavailable: boolean): Promise<ComponentFixture<unknown>> {
    await TestBed.configureTestingModule({
      imports: [component],
      providers: [provideNoopAnimations(), provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(component);
    for (const [key, value] of Object.entries({ ...inputs, visible: true, unavailable })) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  // The zero-filled fixtures above already make hasNoData() true, so they cannot tell
  // whether `unavailable` reaches that guard at all — deleting it leaves them green. This
  // case supplies NON-zero data alongside unavailable: true, which is what the drawer holds
  // when a request fails while it is still showing the previously-loaded foundation. Only
  // the guard turns the empty state on here.
  it('Adoption: reports unavailable even while holding a previous foundation’s non-zero data', async () => {
    const fixture = await render(
      EngagedCommunityDrawerComponent,
      {
        data: {
          totalMembers: 27831,
          changePercentage: 12,
          trend: 'up',
          breakdown: {
            newsletterSubscribers: 10000,
            communityMembers: 8000,
            workingGroupMembers: 1000,
            certifiedIndividuals: 500,
            webVisitors: 7000,
            codeContributors: 1000,
            trainingEnrollees: 331,
          },
          monthlyData: [{ label: 'Jan', value: 27831 }],
        },
        brandReachData: {
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
      },
      true
    );
    const text = document.body.textContent ?? '';

    expect(text).toContain(DRAWER_UNAVAILABLE_HEADING);
    // The stale figure must not still be on screen presented as current.
    expect(text).not.toContain('27,831');

    fixture.destroy();
    TestBed.resetTestingModule();
  });

  // Email and Website fetch their own data, so their failures arrive through catchError
  // rather than a parent input — a distinct path the parent-fed cases cannot reach. Both
  // resolve to a zero-filled default, which is what used to render a measured-absence
  // finding for a failed request. Do not describe either as "the only one": that claim was
  // in this comment and is what let the Website drawer ship unfixed.
  it('Email: says the data could not be loaded when its own request fails', async () => {
    await TestBed.configureTestingModule({
      imports: [EmailCtrDrawerComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: AnalyticsService, useValue: { getEmailCtr: () => throwError(() => new Error('boom')) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal<ProjectContext | null>({ uid: 'f-1', name: 'TLF', slug: 'tlf' }) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EmailCtrDrawerComponent);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = document.body.textContent ?? '';
    expect(text).toContain(DRAWER_UNAVAILABLE_HEADING);
    expect(text).not.toContain('No email activity detected');

    fixture.destroy();
    TestBed.resetTestingModule();
  });

  /**
   * The PARTIAL-failure path, which no other case on this PR reaches. `getEmailCtr` runs the
   * per-send breakdown as an OPTIONAL query that `.catch()`es to `rows: []` and still returns
   * HTTP 200 — so the drawer-level `unavailable` flag never flips, and the five headline tiles,
   * which all reduce() over `emailTypeBreakdown`, sum an empty array to a confident 0.
   *
   * That is the reported production symptom ("0 opens · 0.0% CTR") reproduced one layer down,
   * on a path where the response was a success. The two tests below are the two sides of the
   * contract: a FAILED breakdown must not render as a number, and a GENUINELY empty one must
   * still render as the measurement it is. A single-sided test would pass just as well against
   * a drawer that blanked these tiles unconditionally.
   */
  const emailBase = {
    currentCtr: 2.5,
    changePercentage: 0,
    momChangePercentage: null,
    trend: 'up' as const,
    monthlyData: [2.5],
    monthlyLabels: ['Jan'],
    campaignGroups: [],
    monthlySends: [1000],
    monthlyOpens: [250],
  };

  async function renderEmail(response: Record<string, unknown>): Promise<ComponentFixture<EmailCtrDrawerComponent>> {
    await TestBed.configureTestingModule({
      imports: [EmailCtrDrawerComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: AnalyticsService, useValue: { getEmailCtr: () => of(response) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal<ProjectContext | null>({ uid: 'f-1', name: 'TLF', slug: 'tlf' }) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EmailCtrDrawerComponent);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('Email: a failed OPTIONAL breakdown suppresses the tiles instead of summing [] to zero', async () => {
    // Exactly what the BFF returns when only the breakdown query throws: a 200, a measured
    // primary CTR, an empty breakdown, and the flag that says the emptiness is not a finding.
    const fixture = await renderEmail({ ...emailBase, emailTypeBreakdown: [], breakdownUnavailable: true });
    const text = document.body.textContent ?? '';

    // The fabricated measurements themselves. '0.0%' is the load-bearing assertion: it is what
    // the Open Rate and CTR tiles printed for a query that never ran.
    expect(text).not.toContain('0.0%');
    expect(text).toContain('—');
    // The section must state the outage rather than vanish — an absent table reads as
    // "no campaigns", which is the same false finding told by omission.
    expect(document.body.querySelector('[data-testid="email-ctr-drawer-breakdown-unavailable"]')).not.toBeNull();

    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('Email: a genuinely empty breakdown still renders zeros as the measurement they are', async () => {
    // Same empty array, no failure. The zeros here were measured, so suppressing them would
    // trade the fabricated-zero defect for a fabricated-outage one.
    const fixture = await renderEmail({ ...emailBase, emailTypeBreakdown: [], breakdownUnavailable: false });
    const text = document.body.textContent ?? '';

    expect(text).toContain('0.0%');
    expect(document.body.querySelector('[data-testid="email-ctr-drawer-breakdown-unavailable"]')).toBeNull();

    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('Email: a measured breakdown is unaffected by the partial-failure guard', async () => {
    const fixture = await renderEmail({
      ...emailBase,
      breakdownUnavailable: false,
      emailTypeBreakdown: [
        {
          emailType: 'newsletter',
          campaignCount: 2,
          totalSends: 12345,
          totalOpens: 4000,
          totalClicks: 500,
          openRate: 32.4,
          ctr: 4.1,
          performance: 'EXCELLENT',
          campaigns: [],
        },
      ],
    });
    const text = document.body.textContent ?? '';

    // formatNumber compacts, so assert the RENDERED form — a raw '12,345' assertion could
    // never fail regardless of the guard, the vacuous-assertion trap from an earlier round.
    expect(text).toContain('12.3K');
    expect(document.body.querySelector('[data-testid="email-ctr-drawer-breakdown-unavailable"]')).toBeNull();

    fixture.destroy();
    TestBed.resetTestingModule();
  });

  // The case the zero-filled fixtures structurally cannot make: real figures in the drawer
  // while `unavailable` is true. Two drawers rendered their summary stats ABOVE the
  // "Data unavailable" banner — "0.0% retention" and "0 members" in 2xl type beside copy
  // saying the data could not be loaded — and every zero-filled assertion still passed,
  // because a suppressed body and a body full of zeros contain no distinguishing text.
  for (const { name, component, nonZero } of drawers.filter((d) => d.nonZero)) {
    it(`${name}: suppresses the stat body, not just the caption, when the request failed`, async () => {
      const fixture = await render(component, nonZero!.inputs, true);
      const text = document.body.textContent ?? '';

      expect(text).toContain(DRAWER_UNAVAILABLE_HEADING);
      for (const figure of nonZero!.staleFigures) {
        expect(text).not.toContain(figure);
      }

      fixture.destroy();
      TestBed.resetTestingModule();
    });
  }

  // Pending is NOT failed. PENDING_ED_EVOLUTION_DATA spreads the error fallback, so every
  // field is undefined while the request is still in flight — a drawer deriving failure from
  // `!field` alone announces "Data unavailable" before anything has failed. The body stays
  // suppressed either way (a zero-filled fallback is not a measurement while loading either),
  // but only one of the two states may claim a failure.
  for (const { name, component, inputs } of drawers.filter((d) => d.nonZero)) {
    it(`${name}: says loading, not failed, while the request is still in flight`, async () => {
      await TestBed.configureTestingModule({
        imports: [component],
        providers: [provideNoopAnimations(), provideRouter([])],
      }).compileComponents();

      const fixture = TestBed.createComponent(component);
      for (const [key, value] of Object.entries({ ...inputs, visible: true, unavailable: false, pending: true })) {
        fixture.componentRef.setInput(key, value);
      }
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const text = document.body.textContent ?? '';
      expect(text).toContain('Loading');
      expect(text).not.toContain(DRAWER_UNAVAILABLE_HEADING);
      expect(text).not.toContain(DRAWER_UNAVAILABLE_BODY);
      // The measured-absence copy must not appear either — nothing has been measured yet.
      expect(text).not.toContain('Engage with marketing ops');

      fixture.destroy();
      TestBed.resetTestingModule();
    });
  }

  // Website is the second self-fetching drawer. It was missed on the first pass because the
  // Email comment above called Email "the only one" — an enumerating claim that was wrong when
  // written. Same mechanism: catchError resolves to a zero-filled default, which rendered
  // "No website traffic detected" for a failed request.
  it('Website: says the data could not be loaded when its own request fails', async () => {
    await TestBed.configureTestingModule({
      imports: [WebsiteVisitsDrawerComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: AnalyticsService, useValue: { getWebActivitiesSummary: () => throwError(() => new Error('boom')) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal<ProjectContext | null>({ uid: 'f-1', name: 'TLF', slug: 'tlf' }) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(WebsiteVisitsDrawerComponent);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = document.body.textContent ?? '';
    expect(text).toContain(DRAWER_UNAVAILABLE_HEADING);
    expect(text).not.toContain('No website traffic detected');

    fixture.destroy();
    TestBed.resetTestingModule();
  });

  // A social-only failure leaves the response PRESENT, so `unavailable` is false and the drawer
  // stays open — correctly, because its web half was measured. Only the social parts may be
  // suppressed. Blanking the whole drawer here would repeat the mistake the card layer avoids.
  it('Social: suppresses only the social half when just the social query failed', async () => {
    await TestBed.configureTestingModule({
      imports: [BrandReachDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(BrandReachDrawerComponent);
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('unavailable', false);
    fixture.componentRef.setInput('socialUnavailable', true);
    fixture.componentRef.setInput('data', {
      socialUnavailable: true,
      // Non-zero on purpose: a guard that renders these when socialUnavailable is true would
      // put a fabricated 17,269 on screen, and a zero fixture could not tell that apart from a
      // correctly suppressed tile.
      totalSocialFollowers: 17269,
      totalMonthlySessions: 3482,
      activePlatforms: 2,
      changePercentage: 0,
      sessionMomChangePct: 4,
      trend: 'up',
      socialPlatforms: [],
      websiteDomains: [{ domain: 'docs.example.org', sessions: 3482 }],
      weeklyTrend: [],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = document.body.textContent ?? '';
    // The social half must not assert a measured absence.
    expect(text).not.toContain('Social platform data not yet available');
    expect(text).toContain(DRAWER_UNAVAILABLE_HEADING);
    // Nor may it render the numbers the failed query left behind.
    expect(text).not.toContain('17,269');
    // The web half WAS measured and must survive.
    expect(text).toContain('3,482');

    fixture.destroy();
    TestBed.resetTestingModule();
  });

  // The Email drawer's optional campaign-breakdown query .catch()es to rows: [] and the
  // response still returns 200, so the four tiles reduce() an empty array into a confident 0.
  // Same defect class as the social-only split: a partial failure wearing a success.
  it('Email: shows an em dash, not a summed zero, when only the breakdown query failed', async () => {
    await TestBed.configureTestingModule({
      imports: [EmailCtrDrawerComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        {
          provide: AnalyticsService,
          useValue: {
            getEmailCtr: () =>
              of({
                breakdownUnavailable: true,
                currentCtr: 4.2,
                changePercentage: 0,
                momChangePercentage: null,
                trend: 'up',
                monthlyData: [1],
                monthlyLabels: ['Jan'],
                campaignGroups: [],
                monthlySends: [100],
                monthlyOpens: [40],
                emailTypeBreakdown: [],
              }),
          },
        },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal<ProjectContext | null>({ uid: 'f-1', name: 'TLF', slug: 'tlf' }) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EmailCtrDrawerComponent);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = document.body.textContent ?? '';
    // A summed-to-zero tile is the regression; the em dash is the honest rendering.
    expect(text).not.toContain('0.0%');
    expect(text).toContain('—');

    fixture.destroy();
    TestBed.resetTestingModule();
  });

  for (const { name, component, inputs, measuredCopy } of drawers) {
    it(`${name}: says the data could not be loaded when the request failed`, async () => {
      const fixture = await render(component, inputs, true);
      // PrimeNG renders the drawer body into an overlay appended to the document, not
      // inside the component's own host element — so read the document.
      const text = document.body.textContent ?? '';

      expect(text).toContain(DRAWER_UNAVAILABLE_HEADING);
      expect(text).toContain(DRAWER_UNAVAILABLE_BODY);
      // The regression: an outage stated as a measured absence, plus advice derived from it.
      expect(text).not.toContain(measuredCopy);
      expect(text).not.toContain('Engage with marketing ops');

      // Destroy before reset: the overlay lives on document.body, and a leaked one would
      // let the next case read the previous drawer's text.
      fixture.destroy();
      TestBed.resetTestingModule();
    });

    // The other half of the contract. Identical zero-filled data — only `unavailable`
    // differs — so a guard that over-triggers would hide a genuine measurement.
    it(`${name}: still reports a genuine zero as a measured absence`, async () => {
      const fixture = await render(component, inputs, false);
      // PrimeNG renders the drawer body into an overlay appended to the document, not
      // inside the component's own host element — so read the document.
      const text = document.body.textContent ?? '';

      expect(text).toContain(measuredCopy);
      expect(text).not.toContain(DRAWER_UNAVAILABLE_HEADING);

      // Destroy before reset: the overlay lives on document.body, and a leaked one would
      // let the next case read the previous drawer's text.
      fixture.destroy();
      TestBed.resetTestingModule();
    });
  }
});
