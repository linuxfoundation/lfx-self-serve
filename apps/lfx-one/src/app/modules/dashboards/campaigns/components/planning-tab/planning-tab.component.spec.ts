// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import type { CampaignBriefLoadResult, CampaignBriefOutput, CampaignProgramTypeOption } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
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
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
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
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123', etag: 'W/"v1"', approved: true }))
    );

    await typeEventUrl('https://events.example.com/kubecon-eu-2026');

    expect(campaignService.loadBrief).toHaveBeenCalledWith('kubecon-eu-2026', 'foundation-a');
    expect(savedBrief()).toEqual(exampleBrief);
    expect(savedBriefWarning()).toBeNull();
  });

  it('still offers restore when the stored brief slug differs from the url segment', async () => {
    // The lookup runs BEFORE generation, so its only key is the url's last segment; persistence
    // keys on `eventDetails.slug`, which the scraper returns and may normalise or resolve through
    // a redirect. Copilot flagged the divergence as a missed-row bug.
    //
    // It is not one, and this pins why. The parent builds its ownership key from the RESTORED
    // brief's own `eventDetails.slug` (`ownershipKey` in campaigns.component.ts), not from the url
    // -- and the restored brief came back FROM the row, so it is filed under exactly that name.
    // The two keys already agree where it matters.
    //
    // A regression guard, not a fix. It exists because the obvious repair -- adopting the stored
    // slug as `currentSlug` -- BREAKS this: `restoreSavedBrief` compares `currentSlug` against
    // `extractSlug(url)` to refuse a restore for an event the user navigated away from, so
    // overwriting it makes an unchanged url fail its own guard and silently disables the button.
    // This test fails if anyone tries that again.
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) =>
        s.next({
          status: 'loaded',
          brief: { ...exampleBrief, eventDetails: { ...exampleBrief.eventDetails, slug: 'kubecon-europe-2026' } },
          briefId: 'brief-123',
          etag: 'W/"v1"',
          approved: true,
        })
      )
    );

    // The url segment is `kubecon-eu-2026`; the STORED brief is named `kubecon-europe-2026`.
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(campaignService.loadBrief).toHaveBeenCalledWith('kubecon-eu-2026', 'foundation-a');

    const emitted: { brief: CampaignBriefOutput }[] = [];
    const component = fixture.componentInstance as unknown as {
      restoreSavedBrief(): void;
      restoreSavedBriefRequested: { subscribe(fn: (v: { brief: CampaignBriefOutput }) => void): void };
    };
    component.restoreSavedBriefRequested.subscribe((v) => emitted.push(v));
    component.restoreSavedBrief();

    // Restore fires, and carries the STORED slug -- which is what the parent keys ownership on.
    expect(emitted).toHaveLength(1);
    expect(emitted[0].brief.eventDetails?.slug).toBe('kubecon-europe-2026');
  });

  it('warns when the stored brief was never approved', async () => {
    // campaign-service creates every brief as `draft`; approval is a SECOND call. A save whose
    // approve step failed leaves a durable but unusable row -- campaign creation and audience
    // building both gate on `approved`. Restoring suppresses the next save, so nothing retries,
    // and without this warning the user gets a brief that silently cannot proceed.
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123', etag: 'W/"v1"', approved: false }))
    );

    await typeEventUrl('https://events.example.com/kubecon-eu-2026');

    // Still offered -- it is real, restorable content, and reviewing it is the point.
    expect(savedBrief()).toEqual(exampleBrief);
    expect(savedBriefWarning()).toContain('never approved');
  });

  it('announces the unapproved warning alongside the restore offer', async () => {
    // The offer used to win outright, which was right while a warning meant there was nothing to
    // restore. A loaded-but-unapproved brief now sets BOTH -- announcing only the offer drops the
    // half that says the brief cannot be used downstream, so a screen-reader user hears
    // "restore is available" and nothing about why it will not proceed.
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123', etag: 'W/"v1"', approved: false }))
    );

    await typeEventUrl('https://events.example.com/kubecon-eu-2026');

    const announcement = (fixture.componentInstance as unknown as { savedBriefAnnouncement(): string }).savedBriefAnnouncement();
    expect(announcement).toContain('A restore action is available.');
    expect(announcement).toContain('never approved');
  });

  it('does not warn when the stored brief is approved', async () => {
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123', etag: 'W/"v1"', approved: true }))
    );

    await typeEventUrl('https://events.example.com/kubecon-eu-2026');

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
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-a', etag: 'W/"v1"', approved: true }))
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
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-a', etag: 'W/"v1"', approved: true }))
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
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123', etag: 'W/"v1"', approved: true }))
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
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'unreadable', brief: null, briefId: 'brief-456', etag: 'W/"v1"', approved: false }))
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
    const newLookup = new Observable<CampaignBriefLoadResult>((s) =>
      s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-new', etag: 'W/"v1"', approved: true })
    );

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
      etag: 'W/"v1"',
      approved: true,
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
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123', etag: 'W/"v1"', approved: true }))
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
    slowNewFoundationLookup.next({
      status: 'loaded',
      brief: { ...exampleBrief, selectedPlatforms: ['linkedin-ads'] },
      briefId: 'brief-under-b',
      etag: 'W/"v1"',
      approved: true,
    });
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
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123', etag: 'W/"v1"', approved: true }))
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
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123', etag: 'W/"v1"', approved: true }))
    );

    // Lookup under foundation A.
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(campaignService.loadBrief).toHaveBeenCalledWith('kubecon-eu-2026', 'foundation-a');
    const firstCallCount = campaignService.loadBrief.mock.calls.length;

    // Switch foundation without changing the slug. This should trigger another lookup.
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) =>
        s.next({ status: 'loaded', brief: { ...exampleBrief, selectedPlatforms: ['linkedin-ads'] }, briefId: 'brief-under-b', etag: 'W/"v1"', approved: true })
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
  it('re-fetches the offer when the url changes and reverts inside the debounce window', async () => {
    // `distinctUntilChanged` must sit BEFORE `debounceTime`, and this is the case that proves it:
    // with the debounce first, a key that changes and reverts inside the 500ms window never
    // reaches the comparer as an intermediate value. The eager clear in `onUrlInput` has already
    // wiped `savedBrief`, the comparer then drops the reverted pair as unchanged, and no lookup
    // runs -- the offer stranded for a brief that exists.
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-a', etag: 'W/"v1"', approved: true }))
    );
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(savedBrief()).toEqual(exampleBrief);

    const component = fixture.componentInstance as unknown as {
      briefForm: { controls: { url: { setValue(v: string): void } } };
      onUrlInput(): void;
    };

    // Change and revert WITHOUT waiting out the debounce.
    component.briefForm.controls.url.setValue('https://events.example.com/oss-na-2026');
    component.onUrlInput();
    component.briefForm.controls.url.setValue('https://events.example.com/kubecon-eu-2026');
    component.onUrlInput();
    fixture.detectChanges();

    // The eager clear fired, so the offer is gone right now...
    expect(savedBrief()).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, BRIEF_LOOKUP_DEBOUNCE_WAIT_MS));
    await fixture.whenStable();

    // ...and must come back, because the original slug has to be looked up again.
    expect(savedBrief()).toEqual(exampleBrief);
  });

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
    slowFirstLookup.next({ status: 'loaded', brief: exampleBrief, briefId: 'stale-brief', etag: 'W/"v1"', approved: true });
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
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123', etag: 'W/"v1"', approved: true }))
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
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123', etag: 'W/"v1"', approved: true }))
    );
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    expect(savedBrief()).toEqual(exampleBrief);

    const restored: { brief: CampaignBriefOutput; briefId: string }[] = [];
    const generated: CampaignBriefOutput[] = [];
    fixture.componentInstance.restoreSavedBriefRequested.subscribe((e) => restored.push(e));
    fixture.componentInstance.proceedToImplementation.subscribe((b) => generated.push(b));

    (fixture.componentInstance as unknown as { restoreSavedBrief(): void }).restoreSavedBrief();
    await fixture.whenStable();

    // `approved` rides along with the id: campaign-service refuses a create from an unapproved
    // brief, and the parent files a restored brief as create-ready without it.
    expect(restored).toEqual([{ brief: exampleBrief, briefId: 'brief-123', etag: 'W/"v1"', approved: true }]);
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
      new Observable<CampaignBriefLoadResult>((s) => s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-xyz', etag: 'W/"v1"', approved: true }))
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

/**
 * LFXV2-3201: the planner serves both delivery types from one component, moded by `deliveryType`.
 *
 * These pin the three things that differ, because each can regress on its own and two of the
 * three fail SILENTLY — a stray `platforms` on the request still returns a valid brief, and a
 * re-shown Ad Channels card still lets the user proceed. Only the `canGenerate` regression is
 * loud, and it is the one that blocked the channel before this ticket.
 */
describe('PlanningTabComponent delivery-type mode', () => {
  let fixture: ComponentFixture<PlanningTabComponent>;
  let generateBrief: ReturnType<typeof vi.fn>;

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

  function canGenerate(): boolean {
    return (fixture.componentInstance as unknown as { canGenerate(): boolean }).canGenerate();
  }

  /** Fill only the fields the form marks required, so validity is the sole remaining variable. */
  function fillRequiredFields(): void {
    const form = (fixture.componentInstance as unknown as { briefForm: FormGroup }).briefForm;
    form.controls['url'].setValue('https://events.example.com/kubecon-eu-2026');
    fixture.detectChanges();
  }

  /**
   * Deselect every ad platform, which the paid default pre-populates with google-ads.
   *
   * Writes the signal rather than clicking, because in email mode the Ad Channels card is not
   * rendered and there IS no click path. That is the point: the email assertion below is that
   * `canGenerate` does not consult the platform set at all, so it must hold for a set the UI
   * cannot produce. The paid case is the one where a user reaches this state by clicking.
   */
  function clearPlatforms(): void {
    (fixture.componentInstance as unknown as { selectedPlatforms: { set(v: Set<string>): void } }).selectedPlatforms.set(new Set());
    fixture.detectChanges();
  }

  async function build(deliveryType?: 'paid-marketing' | 'email'): Promise<void> {
    fixture = TestBed.createComponent(PlanningTabComponent);
    fixture.componentRef.setInput('programTypeConfig', programTypeConfig);
    if (deliveryType) {
      fixture.componentRef.setInput('deliveryType', deliveryType);
    }
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanningTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    // Never completes: generate() stays in flight, so the request argument is observable without
    // the component advancing past 'generating' and clearing the state under test.
    generateBrief = vi.fn().mockReturnValue(new Subject());
    vi.spyOn(TestBed.inject(CampaignService), 'generateBrief').mockImplementation(generateBrief);

    const projectContextService = TestBed.inject(ProjectContextService);
    projectContextService.setRouteLensKind('foundation');
    projectContextService.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);
  });

  it('hides the Ad Channels card in email mode', async () => {
    await build('email');
    // querySelector, not debugElement.query: the latter walks the LOGICAL tree and resolves nodes
    // that are no longer rendered, which would make this assertion vacuous.
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-platforms-section"]')).toBeNull();
  });

  it('keeps the Ad Channels card in paid mode', async () => {
    await build('paid-marketing');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-platforms-section"]')).not.toBeNull();
  });

  it('defaults to paid mode when deliveryType is not bound', async () => {
    // The input is additive: the paid container binds nothing, so an omitted binding must keep
    // exactly the pre-3201 behaviour rather than silently switching a live tab to email.
    await build();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-platforms-section"]')).not.toBeNull();
  });

  /**
   * Brief persistence is keyed on `(foundation, event)` with no delivery type, so the row this
   * would find is a PAID brief — restoring it under Email would put RSA headlines and a keyword
   * list into an email plan. The email host also binds no `restoreSavedBriefRequested` handler,
   * so the Restore button emitted into nothing and the click did nothing at all.
   *
   * Asserted on the REQUEST rather than the banner: suppressing the lookup means no call per
   * debounce for a result that can never be used, and a banner-only guard would leave that.
   */
  it('does not look up a saved brief in email mode', async () => {
    const loadBrief = vi.fn().mockReturnValue(new Subject());
    vi.spyOn(TestBed.inject(CampaignService), 'loadBrief').mockImplementation(loadBrief);

    await build('email');
    const component = fixture.componentInstance as unknown as { briefForm: FormGroup; onUrlInput(): void };
    component.briefForm.controls['url'].setValue('https://events.example.com/kubecon-eu-2026');
    fixture.detectChanges();
    component.onUrlInput();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await fixture.whenStable();

    expect(loadBrief).not.toHaveBeenCalled();
  });

  it('still looks up a saved brief in paid mode', async () => {
    const loadBrief = vi.fn().mockReturnValue(new Subject());
    vi.spyOn(TestBed.inject(CampaignService), 'loadBrief').mockImplementation(loadBrief);

    await build('paid-marketing');
    const component = fixture.componentInstance as unknown as { briefForm: FormGroup; onUrlInput(): void };
    component.briefForm.controls['url'].setValue('https://events.example.com/kubecon-eu-2026');
    fixture.detectChanges();
    component.onUrlInput();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await fixture.whenStable();

    expect(loadBrief).toHaveBeenCalled();
  });

  /**
   * The server refuses an email refine, so offering the button would walk the user into a
   * guaranteed error. Asserted on the review step, which is the only place it renders.
   */
  it('does not offer Refine Brief in email mode', async () => {
    await build('email');
    (fixture.componentInstance as unknown as { step: { set(v: string): void } }).step.set('review');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-refine-brief-btn"]')).toBeNull();
  });

  it('offers Refine Brief in paid mode', async () => {
    await build('paid-marketing');
    (fixture.componentInstance as unknown as { step: { set(v: string): void } }).step.set('review');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-refine-brief-btn"]')).not.toBeNull();
  });

  /**
   * Edit and Copy All are as wrong for email as Refine was, and guarding only Refine left the two
   * worse ones behind: Edit opens an EMPTY editor whose Save Edits writes empty
   * `google_search`/`google_display` objects onto an email brief, and Copy All silently copies an
   * empty buffer. Both entry points to Edit are covered — the header one and the action row.
   */
  it('hides the ad-copy actions in email mode', async () => {
    await build('email');
    (fixture.componentInstance as unknown as { step: { set(v: string): void } }).step.set('review');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="planning-refine-brief-btn"]')).toBeNull();
    expect(host.querySelector('[data-testid="planning-edit-brief-btn"]')).toBeNull();
    expect(host.querySelector('[data-testid="planning-copy-all-btn"]')).toBeNull();
    expect(host.querySelector('[data-testid="planning-edit-btn"]')).toBeNull();
    // Delivery-agnostic, so it must SURVIVE — otherwise this test would pass on a template that
    // rendered no review step at all.
    expect(host.querySelector('[data-testid="planning-proceed-btn"]')).not.toBeNull();
  });

  it('keeps the ad-copy actions in paid mode', async () => {
    await build('paid-marketing');
    (fixture.componentInstance as unknown as { step: { set(v: string): void } }).step.set('review');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="planning-refine-brief-btn"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="planning-edit-brief-btn"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="planning-copy-all-btn"]')).not.toBeNull();
  });

  it('hides the Budget & Assets card in email mode', async () => {
    await build('email');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-budget-section"]')).toBeNull();
  });

  it('keeps the Budget & Assets card in paid mode', async () => {
    await build('paid-marketing');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-budget-section"]')).not.toBeNull();
  });

  /**
   * The card being hidden is not on its own enough. The control still exists, so a value can
   * reach it without the card rendering — restoring a paid brief repopulates the form. The server
   * appends "Total Campaign Budget: $N" to the copy prompt, so a stray value would put a paid-ad
   * number into an email brief rather than merely go unread.
   */
  it('drops a populated budget from the email generation request', async () => {
    await build('email');
    fillRequiredFields();
    const form = (fixture.componentInstance as unknown as { briefForm: FormGroup }).briefForm;
    form.controls['totalBudget'].setValue('5000');
    fixture.detectChanges();

    (fixture.componentInstance as unknown as { generate(): void }).generate();
    await fixture.whenStable();

    // Arg 0 is the project slug the BFF's FGA middleware scopes access to — a wrong or empty
    // value here would 403 a legitimately-scoped campaign manager without this test noticing.
    expect(generateBrief.mock.calls[0][0]).toBe('foundation-a');
    expect(generateBrief.mock.calls[0][1].totalBudget).toBeUndefined();
  });

  it('sends a populated budget in paid mode', async () => {
    await build('paid-marketing');
    fillRequiredFields();
    const form = (fixture.componentInstance as unknown as { briefForm: FormGroup }).briefForm;
    form.controls['totalBudget'].setValue('5000');
    fixture.detectChanges();

    (fixture.componentInstance as unknown as { generate(): void }).generate();
    await fixture.whenStable();

    expect(generateBrief.mock.calls[0][0]).toBe('foundation-a');
    expect(generateBrief.mock.calls[0][1].totalBudget).toBe(5000);
  });

  it('allows generation in email mode with no ad platform selected', async () => {
    await build('email');
    fillRequiredFields();
    clearPlatforms();
    expect(canGenerate()).toBe(true);
  });

  it('still requires an ad platform in paid mode', async () => {
    await build('paid-marketing');
    fillRequiredFields();
    clearPlatforms();
    expect(canGenerate()).toBe(false);
  });

  it('omits platforms from the generation request in email mode', async () => {
    await build('email');
    fillRequiredFields();
    (fixture.componentInstance as unknown as { generate(): void }).generate();
    await fixture.whenStable();

    expect(generateBrief).toHaveBeenCalledTimes(1);
    expect(generateBrief.mock.calls[0][0]).toBe('foundation-a');
    const request = generateBrief.mock.calls[0][1];
    // Absent, not empty: `[]` would claim the user deselected every channel rather than that ad
    // channels do not apply. `toBeUndefined` alone would pass on an explicit `platforms: undefined`,
    // so assert the key is not present at all.
    expect('platforms' in request).toBe(false);
    // The discriminator is the half that actually works. Omitting `platforms` alone does NOT stop
    // ad generation — the server reads an absent list as the paid default — so without this
    // assertion, deleting `deliveryType` from the request would leave this test green while
    // restoring the exact AI spend the test is named for.
    expect(request.deliveryType).toBe('email');
  });

  it('sends platforms in the generation request in paid mode', async () => {
    await build('paid-marketing');
    fillRequiredFields();
    (fixture.componentInstance as unknown as { generate(): void }).generate();
    await fixture.whenStable();

    expect(generateBrief).toHaveBeenCalledTimes(1);
    expect(generateBrief.mock.calls[0][0]).toBe('foundation-a');
    expect(generateBrief.mock.calls[0][1].platforms).toEqual(['google-ads']);
  });

  /**
   * The Refine button is hidden in email mode, but `submitRefine` must still refuse rather than
   * rely on that. The `currentCopy` guard would otherwise SWALLOW the case — an email brief
   * generates no copy, so `structuredCopy` is null and the method returned silently, leaving
   * anyone who reached Refine (a restored paid brief, a future caller) pressing Regenerate and
   * watching nothing happen. Asserted with copy present so the refusal, not the guard, is what
   * this pins.
   */
  it('refuses an email refine with a message instead of silently doing nothing', async () => {
    const refineBrief = vi.fn().mockReturnValue(new Subject());
    vi.spyOn(TestBed.inject(CampaignService), 'refineBrief').mockImplementation(refineBrief);

    await build('email');
    const component = fixture.componentInstance as unknown as {
      structuredCopy: { set(v: Record<string, unknown>): void };
      refineFeedback: { set(v: string): void };
      errorMessage(): string | null;
      submitRefine(): void;
    };
    component.structuredCopy.set({ subject: 'Join us at KubeCon EU 2026' });
    component.refineFeedback.set('Make the subject shorter');
    component.submitRefine();
    await fixture.whenStable();

    expect(refineBrief).not.toHaveBeenCalled();
    expect(component.errorMessage()).toBe('Refining email copy is not supported yet.');
  });

  it('sends platforms in the refine request in paid mode', async () => {
    const refineBrief = vi.fn().mockReturnValue(new Subject());
    vi.spyOn(TestBed.inject(CampaignService), 'refineBrief').mockImplementation(refineBrief);

    await build('paid-marketing');
    const component = fixture.componentInstance as unknown as {
      structuredCopy: { set(v: Record<string, unknown>): void };
      refineFeedback: { set(v: string): void };
      submitRefine(): void;
    };
    component.structuredCopy.set({ searchHeadlines: ['Attend KubeCon EU 2026'] });
    component.refineFeedback.set('Make the headlines punchier');
    component.submitRefine();
    await fixture.whenStable();

    expect(refineBrief).toHaveBeenCalledTimes(1);
    expect(refineBrief.mock.calls[0][0]).toBe('foundation-a');
    expect(refineBrief.mock.calls[0][1].platforms).toEqual(['google-ads']);
  });
});
