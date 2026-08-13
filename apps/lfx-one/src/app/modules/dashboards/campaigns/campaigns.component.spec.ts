// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Signal, WritableSignal } from '@angular/core';
import type { CampaignBriefOutput, CampaignDeliveryType, CampaignProgramType, CampaignTab, CampaignTabOption } from '@lfx-one/shared/interfaces';
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
  // Reuses the real `CampaignTabOption` and `WritableSignal` rather than hand-rolled shapes, so
  // a retype on the component is at least a type error here instead of a silently-passing test
  // against a shape that no longer exists. The cast still cannot catch a RENAME — that is the
  // cost of reaching protected members, and the reason the assertions below stay behavioural.
  interface Internals {
    selectedDeliveryType: Signal<CampaignDeliveryType>;
    selectedTab: WritableSignal<CampaignTab>;
    selectedEmailTab: WritableSignal<Exclude<CampaignTab, 'optimization'>>;
    briefOutput: WritableSignal<CampaignBriefOutput | null>;
    emailBriefOutput: WritableSignal<CampaignBriefOutput | null>;
    emailTabs: readonly CampaignTabOption[];
    tabs: readonly CampaignTabOption[];
    isEmail: Signal<boolean>;
    selectTab(tab: CampaignTab, owner: CampaignDeliveryType): void;
    onTabKeydown(event: KeyboardEvent, index: number, owner: CampaignDeliveryType): void;
    onProceedToImplementation(brief: CampaignBriefOutput): void;
    onEmailProceedToImplementation(brief: CampaignBriefOutput): void;
    selectorForm: {
      controls: {
        deliveryType: { setValue(v: CampaignDeliveryType): void };
        programType: { setValue(v: CampaignProgramType): void };
      };
    };
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

  it('offers Optimize on paid marketing but not on email, regardless of which is active', () => {
    // Asserted WITHOUT switching delivery type first, which is the point. Both containers are
    // mounted, so each tablist's list has to be correct at all times — an earlier version keyed
    // this on the ACTIVE delivery type, which left the hidden email tablist rendering the
    // unfiltered four (Optimize included) whenever paid was on screen.
    expect(internals().tabs.map((t) => t.id)).toContain('optimization');

    // Not a "coming soon" omission: HubSpotDispatcher implements no StatusToggler because
    // staging produces a draft a human sends, so there is nothing running to pause. The tab
    // would surface a Pause/Resume the service answers with 400 (`ErrToggleUnsupported`), over
    // keyword and metrics data that is not this channel's to begin with.
    expect(internals().emailTabs.map((t) => t.id)).toEqual(['planning', 'implementation', 'insights']);

    selectEmail();

    // Unchanged by the switch — that is what "per-container" means.
    expect(internals().emailTabs.map((t) => t.id)).not.toContain('optimization');
    expect(internals().tabs.map((t) => t.id)).toContain('optimization');
  });

  /**
   * Regression: the hidden tablist must not write the visible side's tab.
   *
   * Both containers stay mounted, so the hidden one's buttons still dispatch. A handler that
   * inferred its target from `selectedDeliveryType()` would route the hidden email tablist's
   * click into the PAID signal. `display:none` keeps that out of reach of a pointer or Tab
   * press, but not of a programmatic `.click()` — which is what an E2E locator resolving a
   * duplicated testid performs.
   */
  it('routes a tab selection to the container that owns it, not the visible one', () => {
    // Paid is active; the email tablist is mounted but hidden.
    internals().selectTab('implementation', 'email');

    expect(internals().selectedEmailTab()).toBe('implementation');
    expect(internals().selectedTab()).toBe('planning');
  });

  it('keeps each delivery type on its own tab across a round-trip', () => {
    internals().selectTab('insights', 'paid-marketing');
    expect(internals().selectedTab()).toBe('insights');

    selectEmail();
    // Email opens on its own tab rather than inheriting the paid side's.
    expect(internals().selectedEmailTab()).toBe('planning');

    internals().selectTab('implementation', 'email');
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
    internals().selectTab('insights', 'email'); // the last email tab, index 2

    internals().onTabKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), 2, 'email');

    expect(internals().selectedEmailTab()).toBe('planning');
  });

  /**
   * The PAID side of the same handler, which the email case above does not cover.
   *
   * `onTabKeydown` picks its bounding list from `owner`, so the two sides share one code path and
   * differ only in list length — paid has four tabs including `optimization`, email has three.
   * A change to the shared bounds could break paid navigation while the email test stays green,
   * which is precisely the regression the `owner` parameter exists to prevent. Proving it on one
   * side only left that guarantee half-tested.
   */
  it('lands End on the last PAID tab, not the last email one', () => {
    internals().selectTab('planning', 'paid-marketing');

    internals().onTabKeydown(new KeyboardEvent('keydown', { key: 'End' }), 3, 'paid-marketing');

    // `optimization` is paid-only. Bounded on the email list this would be `insights`, so the
    // assertion distinguishes the two lists rather than merely exercising End.
    expect(internals().selectedTab()).toBe('optimization');
  });

  it('wraps ArrowLeft backwards within the email tab set', () => {
    selectEmail();
    internals().selectTab('planning', 'email'); // first email tab, index 0

    internals().onTabKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }), 0, 'email');

    // Backwards off index 0 wraps to the LAST email tab. Modulo the four-tab paid list it would
    // land on `optimization`, which this side does not render.
    expect(internals().selectedEmailTab()).toBe('insights');
  });

  /**
   * A program switch discards BOTH sides' briefs.
   *
   * The brief is program-specific — the URL scrape and generated copy differ between Events and
   * Education — and both containers stay mounted, so resetting only the visible one leaves a
   * stale Events brief on the other side, ready to be handed to Implement on the next delivery
   * switch. The email panel renders a placeholder today, which is precisely why this would go
   * unnoticed until the real staging form lands.
   */
  it('clears both delivery types when the program changes', () => {
    const emailBrief = { eventDetails: { name: 'KubeCon', slug: 'kubecon' } } as CampaignBriefOutput;
    internals().onProceedToImplementation(exampleBrief);
    internals().onEmailProceedToImplementation(emailBrief);
    expect(internals().briefOutput()).not.toBeNull();
    expect(internals().emailBriefOutput()).not.toBeNull();

    internals().selectorForm.controls.programType.setValue('education');
    fixture.detectChanges();

    expect(internals().briefOutput()).toBeNull();
    expect(internals().selectedTab()).toBe('planning');
    expect(internals().emailBriefOutput()).toBeNull();
    expect(internals().selectedEmailTab()).toBe('planning');
  });

  it('does not claim a brief is ready when none has been generated', () => {
    // The Implement tab is directly clickable — no disabled binding — so this panel is reachable
    // before anything has been generated, and "Your brief is ready" is then simply false, told to
    // someone who has not started. The rest of the panel explains what is missing from the
    // channel, which is true either way.
    internals().selectorForm.controls.deliveryType.setValue('email');
    internals().selectTab('implementation', 'email');
    fixture.detectChanges();

    const pending = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-implementation-pending"]');
    expect(pending, 'the pending panel must render').not.toBeNull();
    expect(pending?.textContent).not.toContain('Your brief is ready');
    expect(pending?.textContent).toContain('Staging an email clones');

    internals().onEmailProceedToImplementation({ eventDetails: { name: 'KubeCon', slug: 'kubecon' } } as CampaignBriefOutput);
    internals().selectTab('implementation', 'email');
    fixture.detectChanges();

    const withBrief = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-implementation-pending"]');
    expect(withBrief?.textContent).toContain('Your brief is ready');
    // The two sentences must stay separated — a review round raised `preserveWhitespaces: false`
    // collapsing the separator between the `@if` block and the following text into
    // `ready.Staging`.
    //
    // It does not happen: Angular keeps a space at that boundary. Stated plainly, this assertion
    // was NOT binding as originally written (`not.toContain('ready.Staging')`) — the compiler
    // normalizes the join either way, so it could not fail. In a suite whose whole purpose is
    // pinning behaviours one line away from silently regressing, an unfailable assertion is worse
    // than none: the next person copies it believing the separation is protected. Asserting the
    // separator POSITIVELY does bind.
    expect(withBrief?.textContent).toMatch(/ready\.\s+Staging an email/);
  });

  /**
   * LFXV2-3202: leaving the Plan tab must not DESTROY the planner.
   *
   * `PlanningTabComponent` owns ~20 signals locally — the generated brief, the edited RSA copy,
   * the resolved HubSpot UTM, the keyword list — and none of it is lifted to this component. A
   * structural `@switch` therefore threw all of it away the moment the user looked at another
   * tab, and a brief is a slow, non-deterministic AI generation: it cannot be reproduced by
   * re-running it. The panel is now visibility-toggled instead, the same treatment the two
   * delivery-type containers already had for the same reason.
   *
   * Asserted on the DOM rather than the tab signal, because the tab signal was never the bug —
   * it changed correctly both before and after this fix.
   */
  const planningHost = (testid: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);

  it('keeps the paid planner mounted when the user moves to another tab', () => {
    const before = planningHost('campaigns-planning-tab');
    expect(before).not.toBeNull();

    internals().selectTab('insights', 'paid-marketing');
    fixture.detectChanges();

    const after = planningHost('campaigns-planning-tab');
    // The SAME element instance, not merely a present one: a re-created component would satisfy
    // a null check while still having lost every signal it held.
    expect(after).toBe(before);
    expect(planningHost('campaigns-planning-panel')?.style.display).toBe('none');

    internals().selectTab('planning', 'paid-marketing');
    fixture.detectChanges();

    expect(planningHost('campaigns-planning-tab')).toBe(before);
    expect(planningHost('campaigns-planning-panel')?.style.display).toBe('');
  });

  it('keeps the email planner mounted when the user moves to another tab', () => {
    selectEmail();
    const before = planningHost('campaigns-email-planning-tab');
    expect(before).not.toBeNull();

    internals().selectTab('implementation', 'email');
    fixture.detectChanges();

    expect(planningHost('campaigns-email-planning-tab')).toBe(before);
    expect(planningHost('campaigns-email-planning-panel')?.style.display).toBe('none');
  });

  it('still mounts the fetch-on-init tabs lazily', () => {
    // The counterpart constraint, and the reason only Planning was hoisted out of the @switch.
    // Implementation, Insights and Optimization all fetch in `ngOnInit` — metrics reads and
    // LinkedIn account lookups — so mounting them eagerly would issue network calls for tabs the
    // user may never open, on every page load. Hoisting all four would trade one bug for a cost
    // regression, so this pins that they are still swapped rather than merely hidden.
    //
    // Asserted on the PANEL ids: `campaigns-insights-tab` is carried by both the nav button and
    // the panel's component, so it cannot distinguish "mounted" from "there is a button for it".
    expect(planningHost('campaigns-insights-panel')).toBeNull();
    expect(planningHost('campaigns-optimization-panel')).toBeNull();

    internals().selectTab('insights', 'paid-marketing');
    fixture.detectChanges();

    expect(planningHost('campaigns-insights-panel')).not.toBeNull();
    // Swapped, not stacked: the previous panel is gone from the DOM rather than hidden.
    expect(planningHost('campaigns-optimization-panel')).toBeNull();
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
