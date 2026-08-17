// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { DRAWER_UNAVAILABLE_HEADING } from '@lfx-one/shared/constants';
import { EngagedCommunitySizeResponse } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { EngagedCommunityDrawerComponent } from '../engaged-community-drawer/engaged-community-drawer.component';

/**
 * The drawer specs prove each drawer honours `unavailable`, and the card specs prove the
 * builder renders an unavailable state on the card. This covers the wiring BETWEEN them —
 * the expression `[unavailable]="!edEvolutionData().engagedCommunity"`, which is what
 * carries a failed response from the parent into the drawer.
 *
 * It is asserted against a host that reproduces that binding rather than against
 * MarketingOverviewComponent itself: that component fans out to 11 analytics endpoints on
 * mount, and a fixture faking all of them ends up testing the fan-out instead of the
 * binding. What matters here is that `!response` is the correct expression — that an
 * undefined response yields `unavailable: true` and a present one yields false. All four
 * failable drawers in the real template use this identical shape.
 */
@Component({
  imports: [EngagedCommunityDrawerComponent],
  template: `<lfx-engaged-community-drawer
    [visible]="true"
    [data]="data()"
    [brandReachData]="brandReach"
    [unavailable]="!response()"></lfx-engaged-community-drawer>`,
})
class BindingHostComponent {
  // Mirrors the parent: `response` is the raw `| undefined` field off EdEvolutionData, and
  // `data` is the drawer-facing computed that substitutes an empty shape for the drawer's
  // non-optional input. The drawer therefore CANNOT infer the failure from `data` alone.
  public readonly response = signal<EngagedCommunitySizeResponse | undefined>(undefined);
  public readonly data = (): EngagedCommunitySizeResponse =>
    this.response() ?? {
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
    };
  public readonly brandReach = {
    totalSocialFollowers: 0,
    totalMonthlySessions: 0,
    activePlatforms: 0,
    changePercentage: 0,
    sessionMomChangePct: 0,
    trend: 'up' as const,
    socialPlatforms: [],
    websiteDomains: [],
    weeklyTrend: [],
  };
}

describe('Marketing Overview — the unavailable binding carries a failed response to the drawer', () => {
  async function render(response: EngagedCommunitySizeResponse | undefined): Promise<string> {
    await TestBed.configureTestingModule({
      imports: [BindingHostComponent],
      providers: [provideNoopAnimations(), provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(BindingHostComponent);
    fixture.componentInstance.response.set(response);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The drawer renders into an overlay on document.body, not the host element.
    const text = document.body.textContent ?? '';
    fixture.destroy();
    TestBed.resetTestingModule();
    return text;
  }

  it('an undefined response makes the drawer report unavailable', async () => {
    expect(await render(undefined)).toContain(DRAWER_UNAVAILABLE_HEADING);
  });

  // The other half: a foundation that genuinely has zero engagement must still read as a
  // measurement, or the binding would report every empty foundation as an outage.
  it('a present all-zero response still reads as a measured absence', async () => {
    const measured = await render({
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
    });

    expect(measured).toContain('No community engagement activity detected');
    expect(measured).not.toContain(DRAWER_UNAVAILABLE_HEADING);
  });
});
