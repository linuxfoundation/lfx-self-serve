// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import type { CampaignBriefLoadResult, CampaignBriefOutput, CampaignProgramTypeOption, HubSpotUtmLookupResult } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { EMPTY, Observable, Subject, throwError } from 'rxjs';
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

  it('emits a null etag when the load response omitted the field entirely', async () => {
    // `etag` crosses an HTTP boundary, so the declared `string | null` describes the CURRENT
    // server. Mid-rolling-deploy an older pod omits the field and JSON yields `undefined` — a
    // value the type forbids and the wire produces anyway. Normalising it HERE, at the
    // boundary, gives absence one spelling; otherwise `undefined` reaches the parent, fails its
    // `=== null` test, withholds the overwrite licence, and refuses the first save after every
    // restore as `unverified-validator` for the length of the deploy.
    //
    // The fixture omits `etag` deliberately and casts, because a well-typed literal cannot
    // express the shape an older pod actually sends.
    const emitted: { etag: string | null }[] = [];
    campaignService.loadBrief.mockReturnValue(
      new Observable<CampaignBriefLoadResult>((s) =>
        s.next({ status: 'loaded', brief: exampleBrief, briefId: 'brief-123', approved: true } as unknown as CampaignBriefLoadResult)
      )
    );
    await typeEventUrl('https://events.example.com/kubecon-eu-2026');
    const component = fixture.componentInstance as unknown as {
      restoreSavedBrief(): void;
      restoreSavedBriefRequested: { subscribe(fn: (v: { etag: string | null }) => void): void };
    };
    component.restoreSavedBriefRequested.subscribe((v) => emitted.push(v));

    component.restoreSavedBrief();

    expect(emitted).toHaveLength(1);
    // `toBeNull`, not `toBeFalsy` — `undefined` is falsy too, and passing it through is the bug.
    expect(emitted[0].etag).toBeNull();
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
    const inst = fixture.componentInstance as unknown as Record<string, any>;
    inst['step'].set('review');
    // Copy All is additionally gated on the buffer it copies, so a paid brief that HAS copy is
    // what proves the actions survive. Without this the assertion below would pass for the wrong
    // reason on a brief that simply had nothing to copy.
    inst['copyBuffer'].set('{"google_search":{"headlines":["a"]}}');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="planning-refine-brief-btn"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="planning-edit-brief-btn"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="planning-copy-all-btn"]')).not.toBeNull();
  });

  /**
   * A Microsoft-ONLY paid brief is not email, so `!isEmail()` admits it, but it has no ad copy:
   * Microsoft contributes no copy keys, so `campaign-proxy` emits an empty `copy_structured` and
   * streams no copy token, leaving `copyBuffer` empty. Copy All then wrote an EMPTY clipboard with
   * no feedback — the same silent failure the email guard exists to prevent.
   *
   * Asserted on the buffer rather than on the platform name so the guard also covers any future
   * copy-less platform. Refine and Edit deliberately SURVIVE here: unlike email, this brief has a
   * non-null `structuredCopy` (the empty object), so both are functional.
   */
  it('hides Copy All on a paid brief that produced no ad copy', async () => {
    await build('paid-marketing');
    const inst = fixture.componentInstance as unknown as Record<string, any>;
    inst['step'].set('review');
    inst['copyBuffer'].set('');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="planning-copy-all-btn"]')).toBeNull();
    // Not the email guard firing by accident: the other two ad-copy actions are still rendered.
    expect(host.querySelector('[data-testid="planning-refine-brief-btn"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="planning-edit-brief-btn"]')).not.toBeNull();
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

/**
 * LFXV2-2770: the email brief is a SCRAPE, and the scrape is what gets the date or the city wrong.
 * The generator is instructed to use these fields verbatim, so without an editor the only remedy
 * for a wrong value is to fix the event page upstream and re-scrape.
 */
describe('PlanningTabComponent email brief editing', () => {
  let fixture: ComponentFixture<PlanningTabComponent>;

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

  const scraped = {
    name: 'MCP Dev Summit Nairobi',
    dates: 'March 3-4, 2026',
    city: 'Nairobi',
    countryCode: 'KE',
    audience: 'Developers',
    themes: [],
    registrationUrl: 'https://events.example.com/mcp-dev-summit-nairobi/',
    speakers: [],
    slug: 'mcp-dev-summit-nairobi',
    formatNotes: '',
  };

  interface EmailEditInternals {
    eventDetails: {
      set(v: unknown): void;
      (): { name: string; dates: string; city: string; audience: string; registrationUrl: string } | null;
    };
    isEditingEmailBrief(): boolean;
    emailEditForm: { controls: Record<string, { value: string | null; setValue(v: string): void }> };
    enterEmailEditMode(): void;
    saveEmailEdit(): void;
    cancelEmailEdit(): void;
  }

  function internals(): EmailEditInternals {
    return fixture.componentInstance as unknown as EmailEditInternals;
  }

  /**
   * The brief card lives inside the `step() === 'review'` branch, so a fixture left on the form
   * step renders nothing and every DOM assertion here would pass vacuously.
   */
  async function buildWithScrape(deliveryType: 'paid-marketing' | 'email' = 'email'): Promise<void> {
    fixture = TestBed.createComponent(PlanningTabComponent);
    fixture.componentRef.setInput('programTypeConfig', programTypeConfig);
    fixture.componentRef.setInput('deliveryType', deliveryType);
    fixture.detectChanges();
    await fixture.whenStable();
    internals().eventDetails.set(scraped);
    (fixture.componentInstance as unknown as { step: { set(v: string): void } }).step.set('review');
    fixture.detectChanges();
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

    const projectContextService = TestBed.inject(ProjectContextService);
    projectContextService.setRouteLensKind('foundation');
    projectContextService.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);
  });

  it('renders the scraped brief so the user can see what generation will use', async () => {
    await buildWithScrape();
    const name = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-email-brief-name"]');
    // The VALUE, not just presence: an empty card would still satisfy a presence check.
    expect(name?.textContent?.trim()).toBe('MCP Dev Summit Nairobi');
  });

  it('seeds the editor from the scrape rather than opening blank', async () => {
    await buildWithScrape();
    internals().enterEmailEditMode();
    // An editor that opened blank would silently blank the brief on save.
    expect(internals().emailEditForm.controls['name'].value).toBe('MCP Dev Summit Nairobi');
    expect(internals().isEditingEmailBrief()).toBe(true);
  });

  it('writes the edit back into eventDetails, which is what generation reads', async () => {
    await buildWithScrape();
    internals().enterEmailEditMode();
    internals().emailEditForm.controls['dates'].setValue('March 10-11, 2026');
    internals().saveEmailEdit();
    // Asserting the DESTINATION: an edit that stopped at the form would show the corrected date
    // on screen while content generation still sent the wrong one upstream.
    expect(internals().eventDetails()?.dates).toBe('March 10-11, 2026');
    expect(internals().isEditingEmailBrief()).toBe(false);
  });

  it('discards edits on cancel', async () => {
    await buildWithScrape();
    internals().enterEmailEditMode();
    internals().emailEditForm.controls['name'].setValue('Something else entirely');
    internals().cancelEmailEdit();
    expect(internals().eventDetails()?.name).toBe('MCP Dev Summit Nairobi');
  });

  it('flushes an open editor when the user clicks Proceed without saving', async () => {
    await buildWithScrape();
    const emitted: unknown[] = [];
    (fixture.componentInstance as unknown as { proceedToImplementation: { subscribe(f: (v: unknown) => void): void } }).proceedToImplementation.subscribe((v) =>
      emitted.push(v)
    );

    internals().enterEmailEditMode();
    internals().emailEditForm.controls['dates'].setValue('March 10-11, 2026');
    // Deliberately NOT calling saveEmailEdit: clicking Proceed straight from an open editor is
    // the ordinary path, and dropping the correction there sends the stale scrape to generation
    // while the user is looking at their edit on screen.
    (fixture.componentInstance as unknown as { onProceedToImplementation(): void }).onProceedToImplementation();

    expect((emitted[0] as { eventDetails: { dates: string } }).eventDetails.dates).toBe('March 10-11, 2026');
  });

  /**
   * A failed extraction must not INVENT a country.
   *
   * The fallback record is empty in every field except the name and slug, which are derived from
   * the URL the user typed -- but `countryCode` was hardcoded `'US'`, and it does not stay in the
   * UI: it reaches campaign-service's audience builder as `country`. So a failed scrape for a
   * Nairobi event built a UNITED STATES audience. Real, plausible and wrong, which is worse than
   * an audience that refuses to build.
   */
  /**
   * The country became editable BECAUSE the fallback stopped inventing one.
   *
   * Empty is the honest answer for a failed extraction, but without a field to correct it an
   * operator could not build a country-scoped audience at all — the fix would have traded a wrong
   * audience for no audience.
   */
  it('carries an operator-corrected country code into the emitted brief', async () => {
    await buildWithScrape();
    const emitted: unknown[] = [];
    (fixture.componentInstance as unknown as { proceedToImplementation: { subscribe(f: (v: unknown) => void): void } }).proceedToImplementation.subscribe((v) =>
      emitted.push(v)
    );

    internals().enterEmailEditMode();
    // Lower-case in, upper-case out: `countryNameFor` looks the code up case-sensitively.
    internals().emailEditForm.controls['countryCode'].setValue('ke');
    (fixture.componentInstance as unknown as { onProceedToImplementation(): void }).onProceedToImplementation();

    expect((emitted[0] as { eventDetails: { countryCode: string } }).eventDetails.countryCode).toBe('KE');
  });

  it('does not invent a country when event extraction produced nothing', async () => {
    // Built WITHOUT a scrape, so `eventDetails()` is null and the fallback record is what gets
    // emitted -- the state this test is about. `buildWithScrape` would set it and hide the case.
    fixture = TestBed.createComponent(PlanningTabComponent);
    fixture.componentRef.setInput('programTypeConfig', programTypeConfig);
    fixture.componentRef.setInput('deliveryType', 'email');
    fixture.detectChanges();
    await fixture.whenStable();

    const emitted: unknown[] = [];
    (fixture.componentInstance as unknown as { proceedToImplementation: { subscribe(f: (v: unknown) => void): void } }).proceedToImplementation.subscribe((v) =>
      emitted.push(v)
    );

    // No scrape: `eventDetails()` is null, so the fallback record is what gets emitted.
    (fixture.componentInstance as unknown as { briefForm: { controls: { url: { setValue(v: string): void } } } }).briefForm.controls.url.setValue(
      'https://events.example.com/mcp-dev-summit-nairobi'
    );
    (fixture.componentInstance as unknown as { onProceedToImplementation(): void }).onProceedToImplementation();

    expect((emitted[0] as { eventDetails: { countryCode: string } }).eventDetails.countryCode).toBe('');
  });

  it('closes the editor when a new brief is generated', async () => {
    await buildWithScrape();
    internals().enterEmailEditMode();
    expect(internals().isEditingEmailBrief()).toBe(true);

    (fixture.componentInstance as unknown as { reset(): void }).reset();

    // The flag outliving its brief means the NEXT brief opens straight into an editor seeded from
    // the previous event, and saving then overwrites the new scrape with the old one.
    expect(internals().isEditingEmailBrief()).toBe(false);
  });

  it('does not render the brief card in paid mode', async () => {
    await buildWithScrape('paid-marketing');
    // Paid already has its own structured-copy editor plus the compact strip; a second card
    // would be a duplicate surface.
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-email-brief"]')).toBeNull();
  });

  it('drops the compact strip in email mode so the details are not shown twice', async () => {
    await buildWithScrape();
    // Targets the STRIP's own testid. Asserting on the card's testid instead could never fail:
    // the card is the only thing carrying it, so the count is 1 whether or not the strip renders.
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-event-strip"]')).toBeNull();
  });

  it('keeps the compact strip in paid mode', async () => {
    await buildWithScrape('paid-marketing');
    // The other half of the guard: scoping the strip to paid must not remove it from paid.
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-event-strip"]')).not.toBeNull();
  });
});

