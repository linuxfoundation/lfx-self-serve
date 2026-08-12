// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefLoadResult, CampaignBriefOutput, CampaignProgramTypeOption } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { Observable, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanningTabComponent } from './planning-tab.component';

/**
 * APP-SIDE specs for brief read-back behavior: loading a saved brief from the database when the
 * user types an event URL, offering restore, and handling failures and foundation changes.
 *
 * The server-side implementation of `loadBrief` is tested in the campaign-service Go tests.
 * What is only observable here is what the USER is told: whether a brief is on offer, what
 * warning is shown if one cannot be restored, whether the offer clears on foundation changes,
 * and whether stale lookups are cancelled when the slug changes.
 */
describe('PlanningTabComponent brief read-back', () => {
  const exampleBrief = {
    eventDetails: { slug: 'kubecon-eu-2026', name: 'KubeCon EU 2026' },
    selectedPlatforms: ['google-ads'],
  } as unknown as CampaignBriefOutput;

  const foundationA = {
    uid: 'foundation-a-uid',
    slug: 'foundation-a',
    name: 'Foundation A',
  };

  const foundationB = {
    uid: 'foundation-b-uid',
    slug: 'foundation-b',
    name: 'Foundation B',
  };

  let fixture: ComponentFixture<PlanningTabComponent>;
  let campaignService: { loadBrief: ReturnType<typeof vi.fn> };
  let projectContextService: ProjectContextService;

  // Debounce is 500ms; add 50ms slack for timer jitter (consistent with newsletter.component.spec.ts)
  const BRIEF_LOOKUP_DEBOUNCE_WAIT_MS = 550;

  // Required input for the component
  const programTypeConfig: CampaignProgramTypeOption = {
    id: 'events',
    label: 'Events',
    breadcrumbLabel: 'Events',
    urlLabel: 'Event URL',
    urlPlaceholder: 'https://events.example.com/event-name',
    urlHelp: 'Enter the event registration URL',
    goalLabel: 'Event conversions',
    audiencePlaceholder: 'Enter target audience',
    valuePropPlaceholder: 'Enter value proposition',
  };

  /**
   * Access protected members via type casting, matching campaigns.component.spec.ts pattern.
   * The component wraps `protected readonly` signals, which are not directly exposed.
   */
  function savedBrief(): CampaignBriefOutput | null {
    return (fixture.componentInstance as unknown as { savedBrief(): CampaignBriefOutput | null }).savedBrief();
  }

  function savedBriefWarning(): string | null {
    return (fixture.componentInstance as unknown as { savedBriefWarning(): string | null }).savedBriefWarning();
  }

  /** Type the event URL into the form and trigger the debounced lookup. */
  async function typeEventUrl(url: string): Promise<void> {
    const component = fixture.componentInstance as unknown as { briefForm: { controls: { url: { setValue(v: string): void } } }; onUrlInput(): void };
    component.briefForm.controls.url.setValue(url);
    fixture.detectChanges();
    // Trigger the input handler (protected method accessed via cast).
    component.onUrlInput();
    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, BRIEF_LOOKUP_DEBOUNCE_WAIT_MS));
    await fixture.whenStable();
  }

  /** Simulate a foundation change by calling setFoundation on the ProjectContextService. */
  async function switchFoundation(foundation: typeof foundationA): Promise<void> {
    projectContextService.setFoundation(foundation, false);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanningTabComponent],
      // Real CampaignService against HTTP testing backend, with only `loadBrief` spied.
      // Other methods stay pending, representing the "loading" state.
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), ProjectContextService],
    }).compileComponents();

    campaignService = { loadBrief: vi.fn() };
    vi.spyOn(TestBed.inject(CampaignService), 'loadBrief').mockImplementation(campaignService.loadBrief);
    projectContextService = TestBed.inject(ProjectContextService);

    // Seed the foundation with a starting value so toObservable can emit it.
    // Set the route lens kind to 'foundation' so activeContext returns the foundation selection.
    projectContextService.setRouteLensKind('foundation');
    projectContextService.setFoundation(foundationA, false);

    fixture = TestBed.createComponent(PlanningTabComponent);
    // Set the required input before detecting changes.
    fixture.componentRef.setInput('programTypeConfig', programTypeConfig);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('offers a saved brief for restore when the lookup returns status=loaded', async () => {
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123' }))
    );

    await typeEventUrl('https://events.example.com/kubecon-eu-2026');

    expect(campaignService.loadBrief).toHaveBeenCalledWith('kubecon-eu-2026', 'foundation-a');
    expect(savedBrief()).toEqual(exampleBrief);
    expect(savedBriefWarning()).toBeNull();
  });

  it('warns about an unreadable brief when lookup returns status=unreadable', async () => {
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) =>
        s.next({ status: 'unreadable', brief: null, briefId: 'brief-456' })
      )
    );

    await typeEventUrl('https://events.example.com/old-event');

    expect(campaignService.loadBrief).toHaveBeenCalled();
    expect(savedBrief()).toBeNull();
    expect(savedBriefWarning()).toContain('could not be opened');
    expect(savedBriefWarning()).toContain('Generating a new one will replace it');
  });

  it('warns when lookup fails (catchError transforms to null)', async () => {
    campaignService.loadBrief.mockReturnValue(throwError(() => new Error('Network error')));

    await typeEventUrl('https://events.example.com/failed-lookup');

    expect(campaignService.loadBrief).toHaveBeenCalled();
    expect(savedBrief()).toBeNull();
    expect(savedBriefWarning()).toContain('Could not check whether this event already has a saved brief');
  });

  /**
   * A lookup that is still open when the URL changes must not be allowed to answer. `switchMap`
   * unsubscribes it; `mergeMap` would let it land, and because the user has by then typed a
   * DIFFERENT event, the brief it offers belongs to neither the URL on screen nor the one the
   * restore button would hand forward.
   *
   * Each URL is typed a full debounce apart on purpose. Type them back to back and
   * `debounceTime(500)` collapses the pair into a single emission, so only one lookup ever
   * starts and the test proves nothing about cancellation.
   */
  it('cancels a lookup that is still open when the slug changes', async () => {
    const oldLookup = new Subject<CampaignBriefLoadResult>();
    const newLookup = new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-new' }));

    // First URL: its lookup starts and stays open — `oldLookup` never emits yet.
    campaignService.loadBrief.mockReturnValueOnce(oldLookup);
    await typeEventUrl('https://events.example.com/old-event');
    expect(campaignService.loadBrief).toHaveBeenCalledTimes(1);

    // Second URL, while the first lookup is still in flight.
    campaignService.loadBrief.mockReturnValueOnce(newLookup);
    await typeEventUrl('https://events.example.com/new-event');

    expect(campaignService.loadBrief).toHaveBeenCalledTimes(2);
    expect(savedBrief()?.eventDetails?.name).toBe('KubeCon EU 2026');

    // The first lookup answers last. Nothing is listening, so it cannot displace the newer brief.
    oldLookup.next({
      status: 'loaded',
      brief: { ...exampleBrief, eventDetails: { ...exampleBrief.eventDetails, name: 'Old Event' } },
      briefId: 'brief-old',
    });
    await fixture.whenStable();

    expect(savedBrief()?.eventDetails?.name).toBe('KubeCon EU 2026');
  });

  /**
   * When the foundation changes, the component must clear the saved brief and warning
   * IMMEDIATELY, not wait for the re-lookup to complete. This prevents the old foundation's
   * brief from being offered under the new foundation, where it would be wrong to restore.
   */
  it('clears the brief offer immediately when foundation changes, independent of re-lookup timing', async () => {
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123' }))
    );

    // Seed a brief under foundation A.
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(savedBrief()).toEqual(exampleBrief);

    // Simulate a re-lookup under the new foundation that takes a while to complete.
    const slowNewFoundationLookup = new Subject<CampaignBriefLoadResult>();
    campaignService.loadBrief.mockReturnValue(slowNewFoundationLookup);

    // Change the foundation. The brief should clear IMMEDIATELY, before the new lookup answers.
    await switchFoundation(foundationB);
    await fixture.whenStable();

    expect(savedBrief()).toBeNull();
    expect(savedBriefWarning()).toBeNull();

    // The eager clear above is synchronous, but the re-lookup is not: the pipeline debounces the
    // (slug, foundation) pair by 500ms. Waiting it out is what separates "cleared immediately"
    // from "cleared and never looked again" — without this the assertion below reads the call
    // made under the PREVIOUS foundation and passes for the wrong reason.
    await new Promise((resolve) => setTimeout(resolve, BRIEF_LOOKUP_DEBOUNCE_WAIT_MS));
    await fixture.whenStable();

    // The new lookup should still fire under the new foundation.
    expect(campaignService.loadBrief).toHaveBeenCalledWith('kubecon-eu-2026', 'foundation-b');

    // When it completes, the brief is offered again (under the new foundation).
    slowNewFoundationLookup.next({ status: 'loaded', brief: { ...exampleBrief, selectedPlatforms: ['linkedin-ads'] }, briefId: 'brief-under-b' });
    await fixture.whenStable();

    expect(savedBrief()).not.toBeNull();
    expect(savedBrief()?.selectedPlatforms).toContain('linkedin-ads');
  });

  /**
   * Regression: if `skip(1)` were removed from the foundation-change subscription, the initial
   * foundation would trigger an immediate clear, leaving `savedBrief` empty forever (toObservable
   * replays the current value on subscribe). This test would fail on that bug.
   */
  it('does not clear on initial subscription to the foundation observable (skip(1) guards against replay)', async () => {
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123' }))
    );

    // Type a URL; the lookup completes and sets the brief.
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(savedBrief()).toEqual(exampleBrief);

    // A DIFFERENT slug, deliberately. Retyping the same one proves nothing here: `onUrlInput`
    // clears `savedBrief` eagerly and `distinctUntilChanged` then drops the unchanged
    // (slug, foundation) pair, so no lookup re-runs and the signal stays null whether or not
    // `skip(1)` is present. Only a slug that actually reaches `loadBrief` can show that the
    // foundation-change subscription did NOT fire on its replayed initial value.
    await typeEventUrl('https://events.example.com/kubecon-na-2026');

    expect(savedBrief()).toEqual(exampleBrief);
  });

  /**
   * Verify the combineLatest key includes both slug AND foundation. A brief under foundation-a
   * must not re-use the cached lookup result when the foundation changes to foundation-b,
   * even if the slug is the same. A failed test here indicates the `distinctUntilChanged` key is wrong.
   */
  it('re-runs lookup when foundation changes even if the slug is the same', async () => {
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123' }))
    );

    // Lookup under foundation A.
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(campaignService.loadBrief).toHaveBeenCalledWith('kubecon-eu-2026', 'foundation-a');
    const firstCallCount = campaignService.loadBrief.mock.calls.length;

    // Switch foundation without changing the slug. This should trigger another lookup.
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) =>
        s.next({ status: 'loaded', brief: { ...exampleBrief, selectedPlatforms: ['linkedin-ads'] }, briefId: 'brief-under-b' })
      )
    );
    await switchFoundation(foundationB);
    await new Promise((resolve) => setTimeout(resolve, BRIEF_LOOKUP_DEBOUNCE_WAIT_MS));
    await fixture.whenStable();

    expect(campaignService.loadBrief).toHaveBeenCalledWith('kubecon-eu-2026', 'foundation-b');
    expect(campaignService.loadBrief.mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  /**
   * Regression: `distinctUntilChanged` must sit BEFORE `debounceTime`.
   *
   * With the debounce first, a key change does not reach `switchMap` for another 500ms, so the
   * PREVIOUS lookup stays subscribed across the window and its late response repopulates the
   * offer for a slug the user has already left. Comparing first means the change reaches
   * `switchMap` immediately and it unsubscribes the in-flight request.
   *
   * The first lookup is a Subject that answers only AFTER the slug changed, which is what makes
   * the two orderings distinguishable: under the buggy order its value still lands.
   */
  it('drops an in-flight lookup when the slug changes before it answers', async () => {
    const slowFirstLookup = new Subject<CampaignBriefLoadResult>();
    campaignService.loadBrief.mockReturnValue(slowFirstLookup);

    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(campaignService.loadBrief).toHaveBeenCalledWith('kubecon-eu-2026', 'foundation-a');

    // Move to a different event before the first lookup answers. Its result is now stale.
    //
    // Typed WITHOUT waiting out the debounce, which is the whole point: under the buggy order
    // (debounce before distinct) the new key sits in the debounce window for 500ms while the
    // first lookup stays subscribed, so its late value still lands. Using the normal
    // `typeEventUrl` helper here would wait the window out first and both orderings would pass.
    const secondLookup = new Subject<CampaignBriefLoadResult>();
    campaignService.loadBrief.mockReturnValue(secondLookup);
    const component = fixture.componentInstance as unknown as {
      briefForm: { controls: { url: { setValue(v: string): void } } };
      onUrlInput(): void;
    };
    component.briefForm.controls.url.setValue('https://events.example.com/kubecon-na-2026');
    fixture.detectChanges();
    component.onUrlInput();

    // The abandoned lookup answers late. Nothing must come of it.
    slowFirstLookup.next({ status: 'loaded', brief: exampleBrief, briefId: 'stale-brief' });
    await fixture.whenStable();

    expect(savedBrief()).toBeNull();
  });
});
