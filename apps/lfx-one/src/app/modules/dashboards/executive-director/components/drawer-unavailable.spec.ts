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
import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BrandHealthDrawerComponent } from './brand-health-drawer/brand-health-drawer.component';
import { EmailCtrDrawerComponent } from './email-ctr-drawer/email-ctr-drawer.component';
import { EngagedCommunityDrawerComponent } from './engaged-community-drawer/engaged-community-drawer.component';
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
  const drawers: { name: string; component: Type<unknown>; inputs: Record<string, unknown>; measuredCopy: string }[] = [
    {
      name: 'Sentiment',
      component: BrandHealthDrawerComponent,
      measuredCopy: 'No brand mention activity detected',
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
    },
    {
      name: 'Retention',
      component: MemberRetentionDrawerComponent,
      measuredCopy: 'No retention activity detected',
      inputs: {
        data: { renewalRate: 0, netRevenueRetention: 0, changePercentage: 0, trend: 'up', target: 0, monthlyData: [] },
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

  // The Email drawer is the only one that fetches its own data, so its failure arrives
  // through catchError rather than a parent input — a distinct path that the cases above
  // cannot reach. Its catchError resolves to a zero-filled default, which is exactly what
  // used to render "No email activity detected" for a failed request.
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