describe('PlanningTabComponent — HubSpot UTM states', () => {
  const foundationA = { uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' };
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

  let fixture: ComponentFixture<PlanningTabComponent>;
  let lookup: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;

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

    // A DEFAULT return, because the component re-runs the lookup on a foundation change and
    // tests that switch foundations do not always set one first. Without it the spy returns
    // undefined and `.pipe` throws an UNHANDLED error — which does not fail any individual
    // test, so the suite reports all-green locally while CI fails the run on the error count.
    // Tests that care about the answer override this with their own mockReturnValue.
    lookup = vi.fn(() => EMPTY);
    create = vi.fn();
    vi.spyOn(TestBed.inject(CampaignService), 'lookupHubSpotUtm').mockImplementation(lookup);
    vi.spyOn(TestBed.inject(CampaignService), 'createHubSpotUtm').mockImplementation(create);

    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation(foundationA, false);

    fixture = TestBed.createComponent(PlanningTabComponent);
    fixture.componentRef.setInput('programTypeConfig', programTypeConfig);
    fixture.detectChanges();
  });

  /** Reach the component's private lookup/create the way a click would. */
  function instance(): Record<string, { set(v: unknown): void } & (() => unknown)> {
    return fixture.componentInstance as unknown as Record<string, { set(v: unknown): void } & (() => unknown)>;
  }

  /**
   * Put a url in the field that the component will read back as `eventName`, and return that
   * read-back value.
   *
   * The round trip is NOT the identity: `extractEventName` title-cases each slug word, so
   * "KubeCon NA 2026" comes back as "Kubecon Na 2026". Tests must use the value the COMPONENT
   * derives, or `createInHubSpot`'s guard — which compares the live field against the event the
   * offer was raised for — refuses a create a real user could make.
   *
   * Written without emitting: these tests drive `lookupHubSpot` directly, and letting the
   * control fire would start a second, debounced lookup racing the one under test.
   */
  function setUrlFor(eventName: string): string {
    const slug = eventName.toLowerCase().replace(/ /g, '-');
    (
      fixture.componentInstance as unknown as {
        briefForm: { controls: { url: { setValue(v: string, o?: { emitEvent: boolean }): void } } };
      }
    ).briefForm.controls.url.setValue(`https://events.example.com/${slug}`, { emitEvent: false });
    return slug
      .split('-')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ');
  }

  function runLookup(result: unknown, eventName = 'KubeCon NA 2026'): void {
    // The lookup is driven with the name the FIELD yields, not the caller's spelling, so the
    // panel and the field agree — which is the state a real user is ever in, and the only one
    // in which createInHubSpot will act.
    const derived = setUrlFor(eventName);
    lookup.mockReturnValue(
      new Observable((s) => {
        s.next(result);
        s.complete();
      })
    );
    (fixture.componentInstance as unknown as { lookupHubSpot(name: string): void }).lookupHubSpot(derived);
    fixture.detectChanges();
  }

  /**
   * The create is the whole hazard: it writes into a namespace shared account-wide, and a
   * capped search has not proved the campaign is absent. Both directions are asserted so the
   * guard cannot be satisfied by suppressing the button unconditionally.
   */
  it('offers no create when the lookup was inconclusive, and offers one when it was not', () => {
    for (const [capped, wantButton] of [
      [true, false],
      [false, true],
    ] as const) {
      // A DIFFERENT event name each pass: lookupHubSpot returns early when the event is
      // unchanged, so a repeat with the same name would silently skip the second lookup and
      // assert against the first pass's rendering.
      runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped, inconclusive: capped }, `KubeCon NA 2026 ${capped}`);

      const el = fixture.nativeElement as HTMLElement;
      expect(!!el.querySelector('[data-testid="planning-hubspot-create-btn"]'), `capped=${capped}: create button`).toBe(wantButton);
      expect(!!el.querySelector('[data-testid="planning-hubspot-capped"]'), `capped=${capped}: capped notice`).toBe(!wantButton);
    }
  });

  /**
   * An AMBIGUOUS lookup must still reach the picker.
   *
   * The mapper deliberately reports found:false for a tie or a too-weak match, rather than
   * applying a token nobody chose — but it returns the candidates it refused to choose between.
   * Those arrive on the not-found path, which previously dropped them, leaving the operator with
   * no picker AND no create (inconclusive suppresses that too): a dead end where the one thing
   * they need, choosing between two named campaigns, was the thing removed.
   */
  it('renders the picker for an ambiguous lookup that returned candidates', () => {
    runLookup({
      found: false,
      hs_utm: null,
      campaign_name: '',
      all_matches: [
        { name: 'KubeCon Europe 2026', hs_utm: 'eu-token' },
        { name: 'KubeCon China 2026', hs_utm: 'cn-token' },
      ],
      capped: false,
      inconclusive: true,
    });

    const el = fixture.nativeElement as HTMLElement;
    const picker = el.querySelector('[data-testid="planning-hubspot-matches"]');
    expect(picker, 'the picker must render when candidates came back').toBeTruthy();
    expect(picker?.textContent).toContain('KubeCon Europe 2026');
    expect(picker?.textContent).toContain('KubeCon China 2026');
    // Create stays suppressed on purpose: one of these may BE this event under another name,
    // and creating would duplicate it in a namespace shared portal-wide.
    expect(!!el.querySelector('[data-testid="planning-hubspot-create-btn"]')).toBe(false);
    // ...so the caption must not offer it either. Every path that fills the picker without a
    // selected token also hides Create, so a caption naming it would contradict the notice
    // directly above on the one screen where both appear.
    expect(picker?.textContent).not.toContain('create a new campaign');
  });

  /**
   * An unconfirmed create withdraws the create offer, deliberately — the campaign may already
   * exist. That leaves a fresh lookup as the only way to establish what happened, and
   * `lookupHubSpot` returns early while the event is unchanged, so retyping the same url is a
   * no-op. Without this control the operator is told to check and try again with nothing on the
   * page able to try.
   */
  it('offers a re-check after an unconfirmed create, and the re-check actually runs a lookup', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });
    create.mockReturnValue(
      new Observable((s) => {
        s.next({ created: false });
        s.complete();
      })
    );
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    // The offer is withdrawn and the unknown is surfaced as a control, not just copy.
    expect(instance()['hsNotFound']()).toBe(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="planning-hubspot-create-btn"]')).toBeNull();
    const recheck = el.querySelector('[data-testid="planning-hubspot-recheck-btn"]') as HTMLButtonElement | null;
    expect(recheck).not.toBeNull();

    // And it must actually issue a lookup — clearing lastLookedUpEvent is what defeats the
    // early return, so a re-check that forgot to would silently do nothing.
    const before = lookup.mock.calls.length;
    lookup.mockReturnValue(
      new Observable((s) => {
        s.next({ found: true, hs_utm: 'kubecon-na-2026', campaign_name: 'KubeCon NA 2026', all_matches: [] });
        s.complete();
      })
    );
    recheck!.click();
    fixture.detectChanges();

    expect(lookup.mock.calls.length).toBe(before + 1);
    expect(instance()['hsUtm']()).toBe('kubecon-na-2026');
    // Resolved, so the re-check control goes away.
    expect(instance()['hsUnconfirmed']()).toBe(false);
  });

  /**
   * The component stays mounted when an ED switches foundations, and campaign-service selects
   * the HubSpot connection BY PROJECT -- so the same event name under a different foundation is
   * a different question. With the URL unchanged, an answer for foundation A must not populate
   * foundation B's panel, or B's brief carries A's token.
   */
  it('drops a lookup answer once the foundation has changed', () => {
    const pending = new Subject<unknown>();
    lookup.mockReturnValue(pending);
    (fixture.componentInstance as unknown as { lookupHubSpot(n: string): void }).lookupHubSpot('KubeCon NA 2026');

    // The ED switches foundations while the lookup is in flight. The url field is untouched.
    TestBed.inject(ProjectContextService).setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();

    pending.next({ found: true, hs_utm: 'foundation-a-token', campaign_name: 'KubeCon NA 2026', all_matches: [], capped: false });
    fixture.detectChanges();

    expect(instance()['hsUtm'](), "foundation A's token landed on foundation B's panel").toBeFalsy();
  });

  /**
   * The stale-response guard stops a LATE answer landing; it does nothing about one that already
   * landed. campaign-service picks the HubSpot connection BY PROJECT, so a token found under
   * foundation A is an answer to a question nobody asked about B -- and the url does not change,
   * so nothing else re-runs the lookup. Left in place it rolls into B's brief, and A's Create
   * button stays live against B's portal.
   */
  it('re-asks the HubSpot question under the new foundation, rather than clearing and stopping', () => {
    // Put a url in the field, since the re-lookup reads the event from it.
    (fixture.componentInstance as unknown as { briefForm: { controls: { url: { setValue(v: string): void } } } }).briefForm.controls.url.setValue(
      'https://events.example.com/kubecon-na-2026'
    );
    runLookup(
      { found: true, hs_utm: 'foundation-a-token', campaign_name: 'KubeCon NA 2026', all_matches: [], capped: false, inconclusive: false },
      // extractEventName title-cases the slug, and the guard compares against THAT -- so the
      // captured event must be what the component would derive from the field, not the raw slug.
      'Kubecon Na 2026'
    );
    expect(instance()['hsUtm']()).toBe('foundation-a-token');

    // The new foundation's portal answers differently.
    const before = lookup.mock.calls.length;
    lookup.mockReturnValue(
      new Observable((s) => {
        s.next({ found: true, hs_utm: 'foundation-b-token', campaign_name: 'KubeCon NA 2026', all_matches: [], capped: false, inconclusive: false });
        s.complete();
      })
    );
    TestBed.inject(ProjectContextService).setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();

    // Clearing alone left the panel DEAD: the component stays mounted and the url does not
    // change, so urlInput$ never fires and nothing else starts a lookup. The block stayed
    // hidden -- no create, no re-check -- until the operator retyped the same url.
    expect(lookup.mock.calls.length, 'the foundation change cleared the panel without re-asking').toBe(before + 1);
    expect(instance()['hsUtm'](), "foundation A's token survived into foundation B").toBe('foundation-b-token');
  });

  it('offers Create again for the same event under a different foundation', () => {
    // This ASSERTED THE OPPOSITE until Copilot pointed out the premise was false. The old
    // comment read "a different foundation is a different HubSpot portal" -- but the namespace
    // is the PORTAL, and two projects pointing at one portal is common under the LF umbrella
    // (campaign-service.service.ts:1374). No response carries a portal id, so the client cannot
    // tell the two cases apart.
    //
    // Between the two errors, this fails toward the recoverable one: a create genuinely needed
    // under a different portal is briefly withheld and the re-check resolves it once the lookup
    // answers there. The other direction writes a duplicate nobody can delete.
    const ctx = TestBed.inject(ProjectContextService);
    const first = new Subject<unknown>();
    create.mockReturnValue(first);
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    first.next({ created: true, hs_utm: 'tok', campaign_name: 'KubeCon NA 2026' });
    first.complete();
    fixture.detectChanges();

    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    fixture.detectChanges();

    // dealako, round 4 (blocking): keyed by event alone, this withheld Create PERMANENTLY for
    // that name under every other portal, above a false "Created in HubSpot" status -- and the
    // re-check reads the new portal, never finds it, and cannot clear the record. The key now
    // carries the foundation, so the suppression applies only where the create was made.
    //
    // KNOWN RESIDUAL RISK, recorded rather than hidden (Copilot, and it is right): foundation B
    // may share A's portal, in which case this not-found is HubSpot's post-create indexing lag
    // and offering Create can duplicate the campaign created at the start of this test. The
    // component cannot tell -- no lookup or create response carries a portal id.
    //
    // Chosen deliberately over the alternative, which dealako blocked: withholding here made
    // Create permanently unreachable under every OTHER portal with no way to recover. A
    // recoverable duplicate risk beats an unrecoverable lockout, and the in-flight guard still
    // covers the window where the duplicate is actually likely. When the response carries portal
    // identity, this expectation should flip to asserting the shared-portal case stays blocked.
    expect(instance()['hsCreateBlocked'](), 'Create stayed withheld under a portal where the campaign may not exist').toBe(false);
    expect(instance()['hsNotFound'](), 'should be a normal not-found under the new portal').toBe(true);
  });

  it('does not re-offer Create after a superseded create already succeeded', () => {
    // RED FIRST: this documents the gap Cursor found before any fix exists for it.
    //
    // A superseded create still makes a real campaign upstream. Its result is rightly discarded
    // for rendering -- the operator moved on -- but once nothing is in flight, returning to that
    // same event under the SAME foundation re-offers Create for a campaign that now exists. Two
    // projects on one HubSpot portal share the namespace, so the duplicate cannot be removed
    // from this UI.
    const ctx = TestBed.inject(ProjectContextService);
    const first = new Subject<unknown>();
    create.mockReturnValue(first);
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();

    // Supersede it, then come back to the same foundation.
    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();

    // The superseded create SUCCEEDS upstream.
    first.next({ created: true, hs_utm: null, campaign_name: 'KubeCon NA 2026' });
    first.complete();
    fixture.detectChanges();

    // Back to the original foundation, same event, and the lookup still says not-found because
    // HubSpot has not indexed it yet.
    ctx.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);
    fixture.detectChanges();
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    fixture.detectChanges();

    expect(instance()['hsCreatesInFlight'](), 'nothing should still be in flight').toBe(0);
    expect(instance()['hsCreateBlocked'](), 'Create was re-offered for an event that already has a campaign').toBe(true);
    // AND the operator has a way out. Blocking without a recovery path is the worse failure: a
    // disabled button plus a false "No campaign found" is a dead end, because retyping the same
    // url starts no new lookup either.
    expect(instance()['hsUnconfirmed'](), 'blocked Create with no re-check to recover through').toBe(true);
    expect(instance()['hsNotFound'](), 'showed a false not-found for a campaign that exists').toBe(false);
    // Matched on the stable claim -- that the status says it was CREATED and is not yet
    // visible -- rather than a full sentence, which has now been reworded twice.
    expect(String(instance()['hsStatus']())).toMatch(/^Created\b/);
  });

  it('preserves upstream text on a 400 instead of always saying "check the name"', () => {
    // campaign-service uses 400 for 39 distinct reasons, including "invalid credentials payload"
    // and a refused event URL -- not only name validation. Flattening them all to "check the
    // name and try again" sends an operator to retype an input that cannot fix a credential
    // problem.
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => ({ status: 400, error: { error: 'invalid credentials payload' } })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    expect(String(instance()['hsStatus']())).toContain('invalid credentials payload');
    expect(String(instance()['hsStatus']()), 'buried the real reason under a name prompt').not.toContain('check the name');
  });

  it('falls back to the name prompt when a 400 carries no upstream text', () => {
    // The hard-coded copy is still right when there is nothing better to say.
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => ({ status: 400 })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    expect(String(instance()['hsStatus']())).toContain('check the name');
  });

  it.each([
    ['a 503', 503],
    ['a status-less transport failure', 0],
  ])('records a possibly-created campaign after %s, so a re-check cannot re-offer Create', (_label, status) => {
    // An UNCONFIRMED create may well have committed. Recording only definite successes left a
    // duplicate path: the offered re-check can return empty while HubSpot is still indexing the
    // campaign that did land, and Create was re-enabled for a campaign that exists.
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => (status ? { status } : new Error('socket hang up'))));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    // The re-check comes back empty -- HubSpot has not indexed it yet.
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    fixture.detectChanges();

    expect(instance()['hsCreateBlocked'](), 'Create was re-offered after a create that may have committed').toBe(true);
  });

  it('does not retire the record on INCONCLUSIVE re-checks', () => {
    // A capped or otherwise incomplete search has not established absence, so counting it as a
    // miss would retire the protection on evidence that proves nothing -- and re-enable Create
    // after an unconfirmed POST that may well have landed. Same "absence is not proof" rule the
    // create offer runs on, applied to what RETIRES it.
    const inconclusive = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: true, inconclusive: true };
    const recheckWith = (r: unknown) => {
      lookup.mockReturnValue(
        new Observable((s) => {
          s.next(r);
          s.complete();
        })
      );
      (fixture.componentInstance as unknown as { recheckHubSpot(): void }).recheckHubSpot();
      fixture.detectChanges();
    };

    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => ({ status: 503 })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    // Three inconclusive re-checks -- more than the limit -- must not retire anything.
    recheckWith(inconclusive);
    recheckWith(inconclusive);
    recheckWith(inconclusive);

    expect(instance()['hsCreateBlocked'](), 'inconclusive searches retired the record and re-offered Create').toBe(true);
  });

  it('does not claim "Created" for a create that never confirmed', () => {
    // dealako, round 6 (blocking): the record is written by two arms that know different things.
    // The success arm saw `created: true`. The ERROR arm writes on any status that is not a
    // definite refusal -- a transport 503, where nothing may have happened at all. Telling both
    // "Created, but HubSpot has not indexed it yet" asserts as fact something only one of them
    // established, and for the 503 class it sends the operator to hunt for a campaign that was
    // never attempted -- the exact harm the error arm warns about at its own write site.
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => ({ status: 503 })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    lookup.mockReturnValue(
      new Observable((o) => {
        o.next(empty);
        o.complete();
      })
    );
    (fixture.componentInstance as unknown as { recheckHubSpot(): void }).recheckHubSpot();
    fixture.detectChanges();

    const status = String(instance()['hsStatus']());
    expect(status, 'asserted "Created" for an outcome that was never confirmed').not.toMatch(/^Created\b/);
    expect(status, 'did not tell the operator the create may never have happened').toMatch(/may never have been created/);
    // Suppression is unchanged: an unconfirmed create may still have landed.
    expect(instance()['hsCreateBlocked'](), 'honest copy came at the cost of the duplicate guard').toBe(true);
  });

  it('warns on A->B when the stale create settles after B already looked up', () => {
    // Copilot's SECOND symptom on the same early return: on a one-way A -> B, B's lookup returns
    // not-found while the create is in flight. Once it settles, hsCreatesInFlight falls to zero
    // and Create is enabled again -- correct, B may be a different portal -- but B's panel never
    // got the shared-portal warning, because the record arrived after its lookup rendered.
    const ctx = TestBed.inject(ProjectContextService);
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
    const pending = new Subject<unknown>();

    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(pending);
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    runLookup(empty, 'KubeCon NA 2026');

    pending.next({ created: true, hs_utm: null, campaign_name: 'Kubecon Na 2026' });
    pending.complete();
    fixture.detectChanges();

    // Create stays available -- B may be a different portal (round-4 constraint).
    expect(instance()['hsCreateBlocked'](), 'withheld Create under another foundation').toBe(false);
    // But the operator must be told the name may already be taken on a shared portal.
    expect(String(instance()['hsStatus']()), 'no shared-portal warning after the stale create settled').toMatch(/created earlier in this session/);
  });

  it('reconciles the panel when a stale create FAILS after the new lookup', () => {
    // cursor: the reconciliation was gated on `result?.created`, so it lived only in the success
    // arm. The error arm writes the same two records and then returns on a non-current
    // generation, so a 503 after a foundation switch stranded the panel exactly as a stale
    // success did. Fixing the symptom in one arm is what let this survive.
    const ctx = TestBed.inject(ProjectContextService);
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
    const pending = new Subject<unknown>();

    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(pending);
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    ctx.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);
    fixture.detectChanges();
    runLookup(empty, 'KubeCon NA 2026');

    // The superseded create FAILS, unconfirmed -- the POST may still have committed.
    pending.error({ status: 503 });
    fixture.detectChanges();

    expect(instance()['hsCreateBlocked'](), 'precondition: an unconfirmed record should block Create').toBe(true);
    expect(instance()['hsNotFound'](), 'stranded: a disabled Create above a false not-found').toBe(false);
    expect(instance()['hsUnconfirmed'](), 'stranded: no re-check control to recover through').toBe(true);
    // And it must not claim the campaign was created -- nothing confirmed it.
    expect(String(instance()['hsStatus']()), 'asserted "Created" for an unconfirmed failure').not.toMatch(/^Created/);
  });

  it('reconciles the panel when a stale create settles after the new lookup', () => {
    // Copilot: records are written BEFORE the ownership guards (right -- a superseded create
    // still made a real campaign), but the early return then leaves the PANEL untouched. So on
    // A -> B -> A the sets say "blocked" while the rendered state still says not-found:
    // hsCreateBlocked true, hsNotFound true, hsUnconfirmed false. A disabled Create with no
    // re-check control and no explanation -- recoverable only by reload.
    const ctx = TestBed.inject(ProjectContextService);
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
    const pending = new Subject<unknown>();

    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(pending);
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    // A -> B -> A while the create is still in flight.
    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    ctx.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);
    fixture.detectChanges();

    // The new lookup under A returns not-found FIRST...
    runLookup(empty, 'KubeCon NA 2026');
    // ...and only then does the superseded create settle, successfully.
    pending.next({ created: true, hs_utm: null, campaign_name: 'Kubecon Na 2026' });
    pending.complete();
    fixture.detectChanges();

    expect(instance()['hsCreateBlocked'](), 'precondition: the record should block Create').toBe(true);
    expect(instance()['hsNotFound'](), 'stranded: a disabled Create above a false not-found').toBe(false);
    expect(instance()['hsUnconfirmed'](), 'stranded: no re-check control to recover through').toBe(true);
  });

  it('does not claim "created" cross-foundation for an unconfirmed attempt', () => {
    // Copilot: `hsCreatedEventNames` is written by BOTH create arms, so the cross-foundation
    // warning asserted "was created earlier in this session" for entries whose request may never
    // have left the BFF. Same defect dealako blocked on for the same-foundation message -- I
    // fixed that one and left its sibling saying the same untrue thing.
    const ctx = TestBed.inject(ProjectContextService);
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };

    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => ({ status: 503 })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    runLookup(empty, 'KubeCon NA 2026');

    const status = String(instance()['hsStatus']());
    expect(status, 'asserted a campaign was created on the strength of an unconfirmed attempt').not.toMatch(/was created earlier/);
    expect(status, 'dropped the shared-portal warning entirely').toMatch(/ATTEMPTED/);
    // Still not withheld: a different foundation may be a different portal (round-4 constraint).
    expect(instance()['hsCreateBlocked'](), 'withheld Create under another foundation').toBe(false);
  });

  it('gives the readonly token field an accessible name', () => {
    // Copilot: the `<label>` closed before this input and carried no `for`, so assistive tech
    // announced a readonly field with no name -- the operator hears a value with no idea what it
    // is. Asserted through the ASSOCIATION rather than a string, so the visible label stays the
    // single source of the name.
    runLookup(
      { found: true, hs_utm: 'kubecon-na-2026', campaign_name: 'KubeCon NA 2026', all_matches: [], capped: false, inconclusive: false },
      'KubeCon NA 2026'
    );

    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('[data-testid="planning-hubspot-utm-value"]') as HTMLInputElement | null;
    expect(input, 'the token field did not render').not.toBeNull();
    const label = el.querySelector(`label[for="${input!.id}"]`);
    expect(label, 'the readonly token field has no accessible name').not.toBeNull();
    expect(label!.textContent, 'the label does not name what the field holds').toContain('HubSpot UTM token');
    // The id must be INSTANCE-SCOPED. Paid and email planning tabs are visibility-toggled rather
    // than swapped with `@if`, so both stay mounted -- a hardcoded id appeared twice and `for`
    // bound to the first match, typically the hidden panel, leaving the visible field unnamed
    // (cursor). Asserted through deliveryType rather than a literal, so the derivation is what
    // is pinned.
    expect(input!.id, 'the token field id is not scoped to this instance').toContain('paid-marketing');
  });

  it('suppresses Create cross-foundation when the search was INCONCLUSIVE', () => {
    // dealako (#2079, blocking): the cross-foundation branch set hsNotFound and hsUnconfirmed but
    // never hsCreateSuppressed. The template gates Create on `hsNotFound() && !hsUtm() &&
    // !hsCreateSuppressed()`, so an inconclusive search under foundation B rendered an ENABLED
    // Create -- under the foundation most likely to share a portal with the campaign just
    // created under A.
    const ctx = TestBed.inject(ProjectContextService);
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };

    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(
      new Observable((o) => {
        o.next({ created: true, hs_utm: null, campaign_name: 'Kubecon Na 2026' });
        o.complete();
      })
    );
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    // Foundation B, and its lookup cannot prove completeness.
    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    // recheckHubSpot(), not runLookup(): lookupHubSpot returns early when lastLookedUpEvent
    // already matches, so a second runLookup for the same event is a no-op and the branch under
    // test never runs.
    lookup.mockReturnValue(
      new Observable((o) => {
        o.next({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: true, inconclusive: true });
        o.complete();
      })
    );
    (fixture.componentInstance as unknown as { recheckHubSpot(): void }).recheckHubSpot();
    fixture.detectChanges();

    expect(instance()['hsCreateSuppressed'](), 'an inconclusive cross-foundation search offered Create').toBe(true);
  });

  it('warns under a DIFFERENT foundation without withholding Create', () => {
    // Copilot, raised twice: two foundations can share one HubSpot portal, where campaign names
    // are one namespace. After a create under A settles, hsCreatesInFlight is zero and B's own
    // lookup can be legitimately empty while HubSpot indexes -- so B saw a confident
    // "No campaign found" for a campaign that already exists on its portal.
    //
    // The in-flight guard never covered this: it falls to zero when the POST settles, and the
    // duplicate window is the INDEXING lag that starts there.
    const ctx = TestBed.inject(ProjectContextService);
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };

    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(
      new Observable((o) => {
        o.next({ created: true, hs_utm: null, campaign_name: 'Kubecon Na 2026' });
        o.complete();
      })
    );
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    // A DIFFERENT foundation, same event. Its own lookup is empty -- HubSpot has not indexed it.
    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    runLookup(empty, 'KubeCon NA 2026');

    expect(String(instance()['hsStatus']()), 'reported a confident absence for a name that may exist on this portal').toMatch(
      /created earlier in this session/
    );
    expect(instance()['hsUnconfirmed'](), 'the cross-foundation warning did not surface').toBe(true);
    // The round-4 constraint, asserted alongside: an event-only key that WITHHOLDS Create is
    // unrecoverable, because the re-check reads the new portal and can never clear the record.
    // A different foundation may be a different portal, where creating is exactly right.
    expect(instance()['hsCreateBlocked'](), 'withheld Create under another foundation -- the round-4 lockout').toBe(false);
  });

  it('treats an authorization refusal as definite, not unconfirmed', () => {
    // Copilot (blocking): 401/403 were DEFINITE at the record site and UNCONFIRMED at the message
    // site -- two hand-maintained status lists that drifted. The record was correctly not
    // written, and the operator was still told the campaign might exist, lost the Create button,
    // and had to re-check to settle what the boundary had already settled.
    //
    // Both statuses asserted: 403 is the refusal requireCampaignManager actually returns, 401 the
    // unauthenticated one, and a list that covers only the common case is how this drifted.
    for (const status of [401, 403]) {
      const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
      runLookup(empty, `KubeCon NA 20${status}`);
      create.mockReturnValue(throwError(() => ({ status })));
      (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
      fixture.detectChanges();

      expect(instance()['hsUnconfirmed'](), `${status} reported an unconfirmed outcome for a refused request`).toBe(false);
      expect(instance()['hsCreateBlocked'](), `${status} withdrew Create after a request that never dispatched`).toBe(false);
      expect(String(instance()['hsStatus']()), `${status} blamed HubSpot for our own permission refusal`).toContain('permission');
    }
  });

  it('never re-enables Create from empty re-checks alone, however many', () => {
    // Copilot (blocking): a count of empty searches cannot establish absence. `inconclusive:
    // false` means the search COMPLETED, not that the record is missing -- HubSpot's index is
    // eventually consistent, so a campaign created seconds ago returns a complete, truthful,
    // empty result. Any threshold therefore expires on index lag and re-offers Create after a
    // POST that may have landed, duplicating paid spend.
    //
    // Six revisions tuned that threshold. This asserts it is GONE: only positive evidence
    // retires the record.
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
    const recheck = () => {
      lookup.mockReturnValue(
        new Observable((s) => {
          s.next(empty);
          s.complete();
        })
      );
      (fixture.componentInstance as unknown as { recheckHubSpot(): void }).recheckHubSpot();
      fixture.detectChanges();
    };

    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => ({ status: 503 })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    // Well past every threshold this guard has ever carried.
    for (let i = 0; i < 6; i++) recheck();

    expect(instance()['hsCreateBlocked'](), 'empty re-checks retired the record and re-offered Create').toBe(true);
    expect(instance()['hsNotFound'](), 'reported a confident not-found for a campaign that may exist').toBe(false);
    expect(instance()['hsUnconfirmed'](), 'operator left with no re-check control').toBe(true);
  });

  it('records a possibly-created campaign when the response omits created', () => {
    // Copilot: only a truthy `created` was recorded, but the else arm tells the operator the
    // campaign "may or may not have been created". So a POST that COMMITTED and returned a
    // malformed body wrote no record -- and the next empty lookup restored Create, letting the
    // operator duplicate it by acting on the very warning that described the risk.
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
    runLookup(empty, 'KubeCon NA 2026');
    // 2xx, but the body does not say `created`.
    create.mockReturnValue(
      new Observable((o) => {
        o.next({ hs_utm: null, campaign_name: '' });
        o.complete();
      })
    );
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    expect(instance()['hsCreateBlocked'](), 'an unconfirmed 2xx left Create on offer').toBe(true);
    // And it must NOT claim the campaign was created -- nothing confirmed it.
    expect(String(instance()['hsStatus']()), 'asserted a create the response never confirmed').not.toMatch(/^Created/);
  });

  it('keeps the shared-portal fence while ANOTHER foundation still holds a record', () => {
    // Copilot, raised twice: the name fences are GLOBAL -- "was this name created under any
    // foundation this session?" -- but retirement deleted them alongside a single
    // `foundation|event` record. So a positive find under A removed B's shared-portal warning,
    // and a third foundation on B's portal could then see a confident not-found during lag.
    const ctx = TestBed.inject(ProjectContextService);
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
    const confirmed = { created: true, hs_utm: null, campaign_name: 'Kubecon Na 2026' };

    // Foundation A creates.
    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(
      new Observable((o) => {
        o.next(confirmed);
        o.complete();
      })
    );
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    // Foundation B creates the SAME event name.
    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    runLookup(empty, 'KubeCon NA 2026');
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    // Back to A, where the lookup now POSITIVELY finds it -- retiring A's record only.
    ctx.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);
    fixture.detectChanges();
    lookup.mockReturnValue(
      new Observable((o) => {
        o.next({ found: true, hs_utm: 'kubecon-na-2026', campaign_name: 'KubeCon NA 2026', all_matches: [], capped: false, inconclusive: false });
        o.complete();
      })
    );
    (fixture.componentInstance as unknown as { recheckHubSpot(): void }).recheckHubSpot();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as { hsCreatedEventNames(): Set<string> };
    expect(component.hsCreatedEventNames().has('Kubecon Na 2026'), "A's resolution dropped the fence B still needs").toBe(true);
  });

  it('records a create the operator navigated away from', () => {
    // Copilot (planning-tab:860): the create was bound to `takeUntilDestroyed`, so leaving the
    // page ABORTED a non-idempotent POST mid-flight. Neither arm ran, so nothing recorded that a
    // campaign may exist -- and campaign-service may already have created it. Returning before
    // HubSpot indexed it then re-offered Create, which is the duplicate this component exists to
    // prevent, reached by navigating away.
    //
    // Same fix and reasoning as the optimization tab's keyword mutations: `take(1)` bounds the
    // subscription without cancelling it.
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
    const pending = new Subject<unknown>();
    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(pending);
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as { hsCreatedEvents(): Set<string> };
    fixture.destroy();

    // The create SUCCEEDS after the operator has left.
    pending.next({ created: true, hs_utm: null, campaign_name: 'Kubecon Na 2026' });
    pending.complete();

    // SCOPE OF THIS ASSERTION, stated precisely because an earlier version of it overstated the
    // guarantee: this proves the request was NOT cancelled and its outcome arm ran. It does NOT
    // prove the duplicate guard survives navigation -- the sets are instance signals, so a
    // REMOUNT starts empty and Create can be offered again for a campaign that exists.
    //
    // That gap is real and is not closed here (Copilot). Closing it needs the possibly-created
    // state in a longer-lived service, or upstream idempotency (#2086). What this test pins is
    // the half that IS fixed: an aborted request recorded nothing at all, so even returning to
    // the SAME instance re-offered Create.
    expect(component.hsCreatedEvents().size, 'the create was cancelled by navigation, or its outcome dropped').toBeGreaterThan(0);
  });

  it.each([
    ['both completeness fields absent (an OLD pod)', { found: false, hs_utm: null, campaign_name: '', all_matches: [] }],
    ['inconclusive absent', { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false }],
    ['capped absent', { found: false, hs_utm: null, campaign_name: '', all_matches: [], inconclusive: false }],
  ])('suppresses Create when the response cannot state completeness: %s', (_label, result) => {
    // Copilot: `inconclusive === true` is FALSE for a missing field. The chart default spins up a
    // full new replica set alongside the old with no session affinity, so a browser served a new
    // bundle can call an OLD pod whose response predates these fields -- and that same old
    // response carries the old capped 10-row search. The one moment the signal is absent is the
    // moment the search behind it was least complete, and `=== true` offered Create precisely
    // then.
    runLookup(result as never, 'KubeCon NA 2026');

    expect(instance()['hsCreateSuppressed'](), 'a response that cannot state completeness licensed a create').toBe(true);
  });

  it('offers Create only when BOTH fields explicitly say the search was complete', () => {
    // The other direction, so the assertion above cannot be satisfied by always suppressing.
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');

    expect(instance()['hsCreateSuppressed'](), 'a proven-complete empty search failed to license a create').toBe(false);
  });

  it('retires on a superseded find only once the panel shows that key again', () => {
    // Two reviewers, two opposite failure modes, and this is the shape that satisfies both.
    //
    // Retiring BELOW the render guards discards a superseded positive find, leaving Create
    // suppressed with the answer in hand. Retiring ABOVE them unconditionally lets a STALE find
    // clear the record while a newer not-found renders -- and the template gates Create on
    // `hsNotFound() && !hsUtm() && !hsCreateSuppressed()`, never on hsCreateBlocked, so Create is
    // offered for a campaign that exists.
    //
    // The test is `panelStillShows`, not the generation counter: the record is keyed
    // foundation|event, so what matters is whether the answer describes the key on screen.
    const ctx = TestBed.inject(ProjectContextService);
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => ({ status: 503 })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();
    expect(instance()['hsCreateBlocked']()).toBe(true);

    // A re-check is in flight when the operator switches away.
    const pending = new Subject<unknown>();
    lookup.mockReturnValue(pending);
    (fixture.componentInstance as unknown as { recheckHubSpot(): void }).recheckHubSpot();
    fixture.detectChanges();
    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();

    // It positively finds the campaign while B is on screen. It must NOT retire here -- B's panel
    // is rendering its own answer, and clearing A's record now is the duplicate-offering case.
    pending.next({ found: true, hs_utm: 'kubecon-na-2026', campaign_name: 'KubeCon NA 2026', all_matches: [], capped: false, inconclusive: false });
    pending.complete();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as { hsCreatedEvents(): Set<string> };
    expect(component.hsCreatedEvents().size, 'a stale find cleared the record while another panel was showing').toBeGreaterThan(0);

    // The other direction is already covered by `retires the record when a re-check POSITIVELY
    // finds the campaign` and `retires the record on a TOKENLESS positive find too`, which drive
    // a CURRENT lookup and assert the record clears. Repeating that here would only re-test them;
    // what is unique to this case is that a STALE find must NOT clear it, asserted above.
  });

  it('retires the record on a TOKENLESS positive find too', () => {
    // dealako (#2079, blocking): neither found arm removed the entry, so `hsCreateBlocked` stayed
    // true for the component's lifetime and the "cleared only by a positive find" contract had no
    // implementation behind it. This is the tokenless half -- gating retirement on `hs_utm` would
    // leave Create suppressed forever for a campaign HubSpot has simply not tokenised yet.
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => ({ status: 503 })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();
    expect(instance()['hsCreateBlocked'](), 'precondition: the unconfirmed create should block').toBe(true);

    // FOUND, but HubSpot has assigned no token yet.
    lookup.mockReturnValue(
      new Observable((o) => {
        o.next({ found: true, hs_utm: null, campaign_name: 'KubeCon NA 2026', all_matches: [], capped: false, inconclusive: false });
        o.complete();
      })
    );
    (fixture.componentInstance as unknown as { recheckHubSpot(): void }).recheckHubSpot();
    fixture.detectChanges();

    expect(instance()['hsCreateBlocked'](), 'a positive find left Create suppressed for the session').toBe(false);
  });

  it('retires the record when a re-check POSITIVELY finds the campaign', () => {
    // dealako, round 5 (blocking): the record must have an exit, or an operator is stranded
    // until a reload. The exit is positive evidence -- the lookup actually finding it -- which
    // is the only thing that answers the question the record poses.
    const empty = { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
    runLookup(empty, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => ({ status: 503 })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();
    expect(instance()['hsCreateBlocked']()).toBe(true);

    // HubSpot has now indexed it.
    lookup.mockReturnValue(
      new Observable((s) => {
        s.next({ found: true, hs_utm: 'kubecon-na-2026', campaign_name: 'KubeCon NA 2026', all_matches: [], capped: false, inconclusive: false });
        s.complete();
      })
    );
    (fixture.componentInstance as unknown as { recheckHubSpot(): void }).recheckHubSpot();
    fixture.detectChanges();

    expect(instance()['hsUtm'](), 'the token HubSpot assigned was not applied').toBe('kubecon-na-2026');
    expect(instance()['hsNotFound'](), 'a found campaign still reported not-found').toBe(false);
  });

  it.each([
    ['401', 401],
    ['403', 403],
  ])('does NOT record a %s, which is refused at the boundary', (_label, status) => {
    // requireCampaignManager refuses an unauthorised project BEFORE the POST reaches the
    // controller, so nothing was created. Recording it told the operator a campaign may exist
    // and made them spend two futile re-checks clearing a record that should never have existed.
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => ({ status })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    expect(instance()['hsCreateBlocked'](), 'a boundary refusal was recorded as possibly-created').toBe(false);
  });

  it('does NOT record a 400, which proves nothing was created', () => {
    // The other direction: over-recording would withhold Create after a refusal the operator can
    // actually fix by correcting the name, which is the case the offer exists for.
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    create.mockReturnValue(throwError(() => ({ status: 400, error: { error: 'name rejected' } })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    expect(instance()['hsCreateBlocked'](), 'withheld Create after a definite refusal').toBe(false);
  });

  it('keeps re-check available when the campaign is found but still tokenless', () => {
    // After a create returns without hs_utm, the first re-check can legitimately FIND the
    // campaign before HubSpot has assigned its token. The lookup clears hsUnconfirmed when it
    // starts, and this branch never restored it -- so the only control that settles the question
    // disappeared and the operator was stranded until a reload.
    runLookup({ found: true, hs_utm: null, campaign_name: 'KubeCon NA 2026', all_matches: [], capped: false, inconclusive: false }, 'KubeCon NA 2026');
    fixture.detectChanges();

    expect(instance()['hsUnconfirmed'](), 're-check vanished on a found-but-tokenless campaign').toBe(true);
    expect(String(instance()['hsStatus']())).toContain('no UTM token');
    // Create stays hidden -- the campaign exists, so offering it would duplicate.
    expect(instance()['hsNotFound']()).toBe(false);
  });

  /**
   * The hazard this file already named -- "which is how a duplicate campaign gets made in a
   * shared namespace" -- is now closed one step EARLIER than these tests assumed.
   *
   * They were written when a foundation switch could start a SECOND create while the first was
   * in flight, and pinned the narrower property that a stale response must not re-enable the
   * button. But the second dispatch is itself the duplicate: two projects on the same HubSpot
   * portal share the namespace, and the campaign cannot be removed from this UI. So the second
   * create is now REFUSED outright while any create is unsettled, and these assert that.
   */
  it('refuses a second create while one dispatched before the switch is unsettled', () => {
    // Through the FIELD, so the panel and the url agree — createInHubSpot refuses to act
    // otherwise, and a real user can only reach the button from that state.
    (fixture.componentInstance as unknown as { lastLookedUpEvent: string }).lastLookedUpEvent = setUrlFor('KubeCon NA 2026');
    const first = new Subject<unknown>();
    create.mockReturnValue(first);
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();

    // The operator switches foundation; a create starts for the new one and is still running.
    TestBed.inject(ProjectContextService).setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    // Through the FIELD, so the panel and the url agree — createInHubSpot refuses to act
    // otherwise, and a real user can only reach the button from that state.
    (fixture.componentInstance as unknown as { lastLookedUpEvent: string }).lastLookedUpEvent = setUrlFor('KubeCon NA 2026');
    const second = new Subject<unknown>();
    create.mockReturnValue(second);
    const callsBefore = create.mock.calls.length;
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();

    // REFUSED: the first create is still unsettled, so no second POST goes out at all. That is
    // the duplicate, and it cannot be undone from this UI once it lands.
    expect(create.mock.calls.length, 'dispatched a second create while the first was unsettled').toBe(callsBefore);
    // The control stays blocked for the same reason.
    expect(instance()['hsCreateBlocked']()).toBe(true);

    // The OLD foundation's create now settles, and only then does the offer come back.
    first.error(new Error('stale create failed'));
    fixture.detectChanges();

    expect(instance()['hsCreateBlocked'](), 'stayed blocked after every create settled').toBe(false);
  });

  /**
   * The lookup side has the identical hazard: an A -> B -> A round trip while an A lookup is in
   * flight leaves the old response matching on event AND foundation, so an equality check lets
   * it clear the flag a newer A lookup is holding.
   */
  it('does not let a round-tripped stale lookup clear a newer search', () => {
    const first = new Subject<never>();
    lookup.mockReturnValue(first);
    (fixture.componentInstance as unknown as { lookupHubSpot(n: string): void }).lookupHubSpot('KubeCon NA 2026');

    const ctx = TestBed.inject(ProjectContextService);
    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    ctx.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);
    fixture.detectChanges();

    // A newer lookup for the SAME event under the SAME foundation is now in flight.
    const second = new Subject<never>();
    lookup.mockReturnValue(second);
    (fixture.componentInstance as unknown as { lookupHubSpot(n: string): void }).lookupHubSpot('KubeCon NA 2026');
    expect(instance()['hsSearching']()).toBe(true);

    first.error(new Error('stale lookup failed'));
    fixture.detectChanges();

    expect(instance()['hsSearching'](), 'a round-tripped stale lookup declared the newer one finished').toBe(true);
  });

  /**
   * The same round trip must not let a stale lookup RENDER either.
   *
   * Clearing the flag and applying the answer are separate hazards. panelStillShows compares
   * VALUES, so after A -> B -> A for the same event the stale response matches again and its
   * result would overwrite the newer one — and a stale not-found leaves hsNotFound true with no
   * token, which re-offers Create for a search already superseded. Only the generation counter
   * can tell two identical-looking lookups apart.
   */
  /**
   * A foundation switch must invalidate an in-flight CREATE, not just free the button.
   *
   * The handler clears hsCreating and re-runs the lookup (which bumps lookupGeneration), but
   * nothing advanced createGeneration — so a create still in flight stayed "current". After an
   * A -> B -> A round trip panelStillShows matches again and stops refusing, and the superseded
   * create's answer lands on a panel it was never asked about.
   *
   * The lookup has to run FIRST: createInHubSpot returns early unless lastLookedUpEvent is set,
   * so a test that skips it never starts a create and passes whether or not the fix is present.
   */
  it('invalidates an in-flight create across a round-trip foundation switch', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });

    const pending = new Subject<unknown>();
    create.mockReturnValue(pending);
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();

    const ctx = TestBed.inject(ProjectContextService);
    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    ctx.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);
    fixture.detectChanges();

    // Back on A, so panelStillShows matches again — only createGeneration can refuse this.
    pending.next({ created: true, hs_utm: 'stale-token', campaign_name: 'Stale' });
    pending.complete();
    fixture.detectChanges();

    expect(instance()['hsUtm'](), 'a superseded create wrote its token after a round trip').not.toBe('stale-token');
  });

  it('does not let a round-tripped stale lookup render its answer', () => {
    const first = new Subject<HubSpotUtmLookupResult>();
    lookup.mockReturnValue(first);
    (fixture.componentInstance as unknown as { lookupHubSpot(n: string): void }).lookupHubSpot('KubeCon NA 2026');

    const ctx = TestBed.inject(ProjectContextService);
    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    ctx.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);
    fixture.detectChanges();

    // A newer lookup for the SAME event under the SAME foundation supersedes the first.
    const second = new Subject<HubSpotUtmLookupResult>();
    lookup.mockReturnValue(second);
    (fixture.componentInstance as unknown as { lookupHubSpot(n: string): void }).lookupHubSpot('KubeCon NA 2026');

    // The superseded lookup answers LAST, with a different campaign.
    first.next({ found: true, hs_utm: 'stale-token', campaign_name: 'Stale Campaign', all_matches: [], capped: false, inconclusive: false });
    first.complete();
    fixture.detectChanges();

    expect(instance()['hsUtm'](), 'a superseded lookup wrote its token over a newer search').not.toBe('stale-token');
  });

  /**
   * The ERROR arms need the generation guard too.
   *
   * Guarding only the success path left the failure path trusting panelStillShows alone, which
   * matches again after A -> B -> A. A stale FAILURE then overwrites hsStatus and sets
   * hsUnconfirmed on a newer search — and nothing on the success path clears hsUnconfirmed, so
   * the panel stays stuck reporting a failure that never happened to it.
   */
  it('does not let a round-tripped stale lookup error overwrite a newer search', () => {
    const first = new Subject<HubSpotUtmLookupResult>();
    lookup.mockReturnValue(first);
    (fixture.componentInstance as unknown as { lookupHubSpot(n: string): void }).lookupHubSpot('KubeCon NA 2026');

    const ctx = TestBed.inject(ProjectContextService);
    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    ctx.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);
    fixture.detectChanges();

    const second = new Subject<HubSpotUtmLookupResult>();
    lookup.mockReturnValue(second);
    (fixture.componentInstance as unknown as { lookupHubSpot(n: string): void }).lookupHubSpot('KubeCon NA 2026');

    // The superseded lookup FAILS last.
    first.error(new Error('stale lookup failed'));
    fixture.detectChanges();

    expect(instance()['hsStatus'](), 'a superseded lookup reported its failure on a newer search').not.toBe('HubSpot lookup failed');
    expect(instance()['hsUnconfirmed'](), 'a superseded failure left the panel stuck unconfirmed').toBe(false);
  });

  /**
   * The create OFFER survives a url edit, deliberately -- the HubSpot state is not reset until
   * the 500ms debounced lookup starts. But acting on it in that window would create a campaign
   * for an event the operator has already left, into a namespace nobody can clean up from here.
   */
  it('refuses a create once the url no longer names the event the offer was raised for', () => {
    (fixture.componentInstance as unknown as { briefForm: { controls: { url: { setValue(v: string): void } } } }).briefForm.controls.url.setValue(
      'https://events.example.com/kubecon-na-2026'
    );
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'Kubecon Na 2026');

    // The operator types a different event. The debounce has NOT fired, so the offer is still
    // on screen and lastLookedUpEvent still names the old one.
    (fixture.componentInstance as unknown as { briefForm: { controls: { url: { setValue(v: string): void } } } }).briefForm.controls.url.setValue(
      'https://events.example.com/some-other-conference-2027'
    );
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();

    expect(create, 'created a campaign for an event the operator had left').not.toHaveBeenCalled();
  });

  /**
   * An EMPTY field is not permission either, and panelStillShows alone does not cover it: that
   * helper deliberately keeps the captured event through a mid-edit url, which is right for
   * deciding whether an in-flight ANSWER may be rendered and wrong for an irreversible write.
   * restoreSavedBrief draws the same line.
   */
  it('refuses a create while the url field is empty', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });
    // The offer is on screen, raised by that lookup.
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-hubspot-create-btn"]')).not.toBeNull();

    // The operator clears the field. The offer REMAINS visible, deliberately -- but it now names
    // an event the field does not.
    (
      fixture.componentInstance as unknown as {
        briefForm: { controls: { url: { setValue(v: string, o?: { emitEvent: boolean }): void } } };
      }
    ).briefForm.controls.url.setValue('', { emitEvent: false });
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();

    expect(create, 'created a campaign from an empty url field').not.toHaveBeenCalled();
  });

  /**
   * campaign-service separates the create's outcomes by STATUS, and collapsing them here threw
   * that away at the last step: a 400/404 proves nothing was created, so telling the operator the
   * campaign "may or may not" exist sends them to hunt for something never attempted -- and
   * withdraws the offer they could have acted on.
   *
   * The set stops at 400/404. Widening it to 500 overshot into the opposite and worse error: the
   * BFF's own 500 covers faults at any position, including after the campaign exists.
   */
  it('does not claim HubSpot truncated when capped only means completeness is unproven', () => {
    // campaign-service defines `capped` as "true when the search could NOT be shown to be
    // complete" -- which covers an ABSENT or CONTRADICTORY total, not just HubSpot returning
    // fewer than it matched (design/connection.go). Saying "there are more it did not return"
    // therefore stated a fact the response never established.
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: true, inconclusive: true }, 'Event capped');
    fixture.detectChanges();

    const status = String(instance()['hsStatus']());
    expect(status, 'capped must not be reported as proven truncation').not.toMatch(/there are more it did not/i);
    expect(status).toMatch(/could not be shown to be complete/i);
  });

  it('announces the create outcome through a live region that is always in the DOM', () => {
    // A create outcome that only a sighted user can read is not delivered. The button that
    // started the create can disappear from under the focus that triggered it, and the message
    // can say "may or may not have been created" -- the one outcome a user must not miss.
    //
    // The region must exist BEFORE the text does: an aria-live element created by @if with its
    // content already present is not reliably announced.
    const host = fixture.nativeElement as HTMLElement;
    const live = () => host.querySelector('[data-testid="planning-hubspot-status-live"]');

    // Present while there is nothing to say -- that is the whole point.
    expect(live(), 'the live region must be mounted before any status exists').not.toBeNull();
    expect(live()?.getAttribute('aria-live')).toBe('polite');

    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, 'Event live');
    create.mockReturnValue(throwError(() => ({ status: 503 })));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    expect(live()?.textContent).toMatch(/may or may not/i);
    // The visible copy is hidden from AT so the message is not announced twice.
    expect(host.querySelector('[data-testid="planning-hubspot-status"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('distinguishes a definite create failure from an unconfirmed one', () => {
    for (const [status, offerStaysUp, expected] of [
      [400, true, /check the name/i],
      [404, true, /connect HubSpot/i],
      // 500 is UNCONFIRMED, not proof. campaign-service does reserve 500 for the pre-send
      // position -- but this status is not read from campaign-service, it is read from our own
      // BFF, which raises 500 for a fault at ANY position (error-handler.middleware.ts:92 for any
      // non-BaseApiError; ApiClientService JSON.parses the body AFTER a 2xx). A malformed success
      // body therefore arrives as 500 with the campaign ALREADY created, and re-offering Create
      // there makes the duplicate this handler exists to prevent.
      [500, false, /may or may not/i],
      [503, false, /may or may not/i],
      // Unclassifiable: a non-idempotent create must fail CLOSED, so it reads as unconfirmed.
      [0, false, /may or may not/i],
    ] as const) {
      runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false }, `Event ${status}`);
      create.mockReturnValue(throwError(() => ({ status })));
      (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
      fixture.detectChanges();

      expect(String(instance()['hsStatus']()), `status ${status}`).toMatch(expected);
      // Nothing created -> the offer stays actionable. Unconfirmed -> it is withdrawn, because
      // the campaign may already exist and a retry would duplicate it.
      expect(instance()['hsNotFound'](), `status ${status}: create offer`).toBe(offerStaysUp);
      expect(instance()['hsUnconfirmed'](), `status ${status}: unconfirmed control`).toBe(!offerStaysUp);
    }
  });

  /**
   * Ownership of `hsCreating` cannot be keyed on a value the user can navigate BACK to. A round
   * trip A -> B -> A leaves the original create matching the active foundation again, so it
   * would release the flag a newer create is holding and re-enable the button under a running
   * request -- the same duplicate hazard, reached by a different route.
   */
  it('does not let a create released by a round-trip foundation switch re-enable the button', () => {
    // Through the FIELD, so the panel and the url agree — createInHubSpot refuses to act
    // otherwise, and a real user can only reach the button from that state.
    (fixture.componentInstance as unknown as { lastLookedUpEvent: string }).lastLookedUpEvent = setUrlFor('KubeCon NA 2026');
    const first = new Subject<unknown>();
    create.mockReturnValue(first);
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();

    const ctx = TestBed.inject(ProjectContextService);
    ctx.setFoundation({ uid: 'foundation-b-uid', slug: 'foundation-b', name: 'Foundation B' }, false);
    fixture.detectChanges();
    // ...and straight back to A, so the first create's captured foundation matches once more.
    ctx.setFoundation({ uid: 'foundation-a-uid', slug: 'foundation-a', name: 'Foundation A' }, false);
    fixture.detectChanges();

    // Through the FIELD, so the panel and the url agree — createInHubSpot refuses to act
    // otherwise, and a real user can only reach the button from that state.
    (fixture.componentInstance as unknown as { lastLookedUpEvent: string }).lastLookedUpEvent = setUrlFor('KubeCon NA 2026');
    const second = new Subject<unknown>();
    create.mockReturnValue(second);
    const callsBefore = create.mock.calls.length;
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();

    // The round trip makes the FIRST create's captured foundation match again, which is what
    // made generation counting necessary. But the dispatch is refused regardless: an unsettled
    // create blocks the next one whatever foundation the panel is showing.
    expect(create.mock.calls.length, 'a round trip let a second create through').toBe(callsBefore);
    expect(instance()['hsCreateBlocked']()).toBe(true);

    // A 400: the ONE class of failure that proves nothing was created, so the offer may return.
    // A status-less error would now be recorded as possibly-created instead -- deliberately,
    // since it cannot prove the POST did not commit -- and this test is about generation
    // ownership, not about that classification.
    first.error(Object.assign(new Error('stale create failed'), { status: 400 }));
    fixture.detectChanges();

    // Settled, so the offer returns -- and the stale response still must not have rendered.
    expect(instance()['hsCreateBlocked'](), 'stayed blocked after the only create settled').toBe(false);
  });

  /**
   * The spinner must clear even when the user has retyped the url mid-flight.
   *
   * `panelStillShows` also asks whether the LIVE url still names the captured event, which goes
   * false the moment the user types -- while the only request in flight is still this one. Gating
   * the shared `hsSearching` flag on it therefore freezes the spinner permanently: nothing else
   * can clear it, because `lookupHubSpot`'s early return means no new lookup starts for an
   * unchanged event. Releasing the flag asks the narrower "is this still the latest lookup?".
   */
  it('clears the search flag when the url was retyped before the answer arrived', () => {
    const pending = new Subject<unknown>();
    lookup.mockReturnValue(pending);
    (fixture.componentInstance as unknown as { lookupHubSpot(n: string): void }).lookupHubSpot('KubeCon NA 2026');
    expect(instance()['hsSearching']()).toBe(true);

    // The user starts typing a different event. The debounce has NOT fired, so no second lookup
    // exists -- this one is still the only request in flight.
    (fixture.componentInstance as unknown as { briefForm: { controls: { url: { setValue(v: string): void } } } }).briefForm.controls.url.setValue(
      'https://events.example.com/some-other-conference-2027'
    );
    pending.error(new Error('hubspot down'));
    fixture.detectChanges();

    expect(instance()['hsSearching'](), 'the spinner froze with no request in flight').toBe(false);
  });

  /**
   * An inconclusive-but-not-truncated result must suppress the create just the same, while
   * saying something TRUE about why. Claiming HubSpot returned fewer than it matched, when it
   * returned everything, points the operator at narrowing a term instead of checking the name.
   */
  /**
   * `capped: true` must not be reported as TRUNCATION either.
   *
   * campaign-service sets capped whenever completeness cannot be PROVEN — including HubSpot
   * omitting `total` altogether — not only when it truncated. The old copy said "it matched more
   * than it could return", which is fabricated for a response that never claimed a total, and
   * sends the operator to narrow a search term when the remedy is to check the name. The BFF
   * cannot separate the two: both arrive in one boolean.
   */
  it('does not claim truncation even when capped is set', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: true, inconclusive: true }, 'KubeCon NA 2026 capped');

    const el = fixture.nativeElement as HTMLElement;
    const notice = el.querySelector('[data-testid="planning-hubspot-capped"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent, 'stated truncation the response never claimed').not.toMatch(/matched more than it could return/i);
    // What IS known: the search was not confirmed complete.
    expect(notice?.textContent).toMatch(/did not confirm|check HubSpot/i);
    expect(el.querySelector('[data-testid="planning-hubspot-create-btn"]'), 'create offered on a capped search').toBeNull();
  });

  it('suppresses the create on an inconclusive result without claiming truncation', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: true }, 'KubeCon NA 2026');

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="planning-hubspot-create-btn"]'), 'create offered on an inconclusive search').toBeNull();
    const notice = el.querySelector('[data-testid="planning-hubspot-capped"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent, 'claimed truncation that did not happen').not.toMatch(/matched more than it could return/i);
    expect(notice?.textContent).toMatch(/check HubSpot directly/i);
  });

  /**
   * hsSearching is shared across lookups, unlike hsCreating. An OLDER request's failure must not
   * declare a NEWER in-flight lookup finished -- that drops the spinner while a request is still
   * running, so the panel reads as settled when it is not.
   */
  it('does not let a stale lookup failure clear a newer search', () => {
    const first = new Subject<never>();
    lookup.mockReturnValue(first);
    (fixture.componentInstance as unknown as { lookupHubSpot(n: string): void }).lookupHubSpot('Event A');

    // A newer lookup starts and is still in flight.
    const second = new Subject<never>();
    lookup.mockReturnValue(second);
    (fixture.componentInstance as unknown as { lookupHubSpot(n: string): void }).lookupHubSpot('Event B');
    expect(instance()['hsSearching']()).toBe(true);

    // The OLD one now fails.
    first.error(new Error('stale failure'));
    fixture.detectChanges();

    expect(instance()['hsSearching'](), 'a stale failure declared the newer lookup finished').toBe(true);
  });

  /**
   * hsCreating tracks whether a REQUEST is in flight, which is a fact about the subscription
   * rather than about which event is on screen. Releasing it after the stale guard left the
   * button disabled and "Creating..." frozen on the new event's panel with nothing to clear it.
   */
  it('releases the creating flag even when the answer arrives stale', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });

    const late = new Subject<unknown>();
    create.mockReturnValue(late);
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    expect(instance()['hsCreating']()).toBe(true);

    (fixture.componentInstance as unknown as { lastLookedUpEvent: string }).lastLookedUpEvent = 'Some Other Event';
    late.next({ created: true, hs_utm: 'x', campaign_name: 'KubeCon NA 2026' });
    fixture.detectChanges();

    expect(instance()['hsCreating']()).toBe(false);
  });

  /**
   * A create that SUCCEEDED without a token still needs the re-check: HubSpot assigns the token
   * asynchronously, and lookupHubSpot's early return means retyping the same url cannot fetch
   * it. Clearing the control there leaves no way to ever retrieve it.
   */
  /**
   * The message must not claim HubSpot has assigned nothing. The marketing create is not
   * documented to return `hs_utm` at all, so an absent token means only that THIS RESPONSE did
   * not carry one -- the campaign may already have a token the next lookup can read.
   */
  it('does not claim HubSpot assigned no token when the create response simply lacked one', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });
    create.mockReturnValue(
      new Observable((s) => {
        s.next({ created: true, hs_utm: null, campaign_name: 'KubeCon NA 2026' });
        s.complete();
      })
    );
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    const status = String(instance()['hsStatus']());
    // It DID create -- that much is known and must be stated.
    expect(status).toContain('Created');
    // But not what HubSpot did or did not assign.
    expect(status, 'stated as fact something the response cannot establish').not.toMatch(/has not assigned/i);
    expect(status).toMatch(/not known yet/i);
  });

  it('keeps the re-check available when a created campaign has no token yet', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });
    create.mockReturnValue(
      new Observable((s) => {
        s.next({ created: true, hs_utm: null, campaign_name: 'KubeCon NA 2026' });
        s.complete();
      })
    );
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // Create stays hidden -- the campaign exists.
    expect(el.querySelector('[data-testid="planning-hubspot-create-btn"]')).toBeNull();
    // But the one action that can still make progress is offered.
    expect(el.querySelector('[data-testid="planning-hubspot-recheck-btn"]')).not.toBeNull();
  });

  /**
   * A FAILED re-check established nothing, and this arm leaves lastLookedUpEvent set -- so
   * without restoring the control the same event shows neither Create nor a re-check and the
   * only exit is a page reload.
   */
  it('restores the re-check when the lookup itself fails', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });
    create.mockReturnValue(
      new Observable((s) => {
        s.next({ created: false });
        s.complete();
      })
    );
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    lookup.mockReturnValue(throwError(() => new Error('hubspot down')));
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="planning-hubspot-recheck-btn"]')!.click();
    fixture.detectChanges();

    expect(instance()['hsSearching']()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="planning-hubspot-recheck-btn"]')).not.toBeNull();
  });

  /**
   * lastLookedUpEvent only updates when the 500ms debounced lookup FIRES. Between the user
   * typing event B and that debounce elapsing it still names event A, so a create for A landing
   * in that window passed a lastLookedUpEvent check and wrote A's token into B's panel.
   */
  it('drops a create answer once the url field names a different event', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });

    const late = new Subject<unknown>();
    create.mockReturnValue(late);
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();

    // The user types event B. The debounce has NOT fired, so lastLookedUpEvent still says A.
    (fixture.componentInstance as unknown as { briefForm: { controls: { url: { setValue(v: string): void } } } }).briefForm.controls.url.setValue(
      'https://events.example.com/some-other-conference-2027'
    );
    late.next({ created: true, hs_utm: 'event-a-utm', campaign_name: 'KubeCon NA 2026' });
    fixture.detectChanges();

    expect(instance()['hsUtm']()).toBeFalsy();
  });

  /**
   * The create is slow enough for the operator to retype the url and start a lookup for a
   * different event while it is in flight. Event A's answer must not land on event B's panel.
   */
  it('drops a create answer for an event the operator has already left', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });

    const late = new Subject<unknown>();
    create.mockReturnValue(late);
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();

    // The operator moves on before the create answers.
    (fixture.componentInstance as unknown as { lastLookedUpEvent: string }).lastLookedUpEvent = 'Some Other Event';
    late.next({ created: true, hs_utm: 'event-a-utm', campaign_name: 'KubeCon NA 2026' });
    fixture.detectChanges();

    expect(instance()['hsUtm']()).toBeFalsy();
    expect(String(instance()['hsStatus']() ?? '')).not.toContain('KubeCon NA 2026');
  });

  /**
   * A campaign that EXISTS but has no token is a real match. Offering to create it would
   * duplicate a campaign that is already there, in a namespace shared account-wide.
   */
  it('does not offer to create a campaign that exists without a token', () => {
    runLookup({ found: true, hs_utm: null, campaign_name: 'KubeCon NA 2026', all_matches: [] });

    expect(instance()['hsNotFound']()).toBe(false);
    // The brief gets no token, which is honest — HubSpot has none to report against.
    expect(instance()['hsUtm']()).toBeFalsy();
    expect(String(instance()['hsStatus']())).toContain('no UTM token');
  });

  /**
   * A create that SUCCEEDED must not read as a failure just because HubSpot has not assigned the
   * token yet. Requiring hs_utm too would leave the Create button up and invite a retry that
   * writes a SECOND campaign into the LF-global namespace — upstream has no duplicate check, by
   * design, because that check belongs with the operator.
   *
   * `created` is trustworthy on its own: upstream refuses an id-less create rather than
   * reporting one as success.
   */
  it('treats a create with no token yet as success, not failure', () => {
    // A lookup must have run first: createInHubSpot early-returns without lastLookedUpEvent,
    // so without this the test would pass against a method that never executed.
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });
    create.mockReturnValue(
      new Observable((s) => {
        s.next({ created: true, hs_utm: null, campaign_name: 'KubeCon NA 2027' });
        s.complete();
      })
    );

    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    expect(create).toHaveBeenCalled();

    expect(String(instance()['hsStatus']())).toContain('Created');
    expect(String(instance()['hsStatus']())).not.toContain('Failed');
    expect(instance()['hsNotFound']()).toBe(false);
  });

  it('still offers to create when nothing matched', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });

    expect(instance()['hsNotFound']()).toBe(true);
  });

  /**
   * When the best match is TOKENLESS, it is excluded from `all_matches` — that list's element
   * type has a non-nullable hs_utm, so a tokenless campaign cannot be represented there without
   * inventing the value.
   *
   * The picker's old `length > 1` threshold assumed the selected match was always IN the list,
   * so "more than one" meant "at least one alternative". With a tokenless winner, a single
   * tokened alternative left the list at length 1 and stayed hidden — and the user had no way to
   * take the one token actually available.
   */
  it('offers a lone alternative when the best match has no token', () => {
    runLookup({
      found: true,
      hs_utm: null,
      campaign_name: 'KubeCon NA 2026',
      all_matches: [{ name: 'KubeCon NA 2026 sponsors', hs_utm: 'sponsors' }],
    });

    expect(instance()['hsHasAlternatives']()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="planning-hubspot-matches"]')).not.toBeNull();
  });

  // The selected match alone is not an alternative — showing a one-item picker of the thing
  // already chosen is noise.
  it('does not offer a picker when the only match is the one already selected', () => {
    runLookup({
      found: true,
      hs_utm: 'kubecon-na-2026',
      campaign_name: 'KubeCon NA 2026',
      all_matches: [{ name: 'KubeCon NA 2026', hs_utm: 'kubecon-na-2026' }],
    });

    expect(instance()['hsHasAlternatives']()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="planning-hubspot-matches"]')).toBeNull();
  });

  /**
   * The exposure warning is REQUIRED by the upstream contract, not decoration. HubSpot's campaign
   * namespace is the whole LF portal, so a campaign created here is visible to every other
   * foundation's campaign managers — and the name is whatever event text the operator typed.
   */
  it('warns that a created campaign is visible to everyone on the connected account', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });

    const warning = fixture.nativeElement.querySelector('[data-testid="planning-hubspot-global-warning"]');
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toMatch(/everyone working in that account/i);
    // Paired positive: the Create button must still be offered, so this cannot pass merely
    // because the whole block failed to render.
    expect(fixture.nativeElement.querySelector('[data-testid="planning-hubspot-create-btn"]')).not.toBeNull();
  });

  /**
   * A FAILED create withdraws the button. The outcome is unknown, not failed — upstream reports
   * an id-less 2xx as an error precisely because the campaign may already exist, and classifies
   * every other failure unconfirmed for the same reason. Leaving the button up invites a retry
   * that creates a SECOND campaign in a namespace every foundation shares.
   */
  it('withdraws the create button when the outcome is unknown', () => {
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false });
    expect(fixture.nativeElement.querySelector('[data-testid="planning-hubspot-create-btn"]')).not.toBeNull();

    create.mockReturnValue(throwError(() => new Error('upstream timeout')));
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="planning-hubspot-create-btn"]')).toBeNull();
    expect(String(instance()['hsStatus']())).toMatch(/check HubSpot/i);
  });

  it('uses the token when the match has one', () => {
    runLookup({ found: true, hs_utm: 'kubecon-na-2026', campaign_name: 'KubeCon NA 2026', all_matches: [] });

    expect(instance()['hsUtm']()).toBe('kubecon-na-2026');
    expect(instance()['hsNotFound']()).toBe(false);
  });
});
