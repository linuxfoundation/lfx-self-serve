// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { Signal, WritableSignal } from '@angular/core';
import type {
  AudienceComposedList,
  AudienceComposeUnattachedEvent,
  CampaignAudience,
  EmailBriefCopy,
  CampaignBriefOutput,
  CampaignBriefPersistResult,
  CampaignDeliveryType,
  CampaignEventSponsor,
  CampaignJobOutcome,
  CampaignProgramType,
  CampaignTab,
  CampaignTabOption,
} from '@lfx-one/shared/interfaces';
import { provideRouter } from '@angular/router';
import { CampaignService } from '@services/campaign.service';
import { PersonaService } from '@services/persona.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { CampaignsComponent } from './campaigns.component';
import { seedSelectedFoundation, STATE_ONLY, campaignsComponentUnderTest, trackStateOnlyTests } from './campaigns.spec-helper';
import { AudienceBuilderTabComponent } from './components/audience-builder-tab/audience-builder-tab.component';

seedSelectedFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' });
trackStateOnlyTests();

describe('CampaignsComponent — email delivery channel', () => {
  let fixture: ComponentFixture<CampaignsComponent>;

  // The component's members are protected; the tests reach them through one narrow cast rather
  // than exercising the DOM, because what is being pinned is the state machine, not the markup.
  // Reuses the real `CampaignTabOption` and `WritableSignal` rather than hand-rolled shapes, so
  // a retype on the component is at least a type error here instead of a silently-passing test
  // against a shape that no longer exists. The cast still cannot catch a RENAME — that is the
  // cost of reaching protected members, and the reason the assertions below stay behavioral.
  interface Internals {
    /** The rows the picker draws, after type ranking and the render cap. */
    emailTemplatesRendered: Signal<{ id: string }[]>;
    emailTemplatesRenderCapMessage: Signal<string>;
    emailTemplates: WritableSignal<unknown[] | null>;
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
    onEmailProceedFromPlanning(brief: CampaignBriefOutput): void;
    selectedEmailTemplateId: WritableSignal<string>;
    selectedEmailTypeId: WritableSignal<string>;
    emailCopy: WritableSignal<EmailBriefCopy | null>;
    emailCtaDestination: Signal<string>;
    generatedDestinations: Signal<string[]>;
    emailBodyHtmlPreview: Signal<string>;
    emailCtaUnlinkedLabel: Signal<string>;
    emailHeroImageHost: Signal<string>;
    emailAudience: WritableSignal<CampaignAudience | null>;
    emailBriefId: WritableSignal<string>;
    emailAudienceOrigin: WritableSignal<'composed' | 'restored' | null>;
    emailAudienceUnattached: Signal<AudienceComposedList | null>;
    activeFoundationSlug: Signal<string>;
    emailAudienceScope: Signal<number>;
    emailAudienceReadUnavailable: Signal<boolean>;
    emailAudienceReadPending: Signal<boolean>;
    emailBriefResolving: Signal<boolean>;
    emailAudienceSkipped: WritableSignal<boolean>;
    emailAudienceReadFailed: WritableSignal<boolean>;
    onSkipAudienceStep(): void;
    onContinueToEmailStep(): void;
    onGoToAudienceStep(): void;
    onAudienceComposed(audience: CampaignAudience): void;
    onAudienceComposeUnattached(event: AudienceComposeUnattachedEvent): void;
    restoreEmailAudience(projectSlug: string, briefId: string): Promise<void>;
    resetEmailBriefDerivedState(): void;
    emailCopyState: WritableSignal<'idle' | 'generating' | 'error'>;
    emailCopyError: WritableSignal<string>;
    canGenerateEmailCopy: Signal<boolean>;
    onGenerateEmailCopy(): Promise<void>;
    emailStaging: WritableSignal<'idle' | 'staging' | 'done' | 'error'>;
    emailStagingMessage: WritableSignal<string>;
    emailStagingDraftUrl: Signal<string>;
    emailStagingWarnings: Signal<readonly string[]>;
    canStageEmail: Signal<boolean>;
    onStageEmailSend(): Promise<void>;
    // Read-only now: the form is the source of truth and these derive from it, so a test
    // drives `abTestForm` (the same path the bound control uses) rather than the signal.
    abTestEnabled: Signal<boolean>;
    abTestSubjectB: Signal<string>;
    abTestBodyHtmlB: Signal<string>;
    abTestBodyHtmlBPreview: Signal<string>;
    abTestPreheaderBForSend: Signal<string>;
    abTestBodyHtmlBForSend: Signal<string>;
    emailBodyHtmlForSend: Signal<string>;
    abTestPreheaderBPreview: Signal<string>;
    emailPreheaderPreview: Signal<string>;
    abTestForm: {
      controls: {
        // `value` as well as `setValue`: asserting the CONTROL is what catches a stale write
        // that lands outside change detection, which the `toSignal` mirrors miss.
        enabled: { setValue(v: boolean): void; value: boolean };
        subjectB: { setValue(v: string): void; value: string };
        preheaderB: { setValue(v: string): void; value: string };
        bodyHtmlB: { setValue(v: string): void; value: string };
      };
    };
    abTestCopyState: WritableSignal<'idle' | 'generating' | 'error'>;
    abTestCopyError: WritableSignal<string>;
    canGenerateAbTestCopy: Signal<boolean>;
    selectedEmailStage: Signal<string>;
    selectedEmailSegment: Signal<string | undefined>;
    emailCtaIsStageable: Signal<boolean>;
    emailCtaLabel: Signal<string>;
    emailHeroImageUrl: Signal<string>;
    emailHeroPreviewUrl: Signal<string>;
    emailRegistrationUrl: Signal<string>;
    emailSponsors: Signal<CampaignEventSponsor[]>;
    emailBodyIsStageable: Signal<boolean>;
    abTestIsStageable: Signal<boolean>;
    onGenerateAbTestCopy(): Promise<void>;
    selectorForm: {
      controls: {
        deliveryType: { setValue(v: CampaignDeliveryType): void };
        programType: { setValue(v: CampaignProgramType): void };
        emailType: { disabled: boolean; value: string };
        emailSegment: { disabled: boolean; setValue(v: string): void };
      };
    };
    emailAudienceWriteInFlight: WritableSignal<boolean>;
    emailStagingUnresolved: Signal<boolean>;
    emailStagingHeld: Signal<boolean>;
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
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(campaignsComponentUnderTest());
    TestBed.inject(PersonaService).currentPersona.set('executive-director');
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
    // Audience sits second, between naming the campaign and implementing it: the master list has
    // to exist before the send can be staged against it.
    expect(internals().emailTabs.map((t) => t.id)).toEqual(['planning', 'audience', 'implementation', 'insights']);

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
  it('routes a tab selection to the container that owns it, not the visible one', STATE_ONLY, () => {
    // Paid is active; the email tablist is mounted but hidden.
    internals().selectTab('implementation', 'email');

    expect(internals().selectedEmailTab()).toBe('implementation');
    expect(internals().selectedTab()).toBe('planning');
  });

  it('keeps each delivery type on its own tab across a round-trip', STATE_ONLY, () => {
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
   * Wrapping modulo the PAID list would step ArrowRight off the end of the email tablist onto an
   * index with no button — selecting a tab this side does not render, and focusing nothing. The
   * two lists are the same length today, so the bound is also checked from the far end below.
   */
  it('wraps arrow-key navigation within the email tab set', () => {
    selectEmail();
    internals().selectTab('insights', 'email'); // the last email tab, index 3

    internals().onTabKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), 3, 'email');

    expect(internals().selectedEmailTab()).toBe('planning');
  });

  it("steps into Audience as the email tablist's second tab", () => {
    // The panel is always mounted, so a tab id that never becomes selectable would leave a
    // rendered-but-unreachable section rather than an obvious failure.
    selectEmail();
    internals().selectTab('planning', 'email');

    internals().onTabKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), 0, 'email');

    expect(internals().selectedEmailTab()).toBe('audience');
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
  it('clears both delivery types when the program changes', STATE_ONLY, () => {
    const emailBrief = { eventDetails: { name: 'KubeCon', slug: 'kubecon' } } as CampaignBriefOutput;
    internals().onProceedToImplementation(exampleBrief);
    internals().onEmailProceedFromPlanning(emailBrief);
    expect(internals().briefOutput()).not.toBeNull();
    expect(internals().emailBriefOutput()).not.toBeNull();

    internals().selectorForm.controls.programType.setValue('education');
    fixture.detectChanges();

    expect(internals().briefOutput()).toBeNull();
    expect(internals().selectedTab()).toBe('planning');
    expect(internals().emailBriefOutput()).toBeNull();
    expect(internals().selectedEmailTab()).toBe('planning');
  });

  it('renders the template picker rather than a not-wired-up notice', () => {
    // REPLACES a test that pinned the old pending panel ("Email staging is not wired up yet" /
    // "Staging an email clones ... an endpoint that is still in review"). That copy was false by
    // the time it was read: /hubspot/emails has been live on main since #1439, and the config
    // builder since #1546. LFXV2-3198 is what removes it.
    //
    // The original test's real concern survives here: the Implement tab is directly clickable, so
    // this panel is reachable before anything has been generated, and it must not claim progress
    // the user has not made. The picker states nothing about the brief at all, which is the
    // strongest form of not-lying available.
    internals().selectorForm.controls.deliveryType.setValue('email');
    internals().selectTab('implementation', 'email');
    fixture.detectChanges();

    const panel = fixture.nativeElement as HTMLElement;
    expect(panel.querySelector('[data-testid="campaigns-email-implementation"]'), 'the picker must render').not.toBeNull();
    expect(panel.querySelector('[data-testid="campaigns-email-implementation-pending"]'), 'the stale pending panel must be gone').toBeNull();
    expect(panel.textContent).not.toContain('not wired up yet');
    expect(panel.textContent).not.toContain('still in review');
    expect(panel.textContent).not.toContain('Your brief is ready');
  });

  // `fixture.nativeElement` is typed `any`, so without the cast the annotation below would be
  // ASSERTED rather than checked — `.style.display` would still compile if it were wrong.
  // Matches the sibling helper and the pre-existing call sites in this file.
  const byTestId = (testid: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`);

  /**
   * The planner's rendered HOST ELEMENT, scoped to its delivery container.
   *
   * Two earlier revisions of this helper were wrong in ways that made these tests pass against
   * the pre-fix template, and both are worth recording because each looks correct:
   *
   * 1. It queried the whole fixture. Both delivery containers are always mounted, so an
   *    unscoped search for `campaigns-planning-tab` also reaches the EMAIL planner — and when
   *    the paid one was destroyed, the query silently returned the email one, so `before` and
   *    `after` matched for a planner that had never been at risk. Hence the container scope.
   * 2. It used `debugElement.query`, which walks Angular's LOGICAL tree and still resolves a
   *    debug node for a component whose element has left the rendered DOM. Verified with a
   *    probe: the panel was gone from `querySelector` while the instance comparison still
   *    passed. `querySelector` is the only view that forgets a destroyed node, so it is the
   *    one that can bind.
   *
   * Comparing the host ELEMENT rather than the panel's display is aimed at a hole the panel
   * assertion alone leaves open: a change that kept the wrapper mounted while recreating
   * `lfx-planning-tab` inside it would reintroduce the state loss this PR fixes, and a display
   * check could not see it.
   *
   * **Honest limit, and it survived two reviewers arguing the opposite — so it is stated as an
   * OBSERVATION, not a mechanism.** These tests are revert-verified against the shape the bug
   * actually had (the panel back inside the `@switch`), and each side fails only its own test.
   * They are NOT verified against the narrower wrapper-kept/planner-recreated shape.
   *
   * Substituting `@if (selectedTab() === 'planning')` on `lfx-planning-tab` — both wrapping the
   * `@for` and nested inside it — leaves the suite green. An instrumented probe at the hidden
   * assertion printed `tab=insights` with the planner element still present, so the element was
   * genuinely not removed at the point the test looks. Do not infer a general rule about `@if`
   * timing from that: the sibling `still mounts the fetch-on-init tabs lazily` test proves one
   * `detectChanges()` DOES remove `@switch`-gated panels in the same pass. Why this particular
   * substitution behaves differently is unresolved, which is exactly why it is recorded as
   * something seen rather than something explained.
   *
   * Pinning that case properly needs a test at the planner's own level, not this one.
   */
  const plannerElement = (container: 'campaigns-paid-marketing' | 'campaigns-email', testid: string): HTMLElement | null =>
    // querySelector, NOT debugElement.query: the rendered DOM is the only view that forgets a
    // destroyed node. Scoped to the container because both are always mounted.
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${container}"] [data-testid="${testid}"]`) ?? null;

  /**
   * LFXV2-3202: leaving the Plan tab must not DESTROY the planner.
   *
   * `PlanningTabComponent` owns its state locally — the generated brief, the edited RSA copy, the
   * resolved HubSpot UTM, the keyword list — and none of it is lifted to this component. A
   * structural `@switch` therefore threw all of it away the moment the user looked at another
   * tab, and a brief is a slow, non-deterministic AI generation: it cannot be reproduced by
   * re-running it. The panel is now visibility-toggled instead, the same treatment the two
   * delivery-type containers already had for the same reason.
   *
   * Asserted on the DOM rather than the tab signal, because the tab signal was never the bug —
   * it changed correctly both before and after this fix.
   */
  it('keeps the paid planner mounted when the user moves to another tab', () => {
    const before = plannerElement('campaigns-paid-marketing', 'campaigns-planning-tab');
    expect(before).not.toBeNull();

    internals().selectTab('insights', 'paid-marketing');
    fixture.detectChanges();

    // Still RENDERED while hidden, and the SAME node — hidden rather than swapped for a fresh
    // one, which would have taken every signal it owned with it.
    const whileHidden = plannerElement('campaigns-paid-marketing', 'campaigns-planning-tab');
    expect(whileHidden).not.toBeNull();
    expect(whileHidden).toBe(before);
    expect(byTestId('campaigns-planning-panel')?.style.display).toBe('none');

    internals().selectTab('planning', 'paid-marketing');
    fixture.detectChanges();

    expect(plannerElement('campaigns-paid-marketing', 'campaigns-planning-tab')).toBe(before);
    expect(byTestId('campaigns-planning-panel')?.style.display).not.toBe('none');
  });

  it('keeps the email planner mounted when the user moves to another tab', () => {
    selectEmail();
    const before = plannerElement('campaigns-email', 'campaigns-email-planning-tab');
    expect(before).not.toBeNull();

    internals().selectTab('implementation', 'email');
    fixture.detectChanges();

    expect(plannerElement('campaigns-email', 'campaigns-email-planning-tab')).toBe(before);
    expect(byTestId('campaigns-email-planning-panel')?.style.display).toBe('none');

    // The return leg, which the paid test above also covers. Without it, a binding typo that
    // hid the email panel PERMANENTLY once left would still pass.
    internals().selectTab('planning', 'email');
    fixture.detectChanges();

    expect(plannerElement('campaigns-email', 'campaigns-email-planning-tab')).toBe(before);
    expect(byTestId('campaigns-email-planning-panel')?.style.display).not.toBe('none');
  });

  it('gives the Survey surface a fresh planner, so the Email brief cannot be proceeded onto it', () => {
    selectEmail();
    // The component host itself: a tab button shares the planner's test id.
    const planner = (): Element | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email"] lfx-planning-tab');
    const before = planner();
    expect(before).not.toBeNull();

    internals().selectorForm.controls.deliveryType.setValue('survey');
    fixture.detectChanges();

    const after = planner();
    expect(after).not.toBeNull();
    expect(after, 'a surface switch recreates the planner').not.toBe(before);
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
    //
    // Implementation is named explicitly because it is the costliest of the three to mount
    // eagerly — its own ngOnInit resolves ad-account lists — and it was the one an earlier
    // revision of this test left unasserted.
    expect(byTestId('campaigns-implementation-panel')).toBeNull();
    expect(byTestId('campaigns-insights-panel')).toBeNull();
    expect(byTestId('campaigns-optimization-panel')).toBeNull();

    internals().selectTab('insights', 'paid-marketing');
    fixture.detectChanges();

    expect(byTestId('campaigns-insights-panel')).not.toBeNull();
    // Swapped, not stacked: the previous panel is gone from the DOM rather than hidden.
    expect(byTestId('campaigns-optimization-panel')).toBeNull();
    expect(byTestId('campaigns-implementation-panel')).toBeNull();

    // And still REACHABLE. Asserting only that the lazy panels are absent leaves the other
    // direction unpinned: a typo'd `@case ('implementation')` would make the tab permanently
    // blank while every absence assertion above stayed green.
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();

    expect(byTestId('campaigns-implementation-panel')).not.toBeNull();
    expect(byTestId('campaigns-insights-panel')).toBeNull();
  });

  it('still mounts the EMAIL non-planning panels lazily', () => {
    // The email container is where this is most likely to be "tidied" away, because its
    // remaining panels are cheap static placeholders today rather than fetch-on-init
    // components. They stay in the @switch so both containers keep the same structure, and
    // so the paid side's carve-out is not re-litigated one container over.
    selectEmail();

    expect(byTestId('campaigns-email-implementation-panel')).toBeNull();
    expect(byTestId('campaigns-email-insights-panel')).toBeNull();

    internals().selectTab('implementation', 'email');
    fixture.detectChanges();

    expect(byTestId('campaigns-email-implementation-panel')).not.toBeNull();
    expect(byTestId('campaigns-email-insights-panel')).toBeNull();
  });

  it('does not let one delivery type receive the other approved brief', STATE_ONLY, () => {
    internals().onProceedToImplementation(exampleBrief);
    expect(internals().briefOutput()).toEqual(exampleBrief);
    expect(internals().emailBriefOutput()).toBeNull();

    const emailBrief = { eventDetails: { name: 'Open Source Summit', slug: 'oss' } } as CampaignBriefOutput;
    internals().onEmailProceedFromPlanning(emailBrief);

    expect(internals().emailBriefOutput()).toEqual(emailBrief);
    // Still the paid brief: a shared signal here would show an email brief under Paid
    // Marketing's Implement tab after a round-trip.
    expect(internals().briefOutput()).toEqual(exampleBrief);
  });

  describe('email content generation (LFXV2-2775 proxy)', () => {
    const emailBrief = {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'https://x.example/' },
    } as unknown as CampaignBriefOutput;

    const copy = { subject: 'Three days in Amsterdam', preheader: 'Sessions and labs', body: '<p>Hello</p>', cta: 'Register', ctaUrl: '' };

    let persist: Mock;

    beforeEach(() => {
      persist = vi.fn().mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(persist);
    });

    it('treats the audience as unknown while the warm-up persist is in flight', async () => {
      // A re-proceed resolves the SAME brief, whose audience is read back only once the id lands.
      // Composing in that window raced the read and could leave staging pointed at the old list.
      const slow = new Subject<CampaignBriefPersistResult>();
      persist.mockReturnValue(slow.asObservable());
      vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [] }));
      selectEmail();
      internals().onEmailProceedFromPlanning(emailBrief);

      expect(internals().emailBriefResolving(), 'compose was open while the brief id was still resolving').toBe(true);
      // The CHILD must see it: the signal alone passed with the binding to the Audience tab removed.
      fixture.detectChanges();
      const tab = fixture.debugElement.query(By.directive(AudienceBuilderTabComponent)).componentInstance as AudienceBuilderTabComponent;
      expect(tab.audienceReadPending(), 'the Audience tab was not told the audience is unknown').toBe(true);

      slow.next({ status: 'saved', approved: true, briefId: 'brief-77', etag: null } as unknown as CampaignBriefPersistResult);
      slow.complete();
      await fixture.whenStable();
      // The warm-up settles through several promise hops (persist, then the read it triggers).
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(internals().emailBriefResolving()).toBe(false);
    });

    it("does not let a superseded warm-up clear the newer one's resolving flag", STATE_ONLY, async () => {
      // Warm-up #1 in flight, a reset, warm-up #2 in flight: #1 settling must not reopen compose
      // while #2's persist is still on the wire.
      const first = new Subject<CampaignBriefPersistResult>();
      const second = new Subject<CampaignBriefPersistResult>();
      persist.mockReturnValueOnce(first.asObservable()).mockReturnValueOnce(second.asObservable());
      vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [] }));
      selectEmail();
      internals().onEmailProceedFromPlanning(emailBrief);
      internals().onEmailProceedFromPlanning(emailBrief);

      first.next({ status: 'saved', approved: true, briefId: 'brief-77', etag: null } as unknown as CampaignBriefPersistResult);
      first.complete();
      await fixture.whenStable();

      expect(internals().emailBriefResolving(), "the superseded warm-up cleared the live one's flag").toBe(true);
      second.complete();
    });

    it('reads the saved audience back when the warm-up resolves a brief id', STATE_ONLY, async () => {
      // Re-proceeding from Plan reset `emailAudience` while the warm-up resolved the SAME brief from
      // the ownership cache, and only a restore read the audience back -- so compose reopened over
      // a brief that already had a master.
      const list = vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [] }));
      selectEmail();
      internals().onEmailProceedFromPlanning(emailBrief);
      await fixture.whenStable();

      expect(list, 'an id landed with no audience known and nothing read it back').toHaveBeenCalledWith(expect.any(String), 'brief-77');
    });

    /**
     * The CTA destination check compares the generated URL against the brief's, with the
     * trailing slash normalized away -- because a model that copies the URL and adds or drops
     * one still addresses the same page, and refusing that would silently drop the button.
     *
     * The normalization must apply to the PATHNAME ONLY. Stripping it from the whole serialized
     * URL also mutates the query and fragment, where a trailing slash is part of the VALUE
     * rather than a path separator -- so a generated `?token=abc/` compared equal to the brief's
     * `?token=abc` and a different destination was accepted.
     *
     * Both directions are covered on purpose: this guard has been wrong by over-denying (the
     * legitimate slash variants) as well as by under-denying, and a test for only one direction
     * passes against the other bug.
     */
    it('accepts only slash variants of the same path, never a different query or fragment', STATE_ONLY, () => {
      selectEmail();

      const withRegistrationUrl = (url: string) =>
        ({ eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: url } }) as unknown as CampaignBriefOutput;

      const cases: { brief: string; generated: string; accepted: boolean; why: string }[] = [
        { brief: 'https://x.example/reg', generated: 'https://x.example/reg/', accepted: true, why: 'a trailing slash on the path is the same page' },
        { brief: 'https://x.example/reg/', generated: 'https://x.example/reg', accepted: true, why: 'and the same in reverse' },
        {
          brief: 'https://x.example/reg?token=abc',
          generated: 'https://x.example/reg?token=abc/',
          accepted: false,
          why: 'a slash inside a query VALUE is a different destination',
        },
        { brief: 'https://x.example/reg#frag', generated: 'https://x.example/reg#frag/', accepted: false, why: 'and the same inside a fragment' },
        { brief: 'https://x.example/reg', generated: 'https://evil.example/phish', accepted: false, why: 'an invented URL must never pass' },
        // The unparseable arm, which is reached routinely rather than defensively: a brief with
        // no usable registrationUrl canonicalises to '', and `new URL('')` throws. No brief
        // destination must mean no button, never "any generated url wins".
        { brief: '', generated: 'https://x.example/reg', accepted: false, why: 'a brief with no registration URL stages no button' },
        { brief: 'not a url', generated: 'https://x.example/reg', accepted: false, why: 'and the same for an unusable one' },
      ];

      for (const { brief, generated, accepted, why } of cases) {
        internals().emailBriefOutput.set(withRegistrationUrl(brief));
        internals().emailCopy.set({ subject: 's', preheader: 'p', body: '<p>b</p>', cta: 'Register', ctaUrl: generated } as unknown as EmailBriefCopy);
        fixture.detectChanges();

        expect(internals().emailCtaDestination() !== '', `${generated} vs ${brief}: ${why}`).toBe(accepted);
      }
    });

    /**
     * A refused CTA destination must not make the call to action VANISH.
     *
     * The server keeps a button's label inline in `body` only when its url is blank, while this
     * component additionally refuses a url that does not canonicalise or does not match the
     * brief's registration URL. A hallucinated destination therefore falls between them: dropped
     * server-side because the url was truthy, refused client-side because it was wrong, and the
     * operator sees no call to action at all with nothing explaining why.
     *
     * Shown as plain text rather than as a button, because a button would promise a link the
     * staged draft will not carry.
     */
    /**
     * The client is the ONLY layer that compares the generator's destination with the brief's.
     * The service has `briefId`, not the brief; the controller trusts `buttonUrl` off the
     * request. So if `generatedDestinations` reads `copy.ctaUrl` raw instead of the validated
     * `emailCtaDestination()`, a model that invents a host whitelists ITS OWN phishing domain
     * and the body anchor pointing there survives into the preview and the staged draft.
     *
     * That is the exact vector this allow-list exists to close, and nothing pinned it.
     */
    /**
     * The three predicates this PR moved off bare `.trim()` / raw-body checks. Each mutation
     * below passed the whole suite before these existed, so the change was unpinned.
     */
    it('folds a refused CTA into BOTH variants, or neither', STATE_ONLY, () => {
      // This flipped twice under review, because two true premises point opposite ways: B has no
      // CTA of its own (its generation discards `cta`/`ctaUrl`), but when the destination is
      // REFUSED no button ships for either variant -- `emailCtaLabel` is '' so `onStageEmailSend`
      // sends no `buttonText`/`buttonUrl` at all. There is no widget to double-render against,
      // and folding into A alone makes B silently drop the call to action.
      //
      // Asserting the two bodies AGREE pins the invariant rather than either half of it.
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailCopy.set({
        subject: 'S',
        preheader: 'P',
        body: '<p>A body</p>',
        cta: 'Register Now',
        // Supplied and refused: not the brief's registrationUrl.
        ctaUrl: 'https://evil.example/phish',
      } as unknown as EmailBriefCopy);
      internals().abTestForm.controls.bodyHtmlB.setValue('<p>B body</p>');
      fixture.detectChanges();

      // No button ships, so nothing could be duplicated.
      expect(internals().emailCtaLabel()).toBe('');
      expect(internals().emailCtaUnlinkedLabel()).toBe('Register Now');

      const aHasLabel = internals().emailBodyHtmlForSend().includes('Register Now');
      const bHasLabel = internals().abTestBodyHtmlBForSend().includes('Register Now');

      expect(aHasLabel).toBe(true);
      expect(bHasLabel).toBe(aHasLabel);
    });

    it('does not fold the refused CTA twice when the server already folded it into B', STATE_ONLY, () => {
      // `emailCtaUnlinkedLabel` gates on variant A's `copy.ctaUrl`, but the fold-back applies to
      // BOTH bodies -- and B comes from its OWN `generateEmailCopy` call. So B's button can be
      // url-LESS (campaign-service folds the label into `body`, `!section.url`) while A's was
      // supplied-and-refused (label non-empty). Appending unconditionally rendered it TWICE.
      //
      // The server writes `<div><strong>{escaped}</strong></div>` and `emailCtaUnlinkedLabel`
      // already sanitizes, so the already-folded fragment is byte-identical to the one appended.
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailCopy.set({
        subject: 'S',
        preheader: 'P',
        body: '<p>A body</p>',
        cta: 'Register Now',
        // Supplied and refused: not the brief's registrationUrl.
        ctaUrl: 'https://evil.example/phish',
      } as unknown as EmailBriefCopy);
      // Exactly what campaign-service.service.ts emits for a destination-less button.
      internals().abTestForm.controls.bodyHtmlB.setValue('<p>B body</p><div><strong>Register Now</strong></div>');
      fixture.detectChanges();

      // The precondition: the fold-back IS armed, so this is not passing by doing nothing.
      expect(internals().emailCtaUnlinkedLabel()).toBe('Register Now');

      const bOut = internals().abTestBodyHtmlBForSend();
      expect(bOut.split('Register Now').length - 1).toBe(1);
    });

    it('does not fold the refused CTA twice after the rich editor rewrites the folded label as a paragraph', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailCopy.set({
        subject: 'S',
        preheader: 'P',
        body: '<p>A body</p>',
        cta: 'Register Now',
        ctaUrl: 'https://evil.example/phish',
      } as unknown as EmailBriefCopy);
      // What the editor writes back once the operator types: `<div>` becomes `<p>`.
      internals().abTestForm.controls.bodyHtmlB.setValue('<p>B body</p><p><strong>Register Now</strong></p>');
      fixture.detectChanges();

      expect(internals().emailCtaUnlinkedLabel()).toBe('Register Now');
      expect(internals().abTestBodyHtmlBForSend().split('Register Now').length - 1).toBe(1);
    });

    it.each([
      // The PROPERTY, not the one example: any label sanitize-html re-serializes differently
      // from `escapeHtml`. 'Register Now' round-trips unchanged, which is exactly why the first
      // version of this guard passed while the bug was still live.
      //
      // `marker` is a stable substring of the label that survives BOTH encodings, so the count
      // measures how many times the call to action appears rather than which encoding won.
      // `<` is excluded: `sanitizeDisplayText` strips it, so such a label never reaches here.
      ['an apostrophe', "Don't Miss Out", 'Don&#39;t Miss Out', 'Miss Out'],
      ['a double quote', 'Say "Hello" Now', 'Say &quot;Hello&quot; Now', 'Now'],
      ['an ampersand', 'Tom & Jerry', 'Tom &amp; Jerry', 'Jerry'],
      ['no entities at all', 'Register Now', 'Register Now', 'Register Now'],
    ])('suppresses the duplicate fold for a label containing %s', STATE_ONLY, (_case, label, serverEncoded, marker) => {
      // `escapeHtml` ENCODES `'` and `"`; sanitize-html DECODES them on output. Comparing the raw
      // fragment against the sanitized body therefore missed, and the CTA doubled.
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailCopy.set({
        subject: 'S',
        preheader: 'P',
        body: '<p>A body</p>',
        cta: label,
        ctaUrl: 'https://evil.example/phish',
      } as unknown as EmailBriefCopy);
      internals().abTestForm.controls.bodyHtmlB.setValue(`<p>B body</p><div><strong>${serverEncoded}</strong></div>`);
      fixture.detectChanges();

      // The fold-back is armed, so a pass cannot come from doing nothing.
      expect(internals().emailCtaUnlinkedLabel()).toBe(label);

      const bOut = internals().abTestBodyHtmlBForSend();
      expect(bOut.split(marker).length - 1).toBe(1);
    });

    it('does not stage modules against a body that sanitizes to nothing', STATE_ONLY, () => {
      // `emailBodyIsStageable` judges the SANITIZED body. A tracking-pixel-only payload is
      // non-empty as raw HTML and empty once stripped, so the raw check staged hero/button/
      // sponsor modules against a body that ships as nothing.
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailCopy.set({
        subject: 'S',
        preheader: 'P',
        // Text that exists in the RAW value and vanishes once stripped -- an `<img>` alone has
        // no text either way, so it cannot tell the two predicates apart.
        body: '<style>.x{content:"hi"}</style>',
        cta: '',
        ctaUrl: '',
      } as unknown as EmailBriefCopy);
      fixture.detectChanges();

      expect(internals().emailBodyIsStageable()).toBe(false);
    });

    it.each([
      ['zero-width spaces', '\u200B\u200B'],
      ['a soft hyphen', '\u00AD'],
      ['a Hangul filler', '\u3164'],
    ])('treats a CTA label of %s as absent, matching the controller', STATE_ONLY, (_label, cta) => {
      // `emailCtaLabel` runs `sanitizeDisplayText`, which the controller also runs before
      // dropping an empty `buttonText`. A bare `.trim()` kept these and previewed a label the
      // draft would not carry.
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailCopy.set({
        subject: 'S',
        preheader: 'P',
        body: '<p>Join us</p>',
        cta,
        // Must MATCH the brief's registrationUrl, or `emailCtaIsStageable` is false and the
        // label short-circuits to '' whatever the sanitizer does -- which would make this test
        // pass for the wrong reason.
        ctaUrl: emailBrief.eventDetails.registrationUrl,
      } as unknown as EmailBriefCopy);
      fixture.detectChanges();

      expect(internals().emailCtaIsStageable()).toBe(true);
      expect(internals().emailBodyIsStageable()).toBe(true);
      expect(internals().emailCtaLabel()).toBe('');
    });

    it.each([
      ['zero-width spaces', '\u200B\u200B'],
      ['a soft hyphen', '\u00AD'],
    ])('treats a B preheader of %s as absent so B falls back to A', STATE_ONLY, (_label, value) => {
      // `abTestPreheaderBForSend` sanitizes for the same reason: the controller omits an empty
      // `previewTextB`, and upstream then preserves A's preview text. A `.trim()` kept these
      // truthy, so B shipped an invisible preheader instead of inheriting A's.
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().abTestForm.controls.preheaderB.setValue(value);
      fixture.detectChanges();

      expect(internals().abTestPreheaderBForSend()).toBe('');
    });

    it('does not let an invented CTA url whitelist its own host for body links', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/',
        },
      } as unknown as CampaignBriefOutput);
      internals().emailCopy.set({
        subject: 's',
        preheader: 'p',
        // The model invented a destination AND wrote a body anchor to the same host.
        body: '<p>Join <a href="https://evil.example/phish">here</a></p>',
        cta: 'Register now',
        ctaUrl: 'https://evil.example/phish',
      } as unknown as EmailBriefCopy);
      fixture.detectChanges();

      // Nothing is vouched for, because the generated url is not the brief's.
      expect(internals().generatedDestinations()).toEqual([]);
      // ...so the body anchor loses its href while keeping its words.
      expect(internals().emailBodyHtmlPreview()).not.toContain('evil.example');
      expect(internals().emailBodyHtmlPreview()).toContain('here');
    });

    it('keeps a body link on the host the brief vouches for', STATE_ONLY, () => {
      // The control for the case above: narrowing the list must not drop legitimate links.
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/',
        },
      } as unknown as CampaignBriefOutput);
      internals().emailCopy.set({
        subject: 's',
        preheader: 'p',
        body: '<p>Join <a href="https://events.linuxfoundation.org/kubecon-eu-2026/register">here</a></p>',
        cta: 'Register now',
        ctaUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/',
      } as unknown as EmailBriefCopy);
      fixture.detectChanges();

      expect(internals().generatedDestinations()).toEqual(['https://events.linuxfoundation.org/kubecon-eu-2026/']);
      expect(internals().emailBodyHtmlPreview()).toContain('href="https://events.linuxfoundation.org/kubecon-eu-2026/register"');
    });

    /**
     * #3306. The event page's own links keep their href in the preview when they are on the CTA's host
     * or an LF-owned domain; an off-host one keeps its words only. The controller judges the staged
     * body with the same helper over `emailExtractedLinks`, which the stage request carries.
     */
    it('keeps vetted event-page links in the preview and strips an off-host one', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'https://kubecon.example/eu/',
          cfpUrl: 'https://kubecon.example/eu/cfp',
          agendaUrl: 'https://evil.example/agenda',
          venueUrl: 'https://training.linuxfoundation.org/venue',
          sponsorshipUrl: '',
        },
      } as unknown as CampaignBriefOutput);
      internals().emailCopy.set({
        subject: 's',
        preheader: 'p',
        body:
          '<p><a href="https://kubecon.example/eu/cfp">CFP</a> <a href="https://evil.example/agenda">Agenda</a> ' +
          '<a href="https://training.linuxfoundation.org/venue">Venue</a></p>',
        cta: 'Register now',
        ctaUrl: 'https://kubecon.example/eu/',
      } as unknown as EmailBriefCopy);
      fixture.detectChanges();

      const preview = internals().emailBodyHtmlPreview();
      expect(preview).toContain('href="https://kubecon.example/eu/cfp"');
      expect(preview).toContain('href="https://training.linuxfoundation.org/venue"');
      expect(preview).not.toContain('evil.example');
      expect(preview).toContain('Agenda');
    });

    it('strips an LF-owned link the event page did not publish: the preview narrows the service pass', STATE_ONLY, () => {
      // The service's first pass keeps any LF-owned link, since it cannot see the event page. The
      // preview must narrow that back to the page's own links, or an invented LF address survives.
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: {
          name: 'KubeCon EU 2026',
          slug: 'kubecon-eu-2026',
          countryCode: 'NL',
          registrationUrl: 'https://kubecon.example/eu/',
          cfpUrl: 'https://kubecon.example/eu/cfp',
        },
      } as unknown as CampaignBriefOutput);
      internals().emailCopy.set({
        subject: 's',
        preheader: 'p',
        body: '<p><a href="https://training.linuxfoundation.org/invented">Invented</a></p>',
        cta: 'Register now',
        ctaUrl: 'https://kubecon.example/eu/',
      } as unknown as EmailBriefCopy);
      fixture.detectChanges();

      expect(internals().emailBodyHtmlPreview()).not.toContain('training.linuxfoundation.org');
      expect(internals().emailBodyHtmlPreview()).toContain('Invented');
    });

    it('shows a refused CTA as plain text instead of dropping it silently', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'https://x.example/reg' },
      } as unknown as CampaignBriefOutput);
      internals().emailCopy.set({
        subject: 's',
        preheader: 'p',
        body: '<p>Hello</p>',
        cta: 'Register now',
        ctaUrl: 'https://evil.example/phish',
      } as unknown as EmailBriefCopy);
      fixture.detectChanges();

      // Refused: the generated url is not the brief's.
      expect(internals().emailCtaDestination()).toBe('');
      expect(internals().emailCtaLabel()).toBe('');
      // ...but the wording survives, so the operator can see what the model produced.
      expect(internals().emailCtaUnlinkedLabel()).toBe('Register now');
    });

    it('does not double-render a CTA whose url was OMITTED, since body already carries it', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'https://x.example/reg' },
      } as unknown as CampaignBriefOutput);
      internals().emailCopy.set({
        subject: 's',
        preheader: 'p',
        // The server keeps a URL-less button's label inline in `body` (its filter is
        // `!section.url`), so showing it again here renders the call to action twice.
        body: '<p>Hello</p><div><strong>Submit Your Proposal</strong></div>',
        cta: 'Submit Your Proposal',
        ctaUrl: '',
      } as unknown as EmailBriefCopy);
      fixture.detectChanges();

      expect(internals().emailCtaLabel()).toBe('');
      expect(internals().emailCtaUnlinkedLabel()).toBe('');
    });

    it('still shows the unlinked label for a WHITESPACE-ONLY url, which the server treats as supplied', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'https://x.example/reg' },
      } as unknown as CampaignBriefOutput);
      internals().emailCopy.set({
        subject: 's',
        preheader: 'p',
        body: '<p>Hello</p>',
        cta: 'Register now',
        // `"   "` is TRUTHY, so the server's `!section.url` filter drops the label from body.
        // Trimming on this side would call it omitted and hide it here too -- the CTA would
        // vanish from both, through the gap this helper exists to close.
        ctaUrl: '   ',
      } as unknown as EmailBriefCopy);
      fixture.detectChanges();

      expect(internals().emailCtaLabel()).toBe('');
      expect(internals().emailCtaUnlinkedLabel()).toBe('Register now');
    });

    it('does not double-render a CTA whose destination is accepted', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set({
        eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'https://x.example/reg' },
      } as unknown as CampaignBriefOutput);
      internals().emailCopy.set({
        subject: 's',
        preheader: 'p',
        body: '<p>Hello</p>',
        cta: 'Register now',
        ctaUrl: 'https://x.example/reg',
      } as unknown as EmailBriefCopy);
      fixture.detectChanges();

      // The button is staged, so the plain-text twin must stay empty -- otherwise the preview
      // shows the call to action twice.
      expect(internals().emailCtaLabel()).toBe('Register now');
      expect(internals().emailCtaUnlinkedLabel()).toBe('');
    });

    it('cannot generate without a brief', STATE_ONLY, () => {
      selectEmail();
      expect(internals().canGenerateEmailCopy()).toBe(false);

      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();
      expect(internals().canGenerateEmailCopy()).toBe(true);
    });

    /**
     * A stage change mid-flight must invalidate the request it started.
     *
     * `onSelectEmailType` clears the copy while a generate may still be running, and the selector
     * stays usable — so the older response resolves afterwards and repopulates the panel with the
     * PREVIOUS stage's copy under the new stage's label. That copy reads plausibly and is simply
     * the wrong kind of email, which `onStageEmailSend` would then clone.
     */
    it('discards copy that arrives after the operator changed the stage', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const late = new Subject<{ enabled: boolean; copy: EmailBriefCopy }>();
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(late.asObservable() as never);

      const pending = internals().onGenerateEmailCopy();
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');
      late.next({ enabled: true, copy });
      late.complete();
      await pending;

      expect(internals().emailCopy()).toBeNull();
      expect(internals().emailCopyState()).toBe('idle');
    });

    /**
     * `emailBriefId` is cleared by `resetEmailBriefDerivedState`, so caching the persisted id only
     * there meant the next save after a Proceed found no owned row and CREATED a second brief for
     * a (project, event) that already had one — while the paid path, reading the same cache, went
     * on addressing the first.
     */
    it('records brief ownership so a later save replaces rather than creating a second row', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));
      await internals().onGenerateEmailCopy();

      // The reset clears `emailBriefId` — which is exactly the path that exposed this: with the id
      // gone and ownership never recorded, the next persist had nothing to address and created a
      // SECOND brief for a (project, event) that already had one.
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      persist.mockClear();

      await internals().onGenerateEmailCopy();
      expect(persist).toHaveBeenCalled();
      // The known id is the third argument: this save REPLACES the row rather than creating one.
      expect(persist.mock.calls[0][2]).toBe('brief-77');
    });

    /** A BUILT audience, which is what `canStageEmail` gates on. */
    const builtAudience: CampaignAudience = {
      id: 'aud-1',
      projectId: 'tlf',
      briefId: 'brief-77',
      platform: 'hubspot',
      inclusionSummary: 'Past registrants',
      status: 'built',
      version: 1,
    };

    /**
     * A late AUDIENCE response is worse than a stale one: `canStageEmail` gates on
     * `emailAudience()?.status === 'built'`, so a build resolving after the reset re-enables
     * staging against a brief the page no longer holds.
     *
     * LIMITATION, stated rather than implied: this test pins the OUTCOME, not the generation
     * guard specifically. Removing the guard's bump from `resetEmailBriefDerivedState` leaves it
     * green, because the reset's own `emailAudience.set(null)` already satisfies the assertion in
     * this harness — the mocked persist resolves in a microtask, so the reset lands before the
     * response and the clear is what the assertion observes. Driving the guard itself needs a
     * fake that suspends INSIDE `ensureEmailBriefId`, which this suite has no seam for. The guard
     * is kept because the write it protects (`emailAudience.set(result.audience)`) is
     * unconditional, and a late response would otherwise overwrite the cleared signal.
     */
    /**
     * A late persist must not clear a NEWER one's in-flight slot.
     *
     * `ensureEmailBriefId` dedups concurrent saves by parking the promise in
     * `emailBriefPersistInFlight`, and its `finally` cleared that field unconditionally. A reset
     * also clears it, so this ordering defeated the dedup: persist A starts, a reset clears the
     * slot, persist B starts and takes it, then A settles and wipes B's slot — leaving a third
     * action free to start a SECOND concurrent save of the same brief.
     *
     * Driven through the service mock, which is the real seam: the component's own
     * `persistEmailBrief` awaits `campaignService.persistBrief`, so controlling that controls when
     * each persist settles.
     */
    it("does not let a late persist clear a newer one's in-flight slot", STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const settleA: ((v: unknown) => void)[] = [];
      const settleB: ((v: unknown) => void)[] = [];
      let call = 0;
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(
        () =>
          new Observable((sub) => {
            const bucket = call++ === 0 ? settleA : settleB;
            bucket.push((v) => {
              sub.next(v);
              sub.complete();
            });
          }) as never
      );

      const c = fixture.componentInstance as unknown as {
        ensureEmailBriefId(brief: unknown, slug: string): Promise<string>;
        resetEmailBriefDerivedState(): void;
        emailBriefPersistInFlight: Promise<string> | null;
      };

      const a = c.ensureEmailBriefId(emailBrief, 'tlf');
      // The reset frees the slot, exactly as it does in the app.
      c.resetEmailBriefDerivedState();
      const b = c.ensureEmailBriefId(emailBrief, 'tlf');
      expect(c.emailBriefPersistInFlight, 'precondition: B holds the slot').not.toBeNull();

      // A settles LAST. Its `finally` must leave B's slot alone.
      settleA.forEach((f) => f({ enabled: true, briefId: 'brief-a', etag: null }));
      await a.catch(() => undefined);

      expect(c.emailBriefPersistInFlight, "a late persist cleared the newer one's slot, so a third action could start a second concurrent save").not.toBeNull();

      settleB.forEach((f) => f({ enabled: true, briefId: 'brief-b', etag: null }));
      await b.catch(() => undefined);
    });

    it('discards an audience that arrives after the brief-derived state reset', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      // The read-back is the only path that can now land an audience asynchronously -- the derived
      // build this test used to drive is gone -- and it is the one that matters: a row for the
      // PREVIOUS brief re-enables staging, because `canStageEmail` gates on the audience status.
      const late = new Subject<{ enabled: boolean; audiences: CampaignAudience[] }>();
      vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(late.asObservable() as never);

      const pending = internals().restoreEmailAudience('tlf', 'brief-77');
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      late.next({ enabled: true, audiences: [builtAudience] });
      late.complete();
      await pending;

      expect(internals().emailAudience()).toBeNull();
      expect(internals().canStageEmail()).toBe(false);
    });

    /**
     * The same for copy. Carries the same limitation as the audience test above: it pins the
     * outcome, not the generation bump, which the reset's own clear can satisfy in this harness.
     */
    it('discards copy that arrives after the brief-derived state reset', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const late = new Subject<{ enabled: boolean; copy: EmailBriefCopy }>();
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(late.asObservable() as never);

      const pending = internals().onGenerateEmailCopy();
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      late.next({ enabled: true, copy });
      late.complete();
      await pending;

      expect(internals().emailCopy()).toBeNull();
    });

    /**
     * The dedup must not outlive the brief that started it.
     *
     * A caller joining the shared promise AFTER a reset would receive the PREVIOUS brief's id and
     * address every later write to the wrong row — the dedup becoming a correctness bug precisely
     * because it worked. The reset drops the joinable promise; the in-flight request itself is
     * left to finish.
     */
    it('does not hand a joined caller the previous brief id after a reset', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const slow = new Subject<CampaignBriefPersistResult>();
      persist.mockReturnValue(slow.asObservable());
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));

      const first = internals().onGenerateEmailCopy();
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();

      // A second action after the reset must start its OWN persist rather than join the first.
      persist.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-99', etag: null }));
      const second = internals().onGenerateEmailCopy();

      slow.next({ status: 'saved', approved: true, briefId: 'brief-77', etag: null } as unknown as CampaignBriefPersistResult);
      slow.complete();
      await Promise.all([first, second]);

      // Two persists, not one joined call: the second belongs to the new brief.
      expect(persist).toHaveBeenCalledTimes(2);

      // And the ABANDONED persist must not write its id into the shared cache. The call count
      // alone passed while `brief-77` clobbered `emailBriefId`: `persistEmailBrief` short-circuits
      // on a non-empty id, so the next action would then stage against the previous brief --
      // exactly the cross-brief leak the reset exists to prevent.
      expect(internals().emailBriefId(), 'the abandoned persist wrote its id back after the reset').not.toBe('brief-77');
    });

    /**
     * Two email actions started together each found an empty cache and each issued a first-save
     * persist for the same (project, event) — a duplicate brief, or a lost ownership race.
     */
    it('issues one persist when two email actions start concurrently', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      // Staging is the second brief-scoped action now that the derived build is gone. It needs an
      // audience to get past its entry guard, and the composed handoff is the only way to set one.
      // Set directly rather than through the compose handoff: the handoff only accepts an audience
      // for the brief the parent already holds, and this test needs that cache EMPTY.
      internals().emailAudience.set(builtAudience);
      fixture.detectChanges();

      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(of(null));
      persist.mockClear();

      await Promise.all([internals().onGenerateEmailCopy(), internals().onStageEmailSend()]);

      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('persists the brief first, then generates against that id', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const gen = vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));
      await internals().onGenerateEmailCopy();

      // Brief-scoped upstream: generation posts to /briefs/{id}/email-copy, so an unpersisted
      // brief has no id to address.
      expect(persist).toHaveBeenCalled();
      // Slug and brief id, in that order. The third argument is the email stage, asserted by its
      // own test -- pinning the whole argv here made this ordering test fail when the stage was
      // added, which is a different claim than the one it exists to make.
      expect(gen.mock.calls[0].slice(0, 2)).toEqual(['tlf', 'brief-77']);
      expect(internals().emailCopy()?.subject).toBe('Three days in Amsterdam');
    });

    it('does NOT generate when the persist returns no brief id', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      persist.mockReturnValue(of({ status: 'saved', briefId: '', etag: null }));
      const gen = vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy');

      await internals().onGenerateEmailCopy();

      // Generating without an id would POST to /briefs//email-copy. Refusing is the safe arm.
      expect(gen).not.toHaveBeenCalled();
      expect(internals().emailCopyState()).toBe('error');
    });

    it('reports a disabled cutover without claiming copy was generated', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: false }));
      await internals().onGenerateEmailCopy();

      expect(internals().emailCopy()).toBeNull();
      expect(internals().emailCopyState()).toBe('error');
    });

    // Each conflict must leave the NEXT email action able to succeed. Recording the conflict makes
    // the refusal explain itself; it does not make a retry possible. Without promoting the
    // ownership entry the same validator is re-sent and refused identically, while the banner says
    // trying again will work -- the dead end the paid path already had to fix.
    describe.each([
      ['stale-brief', 'brief-77'],
      ['unverified-validator', 'brief-77'],
      // `superseded-after-write` COMMITTED its write, so the row it names is the one the next save
      // must address. Not recording it creates a second brief for an event that already has one.
      ['superseded-after-write', 'brief-99'],
    ])('after a %s refusal', (conflict, expectedId) => {
      it('lets the next email action through instead of re-sending the refused validator', async () => {
        selectEmail();
        internals().emailBriefOutput.set(emailBrief);
        fixture.detectChanges();

        // A first save records id + validator, so the retry has something to promote.
        persist.mockReturnValue(of({ status: 'saved', briefId: 'brief-77', etag: '"1"', approved: true }));
        vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));
        await internals().onGenerateEmailCopy();

        // Refused: the validator this session holds is no longer the one the row carries.
        persist.mockReturnValue(
          of({ status: 'saved', briefId: conflict === 'superseded-after-write' ? 'brief-99' : 'brief-77', etag: null, approved: false, conflict })
        );
        internals().emailBriefId.set('');
        await internals().onGenerateEmailCopy();

        // The operator has now been warned, so the retry carries explicit overwrite permission
        // rather than the validator that was just refused.
        //
        // NOT awaited: `NEVER` keeps the persist open on purpose, and the claim under test is what
        // this call SENDS, which is already decided by the time the request is issued. Awaiting it
        // would only wait for a response the test never intends to deliver.
        persist.mockClear();
        persist.mockReturnValue(NEVER);
        internals().emailBriefId.set('');
        void internals().onGenerateEmailCopy();
        await fixture.whenStable();

        expect(persist).toHaveBeenLastCalledWith(emailBrief, expect.anything(), expectedId, null, true);
      });
    });

    // The promotion must not outrun the warning that justifies it. A same-stage email-type change
    // bumps `emailCopyGeneration` without bumping `emailBriefPersistGeneration`, so an in-flight
    // persist is still current by its own generation while its caller has already returned early
    // and rendered NO banner. Promoting there would hand out overwrite permission for a refusal
    // the operator was never shown.
    it('shows a warm-up conflict on the Audience tab and grants its overwrite only on Retry', STATE_ONLY, async () => {
      // A conflict carrying an id used to read as "unapproved": no Retry, and the conflict message
      // whose render grants the overwrite never appeared, so proceeding repeated the conflict.
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();
      persist.mockReturnValue(of({ status: 'saved', briefId: 'brief-77', etag: '"1"', approved: true }));
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));
      await internals().onGenerateEmailCopy();

      persist.mockReturnValue(of({ status: 'saved', briefId: 'brief-77', etag: null, approved: false, conflict: 'stale-brief' }));
      internals().emailBriefId.set('');
      const warm = internals() as unknown as { warmEmailBriefId(): void; emailBriefSaveMessage: () => string; onRetryEmailBrief(): void };
      warm.warmEmailBriefId();
      await fixture.whenStable();

      expect((internals() as unknown as { emailBriefState: () => string }).emailBriefState()).toBe('failed');
      expect(warm.emailBriefSaveMessage(), 'the conflict recovery never reached the Audience tab').not.toBe('');

      // Not granted by the warm-up alone: the next save still addresses the row with its validator.
      persist.mockClear();
      persist.mockReturnValue(NEVER);
      warm.onRetryEmailBrief();
      await fixture.whenStable();

      expect(persist, 'Retry after the shown conflict did not carry the overwrite').toHaveBeenLastCalledWith(
        emailBrief,
        expect.anything(),
        'brief-77',
        null,
        true
      );
    });

    it('withholds the overwrite until the conflict warning is actually rendered', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      persist.mockReturnValue(of({ status: 'saved', briefId: 'brief-77', etag: '"1"', approved: true }));
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));
      await internals().onGenerateEmailCopy();

      // Refused — and the caller is invalidated mid-flight, so it returns before any banner.
      persist.mockReturnValue(of({ status: 'saved', briefId: 'brief-77', etag: null, approved: false, conflict: 'stale-brief' }));
      internals().emailBriefId.set('');
      // The REAL trigger, not a poked counter. `cfp-launch` and `colocated-cfp-reminder` share the
      // stage `CFP Launch`, so this bumps the copy generation and leaves the persist generation
      // (and the brief) alone -- which is exactly the desync under test. A DIFFERENT-stage change
      // would clear `emailBriefOutput` and there would be no persist to reason about at all.
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('cfp-launch');
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const inFlight = internals().onGenerateEmailCopy();
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('colocated-cfp-reminder');
      await inFlight;

      // No banner was shown, so no permission may have been granted.
      persist.mockClear();
      persist.mockReturnValue(NEVER);
      internals().emailBriefId.set('');
      void internals().onGenerateEmailCopy();
      await fixture.whenStable();

      expect(persist).toHaveBeenLastCalledWith(emailBrief, expect.anything(), 'brief-77', '"1"', false);
    });

    // A staged promotion must not outlive the render that was supposed to grant it. Reading it
    // only after the `conflict === null` guard meant a plain non-conflict failure returned without
    // dropping it, and a LATER unrelated conflict then applied it -- overwrite permission earned
    // by one refusal, spent against the row a different refusal named.
    //
    // Asserted on `knownBriefIds` directly rather than by driving three UI actions: the promotion
    // IS an ownership write, and the persist dedup plus the type-change resets make a three-action
    // script assert far less than it appears to.
    it('drops a staged overwrite when a non-conflict failure renders instead', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const priv = internals() as unknown as {
        ownershipKey(p: string, b: unknown): string | null;
        knownBriefIds: Map<string, { id: string; etag: string | null; absence?: string }>;
        activeFoundationSlug(): string;
        pendingEmailOverwrite: { key: string; id: string; generation: number; conflict: string } | null;
        emailBriefConflict: string | null;
        emailBriefPersistGeneration: number;
        emailSaveFailureMessage(consequence: string): string;
      };
      const key = priv.ownershipKey(priv.activeFoundationSlug(), emailBrief) as string;
      expect(key).not.toBeNull();
      priv.knownBriefIds.set(key, { id: 'brief-77', etag: '"1"' });

      // A stale-brief refusal staged a promotion, and its caller returned before rendering.
      priv.pendingEmailOverwrite = { key, id: 'brief-77', generation: priv.emailBriefPersistGeneration, conflict: 'stale-brief' };

      // A plain failure with NO conflict renders next. It must DROP the staged entry.
      priv.emailBriefConflict = null;
      priv.emailSaveFailureMessage('so no copy was generated.');
      expect(priv.pendingEmailOverwrite, 'a non-conflict render left the staged promotion behind').toBeNull();

      // A later, unrelated refusal must not be able to spend it.
      priv.emailBriefConflict = 'unowned-brief-exists';
      priv.emailSaveFailureMessage('so no copy was generated.');
      expect(priv.knownBriefIds.get(key)?.absence, 'a stale staged overwrite was applied by an unrelated conflict').toBeUndefined();
      expect(priv.knownBriefIds.get(key)?.etag).toBe('"1"');
    });

    // The other half of the same rule: a promotion IS granted when the refusal that staged it is
    // the one being rendered. Without this the test above could pass by never promoting at all.
    it('applies the staged overwrite when its own conflict is the one rendered', STATE_ONLY, () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const priv = internals() as unknown as {
        ownershipKey(p: string, b: unknown): string | null;
        knownBriefIds: Map<string, { id: string; etag: string | null; absence?: string }>;
        activeFoundationSlug(): string;
        pendingEmailOverwrite: { key: string; id: string; generation: number; conflict: string } | null;
        emailBriefConflict: string | null;
        emailBriefPersistGeneration: number;
        emailSaveFailureMessage(consequence: string): string;
      };
      const key = priv.ownershipKey(priv.activeFoundationSlug(), emailBrief) as string;
      priv.knownBriefIds.set(key, { id: 'brief-77', etag: '"1"' });
      priv.pendingEmailOverwrite = { key, id: 'brief-77', generation: priv.emailBriefPersistGeneration, conflict: 'stale-brief' };

      priv.emailBriefConflict = 'stale-brief';
      priv.emailSaveFailureMessage('so no copy was generated.');

      expect(priv.knownBriefIds.get(key)).toEqual(expect.objectContaining({ id: 'brief-77', etag: null, absence: 'overwrite' }));
    });

    // `emailBriefConflict` is single shared state, so an abandoned persist must not write its
    // outcome over the current send's. A stage change nulls `emailBriefPersistInFlight` so a newer
    // persist can start, and the older one then resolves -- either overwriting the live conflict
    // token or, on its success arm, wiping it. The operator then sees a generic retry banner for a
    // refusal belonging to a send they moved off, and the pending overwrite is dropped because the
    // conflict it matches against is gone.
    it('does not let an abandoned persist write the current conflict token', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const priv = internals() as unknown as { emailBriefConflict: string | null };

      // A persist that will resolve AFTER the page has moved on.
      const late = new Subject<CampaignBriefPersistResult>();
      persist.mockReturnValue(late.asObservable());
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));
      const inFlight = internals().onGenerateEmailCopy();

      // The operator switches to a different send. `cfp-launch` -> `colocated-cfp-reminder` share
      // a stage, so the brief survives; what matters is that the persist generation moves.
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('cfp-launch');
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      // The CURRENT send records its own refusal.
      priv.emailBriefConflict = 'unowned-brief-exists';

      // Now the abandoned persist answers, with a different outcome.
      late.next({ status: 'saved', briefId: 'brief-77', etag: null, approved: true } as unknown as CampaignBriefPersistResult);
      late.complete();
      await inFlight;
      await fixture.whenStable();

      expect(priv.emailBriefConflict, 'an abandoned persist wiped the live send conflict token').toBe('unowned-brief-exists');
    });

    it('surfaces the upstream refusal rather than a generic message', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      // The 503 case: no AI model configured upstream. An operator needs the real reason.
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(
        of({ enabled: true, error: 'The email copy could not be generated. Try again.' })
      );
      await internals().onGenerateEmailCopy();

      expect(internals().emailCopyError()).toBe('The email copy could not be generated. Try again.');
    });
  });

  describe('email send audience', () => {
    const emailBrief = {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'https://x.example/' },
    } as unknown as CampaignBriefOutput;

    const audience: CampaignAudience = {
      id: 'aud-1',
      projectId: 'tlf',
      briefId: 'brief-77',
      platform: 'hubspot',
      inclusionSummary: 'Past registrants of 3 prior editions',
      status: 'built',
      version: 1,
    };

    let persist: Mock;

    beforeEach(() => {
      persist = vi.fn().mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(persist);
    });

    /**
     * A failed HubSpot row must not be announced as a created draft.
     *
     * campaign-service reports a partial outcome as `{ platform: 'hubspot', ok: false, error }`
     * with an EMPTY `errors` array, so checking only the top level said "Draft created in
     * HubSpot" for a staging that failed — sending the operator to look for a draft that is not
     * there.
     */
    it('reports a failed hubspot platform result as an error, not a created draft', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      internals().emailBriefId.set(audience.briefId);
      internals().onAudienceComposed(audience);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(
        of({
          campaigns: [],
          errors: [],
          platformResults: [{ platform: 'hubspot', ok: false, error: 'the source template could not be cloned' }],
        } as unknown as CampaignJobOutcome)
      );

      await internals().onStageEmailSend();
      fixture.detectChanges();

      expect(internals().emailStaging()).toBe('error');
      expect(internals().emailStagingMessage()).toContain('could not be cloned');
    });

    it.each([
      ['an https HubSpot link', 'https://app.hubspot.com/email/123/edit/c1/settings', 'https://app.hubspot.com/email/123/edit/c1/settings'],
      ['a non-http(s) link', 'javascript:alert(1)', ''],
      ['no link', undefined, ''],
      ['a regional HubSpot app host', 'https://app-eu1.hubspot.com/email/123/edit/c1/settings', 'https://app-eu1.hubspot.com/email/123/edit/c1/settings'],
      ['an https link off HubSpot', 'https://evil.example/email/123', ''],
      ['a look-alike HubSpot host', 'https://app.hubspot.com.evil.example/email/123', ''],
      ['plain http to HubSpot', 'http://app.hubspot.com/email/123', ''],
    ])('links the staged draft only for a safe URL: %s', async (_label, hubspotUrl, expected) => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      // The link renders on the Implement tab; without it the anchor assertion read an absent element.
      internals().selectedEmailTab.set('implementation');
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      internals().emailBriefId.set(audience.briefId);
      internals().onAudienceComposed(audience);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(
        of({
          campaigns: [],
          errors: [],
          platformResults: [{ platform: 'hubspot', ok: true, campaignId: 'c1', hubspotUrl }],
        } as unknown as CampaignJobOutcome)
      );

      await internals().onStageEmailSend();
      fixture.detectChanges();

      expect(internals().emailStaging()).toBe('done');
      expect(internals().emailStagingDraftUrl()).toBe(expected);
      const anchor = fixture.nativeElement.querySelector('[data-testid="campaigns-email-stage-draft-link"]') as HTMLAnchorElement | null;
      expect(anchor?.getAttribute('href') ?? '').toBe(expected);
    });

    it('shows a warning when the draft was created without its hero image, and keeps the staging a success', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTab.set('implementation');
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      internals().emailBriefId.set(audience.briefId);
      internals().onAudienceComposed(audience);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(
        of({
          campaigns: [],
          errors: [],
          platformResults: [
            {
              platform: 'hubspot',
              ok: true,
              campaignId: 'c1',
              hubspotUrl: 'https://app.hubspot.com/email/123/edit/c1/settings',
              warnings: ['The hero image could not be added to the email: the image could not be downloaded from the event page.'],
            },
          ],
        } as unknown as CampaignJobOutcome)
      );

      await internals().onStageEmailSend();
      fixture.detectChanges();

      expect(internals().emailStaging()).toBe('done');
      expect(internals().emailStagingWarnings()).toHaveLength(1);
      const shown = fixture.nativeElement.querySelector('[data-testid="campaigns-email-stage-warning"]') as HTMLElement | null;
      expect(shown?.textContent).toContain('hero image could not be added');
    });

    it('shows no warning block when the draft was created in full', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTab.set('implementation');
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      internals().emailBriefId.set(audience.briefId);
      internals().onAudienceComposed(audience);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(
        of({
          campaigns: [],
          errors: [],
          platformResults: [{ platform: 'hubspot', ok: true, campaignId: 'c1' }],
        } as unknown as CampaignJobOutcome)
      );

      await internals().onStageEmailSend();
      fixture.detectChanges();

      expect(internals().emailStagingWarnings()).toEqual([]);
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-stage-warnings"]')).toBeNull();
    });

    /** An ABSENT platformResults must still succeed — it is optional on the contract. */
    it('still reports success when the service omits platformResults', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      internals().emailBriefId.set(audience.briefId);
      internals().onAudienceComposed(audience);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(
        of({ campaigns: [{ id: 'c1' }], errors: [] } as unknown as CampaignJobOutcome)
      );

      await internals().onStageEmailSend();
      fixture.detectChanges();

      expect(internals().emailStaging()).toBe('done');
    });

    /**
     * A reset landing during the CREATE await must stop the poll and the state writes.
     *
     * LIMITATION, same as the sibling test below: this pins the OUTCOME, not the guard. Removing
     * the post-create `isCurrent()` check leaves it green -- instrumenting the branch showed
     * `isCurrent()` reads `true` throughout, because the reset lands before the generation is
     * captured rather than inside the await. Producing a reset that lands strictly BETWEEN the
     * capture and the create's resolution needs a seam this harness does not have.
     *
     * The guard is kept because the window is real in the browser: the request cannot be recalled
     * once sent, but the poll and the state writes after it can be, and those are what an
     * operator sees. Labelling the test is better than reporting coverage it does not demonstrate.
     */
    it('abandons the staging result when the brief resets during the create', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      internals().emailBriefId.set(audience.briefId);
      internals().onAudienceComposed(audience);

      // The create hangs, so the reset lands squarely inside its await -- past the entry check.
      const slowCreate = new Subject<{ jobId: string }>();
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(slowCreate.asObservable() as never);
      const poll = vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(of(null));

      void internals().onStageEmailSend();
      await Promise.resolve();
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();

      slowCreate.next({ jobId: 'j1' });
      slowCreate.complete();
      await Promise.resolve();
      await Promise.resolve();

      // The poll belongs to the abandoned brief and must never start.
      expect(poll).not.toHaveBeenCalled();
      expect(internals().emailStaging()).toBe('idle');
    });

    /**
     * A reset during staging must stop the CREATE, not just the poll — that write clones a HubSpot
     * draft and points it at the previous brief's audience, and cancelling the poll afterwards
     * does not undo it.
     *
     * LIMITATION, stated rather than implied: this pins the OUTCOME, not the generation guard.
     * Removing that guard leaves this green, because `resetEmailBriefDerivedState` also clears
     * `emailAudience` and the ENTRY check (`emailAudience()?.status !== 'built'`) returns first.
     * The guard is kept as defence-in-depth for a reset that lands after that check has passed,
     * which this harness has no seam to produce; the entry check is what this test proves.
     */
    it('does not create a campaign when the brief resets mid-stage', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      // The audience is attached synchronously by the compose handoff, so nothing here depends on
      // the persist -- which is what lets the persist be slowed below without hanging the setup.
      internals().emailBriefId.set(audience.briefId);
      internals().onAudienceComposed(audience);
      create.mockClear();

      // NOW slow the persist, and clear the cached id so staging actually awaits it.
      const slowPersist = new Subject<CampaignBriefPersistResult>();
      persist.mockReturnValue(slowPersist.asObservable());
      internals().emailBriefId.set('');

      // NOT awaited: the guard returns early, and the promise chain settles on its own. Awaiting
      // it here is what timed the first version of this test out.
      void internals().onStageEmailSend();
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      slowPersist.next({ status: 'saved', approved: true, briefId: 'brief-77', etag: null } as unknown as CampaignBriefPersistResult);
      slowPersist.complete();
      // Two microtask turns: one for the persist to resolve, one for the guard to run after it.
      await Promise.resolve();
      await Promise.resolve();

      expect(create).not.toHaveBeenCalled();
    });

    /**
     * A reset must CANCEL the staging poll, not merely relabel it.
     *
     * Setting `emailStaging` back to `idle` leaves the subscription running, so a job settling
     * after a new brief or a foundation switch still writes `done` — announcing a HubSpot draft
     * that belongs to the PREVIOUS brief as though it were this one's.
     */
    it('stops the staging poll when the brief-derived state resets', STATE_ONLY, async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      const late = new Subject<CampaignJobOutcome | null>();
      internals().emailBriefId.set(audience.briefId);
      internals().onAudienceComposed(audience);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(late.asObservable());

      await internals().onStageEmailSend();

      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      // The job settles AFTER the reset. With the poll still subscribed this writes 'done'.
      late.next({ campaigns: [{ id: 'c1' }], errors: [] } as unknown as CampaignJobOutcome);
      late.complete();
      fixture.detectChanges();

      expect(internals().emailStaging()).toBe('idle');
      expect(internals().emailStagingMessage()).toBe('');
    });
  });

  /**
   * The composed master reaching the send.
   *
   * The Audience tab used to be a dead end -- it created real HubSpot lists and nothing carried
   * them here, so the send still went to an audience the service derived on its own. What is only
   * decidable in this component is what happens to the row once it arrives: that it unblocks
   * staging, that it cannot be silently overwritten by a read-back already in flight, and that a
   * master nothing is attached to is reported rather than dropped.
   */
  describe('composed audience handoff', () => {
    const emailBrief = {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'https://x.example/' },
    } as unknown as CampaignBriefOutput;

    const composed: CampaignAudience = {
      id: 'aud-9',
      briefId: 'brief-77',
      platform: 'hubspot',
      platformMasterListId: '900',
      inclusionSummary: '4 signal lists, 1 suppression list',
      status: 'built',
      version: 1,
    };

    const looseMaster: AudienceComposedList = {
      listId: '900',
      name: '27Q2 - KubeCon EU 2026 - Master',
      hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/900',
    };
    /** The loose-list event as the Audience tab emits it for what is on screen now. */
    const looseHere = (): AudienceComposeUnattachedEvent => ({
      master: looseMaster,
      briefId: internals().emailBriefId(),
      projectSlug: internals().activeFoundationSlug(),
      scope: internals().emailAudienceScope(),
    });

    function onImplementTab(): void {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTab.set('implementation');
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();
    }

    it('holds Stage while the Audience tab is replacing the recorded audience', () => {
      // A re-attach or a replacement compose leaves the old row `built` until its reply lands, so
      // Stage stayed enabled and cloned a draft against the list being replaced.
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      expect(internals().canStageEmail(), 'fixture precondition: stageable on a built audience').toBe(true);

      internals().emailAudienceWriteInFlight.set(true);
      expect(internals().canStageEmail(), 'Stage stayed open during an audience write').toBe(false);
      fixture.detectChanges();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-stage-hint"]')?.textContent,
        'Stage was disabled with no reason given'
      ).toContain('audience write is still running');

      internals().emailAudienceWriteInFlight.set(false);
      expect(internals().canStageEmail()).toBe(true);
    });

    it.each([
      ['the poll lost track of the job', () => throwError(() => new Error('network'))],
      ['the poll timed out with no answer', () => of(null)],
    ])('holds every stage lock when %s, until the operator confirms', (_label, poll) => {
      // A draft may still be created, so releasing on `'error'` let a replacement write race it and
      // a retry duplicate it.
      onImplementTab();
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(poll() as never);
      internals().emailStaging.set('staging');
      (internals() as unknown as { pollStagingJob(job: string, slug: string, brief: string): void }).pollStagingJob(
        'job-1',
        internals().activeFoundationSlug(),
        internals().emailBriefId()
      );
      fixture.detectChanges();

      expect(internals().emailStaging()).toBe('error');
      expect(internals().emailStagingHeld(), 'the locks were released on an unresolved stage').toBe(true);
      expect(internals().selectorForm.controls.emailSegment.disabled).toBe(true);

      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="campaigns-email-stage-unresolved-ack"] button')?.click();
      fixture.detectChanges();
      expect(internals().emailStagingHeld(), 'confirming did not release the locks').toBe(false);
      expect(internals().selectorForm.controls.emailSegment.disabled).toBe(false);
    });

    it('explains a Stage held by an unresolved stage even after the poll is cancelled', () => {
      // `cancelStagingPoll` resets the state to idle and clears the message while the hold stays,
      // so a hint keyed on the message left a disabled Stage with no reason.
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      (internals() as unknown as { markStageUnresolved(p: string, b: string): void }).markStageUnresolved(
        internals().activeFoundationSlug(),
        internals().emailBriefId()
      );
      (internals() as unknown as { cancelStagingPoll(): void }).cancelStagingPoll();
      fixture.detectChanges();

      const hint = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-stage-hint"]')?.textContent ?? '';
      expect(internals().canStageEmail()).toBe(false);
      expect(hint, 'Stage was held with no reason given').toContain('ended without an answer');
    });

    it('scopes an unresolved stage to its brief: another brief is not locked, and the hold returns with it', STATE_ONLY, () => {
      // A single global flag locked brief B on A's stage, and B's acknowledgement cleared A's.
      onImplementTab();
      internals().emailBriefId.set('brief-a');
      (internals() as unknown as { markStageUnresolved(p: string, b: string): void }).markStageUnresolved(internals().activeFoundationSlug(), 'brief-a');
      expect(internals().emailStagingHeld(), 'fixture precondition: A is held').toBe(true);

      internals().emailBriefId.set('brief-b');
      expect(internals().emailStagingHeld(), "brief B was locked by brief A's stage").toBe(false);

      internals().emailBriefId.set('brief-a');
      expect(internals().emailStagingHeld(), "A's hold was lost on the round trip").toBe(true);
    });

    it('tells the operator to check HubSpot when the RESOLVED brief has an unresolved stage', async () => {
      // The on-screen key can differ from the brief the persist resolves; the recovery is the HubSpot
      // check, not "stage again".
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      vi.spyOn(internals() as unknown as { ensureEmailBriefId(): Promise<string> }, 'ensureEmailBriefId').mockResolvedValue('brief-held');
      (internals() as unknown as { markStageUnresolved(p: string, b: string): void }).markStageUnresolved(internals().activeFoundationSlug(), 'brief-held');
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign');

      await (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();

      expect(create).not.toHaveBeenCalled();
      expect(internals().emailStagingMessage()).toContain('Check HubSpot');
    });

    it('does not advise a retry when the create failed after it was dispatched', STATE_ONLY, async () => {
      // The stage is held as unresolved because the create may already be running; "try again"
      // contradicted that hold and invited a duplicate draft.
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(throwError(() => new HttpErrorResponse({ status: 504 })) as never);

      await (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();

      expect(internals().emailStagingHeld(), 'fixture precondition: the dispatched stage is held').toBe(true);
      expect(internals().emailStagingMessage()).toContain('Check HubSpot before staging again');
      expect(internals().emailStagingMessage()).not.toContain('try again');
    });

    it('keeps the retry advice for a failure before anything was dispatched', STATE_ONLY, async () => {
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      vi.spyOn(internals() as unknown as { ensureEmailBriefId(): Promise<string> }, 'ensureEmailBriefId').mockRejectedValue(new Error('persist failed'));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign');

      await (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();

      expect(create).not.toHaveBeenCalled();
      expect(internals().emailStagingMessage()).toContain('try again');
    });

    it('releases the hold when a create cancelled mid-flight comes back as a definite refusal', STATE_ONLY, async () => {
      // The cancel held the dispatch because the create MIGHT have started; a definite refusal says
      // it did not, but the stale-context return skipped it and kept everything locked.
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      const create = new Subject<{ jobId: string; error?: string; enabled: boolean }>();
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(create as never);
      const staging = (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();
      await fixture.whenStable();
      (internals() as unknown as { cancelStagingPoll(): void }).cancelStagingPoll();
      expect(internals().emailStagingHeld(), 'fixture precondition: the cancel held the dispatch').toBe(true);

      create.next({ enabled: true, jobId: '', error: 'The campaign service refused this request.' });
      create.complete();
      await staging;

      expect(internals().emailStagingHeld(), 'a refused create kept the stage held').toBe(false);
    });

    it('keeps the hold when a create cancelled mid-flight comes back as indeterminate', STATE_ONLY, async () => {
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      const create = new Subject<{ jobId: string; error?: string; enabled: boolean; indeterminate?: boolean }>();
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(create as never);
      const staging = (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();
      await fixture.whenStable();
      (internals() as unknown as { cancelStagingPoll(): void }).cancelStagingPoll();

      create.next({ enabled: true, jobId: '', error: 'Unconfirmed.', indeterminate: true });
      create.complete();
      await staging;

      expect(internals().emailStagingHeld(), 'an indeterminate create was released').toBe(true);
    });

    it('holds a DISPATCHED stage when a brief reset cancels its poll', STATE_ONLY, async () => {
      // The reset idles the display state, but the create cannot be recalled and its job may still
      // resolve the brief's audience -- releasing let A -> B -> A replace it underneath the job.
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ enabled: true, jobId: 'job-1', error: null }) as never);
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(NEVER as never);
      await (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();
      expect(internals().emailStaging(), 'fixture precondition: polling').toBe('staging');

      (internals() as unknown as { cancelStagingPoll(): void }).cancelStagingPoll();
      expect(internals().emailStaging()).toBe('idle');
      expect(internals().emailStagingHeld(), 'a dispatched stage was released by a UI reset').toBe(true);
    });

    it('releases nothing extra once the job reached a terminal answer', STATE_ONLY, async () => {
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ enabled: true, jobId: 'job-1', error: null }) as never);
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(
        of({ errors: [], platformResults: [{ platform: 'hubspot', ok: true, campaignId: 'd-1' }] }) as never
      );
      await (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();
      expect(internals().emailStaging()).toBe('done');

      (internals() as unknown as { cancelStagingPoll(): void }).cancelStagingPoll();
      expect(internals().emailStagingHeld(), 'a finished stage was held as unresolved').toBe(false);
    });

    it.each([
      ['an indeterminate create (it may have started)', { jobId: '', error: 'Campaign creation could not be confirmed.', indeterminate: true }, true],
      ['a definite refusal (nothing was created)', { jobId: '', error: 'Campaign creation was rejected and nothing was created.' }, false],
    ])('on %s, holds the stage only if a draft may exist', STATE_ONLY, async (_label, response, held) => {
      // A refusal left `dispatchedStage` set, so a later segment change or reset turned a draft that
      // cannot exist into an unresolved hold -- and an indeterminate error read as a refusal.
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of(response) as never);

      await (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();
      (internals() as unknown as { cancelStagingPoll(): void }).cancelStagingPoll();

      expect(internals().emailStagingHeld()).toBe(held);
    });

    it('refuses the unresolved acknowledgement while the abandoned create is still on the wire', async () => {
      // A reset records the stage as unresolved but cannot cancel the create; checking HubSpot before
      // the draft can appear, then staging again, is how a duplicate is made.
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      const create = new Subject<{ jobId: string }>();
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(create as never);
      const staging = (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();
      await fixture.whenStable();
      (internals() as unknown as { cancelStagingPoll(): void }).cancelStagingPoll();
      expect(internals().emailStagingHeld(), 'fixture precondition: held').toBe(true);

      // The RENDERED guard, not only the handler's: the waiting copy shows and the ack button is
      // disabled while the create is on the wire. Dropping either template guard while the handler
      // guard stays would still let an operator click through before the draft can appear.
      const el = fixture.nativeElement as HTMLElement;
      const ackButton = (): HTMLButtonElement | null => el.querySelector('[data-testid="campaigns-email-stage-unresolved-ack"] button');
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="campaigns-email-stage-unresolved-waiting"]'), 'no waiting copy while the create is on the wire').not.toBeNull();
      expect(ackButton(), 'fixture precondition: ack button rendered').not.toBeNull();
      expect(ackButton()!.disabled, 'ack button enabled while the create is on the wire').toBe(true);

      (internals() as unknown as { onAcknowledgeStagingUnresolved(): void }).onAcknowledgeStagingUnresolved();
      expect(internals().emailStagingHeld(), 'acknowledged while the create was still on the wire').toBe(true);

      create.error(new HttpErrorResponse({ status: 504 }));
      await staging;
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="campaigns-email-stage-unresolved-waiting"]'), 'waiting copy outlived the create').toBeNull();
      expect(ackButton()!.disabled, 'ack button still disabled after the create settled').toBe(false);

      (internals() as unknown as { onAcknowledgeStagingUnresolved(): void }).onAcknowledgeStagingUnresolved();
      expect(internals().emailStagingHeld(), 'the acknowledgement never became available').toBe(false);
    });

    it("lets a stale create's rejection settle only its own dispatch, not the newer stage's", STATE_ONLY, async () => {
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      const first = new Subject<{ jobId: string }>();
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValueOnce(first as never);
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(NEVER as never);
      const stageA = (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();
      await fixture.whenStable();
      (internals() as unknown as { cancelStagingPoll(): void }).cancelStagingPoll();
      (internals() as unknown as { onAcknowledgeStagingUnresolved(): void }).onAcknowledgeStagingUnresolved();

      // Stage B starts on a different brief while A's request is still pending.
      internals().emailBriefId.set('brief-other');
      internals().onAudienceComposed({ ...composed, briefId: 'brief-other' });
      create.mockReturnValueOnce(of({ jobId: 'job-b' }) as never);
      await (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();
      first.error(new HttpErrorResponse({ status: 504 }));
      await stageA;

      expect(internals().emailStagingUnresolved(), "A's stale rejection marked brief B unresolved").toBe(false);
      expect(
        (internals() as unknown as { dispatchedStage: { briefId: string } | null }).dispatchedStage?.briefId,
        "A's stale rejection cleared B's dispatch marker"
      ).toBe('brief-other');
    });

    it('does not re-lock a brief on a reset after its lost job was acknowledged', STATE_ONLY, async () => {
      // The poll's error path recorded the stage as unresolved but left the dispatch marker set,
      // so a later reset treated it as a newly abandoned create and locked the brief again.
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(throwError(() => new Error('network')) as never);
      await (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();
      expect(internals().emailStagingHeld(), 'fixture precondition: held after the lost job').toBe(true);

      (internals() as unknown as { onAcknowledgeStagingUnresolved(): void }).onAcknowledgeStagingUnresolved();
      (internals() as unknown as { cancelStagingPoll(): void }).cancelStagingPoll();

      expect(internals().emailStagingHeld(), 'an acknowledged stage was re-locked by a reset').toBe(false);
    });

    it('holds the stage when the create request fails after it was sent', STATE_ONLY, async () => {
      // The request may have reached the BFF and started; failing closed beats a duplicate draft.
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })) as never);

      await (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();

      expect(internals().emailStaging()).toBe('error');
      expect(internals().emailStagingHeld(), 'a create that may have started was released').toBe(true);
    });

    it('holds the locks when staging is accepted but returns no job to follow', STATE_ONLY, async () => {
      // The request WAS accepted, so a draft may still be created; releasing let a retry duplicate it.
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ enabled: true, jobId: null, error: null }) as never);

      await (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();

      expect(internals().emailStaging()).toBe('error');
      expect(internals().emailStagingHeld(), 'an accepted stage with nothing to track released the locks').toBe(true);
    });

    it('locks the type and segment pickers while a stage is in flight', STATE_ONLY, () => {
      // `onStageEmailSend` snapshots the copy before its awaits, so switching mid-stage cloned a
      // HubSpot draft with the PREVIOUS selection's copy -- a create on the wire cannot be recalled.
      selectEmail();
      internals().emailStaging.set('staging');
      fixture.detectChanges();
      expect(internals().selectorForm.controls.emailSegment.disabled, 'segment could change mid-stage').toBe(true);
      expect(internals().selectorForm.controls.emailType.disabled, 'type could change mid-stage').toBe(true);

      internals().emailStaging.set('done');
      fixture.detectChanges();
      expect(internals().selectorForm.controls.emailSegment.disabled).toBe(false);
      expect(internals().selectorForm.controls.emailType.disabled).toBe(false);
    });

    it('abandons an in-flight stage when the segment changes, as a type change does', STATE_ONLY, () => {
      // Left running, the poll went on to report "Draft created" for copy the new segment no longer
      // shows. Invalidated and cleaned up together, like `onSelectEmailType`.
      selectEmail();
      internals().emailStaging.set('staging');
      const priv = internals() as unknown as { emailStagingGeneration: number; onSelectEmailSegment(id: string): void };
      const before = priv.emailStagingGeneration;

      priv.onSelectEmailSegment('alumni');

      expect(priv.emailStagingGeneration, 'the in-flight stage was not invalidated').toBe(before + 1);
      expect(internals().emailStaging(), 'the abandoned stage kept spinning').toBe('idle');
    });

    it("keeps a finished stage's confirmation across a segment change", STATE_ONLY, () => {
      selectEmail();
      internals().emailStaging.set('done');

      (internals() as unknown as { onSelectEmailSegment(id: string): void }).onSelectEmailSegment('alumni');

      expect(internals().emailStaging(), 'a finished stage\'s "Draft created" was erased').toBe('done');
    });

    it('refuses to create when an audience write started during the brief-id await', STATE_ONLY, async () => {
      // The Audience tab stays mounted, so a replacement write could start while staging resolved
      // its brief id; the create would then clone a draft against the list being replaced.
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign');
      const persist = vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(() => {
        internals().emailAudienceWriteInFlight.set(true);
        return of({ status: 'saved', approved: true, briefId: composed.briefId, etag: null }) as never;
      });
      internals().emailBriefId.set('');

      await (internals() as unknown as { onStageEmailSend(): Promise<void> }).onStageEmailSend();

      expect(persist).toHaveBeenCalled();
      expect(create, 'a draft was cloned against an audience being replaced').not.toHaveBeenCalled();
      expect(internals().emailStaging()).toBe('error');
    });

    it('explains a Stage blocked by a FIRST compose, not "compose it first"', () => {
      // The audience is still null while the first compose runs, so a hint keyed on the audience
      // told the operator to do exactly what was already in progress.
      onImplementTab();
      internals().emailAudienceWriteInFlight.set(true);
      fixture.detectChanges();

      const hint = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-stage-hint"]')?.textContent ?? '';
      expect(hint).toContain('audience write is still running');
      expect(hint, 'the hint asked for the compose that was running').not.toContain('Compose the send audience');
    });

    it('says a restored audience is attached instead of asking for one', () => {
      // Only `composed` was special-cased, so a restored, attached audience still read "Needed
      // before the draft can be staged" directly above the card announcing it attached.
      onImplementTab();
      internals().emailAudience.set({ ...composed, status: 'built' });
      internals().emailAudienceOrigin.set('restored');
      fixture.detectChanges();

      const block = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-send-audience"]');
      expect(block?.querySelector('[data-testid="campaigns-email-audience-restored-note"]')).not.toBeNull();
      expect(block?.textContent, 'a restored audience was described as still needed').not.toContain('Needed before the draft can be staged');
    });

    it('unblocks staging on a composed audience', STATE_ONLY, () => {
      onImplementTab();
      expect(internals().canStageEmail(), 'fixture precondition: staging must be blocked before an audience exists').toBe(false);

      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      fixture.detectChanges();

      expect(internals().canStageEmail()).toBe(true);
      expect(internals().emailAudience()).toEqual(composed);
    });

    /**
     * The generation bump has to happen BEFORE the signal write, not after. A restore read-back may
     * be in flight when the operator composes, and its reply arm checks the counter before setting
     * `emailAudience` -- so bumping late leaves a window in which a STALE row lands on top of the
     * list just assembled, and dispatch then sends to the stale one.
     */
    it('discards a read-back that resolves after a compose attached its own audience', STATE_ONLY, async () => {
      onImplementTab();
      const late = new Subject<{ enabled: boolean; audiences: CampaignAudience[] }>();
      vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(late.asObservable() as never);

      const pending = internals().restoreEmailAudience('tlf', 'brief-77');
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);

      late.next({ enabled: true, audiences: [{ ...composed, id: 'aud-stale', platformMasterListId: '111' }] });
      late.complete();
      await pending;
      fixture.detectChanges();

      expect(internals().emailAudience()?.id, 'a stale read-back overwrote the composed audience').toBe('aud-9');
    });

    /**
     * A stage switch does not stop a compose already in flight on the Audience tab, and its reply
     * names the brief it was dispatched with. Accepting it would put the previous stage's list on
     * this stage's send.
     */
    it('ignores a composed audience for a brief the parent no longer holds', STATE_ONLY, () => {
      onImplementTab();
      internals().emailBriefId.set('brief-other');
      internals().onAudienceComposed(composed);
      fixture.detectChanges();

      expect(internals().emailAudience(), 'an audience for another brief was attached to this send').toBeNull();
      expect(internals().canStageEmail()).toBe(false);
    });

    it('ignores a composed audience while no brief is held', STATE_ONLY, () => {
      onImplementTab();
      internals().emailBriefId.set('');
      internals().onAudienceComposed({ ...composed, briefId: '' });

      expect(internals().emailAudience()).toBeNull();
    });

    it('names the composed origin rather than claiming the audience came from the event details', () => {
      onImplementTab();
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      expect(host.textContent).toContain('Audience attached');
      // Recorded on the row all along and rendered nowhere until now: it is what the operator
      // searches HubSpot for when checking what a send will actually go to.
      expect(host.querySelector('[data-testid="campaigns-email-audience-master-list"]')?.textContent).toContain('900');
    });

    /**
     * The list is real, it consumed contact quota, and NO other screen in this app will ever
     * mention it again -- so dropping this would leave an orphaned HubSpot list the operator has
     * no route back to. No retry is offered, for the reason the template already records: compose
     * is not idempotent, and a second attempt mints a second list for the same send.
     */
    it('warns about a master list that attached to nothing, and links to it', () => {
      onImplementTab();
      internals().onAudienceComposeUnattached(looseHere());
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      const warning = host.querySelector('[data-testid="campaigns-email-audience-unattached"]');
      expect(warning, 'a list was created in HubSpot with nothing on screen naming it').not.toBeNull();
      expect(warning?.textContent).toContain('27Q2 - KubeCon EU 2026 - Master');
      expect(host.querySelector<HTMLAnchorElement>('[data-testid="campaigns-email-audience-unattached-link"]')?.getAttribute('href')).toBe(
        looseMaster.hubspotUrl
      );
      // Staging stays blocked: nothing was attached, so a send here would have no recipients.
      expect(internals().canStageEmail()).toBe(false);
    });

    it('still names a loose master list with no HubSpot URL, but offers no link to it', () => {
      // A blank URL renders href="", which opens this app instead of the list.
      onImplementTab();
      internals().onAudienceComposeUnattached({ ...looseHere(), master: { ...looseMaster, hubspotUrl: '' } });
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      expect(host.querySelector('[data-testid="campaigns-email-audience-unattached"]')?.textContent).toContain('27Q2 - KubeCon EU 2026 - Master');
      expect(host.querySelector('[data-testid="campaigns-email-audience-unattached-link"]'), 'a blank URL rendered a link back to this app').toBeNull();
    });

    /**
     * The derived build that used to live in this block is gone, and must stay gone.
     *
     * It wrote a NEW audience row while dispatch resolves the newest, so one click silently
     * switched the send away from the hand-assembled list -- which stayed in HubSpot, paid for and
     * unmentioned. An acknowledgement gate was the previous answer and was not enough: nothing on
     * this screen could report the switch after it happened. The Audience tab is now the only
     * producer, so the Implement tab must offer no audience control in ANY state.
     */
    it.each([
      ['nothing yet', (): void => undefined],
      ['a loose master list', (): void => internals().onAudienceComposeUnattached(looseHere())],
      ['a failed audience', (): void => internals().emailAudience.set({ ...composed, status: 'failed' })],
    ])('offers no way to produce an audience from the Implement tab with %s', (_label, arrange) => {
      onImplementTab();
      arrange();
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      expect(host.querySelector('[data-testid="campaigns-email-audience-btn"]'), 'a build control came back to the Implement tab').toBeNull();
      expect(host.querySelector('[data-testid="campaigns-email-audience-supersede-btn"]')).toBeNull();
    });

    /** With no control offered, the empty state has to say where an audience comes from. */
    it('points at the Audience tab when there is no audience yet', () => {
      onImplementTab();

      const empty = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-empty"]');
      expect(empty?.textContent, 'the block was a dead end: no audience, no control, no instruction').toContain('Audience');
    });

    it('drops the reconcile warning once an audience actually attaches', () => {
      onImplementTab();
      internals().onAudienceComposeUnattached(looseHere());
      fixture.detectChanges();

      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      fixture.detectChanges();

      expect(internals().emailAudienceUnattached(), 'a stale warning survived the attach it was waiting for').toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-audience-unattached"]')).toBeNull();
    });

    it("keeps a stale reply's warning under the brief it was composed for", () => {
      // A brief switch does not cancel a compose in flight. Filed by the brief on screen when the
      // reply landed, the previous brief's list was offered as this email's recovery.
      onImplementTab();
      internals().emailBriefId.set('brief-b');
      internals().onAudienceComposeUnattached({
        master: looseMaster,
        briefId: 'brief-a',
        projectSlug: internals().activeFoundationSlug(),
        scope: internals().emailAudienceScope(),
      });
      fixture.detectChanges();

      expect(internals().emailAudienceUnattached(), "brief A's loose list was shown on brief B").toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-audience-unattached"]')).toBeNull();

      // Kept, not dropped: the list is real, and its own brief still needs the warning.
      internals().emailBriefId.set('brief-a');
      expect(internals().emailAudienceUnattached()).toEqual(looseMaster);
    });

    it('keeps a brief-less warning once the plan save fills the brief id', STATE_ONLY, () => {
      // A compose run before the plan was saved is filed under no brief. The save that follows fills
      // `emailBriefId`, and looking up the live id alone hid the warning for a list still unattached.
      onImplementTab();
      internals().emailBriefId.set('');
      internals().onAudienceComposeUnattached({
        master: looseMaster,
        briefId: '',
        projectSlug: internals().activeFoundationSlug(),
        scope: internals().emailAudienceScope(),
      });
      internals().emailBriefId.set('brief-saved');
      fixture.detectChanges();

      expect(internals().emailAudienceUnattached(), 'the warning vanished when the plan was saved').toEqual(looseMaster);
    });

    it('drops a brief-less reply that lands after a reset', STATE_ONLY, () => {
      // A brief-less compose has no brief to scope by, so a reply landing after a reset was filed
      // under the shared brief-less key and shown on the NEXT brief, offering A's list for B.
      onImplementTab();
      const dispatched = internals().emailAudienceScope();
      internals().onEmailProceedFromPlanning({ eventDetails: { name: 'Other', slug: 'other' } } as unknown as CampaignBriefOutput);
      internals().onAudienceComposeUnattached({ master: looseMaster, briefId: '', projectSlug: internals().activeFoundationSlug(), scope: dispatched });

      expect(internals().emailAudienceUnattached(), "the previous send's loose list was shown on the next brief").toBeNull();
    });

    it("drops a brief's loose-list warning once a read finds its audience", STATE_ONLY, async () => {
      // With an older campaign-service the attach may have happened despite `recorded: false`. Kept,
      // the warning read "not attached" beside the card naming the same list.
      onImplementTab();
      internals().emailBriefId.set('brief-77');
      internals().onAudienceComposeUnattached({
        master: looseMaster,
        briefId: 'brief-77',
        projectSlug: internals().activeFoundationSlug(),
        scope: internals().emailAudienceScope(),
      });
      vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(
        of({ enabled: true, audiences: [{ id: 'aud-77', briefId: 'brief-77', platform: 'hubspot', status: 'built', version: 1 } as CampaignAudience] })
      );
      expect(internals().emailAudienceUnattached(), 'the precondition: the warning is showing').toEqual(looseMaster);

      await internals().restoreEmailAudience(internals().activeFoundationSlug(), 'brief-77');

      expect(internals().emailAudienceUnattached()).toBeNull();
    });

    it('clears the warning when the brief-derived state resets', STATE_ONLY, () => {
      onImplementTab();
      internals().onAudienceComposeUnattached(looseHere());
      fixture.detectChanges();

      // A handoff into Implement for another brief. The HubSpot list still exists, but the
      // warning is scoped to ONE campaign's send -- carrying it over would accuse a send that
      // composed nothing.
      internals().onEmailProceedFromPlanning({ eventDetails: { name: 'Other', slug: 'other' } } as unknown as CampaignBriefOutput);
      fixture.detectChanges();

      expect(internals().emailAudienceUnattached()).toBeNull();
      expect(internals().emailAudienceOrigin()).toBeNull();
    });
  });

  /**
   * The step order off the Plan tab.
   *
   * Plan used to hand off straight to Implement, which put the one action Implement cannot
   * finish -- staging, which campaign-service refuses without a built audience -- in front of the
   * operator, with the step that unblocks it behind a tab nothing pointed at. These pin the
   * order and BOTH exits from the audience step, because the audience is optional to writing the
   * email and mandatory only to staging it.
   */
  describe('email flow: plan -> audience -> implement', () => {
    const emailBrief = {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'https://x.example/' },
    } as unknown as CampaignBriefOutput;

    const composed: CampaignAudience = {
      id: 'aud-9',
      briefId: 'brief-77',
      platform: 'hubspot',
      platformMasterListId: '900',
      status: 'built',
      version: 1,
    };

    it('lands on the audience step, not on implement', STATE_ONLY, () => {
      selectEmail();

      internals().onEmailProceedFromPlanning(emailBrief);
      fixture.detectChanges();

      expect(internals().selectedEmailTab()).toBe('audience');
      expect(internals().emailBriefOutput()).toEqual(emailBrief);
    });

    /**
     * The handoff sets the tab signal DIRECTLY rather than going through `selectTab`, so the work
     * that tab's entry does has to be repeated here. Saving the plan is the one that matters: a
     * compose with no brief id creates a real HubSpot list and attaches it to nothing, which is a
     * state this app cannot then fix on the operator's behalf.
     */
    it('saves the plan on arrival, so a compose there can attach what it creates', STATE_ONLY, () => {
      selectEmail();
      const persist = vi
        .spyOn(TestBed.inject(CampaignService), 'persistBrief')
        .mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }) as never);

      internals().onEmailProceedFromPlanning(emailBrief);

      expect(persist).toHaveBeenCalled();
    });

    it('offers a skip on the audience step and leaves for the email', () => {
      selectEmail();
      internals().onEmailProceedFromPlanning(emailBrief);
      fixture.detectChanges();

      const skip = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="campaigns-email-audience-skip-btn"] button');
      expect(skip, 'the audience step had no way out for an operator who wants to write the email first').not.toBeNull();

      skip?.click();
      fixture.detectChanges();

      expect(internals().selectedEmailTab()).toBe('implementation');
      expect(internals().emailAudienceSkipped()).toBe(true);
    });

    /**
     * Skipping re-orders the work; it does not bypass the gate. `resolveBuiltAudience` upstream
     * refuses a brief whose newest HubSpot audience is missing, so a skip that left staging
     * enabled would hand the operator a button whose only outcome is an upstream error.
     */
    it('does not make a send stageable, and says what is missing', () => {
      selectEmail();
      internals().onEmailProceedFromPlanning(emailBrief);
      internals().onSkipAudienceStep();
      internals().selectedEmailTemplateId.set('hs-123');
      fixture.detectChanges();

      expect(internals().canStageEmail()).toBe(false);
      const hint = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-stage-hint"]');
      expect(hint?.textContent).toContain('Audience tab');
    });

    it('reports a skip as a choice and offers the way back', () => {
      selectEmail();
      internals().onEmailProceedFromPlanning(emailBrief);
      internals().onSkipAudienceStep();
      fixture.detectChanges();

      const empty = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-empty"]');
      // Not an error: the operator was invited to skip, so an amber "missing audience" warning
      // would call their own decision a fault.
      expect(empty?.textContent).toContain('You skipped the audience step');

      const back = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="campaigns-email-audience-goto-btn"] button');
      expect(back, 'the blocked send named a tab and left the operator to find it').not.toBeNull();

      back?.click();
      fixture.detectChanges();

      expect(internals().selectedEmailTab()).toBe('audience');
    });

    /** The way back exists whether or not the step was skipped -- being stuck is the same state. */
    it('offers the way back even when the step was never skipped', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const empty = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-empty"]');
      expect(empty?.textContent).not.toContain('You skipped');
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-goto-btn"]')).not.toBeNull();
    });

    /**
     * Continue is a SEPARATE handler from skip, not the same call with another label: recording a
     * skip here would print "You skipped the audience step" directly above the card naming the
     * list that was attached.
     */
    it('swaps skip for continue once an audience is attached, and records no skip', () => {
      selectEmail();
      internals().onEmailProceedFromPlanning(emailBrief);
      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      expect(host.querySelector('[data-testid="campaigns-email-audience-skip-btn"]')).toBeNull();
      host.querySelector<HTMLElement>('[data-testid="campaigns-email-audience-continue-btn"] button')?.click();
      fixture.detectChanges();

      expect(internals().selectedEmailTab()).toBe('implementation');
      expect(internals().emailAudienceSkipped()).toBe(false);
      expect(internals().canStageEmail()).toBe(false); // no template yet -- the audience is not the blocker
    });

    it('drops the skip when an audience arrives after one', STATE_ONLY, () => {
      selectEmail();
      internals().onEmailProceedFromPlanning(emailBrief);
      internals().onSkipAudienceStep();
      expect(internals().emailAudienceSkipped(), 'fixture precondition').toBe(true);

      internals().emailBriefId.set(composed.briefId);
      internals().onAudienceComposed(composed);
      fixture.detectChanges();

      // Otherwise the Implement tab reports a skipped step beside the attached list.
      expect(internals().emailAudienceSkipped()).toBe(false);
    });

    it('drops the skip when a new brief arrives', STATE_ONLY, () => {
      selectEmail();
      internals().onEmailProceedFromPlanning(emailBrief);
      internals().onSkipAudienceStep();

      // A handoff for a DIFFERENT send: the skip belongs to the brief that was skipped.
      internals().onEmailProceedFromPlanning({ eventDetails: { name: 'Other', slug: 'other' } } as unknown as CampaignBriefOutput);

      expect(internals().emailAudienceSkipped()).toBe(false);
    });
  });

  /**
   * The audience read-back on restore.
   *
   * Without it a reload was destructive in a way nothing admitted: `emailAudience` is in-memory
   * only, so a brief that already had a master list came back looking like it had none, and the
   * operator composed a second one -- which newest-row-wins then made the dispatched one.
   */
  describe('email audience restore', () => {
    const stored: CampaignAudience = {
      id: 'aud-stored',
      briefId: 'brief-77',
      platform: 'hubspot',
      platformMasterListId: '900',
      status: 'built',
      version: 2,
    };

    it('repopulates the audience from the stored row', async () => {
      selectEmail();
      const list = vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [stored] }));

      await internals().restoreEmailAudience('tlf', 'brief-77');

      expect(list).toHaveBeenCalledWith('tlf', 'brief-77');
      expect(internals().emailAudience()).toEqual(stored);
      // The point of the read: the reload cannot push the operator into composing a duplicate
      // master list, because the one already attached is on screen.
      expect(internals().emailAudienceOrigin()).toBe('restored');
    });

    /**
     * Matched on `hubspot` rather than taken as "the first row". A brief can carry rows for other
     * platforms, and dispatching an email send against a non-HubSpot audience is not a degraded
     * result -- it is the wrong list entirely.
     */
    it('takes the HubSpot row, not merely the first one', STATE_ONLY, async () => {
      selectEmail();
      const other = { ...stored, id: 'aud-other', platform: 'linkedin' } as unknown as CampaignAudience;
      vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [other, stored] }));

      await internals().restoreEmailAudience('tlf', 'brief-77');

      expect(internals().emailAudience()?.id).toBe('aud-stored');
    });

    it('records an unavailable lookup apart from a failure, and keeps writes blocked', STATE_ONLY, async () => {
      // `enabled: false` is a deploy-time flag: a retry gets the same answer, so it must not be
      // reported as a failure the Audience tab offers to retry.
      selectEmail();
      vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(of({ enabled: false }) as never);

      await internals().restoreEmailAudience('tlf', 'brief-77');

      expect(internals().emailAudienceReadUnavailable()).toBe(true);
      expect(internals().emailAudienceReadFailed()).toBe(false);
      expect(internals().emailAudienceReadPending()).toBe(false);
    });

    it.each([
      ['the cutover flag is off', { enabled: false }],
      ['the read failed', { enabled: true, error: 'The saved audience could not be read.' }],
      ['the brief has no audience yet', { enabled: true, audiences: [] }],
    ])('stays silent when %s', STATE_ONLY, async (_label, result) => {
      selectEmail();
      vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(of(result) as never);

      await internals().restoreEmailAudience('tlf', 'brief-77');

      expect(internals().emailAudience()).toBeNull();
      expect(internals().emailAudienceOrigin()).toBeNull();
    });

    /**
     * Refused before the call, not defaulted. The BFF answers an empty `project` or `brief_id`
     * with a 400, and this path is silent by design -- so there is nowhere to report that 400.
     */
    it.each([
      ['no project', '', 'brief-77'],
      ['no brief id', 'tlf', ''],
    ])('does not provoke a 400 with %s', STATE_ONLY, async (_label, projectSlug, briefId) => {
      selectEmail();
      const list = vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(of({ enabled: true, audiences: [stored] }));

      await internals().restoreEmailAudience(projectSlug, briefId);

      expect(list).not.toHaveBeenCalled();
    });

    it('swallows a thrown read rather than banner-ing a page nobody asked anything of', STATE_ONLY, async () => {
      selectEmail();
      vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(throwError(() => new Error('network')) as never);

      await expect(internals().restoreEmailAudience('tlf', 'brief-77')).resolves.toBeUndefined();
      expect(internals().emailAudience()).toBeNull();
    });

    // A read fails two ways -- upstream answering with `error`, or the call rejecting -- and the
    // guard covered only the first. The thrown arm left the flag false, so compose was offered for
    // a brief whose existing audience the outage had hidden, which is how a SECOND HubSpot master
    // list gets created for one brief. Silent on screen and fail-closed underneath are both true.
    it.each([
      ['upstream answers with an error', { enabled: true, error: 'The saved audience could not be read.' }],
      ['the call rejects', 'throw'],
    ])('records the failure when %s', STATE_ONLY, async (_label, outcome) => {
      selectEmail();
      vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(
        (outcome === 'throw' ? throwError(() => new Error('network')) : of(outcome)) as never
      );

      await internals().restoreEmailAudience('tlf', 'brief-77');

      expect(internals().emailAudienceReadFailed(), 'an unverified audience was treated as a verified absence').toBe(true);
    });

    // The failure belongs to ONE brief. Left set, it locked compose for every LATER brief whose
    // audience had never been read and never failed -- a new brief clears `emailBriefId`, and the
    // restore returns early on an empty id, so nothing would ever clear it but a page reload.
    it('stops reporting a failure once the brief it belonged to is left', STATE_ONLY, async () => {
      selectEmail();
      vi.spyOn(TestBed.inject(CampaignService), 'listAudiences').mockReturnValue(throwError(() => new Error('network')) as never);
      await internals().restoreEmailAudience('tlf', 'brief-77');
      expect(internals().emailAudienceReadFailed(), 'fixture precondition').toBe(true);

      internals().resetEmailBriefDerivedState();

      expect(internals().emailAudienceReadFailed(), "one brief's failed read locked compose for the next brief").toBe(false);
    });
  });

  describe('email preview', () => {
    const copy = {
      subject: 'Three days in Amsterdam',
      preheader: 'Sessions and labs',
      body: '<p>Body</p>',
      cta: 'Register',
      ctaUrl: '',
    };

    it('shows nothing until copy exists', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      // An empty preview frame would suggest the email exists and is blank.
      expect(host.querySelector('[data-testid="campaigns-email-preview"]')).toBeNull();

      internals().emailCopy.set(copy);
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="campaigns-email-preview"]')).not.toBeNull();
    });

    it('warns that staging REPLACES the template content rather than merging into it', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailCopy.set(copy);
      fixture.detectChanges();

      // The upstream rule this pinned did change, exactly as the previous version of this test
      // said it should: bodyHtml used to apply only to a single-widget draft, so the note warned
      // that a multi-widget template kept its own body. RebuildEmailContent now replaces the
      // whole widget tree, so the warning that matters is the REVERSE one — the operator needs to
      // know the template's own images and footer do not survive.
      const note = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-preview-note"]');
      expect(note?.textContent).toContain('replaced, not merged');
      expect(note?.textContent).not.toContain('keeps its own body');
    });
  });

  it('renders the hero banner note from the shared template', () => {
    selectEmail();
    // The preview panels live on the implementation tab; the default tab renders none of them.
    internals().selectedEmailTab.set('implementation');
    internals().emailCopy.set({ subject: 's', preheader: 'p', body: '<p>b</p>', cta: '', ctaUrl: '' } as never);
    internals().emailBriefOutput.set({
      eventDetails: { heroImageUrl: 'https://cdn.events.example.org/banner.png' },
    } as never);
    fixture.detectChanges();

    // The note lives in ONE `ng-template` used from each preview panel, so the panels cannot
    // drift apart. Asserting it renders at all is what makes the extraction safe: the markup was
    // previously triplicated, and nothing covered any of the three copies.
    const host: HTMLElement = fixture.nativeElement;
    const notes = host.querySelectorAll('[data-testid="campaigns-email-preview-hero"]');
    // One panel renders under this fixture; the other two sit behind further conditions (a
    // staged draft and an A/B variant). A hard count of 3 would assert an assumption rather than
    // the fixture -- it fails at 1 -- so this pins what is actually reachable here: the note
    // renders, it NAMES the host, and it never becomes an <img>.
    expect(notes.length).toBeGreaterThan(0);
    // And it NAMES the host rather than loading it -- no <img> may appear in the rendered note.
    for (const note of Array.from(notes)) {
      expect(note.textContent).toContain('cdn.events.example.org');
      expect(note.querySelector('img')).toBeNull();
    }
  });

  it('sanitizes variant B for the preview', STATE_ONLY, () => {
    selectEmail();
    internals().abTestForm.controls.enabled.setValue(true);
    internals().abTestForm.controls.subjectB.setValue('B subject');
    internals().abTestForm.controls.bodyHtmlB.setValue('<p>Hi</p><img src="https://evil.example/p.gif">');
    fixture.detectChanges();

    // Sanitizing only the preview is WORSE than sanitizing neither: the pixel vanishes from the
    // one view that could catch it while still shipping in the sent email.
    //
    // The name says PREVIEW only, deliberately. Staging reads `abTestBodyHtmlBForSend`, which
    // WRAPS this value rather than aliasing it, so asserting the two equal would be a tautology
    // only where the refused-CTA fold-back adds nothing. The fold-back itself is pinned by
    // 'folds a refused CTA into BOTH variants, or neither'.
    //
    // The staged value is covered where it can actually fail: the controller test
    // 'sanitizes both HTML bodies and every display field at the request boundary' asserts the
    // emitted payload, which is what ships.
    const preview = internals().abTestBodyHtmlBPreview();
    expect(preview).not.toContain('<img');
    expect(preview).toContain('Hi');
  });

  it('names the hero image host, and falls back to empty for an unusable url', STATE_ONLY, () => {
    selectEmail();
    // `emailHeroImageUrl` is gated on `emailBodyIsStageable`, so the copy has to be present --
    // the hero is only named when it will actually be staged.
    internals().emailCopy.set({ subject: 's', preheader: 'p', body: '<p>b</p>', cta: '', ctaUrl: '' } as never);
    internals().emailBriefOutput.set({
      eventDetails: { heroImageUrl: 'https://cdn.events.example.org/banner.png' },
    } as never);
    fixture.detectChanges();
    expect(internals().emailHeroImageHost()).toBe('cdn.events.example.org');

    // The catch branch, which is REACHED rather than defensive: `new URL('')` throws, and a
    // brief with no usable heroImageUrl is the ordinary case. Untested, this could return
    // `undefined` and the preview would read "Event banner from undefined".
    internals().emailBriefOutput.set({ eventDetails: { heroImageUrl: '' } } as never);
    fixture.detectChanges();
    expect(internals().emailHeroImageHost()).toBe('');

    internals().emailBriefOutput.set({ eventDetails: { heroImageUrl: 'not a url' } } as never);
    fixture.detectChanges();
    expect(internals().emailHeroImageHost()).toBe('');
  });

  it('refuses to stage a variant B body that is only a tracking pixel', STATE_ONLY, () => {
    selectEmail();
    internals().abTestForm.controls.enabled.setValue(true);
    internals().abTestForm.controls.subjectB.setValue('B subject');
    // Non-empty raw, EMPTY once sanitized. Gating on the raw value called this stageable and
    // then shipped an empty variant.
    internals().abTestForm.controls.bodyHtmlB.setValue('<img src="https://evil.example/p.gif">');
    fixture.detectChanges();

    expect(internals().abTestBodyHtmlBPreview().trim()).toBe('');
    expect(internals().abTestIsStageable()).toBe(false);
  });
});
