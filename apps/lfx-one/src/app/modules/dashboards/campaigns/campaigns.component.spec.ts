// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignDeliveryType, CampaignTab } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { CampaignsComponent } from './campaigns.component';

/**
 * The Email delivery channel differs from Paid Marketing in ways that are invisible to the type
 * system: a missing tab, a separate tab signal, a separate brief. Each is one line away from
 * silently regressing into the paid behaviour, so each gets an assertion.
 */
describe('CampaignsComponent — email delivery channel', () => {
  let fixture: ComponentFixture<CampaignsComponent>;

  // The component's members are protected; the tests reach them through one narrow cast rather
  // than exercising the DOM, because what is being pinned is the state machine, not the markup.
  interface Internals {
    selectedDeliveryType: () => CampaignDeliveryType;
    selectedTab: { (): CampaignTab; set(v: CampaignTab): void };
    selectedEmailTab: { (): CampaignTab; set(v: CampaignTab): void };
    briefOutput: () => CampaignBriefOutput | null;
    emailBriefOutput: () => CampaignBriefOutput | null;
    visibleTabs: () => readonly { id: CampaignTab }[];
    selectTab(tab: CampaignTab): void;
    onTabKeydown(event: KeyboardEvent, index: number): void;
    onProceedToImplementation(brief: CampaignBriefOutput): void;
    onEmailProceedToImplementation(brief: CampaignBriefOutput): void;
    selectorForm: { controls: { deliveryType: { setValue(v: CampaignDeliveryType): void } } };
  }

  const internals = (): Internals => fixture.componentInstance as unknown as Internals;

  const selectEmail = (): void => {
    internals().selectorForm.controls.deliveryType.setValue('email');
    fixture.detectChanges();
  };

  const exampleBrief = { eventDetails: { name: 'KubeCon', slug: 'kubecon' } } as CampaignBriefOutput;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(CampaignsComponent);
    fixture.detectChanges();
  });

  it('offers Optimize on paid marketing but not on email', () => {
    expect(
      internals()
        .visibleTabs()
        .map((t) => t.id)
    ).toContain('optimization');

    selectEmail();

    // Not a "coming soon" omission: HubSpotDispatcher implements no StatusToggler because
    // staging produces a draft a human sends, so there is nothing running to pause. Offering
    // the tab would promise an action the service answers with 400.
    expect(
      internals()
        .visibleTabs()
        .map((t) => t.id)
    ).not.toContain('optimization');
    expect(
      internals()
        .visibleTabs()
        .map((t) => t.id)
    ).toEqual(['planning', 'implementation', 'insights']);
  });

  it('keeps each delivery type on its own tab across a round-trip', () => {
    internals().selectTab('insights');
    expect(internals().selectedTab()).toBe('insights');

    selectEmail();
    // Email opens on its own tab rather than inheriting the paid side's.
    expect(internals().selectedEmailTab()).toBe('planning');

    internals().selectTab('implementation');
    expect(internals().selectedEmailTab()).toBe('implementation');
    // The paid side is untouched — both containers stay mounted, so its tab component and all
    // its local state survive the trip.
    expect(internals().selectedTab()).toBe('insights');

    internals().selectorForm.controls.deliveryType.setValue('paid-marketing');
    fixture.detectChanges();
    expect(internals().selectedTab()).toBe('insights');
  });

  /**
   * Regression: keyboard navigation is bounded by the VISIBLE tabs.
   *
   * Wrapping modulo the full four-tab list would step ArrowRight off the end of the email
   * tablist onto an index with no button — selecting a tab this side does not render, and
   * focusing nothing.
   */
  it('wraps arrow-key navigation within the email tab set', () => {
    selectEmail();
    internals().selectTab('insights'); // the last visible email tab, index 2

    internals().onTabKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), 2);

    expect(internals().selectedEmailTab()).toBe('planning');
  });

  it('does not let one delivery type receive the other approved brief', () => {
    internals().onProceedToImplementation(exampleBrief);
    expect(internals().briefOutput()).toEqual(exampleBrief);
    expect(internals().emailBriefOutput()).toBeNull();

    const emailBrief = { eventDetails: { name: 'Open Source Summit', slug: 'oss' } } as CampaignBriefOutput;
    internals().onEmailProceedToImplementation(emailBrief);

    expect(internals().emailBriefOutput()).toEqual(emailBrief);
    // Still the paid brief: a shared signal here would show an email brief under Paid
    // Marketing's Implement tab after a round-trip.
    expect(internals().briefOutput()).toEqual(exampleBrief);
  });
});
