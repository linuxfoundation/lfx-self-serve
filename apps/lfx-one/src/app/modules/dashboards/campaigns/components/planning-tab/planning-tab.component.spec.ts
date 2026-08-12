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

  it('replaces the offer as soon as a different event url is typed', async () => {
    // The invariant: the page must never offer event A while the field NAMES event B.
    //
    // Asserted INSIDE the debounce window, deliberately. Waiting it out lets the second lookup
    // answer `none`, and `applySavedBrief` nulls `savedBrief` on its own — so the assertion would
    // pass whether or not the eager clear ran, which is the false-pass shape this file already
    // had to fix once for `skip(1)`. Verified by deleting the eager clear: this fails, and the
    // debounce-waiting version did not.
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-a' }))
    );
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(savedBrief()).toEqual(exampleBrief);

    // Type event B and stop before the debounce fires: no lookup has answered yet, so anything
    // still on screen is there because the input handler left it.
    const component = fixture.componentInstance as unknown as {
      briefForm: { controls: { url: { setValue(v: string): void } } };
      onUrlInput(): void;
    };
    component.briefForm.controls.url.setValue('https://events.example.com/oss-na-2026');
    component.onUrlInput();
    fixture.detectChanges();

    expect(savedBrief()).toBeNull();
    expect(savedBriefWarning()).toBeNull();
  });

  it('refuses to restore once the field no longer names the offered event', async () => {
    // The offer is deliberately KEPT while the url is empty or half-typed: clearing it there
    // strands it, because `onUrlChange` issues a lookup only when the slug CHANGES and retyping
    // the same url is correctly a no-op. But keeping it VISIBLE must not mean acting on it — the
    // panel reads "A brief was already saved for <A>" while the field is being edited toward B,
    // and restoring then hands Implementation a brief for the event the user is leaving.
    const emitted: unknown[] = [];
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-a' }))
    );
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    const component = fixture.componentInstance as unknown as {
      briefForm: { controls: { url: { setValue(v: string): void } } };
      onUrlInput(): void;
      restoreSavedBrief(): void;
      restoreSavedBriefRequested: { subscribe(fn: (v: unknown) => void): void };
    };
    component.restoreSavedBriefRequested.subscribe((v) => emitted.push(v));

    // While the field still names event A, restore works — the case the offer exists for.
    component.restoreSavedBrief();
    expect(emitted).toHaveLength(1);

    // Now the user starts retyping: the field is momentarily empty.
    component.briefForm.controls.url.setValue('');
    component.onUrlInput();
    fixture.detectChanges();

    // The offer is still on screen (not stranded)...
    expect(savedBrief()).toEqual(exampleBrief);
    // ...but must no longer be applicable.
    component.restoreSavedBrief();
    expect(emitted).toHaveLength(1);
  });

  it('keeps the restore offer across Cancel', async () => {
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123' }))
    );
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(savedBrief()).toEqual(exampleBrief);

    // Cancel / New Brief. It discards the GENERATED brief; it says nothing about the stored one,
    // which is still there and still the user's.
    (fixture.componentInstance as unknown as { reset(): void }).reset();
    await new Promise((resolve) => setTimeout(resolve, BRIEF_LOOKUP_DEBOUNCE_WAIT_MS));
    await fixture.whenStable();

    // Clearing it stranded the offer permanently rather than hiding it: `onUrlChange` issues a
    // lookup only when the slug CHANGES, and reset leaves the url untouched, so retyping the same
    // url is correctly a no-op and no keystroke could bring the offer back. The next Proceed then
    // created a second row and hit the unowned-brief conflict.
    expect(savedBrief()).toEqual(exampleBrief);
    // And no re-fetch is needed to achieve it — the offer depends on `(slug, foundation)`, which
    // reset does not touch. A second lookup here would mean the fix was papering over a clear.
    expect(campaignService.loadBrief).toHaveBeenCalledTimes(1);
  });

  it('warns about an unreadable brief when lookup returns status=unreadable', async () => {
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'unreadable', brief: null, briefId: 'brief-456' }))
    );

    await typeEventUrl('https://events.example.com/old-event');

    expect(campaignService.loadBrief).toHaveBeenCalled();
    expect(savedBrief()).toBeNull();
    expect(savedBriefWarning()).toContain('could not be opened');
    // The warning must NOT promise a replace. An unreadable brief cannot be restored, so the
    // page never holds its id and the save is refused as unowned (LFXV2-3200) — telling the user
    // their new brief will replace the old one describes an outcome that cannot happen, and
    // leaves them with no explanation when the save is refused.
    expect(savedBriefWarning()).toContain('cannot be saved over it');
    expect(savedBriefWarning()).not.toContain('will replace it');
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

  /**
   * Clearing the URL field and retyping the SAME one must leave the offer intact.
   *
   * The naive guard — clear whenever the slug differs — loses it: emptying the field sets the
   * tracked slug to '' with no lookup issued, so retyping clears the offer again and pushes a
   * slug `distinctUntilChanged` may drop as unchanged, leaving nothing to re-fetch it. The
   * tracked slug therefore records what was last LOOKED UP rather than what was last typed.
   */
  it('keeps the restore offer when the url is cleared and the same one retyped', async () => {
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123' }))
    );
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(savedBrief()).toEqual(exampleBrief);

    await typeEventUrl('');
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');

    expect(savedBrief()).toEqual(exampleBrief);
  });

  /**
   * Restoring must emit on `restoreSavedBriefRequested`, NOT `proceedToImplementation`.
   *
   * The parent persists whatever arrives on `proceedToImplementation`. A restored brief came
   * out of campaign-service moments earlier, so routing it there makes a read perform a write:
   * `saveBrief` finds the row and PUTs, bumping `version`, and what it writes is
   * `fromBriefResponse`'s reconstruction rather than the stored bytes — `event_details`,
   * `copy`, `keywords` and `targeting` are opaque in the service design, so anything the
   * adapter does not model is silently replaced. Asserting the CHANNEL is what pins that.
   */
  it('emits a restored brief on the restore output, not the generate output', async () => {
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123' }))
    );
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(savedBrief()).toEqual(exampleBrief);

    const restored: { brief: CampaignBriefOutput; briefId: string }[] = [];
    const generated: CampaignBriefOutput[] = [];
    fixture.componentInstance.restoreSavedBriefRequested.subscribe((e) => restored.push(e));
    fixture.componentInstance.proceedToImplementation.subscribe((b) => generated.push(b));

    (fixture.componentInstance as unknown as { restoreSavedBrief(): void }).restoreSavedBrief();
    await fixture.whenStable();

    expect(restored).toEqual([{ brief: exampleBrief, briefId: 'brief-123' }]);
    expect(generated).toEqual([]);
  });

  /**
   * The restore carries the brief ID, and that is load-bearing rather than incidental.
   *
   * The parent sends it with the next save as proof of ownership; without it the server treats
   * the save as unowned and REFUSES to replace, so a restored brief could never be saved back
   * (LFXV2-3200). Asserted separately from the channel test above because the two can regress
   * independently — emitting on the right output with a missing id is a silent half-fix.
   */
  it('carries the brief id with the restored brief', async () => {
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-xyz' }))
    );
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');

    const restored: { brief: CampaignBriefOutput; briefId: string }[] = [];
    fixture.componentInstance.restoreSavedBriefRequested.subscribe((e) => restored.push(e));

    (fixture.componentInstance as unknown as { restoreSavedBrief(): void }).restoreSavedBrief();
    await fixture.whenStable();

    expect(restored).toHaveLength(1);
    expect(restored[0].briefId).toBe('brief-xyz');
  });
});
