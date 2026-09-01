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
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [] });
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

  /**
   * `hsCreating` is shared, not per-subscription. A foundation change clears state and can start
   * a SECOND create while the first is still in flight -- so an older create releasing the flag
   * unconditionally re-enables the button while the newer request is still running, which is how
   * a duplicate campaign gets made in a shared namespace.
   */
  it('does not let a stale create re-enable the button for a newer one', () => {
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
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    expect(instance()['hsCreating']()).toBe(true);

    // The OLD foundation's create now settles.
    first.error(new Error('stale create failed'));
    fixture.detectChanges();

    expect(instance()['hsCreating'](), 'a stale create re-enabled the button while a newer one was still running').toBe(true);
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
    (fixture.componentInstance as unknown as { createInHubSpot(): void }).createInHubSpot();
    expect(instance()['hsCreating']()).toBe(true);

    first.error(new Error('stale create failed'));
    fixture.detectChanges();

    expect(instance()['hsCreating'](), "a round-tripped stale create released the newer one's flag").toBe(true);
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
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [] });

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
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [] });
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
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [] });
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
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [] });

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
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [] });

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
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [] });
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
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [] });

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
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [] });

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
    runLookup({ found: false, hs_utm: null, campaign_name: '', all_matches: [] });
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
