// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AudienceCustomService } from '@services/audience-custom.service';
import { CampaignService } from '@services/campaign.service';
import { map, NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUDIENCE_ATTACH_MAX_LIST_IDS,
  AUDIENCE_INCLUSION_SUMMARY_MAX_LENGTH,
  AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS,
  AUDIENCE_UNION_EXACT_CAP,
} from '@lfx-one/shared/constants';
import type {
  AudienceComposedList,
  AudienceComposeMasterPartial,
  AudienceAttachExistingResult,
  AudienceComposeMasterResult,
  CampaignAudience,
  AudienceDiscoveredEvent,
  AudienceDiscoveredList,
  AudienceDiscoveryResult,
  AudienceDiscoverySSEEventType,
  AudienceLastSentEmail,
  AudienceSignal,
  AudienceSuppressionList,
  AudienceSuppressionListsResult,
  SSEEvent,
} from '@lfx-one/shared/interfaces';

import { By } from '@angular/platform-browser';

import { AudienceCustomBuilderComponent } from '../audience-custom-builder/audience-custom-builder.component';
import { AudienceBuilderTabComponent } from './audience-builder-tab.component';

const EVENT: AudienceDiscoveredEvent = { eventName: 'Synthetic Summit 2026', brandShort: 'SYN', eventDates: ['2026-03-02', '2026-03-04'] };

function discovered(overrides: Partial<AudienceDiscoveryResult> = {}): AudienceDiscoveryResult {
  const lists: AudienceDiscoveredList[] = [
    {
      listId: '101',
      name: 'Synthetic Summit 2026 - Registrants',
      signal: 'event_registration',
      size: 1200,
      reason: 'The filter selects on registration for this event.',
      listType: 'DYNAMIC',
      hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/101',
    },
  ];
  return { lists, missingSignals: ['event_speakers'], ...overrides };
}

describe('AudienceBuilderTabComponent', () => {
  let fixture: ComponentFixture<AudienceBuilderTabComponent>;
  let stream: Subject<SSEEvent<AudienceDiscoverySSEEventType>>;

  const getAudienceCapabilities = vi.fn();
  const discoverAudience = vi.fn();
  const searchAudienceLists = vi.fn();
  const getAudienceSuppressionLists = vi.fn();
  const getAudienceLastSent = vi.fn();
  const getAudienceExistingMasterLists = vi.fn();
  const previewAudienceCount = vi.fn();
  const composeAudienceMaster = vi.fn();
  const runAudienceQa = vi.fn();
  const attachExistingAudience = vi.fn();

  beforeEach(async () => {
    for (const mock of [
      getAudienceCapabilities,
      discoverAudience,
      searchAudienceLists,
      getAudienceSuppressionLists,
      getAudienceLastSent,
      getAudienceExistingMasterLists,
      previewAudienceCount,
      composeAudienceMaster,
      runAudienceQa,
      attachExistingAudience,
    ]) {
      mock.mockReset();
    }

    stream = new Subject<SSEEvent<AudienceDiscoverySSEEventType>>();
    getAudienceCapabilities.mockReturnValue(of({ hubspotConfigured: true }));
    discoverAudience.mockReturnValue(stream.asObservable());
    searchAudienceLists.mockReturnValue(of([]));
    getAudienceSuppressionLists.mockReturnValue(
      of([
        {
          key: 'lf_events_gdpr',
          label: 'LF Events GDPR',
          listId: '201',
          name: 'LF Events - GDPR Suppression',
          size: 5000,
          category: 'standard',
          hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
        },
      ])
    );
    getAudienceLastSent.mockReturnValue(of([]));
    getAudienceExistingMasterLists.mockReturnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [AudienceBuilderTabComponent],
      providers: [
        // The custom builder child owns its own requests; none of these specs drive it.
        {
          provide: AudienceCustomService,
          useValue: {
            interpret: vi.fn(() => NEVER),
            preview: vi.fn(() => NEVER),
            create: vi.fn(() => NEVER),
            inFlightCreate: vi.fn(() => null),
            createOutcome: vi.fn(() => null),
            takeCreateOutcome: vi.fn(() => null),
          },
        },
        {
          provide: CampaignService,
          useValue: {
            getAudienceCapabilities,
            discoverAudience,
            searchAudienceLists,
            // The endpoint answers `{ lists, standardList? }`. Most specs only care about the rows, so
            // a mock emitting a bare array is wrapped; one emitting the full result passes through.
            getAudienceSuppressionLists: (...args: unknown[]) =>
              (getAudienceSuppressionLists(...args) as Observable<AudienceSuppressionList[] | AudienceSuppressionListsResult>).pipe(
                map((value) => (Array.isArray(value) ? { lists: value } : value))
              ),
            getAudienceLastSent,
            getAudienceExistingMasterLists,
            previewAudienceCount,
            composeAudienceMaster,
            runAudienceQa,
            attachExistingAudience,
          },
        },
      ],
    }).compileComponents();
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Renders the tab as active.
   *
   * Two cycles: the capabilities request is driven by a `toObservable(active)` created in the
   * constructor, which flushes on the FIRST change-detection pass, so the response only reaches
   * the view on the second.
   */
  async function render(
    inputs: { active?: boolean; initialEventUrl?: string; briefId?: string; audienceReadFailed?: boolean; audienceReadPending?: boolean } = {}
  ): Promise<void> {
    fixture = TestBed.createComponent(AudienceBuilderTabComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('active', inputs.active ?? true);
    fixture.componentRef.setInput('initialEventUrl', inputs.initialEventUrl ?? '');
    // Defaults to EMPTY, which is the brief-less exploratory state the builder is reachable in.
    // Tests that care about attaching opt in, so every other test here keeps exercising the path
    // where a compose creates lists that no send points at.
    fixture.componentRef.setInput('briefId', inputs.briefId ?? '');
    fixture.componentRef.setInput('audienceReadFailed', inputs.audienceReadFailed ?? false);
    fixture.componentRef.setInput('audienceReadPending', inputs.audienceReadPending ?? false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function typeEventUrl(value: string): void {
    const input = host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-event-url"]');
    if (input === null) {
      throw new Error('the event-url input is not rendered');
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function click(testId: string): void {
    host().querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click();
    fixture.detectChanges();
  }

  /** Clicks Compose and then its confirmation: compose asks before it creates anything. */
  function composeMaster(): void {
    click('campaigns-audience-compose');
    click('campaigns-audience-compose-confirm');
  }

  /**
   * Clicks "Use selected lists", confirming when it asks: an attach that creates the standing list
   * or the registrants list asks first, and most fixtures here have no standing list yet.
   */
  function useSelectionDirectly(): void {
    click('campaigns-audience-use-direct');
    if (host().querySelector('[data-testid="campaigns-audience-use-direct-confirming"]')) {
      click('campaigns-audience-use-direct-confirm');
    }
  }

  /** Confirms a step-4 reuse attach when it asks (it does while the standing list is missing). */
  function confirmReuseIfAsked(): void {
    if (host().querySelector('[data-testid="campaigns-audience-reuse-attach-confirming"]')) {
      click('campaigns-audience-reuse-attach-confirm');
    }
  }

  /** Toggles one standard suppression row, opening the collapsed standard entry first. */
  function toggleStandardRow(key: string): void {
    if (!host().querySelector(`[data-testid="audience-suppression-grid-toggle-${key}"]`)) {
      click('audience-suppression-standard-expand');
    }
    click(`audience-suppression-grid-toggle-${key}`);
  }

  /** Drives the stream through to a completed discovery. */
  function completeDiscovery(result: AudienceDiscoveryResult = discovered()): void {
    stream.next({ type: 'event', data: EVENT });
    stream.next({ type: 'discovered', data: result });
    stream.next({ type: 'done', data: {} });
    fixture.detectChanges();
  }

  describe('capabilities', () => {
    it('does not request capabilities until the tab is first shown', async () => {
      // The panel is always mounted so its selection state survives a tab switch. That is only
      // free if it issues no request while hidden.
      await render({ active: false });

      expect(getAudienceCapabilities).not.toHaveBeenCalled();
    });

    it('requests capabilities exactly once across repeated activations', async () => {
      // `take(1)` after the `filter` is what bounds this. The panel is never destroyed on a tab
      // switch, so a plain `switchMap` would re-request on every return to the tab for an answer
      // that cannot change within a session.
      await render({ active: true });
      expect(getAudienceCapabilities).toHaveBeenCalledTimes(1);

      fixture.componentRef.setInput('active', false);
      fixture.detectChanges();
      fixture.componentRef.setInput('active', true);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(getAudienceCapabilities, 'capabilities were re-requested on re-activation').toHaveBeenCalledTimes(1);
    });

    it('shows the degrade banner and disables discovery when HubSpot is unconfigured', async () => {
      // The flag can be on in an environment with no HubSpot token. An operator who sees the tab
      // and gets an opaque 500 per click learns nothing, so the tab renders read-only instead.
      getAudienceCapabilities.mockReturnValue(of({ hubspotConfigured: false }));
      await render();

      expect(host().querySelector('[data-testid="campaigns-audience-degraded-banner"]')).not.toBeNull();
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-discover"]')?.disabled).toBe(true);
    });

    it('degrades rather than throwing when the capabilities request itself fails', async () => {
      getAudienceCapabilities.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      await render();

      expect(host().querySelector('[data-testid="campaigns-audience-degraded-banner"]')).not.toBeNull();
    });

    it('renders no banner when HubSpot is configured', async () => {
      await render();

      expect(host().querySelector('[data-testid="campaigns-audience-degraded-banner"]')).toBeNull();
    });
  });

  describe('discovery', () => {
    it('seeds the event URL from the brief without overwriting a typed value', async () => {
      await render({ initialEventUrl: 'https://events.example.org/synthetic-summit' });
      // The SAME event throughout: a later update to its brief, not a different event's brief.
      fixture.componentRef.setInput('eventKey', 'synthetic-summit');
      fixture.detectChanges();
      expect(host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-event-url"]')?.value).toBe('https://events.example.org/synthetic-summit');

      // A later brief update must not clobber what the operator typed over the seed.
      typeEventUrl('https://events.example.org/typed-by-hand');
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/second-seed');
      fixture.detectChanges();

      expect(host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-event-url"]')?.value, 'the seed overwrote a typed URL').toBe(
        'https://events.example.org/typed-by-hand'
      );
    });

    it("accepts the new project's seed after the operator typed under the old one", async () => {
      // The dirty flag is project-scoped state too. Clearing the control with setValue('') left it
      // dirty, and the seed only fires while pristine — so typing under project A permanently
      // suppressed every later project's advertised brief URL.
      await render({ initialEventUrl: 'https://events.example.org/synthetic-summit' });
      typeEventUrl('https://events.example.org/typed-by-hand');

      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();
      expect(
        host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-event-url"]')?.value,
        'fixture precondition: a project switch must clear the field'
      ).toBe('');

      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/second-foundation-event');
      fixture.detectChanges();

      expect(
        host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-event-url"]')?.value,
        "the new project's brief URL was rejected because the control stayed dirty across the switch"
      ).toBe('https://events.example.org/second-foundation-event');
    });

    it('clears a discovery failure when the project changes', async () => {
      // A failed discover belongs to the run that failed. Left set, foundation A's error stays on
      // screen after the switch and reads as foundation B's.
      discoverAudience.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'portal unreachable' } })));
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      fixture.detectChanges();
      expect(host().textContent, 'fixture precondition: the discovery error must be on screen').toContain('portal unreachable');

      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();

      expect(host().textContent, "the previous project's discovery failure survived the switch").not.toContain('portal unreachable');
    });

    it("shows the fallback copy rather than Angular's transport string", async () => {
      // extractErrorMessage ends in `error.message || fallback`, and HttpErrorResponse.message is
      // never empty — so on a body-less failure the fallback was unreachable and the operator got
      // "Http failure response for ...", which they can do nothing with.
      discoverAudience.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0, error: null })));
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      fixture.detectChanges();

      expect(host().textContent, 'a raw Angular transport string reached the operator').not.toContain('Http failure response');
      expect(host().textContent, 'the fallback copy was not shown').toContain('Audience discovery failed');
    });

    it('will not start discovery with an empty URL', async () => {
      await render();

      click('campaigns-audience-discover');

      expect(discoverAudience).not.toHaveBeenCalled();
    });

    it('streams progress, then the event identity, then the buckets', async () => {
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');

      stream.next({ type: 'progress', data: { message: 'Searching HubSpot lists...', inspected: 12 } });
      fixture.detectChanges();
      const ticker = host().querySelector('[data-testid="campaigns-audience-progress"]');
      expect(ticker?.textContent).toContain('Searching HubSpot lists...');
      expect(ticker?.textContent).toContain('12');

      stream.next({ type: 'event', data: EVENT });
      fixture.detectChanges();
      const identity = host().querySelector('[data-testid="campaigns-audience-identity"]');
      expect(identity?.textContent).toContain('Synthetic Summit 2026');
      expect(identity?.textContent, 'eventDates rendered as a raw array').toContain('2026-03-02 – 2026-03-04');

      stream.next({ type: 'discovered', data: discovered() });
      stream.next({ type: 'done', data: {} });
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="audience-bucket-event_registration"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-progress"]'), 'the ticker outlived the stream').toBeNull();
    });

    it('loads suppression and reuse lookups only after the event is named', async () => {
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      expect(getAudienceSuppressionLists).not.toHaveBeenCalled();

      completeDiscovery();

      expect(getAudienceSuppressionLists).toHaveBeenCalledWith('tlf', 'SYN', 'Synthetic Summit 2026', 'Synthetic Summit 2026');
      expect(getAudienceLastSent).toHaveBeenCalledWith('tlf', 'Synthetic Summit 2026', 'SYN');
      expect(getAudienceExistingMasterLists).toHaveBeenCalledWith('tlf', 'Synthetic Summit 2026', 'SYN');
    });

    it('reports a server restart as an interruption the operator must act on', async () => {
      // A `shutdown` event means the run died mid-flight. Falling through to `done` would clear
      // the spinner and leave the operator believing discovery simply found nothing.
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');

      stream.next({ type: 'shutdown', data: {} });
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-discover-error"]')?.textContent).toContain('interrupted');
      expect(host().querySelector('[data-testid="audience-card-grid"]'), 'an interrupted run rendered a review grid').toBeNull();
    });

    it('surfaces an in-stream error event', async () => {
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');

      stream.next({ type: 'error', data: 'The event page could not be fetched.' });
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-discover-error"]')?.textContent).toContain('The event page could not be fetched.');
    });
  });

  describe('selection, preview and compose', () => {
    async function renderWithDiscovery(inputs: { audienceReadFailed?: boolean; audienceReadPending?: boolean; briefId?: string } = {}): Promise<void> {
      await render(inputs);
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
    }

    it('drops a stale count when the selection changes', async () => {
      // A count computed for a different selection is misinformation an operator would compose on.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      previewAudienceCount.mockReturnValue(of({ exact: true, estimate: 1200, count: 1200, reason: '' }));
      click('campaigns-audience-preview-count');
      expect(host().querySelector('[data-testid="campaigns-audience-count"]')?.textContent).toContain('1,200');

      toggleStandardRow('lf_events_gdpr');
      expect(host().querySelector('[data-testid="campaigns-audience-count"]'), 'a count survived a selection edit').toBeNull();
    });

    it('never renders an unknown total as "~0" people', async () => {
      // Upstream returns estimate:0 when a selected list did not report a size at all -- HubSpot
      // omits it on some list shapes, and summing it as zero would leave the total short by that
      // whole list. "~0" would turn that refusal into a measurement of approximately nobody,
      // which is the fabricated number this type exists to prevent.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      previewAudienceCount.mockReturnValue(of({ exact: false, estimate: 0, count: 0, reason: 'one or more selected lists did not report a size' }));
      click('campaigns-audience-preview-count');

      const text = host().querySelector('[data-testid="campaigns-audience-count"]')?.textContent ?? '';
      expect(text, 'an unknown total was rendered as a number').not.toContain('~0');
      expect(text).toContain('No reliable total');
    });

    it('renders an estimate AT the cap as approximate, since the server would have swept it', async () => {
      // The boundary is the only value where the two services can disagree, and the pair of tests
      // above brackets it without landing on it (41,000 and 1,200). The server's ExceedsExactCap is
      // STRICTLY greater, so at exactly the cap the union sweep runs -- an `exact:false` here means
      // it ran and FAILED, which is the degraded case, not the refused-as-too-big case.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      previewAudienceCount.mockReturnValue(
        of({
          exact: false,
          estimate: AUDIENCE_UNION_EXACT_CAP,
          count: AUDIENCE_UNION_EXACT_CAP,
          reason: 'live membership lookup failed; showing the sum estimate',
        })
      );
      click('campaigns-audience-preview-count');

      const text = host().querySelector('[data-testid="campaigns-audience-count"]')?.textContent ?? '';
      // "Up to N" is the inexact marker, not "~": the sum is strictly an UPPER bound (two
      // identical 20,000 lists estimate 40,000 and union 20,000), so "~" claimed a closeness
      // the number does not have.
      expect(text, 'a swept-and-failed count at the cap was rendered as a refused-as-too-big bound').toContain('Up to');
      expect(text).not.toContain(`${AUDIENCE_UNION_EXACT_CAP.toLocaleString('en-US')}+`);
    });

    it("drops the previous event's selection when a new discovery runs", async () => {
      // The sibling test above establishes that a count computed for a different SELECTION is
      // misinformation. A selection carried across a different EVENT is the same defect one level
      // up, and worse: compose is a non-idempotent WRITE to the production HubSpot portal, so the
      // master list it creates is named for event B while containing event A's contacts, and looks
      // entirely legitimate afterwards.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      // A second, different event. Its result shares no list id with the first. The ticked list is
      // work the reset loses, so the operator confirms starting over first.
      typeEventUrl('https://events.example.org/other-2027');
      click('campaigns-audience-discover');
      click('campaigns-audience-start-over-confirm');
      completeDiscovery(
        discovered({
          lists: [
            {
              listId: '999',
              name: 'Other 2027 - Registrants',
              signal: 'event_registration',
              size: 40,
              reason: 'The filter selects on registration for this event.',
              listType: 'DYNAMIC',
              hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/999',
            },
          ],
        })
      );

      expect(
        host().querySelector('[data-testid="campaigns-audience-remove-101"]'),
        "the previous event's list is still selected after re-discovering"
      ).toBeNull();

      // The wire is what actually matters: a stale id here creates the wrong audience in HubSpot.
      composeAudienceMaster.mockReturnValue(of({ master: { listId: '5', name: 'm', size: 1, hubspotUrl: 'u' }, sourceListIds: [] }));
      click('audience-card-grid-toggle-999');
      composeMaster();

      expect(composeAudienceMaster).toHaveBeenCalled();
      const sent = composeAudienceMaster.mock.calls.at(-1)?.[1]?.listIds ?? [];
      expect(sent, "compose carried the previous event's list id").not.toContain('101');
    });

    it('reports a capped union as an approximate sum, never a fabricated exact number', async () => {
      // Above the cap the server skips the union sweep and returns the naive SUM, which
      // double-counts every contact in more than one list — an UPPER bound. Two ways to get this
      // wrong: rendering it as a precise total (a number an operator plans a send around), or
      // rendering the CAP, which threw away the server's real figure and understated reach by
      // 16,000 here. `~41,000` is the honest reading of what `OverCapPreviewCount` sends.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      previewAudienceCount.mockReturnValue(of({ exact: false, estimate: 41_000, count: 41_000, reason: 'Union above the exact-count cap.' }));
      click('campaigns-audience-preview-count');

      const text = host().querySelector('[data-testid="campaigns-audience-count"]')?.textContent ?? '';
      expect(text, "the server's own estimate was discarded in favour of the cap").toContain('Up to 41,000');
      // The `~` prefix IS the "not exact" signal, and the assertion above already requires it.
      // A bare "41,000" cannot be asserted absent here — "~41,000" contains it as a substring —
      // so the exactness check is that the label does not start with a digit.
      expect(text.trimStart().startsWith('4'), 'an upper-bound estimate was rendered as an exact total').toBe(false);
      expect(text, 'an upper bound was presented as an approximation of the truth').not.toContain('~');
      expect(text, 'the cap was shown as if it were the figure the server sent').not.toContain(`${AUDIENCE_UNION_EXACT_CAP.toLocaleString('en-US')}+`);
    });

    it('shows a degraded count as approximate, never as the cap', async () => {
      // `exact: false` arrives from TWO server paths and the cap label is only true for one of
      // them. `DegradedPreviewCount` (membership sweep failed or truncated) is reachable ONLY
      // BELOW the cap -- `audience_explorer.go` returns early once `ExceedsExactCap` holds -- so
      // rendering it as `25,000+` overstates a small audience by an order of magnitude, in the
      // direction that upstream doc calls "the one direction that must never be reported as
      // exact". The sibling test above covers the over-cap path, where the bound IS correct.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      previewAudienceCount.mockReturnValue(
        of({ exact: false, estimate: 1_200, count: 1_200, reason: 'live membership lookup failed; showing the sum estimate' })
      );
      click('campaigns-audience-preview-count');

      const text = host().querySelector('[data-testid="campaigns-audience-count"]')?.textContent ?? '';
      expect(text, 'a failed sweep was rendered as a 25,000 floor').not.toContain(AUDIENCE_UNION_EXACT_CAP.toLocaleString('en-US'));
      expect(text, 'the estimate the server did return was not shown').toContain('1,200');
    });

    it('ignores a discovery frame that arrives after the project changed', async () => {
      // The SSE stream is the one that repopulates identity and the discovered list ids, so a
      // late frame from project A restores A's ids after the panel is scoped to project B —
      // and the follow-up lookups then run against B carrying them. Every other request was
      // generation-guarded; this one was not.
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');

      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // Project A's stream finally delivers its results.
      stream.next({ type: 'event', data: EVENT });
      stream.next({ type: 'discovered', data: discovered() });
      stream.next({ type: 'done', data: {} });
      fixture.detectChanges();

      expect(
        host().querySelector('[data-testid="audience-card-grid-toggle-101"]'),
        "a previous project's discovery results were rendered after the switch"
      ).toBeNull();
    });

    it('re-enables Discover after the project changes mid-discovery', async () => {
      // The generation bump DISCARDS the old stream's completion, so without clearing
      // `discovering` the flag stayed true forever and the new project's Discover button was
      // permanently disabled — the guard causing the stall it was added to prevent.
      // `stream` is a Subject the helper never completes, so discovery stays in flight.
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');

      // resetRunState used to run AFTER `discovering` was set, clearing it immediately — the
      // spinner never appeared and a second click could launch an overlapping SSE request.
      expect(
        host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-discover"]')?.disabled,
        'Discover stayed live during an in-flight discovery, so it can be clicked twice'
      ).toBe(true);

      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      typeEventUrl('https://events.example.org/other-2027');
      expect(
        host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-discover"]')?.disabled,
        'Discover stayed disabled after switching project mid-discovery'
      ).toBe(false);
    });

    it("does not carry project A's capability into project B's pending window", async () => {
      // switchMap starts B's request, but toSignal keeps A's value until B emits — so a
      // project that answered `hubspotConfigured: true` left every control enabled for the
      // NEXT project while it was still unverified, and B may have no HubSpot connection.
      getAudienceCapabilities.mockReturnValue(of({ hubspotConfigured: true }));
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-discover"]')?.disabled).toBe(false);

      // B's request never resolves: the panel must not inherit A's "configured" answer.
      getAudienceCapabilities.mockReturnValue(new Subject());
      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      typeEventUrl('https://events.example.org/other-2027');

      expect(
        host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-discover"]')?.disabled,
        "project A's capability kept the panel open for an unverified project B"
      ).toBe(true);
    });

    it('keeps writes disabled until the current project answers', async () => {
      // `toSignal` starts at null and retains project A's value while B is pending, and
      // `?.hubspotConfigured === false` read BOTH as "fine" — so discovery was enabled before
      // the first check returned, and indefinitely if it stalled.
      getAudienceCapabilities.mockReturnValue(new Subject());
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');

      expect(
        host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-discover"]')?.disabled,
        'discovery was enabled before capabilities resolved'
      ).toBe(true);
    });

    it('does not blame credentials when the capabilities request itself failed', async () => {
      // Both states fail closed, which is right. But a failed request was reported as a
      // CONFIRMED "no HubSpot credentials configured" — so a gateway or campaign-service
      // outage sent the operator to an administrator to fix credentials that are fine.
      getAudienceCapabilities.mockReturnValue(throwError(() => new Error('gateway down')));
      await render();

      expect(host().querySelector('[data-testid="campaigns-audience-degraded-banner"]'), 'the tab must still fail closed').not.toBeNull();
      expect(
        host().querySelector('[data-testid="campaigns-audience-degraded-unconfigured"]'),
        'an outage was reported as a confirmed configuration problem'
      ).toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-degraded-unknown"]')).not.toBeNull();
    });

    it('still names the configuration problem when that is the real answer', async () => {
      // The retryable copy must not swallow the genuine "not configured" case, which is the
      // one an administrator actually has to act on.
      getAudienceCapabilities.mockReturnValue(of({ hubspotConfigured: false }));
      await render();

      expect(host().querySelector('[data-testid="campaigns-audience-degraded-unconfigured"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-degraded-unknown"]')).toBeNull();
    });

    it("states upstream's reason instead of guessing at credentials", async () => {
      // `hubspotConfigured: false` covers BOTH "no credentials exist" and "a connection exists
      // but cannot produce a client" (inactive, undecryptable). Only upstream knows which, and
      // the generic copy sends an administrator to configure credentials that are already there.
      getAudienceCapabilities.mockReturnValue(of({ hubspotConfigured: false, detail: 'The HubSpot connection for this project is inactive.' }));
      await render();

      expect(
        host().querySelector('[data-testid="campaigns-audience-degraded-detail"]')?.textContent,
        "upstream's reason was dropped and the generic credentials copy shown instead"
      ).toContain('inactive');
      expect(
        host().querySelector('[data-testid="campaigns-audience-degraded-unconfigured"]'),
        'the wrong remediation was offered alongside the real one'
      ).toBeNull();
    });

    it('refetches capabilities for a new project even after one request failed', async () => {
      // An outer catchError emits its fallback and COMPLETES the slug stream, so a single
      // failed capabilities call would leave the tab degraded for the rest of the session —
      // no later project switch could recover it without recreating the component.
      getAudienceCapabilities.mockReturnValueOnce(throwError(() => new Error('upstream down')));
      await render();
      expect(getAudienceCapabilities).toHaveBeenCalledTimes(1);

      getAudienceCapabilities.mockReturnValue(of({ hubspotConfigured: true }));
      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getAudienceCapabilities, 'the slug stream completed on the first failure').toHaveBeenCalledTimes(2);
    });

    it("drops the previous project's selection when the project changes", async () => {
      // The campaigns component stays mounted across `activeFoundationSlug` changes, so the
      // panel kept the previous portal's discovered lists and ticks while every write went to
      // the new slug. HubSpot list ids are numeric and portal-scoped, so an id ticked in
      // portal A can name an unrelated list in portal B — and compose it.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]')).not.toBeNull();

      fixture.componentRef.setInput('projectSlug', 'a-different-foundation');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), "the previous project's selection survived a project switch").toBeNull();
    });

    it('shows a list ticked on both sides instead of silently dropping the exclusion', async () => {
      // `excludeIds` filters out anything also included, so the request omitted the exclusion
      // while BOTH checkboxes stayed ticked. The panel then claimed a GDPR/opt-out list would
      // be applied to a send that did not carry it — contacts the operator believed were
      // suppressed get mailed. Which side should win is their call, not this component's.
      // The SAME list on both sides is what creates the conflict, so the discovered list and
      // the suppression row share an id here.
      getAudienceSuppressionLists.mockReturnValue(
        of([
          {
            key: 'lf_events_gdpr',
            label: 'LF Events GDPR',
            listId: '101',
            name: 'Synthetic Summit 2026 - Registrants',
            size: 1200,
            category: 'standard',
            hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/101',
          },
        ])
      );
      // Every resolved suppression row arrives pre-ticked, so including 101 is the second tick.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      const banner = host().querySelector('[data-testid="campaigns-audience-conflict"]');
      expect(banner, 'a list ticked on both sides was resolved silently').not.toBeNull();
      expect(banner?.textContent).toContain('Synthetic Summit 2026 - Registrants');

      const btn = host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]');
      expect(btn?.disabled, 'compose stayed enabled with an unresolved include/exclude conflict').toBe(true);
    });

    it('refuses to attach a master that is also marked Exclude, instead of dropping the exclusion', async () => {
      // Filtering the overlap out recorded a send that reaches contacts the operator marked for
      // exclusion. The tab's conflict gate only sees the step-6 selection, not the attached list.
      await renderWithDiscovery({ briefId: 'brief-1' });
      const tab = fixture.componentInstance as unknown as {
        onExcludeList: (list: { listId: string; name: string }) => void;
        onUseMasterList: (list: { listId: string; name: string }, confirmed?: boolean) => void;
        attachError: () => string | null;
      };
      tab.onExcludeList({ listId: '901', name: 'Synthetic Master' });
      fixture.detectChanges();

      // Confirmed: this fixture has no standing list yet, so the attach would create it.
      tab.onUseMasterList({ listId: '901', name: 'Synthetic Master' }, true);

      expect(attachExistingAudience, 'the overlap was attached with the exclusion dropped').not.toHaveBeenCalled();
      expect(tab.attachError()).toContain('both sent to and excluded');
    });

    it('does not offer direct use past the BFF include-list cap, and says why', async () => {
      await renderWithDiscovery({ briefId: 'brief-1' });
      const tab = fixture.componentInstance as unknown as {
        inclusion: { set: (m: ReadonlyMap<string, string>) => void };
        canUseSelectionDirectly: () => boolean;
        directUseLimitMessage: () => string;
      };
      const tooMany = new Map(Array.from({ length: AUDIENCE_ATTACH_MAX_LIST_IDS + 1 }, (_, i) => [String(1000 + i), `List ${i}`] as [string, string]));
      tab.inclusion.set(tooMany);
      fixture.detectChanges();

      expect(tab.canUseSelectionDirectly(), 'direct use offered for a selection the BFF refuses').toBe(false);
      expect(tab.directUseLimitMessage()).toContain(`at most ${AUDIENCE_ATTACH_MAX_LIST_IDS} lists`);
      expect(host().querySelector('[data-testid="campaigns-audience-use-direct-limit"]')).not.toBeNull();
    });

    it('does not offer compose past the BFF cap on selected or excluded lists, and says why', async () => {
      // The over-cap copy used to steer the operator into compose, which the BFF refused the same way
      // and `composeAttempted` then locked until reload.
      await renderWithDiscovery({ briefId: 'brief-1' });
      const tab = fixture.componentInstance as unknown as {
        inclusion: { set: (m: ReadonlyMap<string, string>) => void };
        exclusion: { set: (m: ReadonlyMap<string, string>) => void };
        canCompose: () => boolean;
      };
      const many = (from: number): ReadonlyMap<string, string> =>
        new Map(Array.from({ length: AUDIENCE_ATTACH_MAX_LIST_IDS + 1 }, (_, i) => [String(from + i), `List ${i}`] as [string, string]));

      tab.inclusion.set(many(3000));
      fixture.detectChanges();
      expect(tab.canCompose(), 'compose offered for a selection the BFF refuses').toBe(false);
      expect(host().querySelector('[data-testid="campaigns-audience-compose-limit"]')?.textContent).toContain(
        `Select at most ${AUDIENCE_ATTACH_MAX_LIST_IDS} lists`
      );

      tab.inclusion.set(new Map([['101', 'One list']]));
      tab.exclusion.set(many(4000));
      fixture.detectChanges();
      expect(tab.canCompose(), 'compose offered with more exclusions than the BFF accepts').toBe(false);
      expect(host().querySelector('[data-testid="campaigns-audience-compose-limit"]')?.textContent).toContain(
        `Exclude at most ${AUDIENCE_ATTACH_MAX_LIST_IDS} lists`
      );
    });

    it("shows the parent's conflict-specific recovery for a failed save instead of the generic copy", async () => {
      await render({ briefId: '' });
      fixture.componentRef.setInput('briefState', 'failed');
      fixture.componentRef.setInput('briefSaveMessage', 'This plan was changed in another session. Reload it first, so no lists can be attached yet.');
      fixture.detectChanges();
      const tab = fixture.componentInstance as unknown as { briefStateMessage: () => string };

      expect(tab.briefStateMessage()).toContain('changed in another session');
    });

    it('keeps a direct-use summary within the BFF length cap', async () => {
      await renderWithDiscovery({ briefId: 'brief-1' });
      const tab = fixture.componentInstance as unknown as {
        inclusion: { set: (m: ReadonlyMap<string, string>) => void };
        onUseSelectionDirectly: (confirmed?: boolean) => void;
      };
      attachExistingAudience.mockReturnValue(NEVER);
      const longNames = new Map(
        Array.from({ length: 50 }, (_, i) => [String(2000 + i), `Synthetic list with a deliberately long name ${i}`] as [string, string])
      );
      tab.inclusion.set(longNames);
      fixture.detectChanges();

      // Confirmed: this fixture has no standing list yet, so the attach would create it.
      tab.onUseSelectionDirectly(true);

      const request = attachExistingAudience.mock.calls.at(-1)?.[1] as { inclusionSummary?: string; includeListIds?: string[] } | undefined;
      expect(request?.includeListIds).toHaveLength(50);
      expect(request?.inclusionSummary?.length ?? 0).toBeLessThanOrEqual(AUDIENCE_INCLUSION_SUMMARY_MAX_LENGTH);
    });

    it('says so when no suppression list resolves in the portal, rather than asking for a tick', async () => {
      // "Select at least one suppression list" was an instruction the operator could not follow:
      // an unresolved row carries no list id and cannot be ticked.
      getAudienceSuppressionLists.mockReturnValue(
        of([{ key: 'lf_events_gdpr', label: 'LF Events GDPR', listId: '', name: '', category: 'standard', hubspotUrl: '' }])
      );
      await renderWithDiscovery({ briefId: 'brief-1' });
      const tab = fixture.componentInstance as unknown as { attachUnavailableMessage: () => string };

      expect(tab.attachUnavailableMessage()).toContain('No suppression list resolves in this HubSpot portal');
    });

    it('asks for a tick when a suppression list resolves but none is ticked', async () => {
      await renderWithDiscovery({ briefId: 'brief-1' });
      toggleStandardRow('lf_events_gdpr');
      const tab = fixture.componentInstance as unknown as { attachUnavailableMessage: () => string };

      expect(tab.attachUnavailableMessage()).toContain('Select at least one suppression list');
    });

    it('blocks existing-master reuse while a list is ticked on both sides', async () => {
      // `onUseMasterList` submits `excludeIds()`, which DROPS a list ticked on both sides -- so
      // reusing a master here silently lost a suppression the panel still showed as applied.
      getAudienceSuppressionLists.mockReturnValue(
        of([
          {
            key: 'lf_events_gdpr',
            label: 'LF Events GDPR',
            listId: '101',
            name: 'Synthetic Summit 2026 - Registrants',
            size: 1200,
            category: 'standard',
            hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/101',
          },
          {
            key: 'lf_events_casl',
            label: 'LF Events CASL',
            listId: '202',
            name: 'LF Events - CASL Suppression',
            size: 900,
            category: 'standard',
            hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/202',
          },
        ])
      );
      await renderWithDiscovery({ briefId: 'brief-1' });
      const gate = fixture.componentInstance as unknown as { canUseExistingMaster: () => boolean };
      // Both rows arrive ticked. Untick 101 so the inclusion alone is conflict-free, while 202 keeps
      // the mandatory suppression satisfied.
      toggleStandardRow('lf_events_gdpr');
      click('audience-card-grid-toggle-101');
      expect(gate.canUseExistingMaster(), 'the precondition: reuse is open with no conflict').toBe(true);

      toggleStandardRow('lf_events_gdpr');
      expect(gate.canUseExistingMaster(), 'master reuse stayed open with an unresolved conflict').toBe(false);
    });

    it("refuses to compose when the brief's existing audience could not be read", async () => {
      // A failed audience read leaves the parent's `emailAudience` null, which is byte-identical
      // to a brief that never had one. Offering compose there let an outage that HID an existing
      // audience produce a SECOND HubSpot master list for the same brief -- irreversible, not
      // idempotent, and real work to unpick.
      //
      // Same fail-closed reasoning as `suppressionFailed`: an unverifiable absence is not an
      // absence.
      await renderWithDiscovery({ audienceReadFailed: true });
      click('audience-card-grid-toggle-101');

      const btn = host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]');
      expect(btn?.disabled, 'compose stayed enabled while the existing audience was unreadable').toBe(true);
    });

    it('allows compose once the audience read has actually answered', async () => {
      // The counterpart, so the guard cannot be satisfied by disabling compose permanently.
      await renderWithDiscovery({ audienceReadFailed: false });
      click('audience-card-grid-toggle-101');

      const btn = host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]');
      expect(btn?.disabled, 'a verified-absent audience must not block compose').toBe(false);
    });

    it("starts over when a DIFFERENT event's brief arrives under the mounted panel", async () => {
      // The parent hands Plan's next event to the same component. Event A's discovery and ticks
      // survived, and a compose then sent A's lists with B's brief id.
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');
      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), 'fixture precondition: a list is selected').not.toBeNull();

      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-b');
      fixture.componentRef.setInput('briefId', 'brief-b');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), "event A's selection survived into event B").toBeNull();
      expect(host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-event-url"]')?.value).toBe('https://events.example.org/event-b');
    });

    it('keeps the selection across a stage change that clears the brief and hands back the SAME event', async () => {
      // Every stage change clears the brief first, so the URL goes A -> '' -> A. Comparing plain
      // previous/next pairs saw A -> '' as a change of event and wiped the same event's work.
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('initialEventUrl', '');
      fixture.componentRef.setInput('briefId', '');
      fixture.detectChanges();
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-a');
      fixture.componentRef.setInput('briefId', 'brief-a-cfp');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), 'a stage change wiped the same event').not.toBeNull();
    });

    it('resets across a cleared brief when it is a DIFFERENT event that comes back', async () => {
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('initialEventUrl', '');
      fixture.detectChanges();
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-b');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), "event A's selection survived into event B").toBeNull();
    });

    it("keeps hand-started work in a new project when that project's first brief arrives", async () => {
      // A project switch must forget the previous project's last event: carried over, the new
      // project's first brief read as a CHANGE of event and wiped the exploratory discovery.
      await render({ initialEventUrl: 'https://events.example.org/p1-event', briefId: 'brief-p1' });
      fixture.componentRef.setInput('projectSlug', 'other-project');
      fixture.componentRef.setInput('initialEventUrl', '');
      fixture.componentRef.setInput('briefId', '');
      fixture.detectChanges();
      typeEventUrl('https://events.example.org/p2-event');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/p2-event');
      fixture.componentRef.setInput('briefId', 'brief-p2');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), 'hand-started work was wiped by the first brief').not.toBeNull();
    });

    it("strands a compose in flight when a different event's brief arrives, and blocks a recompose", async () => {
      // The reply is discarded by the reset, so the create must be recorded as unconfirmed rather
      // than lost -- composing again would duplicate the lists.
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');
      composeAudienceMaster.mockReturnValue(new Subject());
      composeMaster();

      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-b');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-stranded"]'), 'the abandoned create was not reported').not.toBeNull();

      // The acknowledgement waits for the abandoned request to settle: the lists may not exist yet.
      const dismiss = host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose-stranded-dismiss"]');
      expect(dismiss?.disabled, 'the stranded marker could be cleared mid-request').toBe(true);
      (fixture.componentInstance as unknown as { onDismissStranded(): void }).onDismissStranded();
      fixture.detectChanges();
      expect(host().querySelector('[data-testid="campaigns-audience-compose-stranded"]'), 'the handler cleared it anyway').not.toBeNull();

      // And composing again in that project is blocked until the operator reconciles it.
      typeEventUrl('https://events.example.org/event-b');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');
      composeMaster();
      expect(composeAudienceMaster, 'a second compose ran over the stranded one').toHaveBeenCalledTimes(1);
    });

    it('pauses compose and attach while the parent is staging a send', async () => {
      // The exclusion is two-way: a write started while the create is on the wire could change which
      // audience that draft resolves to, and the create carries only the brief id.
      await renderWithDiscovery({ briefId: 'brief-1' });
      click('audience-card-grid-toggle-101');
      fixture.componentRef.setInput('stagingInFlight', true);
      fixture.detectChanges();

      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled, 'compose ran during staging').toBe(true);
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-use-direct"]')?.disabled, 'attach ran during staging').toBe(true);
      expect(host().querySelector('[data-testid="campaigns-audience-staging-pause"]')).not.toBeNull();

      fixture.componentRef.setInput('stagingInFlight', false);
      fixture.detectChanges();
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled).toBe(false);
    });

    it('keeps the write lock through a context switch until an in-flight attach SETTLES', async () => {
      // A reset discards the reply but the attach is still being recorded upstream. Releasing the
      // lock on the reset let A -> B -> A start a second write that the first could then overwrite.
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');
      const reply = new Subject<AudienceAttachExistingResult>();
      attachExistingAudience.mockReturnValue(reply);
      useSelectionDirectly();
      const seen: boolean[] = [];
      fixture.componentInstance.audienceWriteInFlight.subscribe((busy) => seen.push(busy));

      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-b');
      fixture.detectChanges();
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-a');
      fixture.detectChanges();
      const gate = fixture.componentInstance as unknown as { canAttach: () => boolean; canCompose: () => boolean };
      expect(gate.canAttach(), 'a second attach could start while the first was on the wire').toBe(false);
      expect(seen.at(-1), 'Stage was released while the attach was still recording').toBe(true);

      reply.next({
        master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' },
        suppressionListIds: [],
        audience: { id: 'a', briefId: 'brief-a', platform: 'hubspot', status: 'built', version: 1 },
      } as AudienceAttachExistingResult);
      reply.complete();
      fixture.detectChanges();
      expect(seen.at(-1), 'the lock never released after the attach settled').toBe(false);
    });

    it('reports an abandoned attach that succeeds, so the parent shows what upstream recorded', async () => {
      // The lock releases when the attach settles; without the report the parent kept showing the
      // OLD audience after A -> B -> A, while upstream now resolved the newly attached one.
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');
      const reply = new Subject<AudienceAttachExistingResult>();
      attachExistingAudience.mockReturnValue(reply);
      useSelectionDirectly();
      const attached: CampaignAudience[] = [];
      fixture.componentInstance.audienceAttached.subscribe((row) => attached.push(row));

      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-b');
      fixture.detectChanges();
      const row = { id: 'aud-a', briefId: 'brief-a', platform: 'hubspot', status: 'built', version: 2 } as CampaignAudience;
      reply.next({ master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' }, suppressionListIds: [], audience: row } as AudienceAttachExistingResult);
      reply.complete();

      expect(attached, 'the recorded row was swallowed by the generation guard').toEqual([row]);
    });

    it('resets hand-edited work for event B when event A is handed back', async () => {
      // Comparing advertised URLs saw "A -> A" and kept B's lists, which compose then sent with A's brief.
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      typeEventUrl('https://events.example.org/event-b');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('initialEventUrl', '');
      fixture.detectChanges();
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-a');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), "B's hand-built selection survived under A").toBeNull();
    });

    it("reseeds a URL typed for one event, before any discovery, when a different event's brief arrives", async () => {
      // The seed never overwrites a dirty field, so B's typed URL survived into C's brief and the next
      // discovery composed B's lists with C's brief id.
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      fixture.componentRef.setInput('eventKey', 'event-a');
      fixture.detectChanges();
      typeEventUrl('https://events.example.org/event-b');

      fixture.componentRef.setInput('eventKey', 'event-c');
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-c');
      fixture.detectChanges();

      expect(host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-event-url"]')?.value, "B's typed URL survived into C").toBe(
        'https://events.example.org/event-c'
      );
    });

    it('keeps a URL typed before the first brief when that brief advertises it', async () => {
      await render({ briefId: '' });
      typeEventUrl('https://events.example.org/event-b');

      fixture.componentRef.setInput('eventKey', 'event-b');
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-b');
      fixture.detectChanges();

      expect(host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-event-url"]')?.value).toBe('https://events.example.org/event-b');
    });

    it("starts over when a different event's brief arrives after a foundation switch that kept the brief", async () => {
      // The parent keeps its brief across a foundation switch, so forgetting the event on screen made
      // the next brief read as "the first after exploratory work" and E's lists survived into F's brief.
      await render({ initialEventUrl: '', briefId: 'brief-e' });
      fixture.componentRef.setInput('eventKey', 'event-e');
      fixture.detectChanges();
      fixture.componentRef.setInput('projectSlug', 'other-foundation');
      fixture.detectChanges();
      typeEventUrl('https://events.example.org/shared');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('eventKey', 'event-f');
      fixture.componentRef.setInput('briefId', 'brief-f');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), "E's lists survived into F's brief").toBeNull();
    });

    it("reseeds a URL typed after a foundation switch when the new project's first brief is for another event", async () => {
      // The key is empty after the switch, so the reseed (gated on a previous key) skipped the first
      // brief, and the typed URL's lists would be built against the new brief id.
      await render({ initialEventUrl: 'https://events.example.org/event-e', briefId: 'brief-e' });
      fixture.componentRef.setInput('eventKey', 'event-e');
      fixture.detectChanges();
      fixture.componentRef.setInput('projectSlug', 'other-foundation');
      fixture.detectChanges();
      typeEventUrl('https://events.example.org/event-x');

      fixture.componentRef.setInput('eventKey', 'event-f');
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-f');
      fixture.componentRef.setInput('briefId', 'brief-f');
      fixture.detectChanges();

      expect(host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-event-url"]')?.value, "X's typed URL survived into F's first brief").toBe(
        'https://events.example.org/event-f'
      );
    });

    it("keeps work discovered after a foundation switch when the new project's first brief advertises that URL", async () => {
      // The parent keeps the OLD project's brief across the switch; remembering its key compared the
      // new project's first brief against it and wiped work discovered for that very event.
      await render({ initialEventUrl: 'https://events.example.org/event-e', briefId: 'brief-e' });
      fixture.componentRef.setInput('eventKey', 'event-e');
      fixture.detectChanges();
      fixture.componentRef.setInput('projectSlug', 'other-foundation');
      fixture.detectChanges();
      typeEventUrl('https://events.example.org/event-f');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('eventKey', 'event-f');
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-f');
      fixture.componentRef.setInput('briefId', 'brief-f');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), "F's own first brief wiped the work discovered for F").not.toBeNull();
    });

    it('files the unattached warning for an abandoned compose that created a list', async () => {
      // An event change now strands a compose in the SAME project; its reply was swallowed by the
      // generation guard, so the parent's warning -- the only route back to a billed list -- was lost.
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      fixture.componentRef.setInput('eventKey', 'event-a');
      fixture.detectChanges();
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');
      const reply = new Subject<AudienceComposeMasterResult>();
      composeAudienceMaster.mockReturnValue(reply);
      composeMaster();
      const unattached: AudienceComposedList[] = [];
      fixture.componentInstance.audienceComposeUnattached.subscribe((e) => unattached.push(e.master));

      fixture.componentRef.setInput('eventKey', 'event-b');
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-b');
      fixture.detectChanges();
      const master = { listId: '900', name: 'Master', hubspotUrl: 'u' };
      reply.next({ master, sourceListIds: ['101'], recorded: false });
      reply.complete();

      expect(unattached, "the abandoned compose's real list was never reported").toEqual([master]);
    });

    it('starts over when the FIRST brief after exploratory work advertises no URL', async () => {
      // A brief with no URL is no evidence the work was for its event.
      await render({ briefId: '' });
      typeEventUrl('https://events.example.org/event-a');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('eventKey', 'event-b');
      fixture.componentRef.setInput('briefId', 'brief-b');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), "A's lists survived into a URL-less brief B").toBeNull();
    });

    it("starts over when the same event's advertised URL is removed", async () => {
      await render({ initialEventUrl: 'https://events.example.org/old', briefId: 'brief-a' });
      fixture.componentRef.setInput('eventKey', 'event-a');
      fixture.detectChanges();
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('initialEventUrl', '');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), 'lists from a removed URL survived').toBeNull();
    });

    it('keeps exploratory work when the FIRST brief is for the URL the operator discovered', async () => {
      await render({ briefId: '' });
      typeEventUrl('https://events.example.org/event-b');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('eventKey', 'event-b');
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-b');
      fixture.componentRef.setInput('briefId', 'brief-b');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), "B's own first brief wiped the B work").not.toBeNull();
    });

    it('starts over on a different event key even when the edited URL matches the new brief', async () => {
      // Fail-safe: two events can share a URL, and a wrong guess composes A's lists with B's brief.
      await render({ initialEventUrl: 'https://events.example.org/shared', briefId: 'brief-a' });
      fixture.componentRef.setInput('eventKey', 'event-a');
      fixture.detectChanges();
      typeEventUrl('https://events.example.org/shared');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('eventKey', 'event-b');
      fixture.componentRef.setInput('briefId', 'brief-b');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), "A's lists survived into B on a shared URL").toBeNull();
    });

    it("starts over when the same event's advertised URL is corrected", async () => {
      // The slug-based key does not change, but the lists came from the old URL.
      await render({ initialEventUrl: 'https://events.example.org/old', briefId: 'brief-a' });
      fixture.componentRef.setInput('eventKey', 'event-a');
      fixture.detectChanges();
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/corrected');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), 'lists from the old URL survived a correction').toBeNull();
    });

    it('holds Stage while a compose a reset abandoned is still being created', async () => {
      // `composing` is cleared by the reset so the new context is not stuck on a spinner, but the
      // HubSpot lists are still being created -- Stage must not unlock on the old audience.
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');
      const reply = new Subject<never>();
      composeAudienceMaster.mockReturnValue(reply);
      composeMaster();
      const seen: boolean[] = [];
      fixture.componentInstance.audienceWriteInFlight.subscribe((busy) => seen.push(busy));

      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-b');
      fixture.detectChanges();
      expect(seen.at(-1), 'Stage unlocked mid-compose').toBe(true);

      reply.error(new HttpErrorResponse({ status: 500 }));
      fixture.detectChanges();
      expect(seen.at(-1), 'the lock never released after the compose settled').toBe(false);
    });

    it("drops a discovery still streaming when a different event's brief arrives", async () => {
      // `hasDiscovered` turns true only on the final frame, so a mid-stream switch let A's frames
      // finish under B's brief.
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      click('campaigns-audience-discover');

      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/event-b');
      fixture.detectChanges();
      completeDiscovery();

      expect(host().querySelector('[data-testid="audience-card-grid-toggle-101"]'), "event A's late frames landed under event B").toBeNull();
    });

    it.each([
      ['both events have no registration URL', '', ''],
      ['both events advertise the same registration URL', 'https://events.example.org/register', 'https://events.example.org/register'],
    ])("resets when a different event's brief arrives and %s", async (_label, urlA, urlB) => {
      // Identified by URL alone, two different events looked identical and A's lists were composed
      // with B's brief.
      await render({ initialEventUrl: urlA, briefId: 'brief-a' });
      fixture.componentRef.setInput('eventKey', 'kubecon-eu');
      fixture.detectChanges();
      typeEventUrl('https://events.example.org/kubecon-eu');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('eventKey', 'open-source-summit');
      fixture.componentRef.setInput('initialEventUrl', urlB);
      fixture.componentRef.setInput('briefId', 'brief-b');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), "event A's selection survived into event B").toBeNull();
    });

    it('keeps the selection when the SAME event is handed back (another stage, or a re-proceed)', async () => {
      await render({ initialEventUrl: 'https://events.example.org/event-a', briefId: 'brief-a' });
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      fixture.componentRef.setInput('briefId', 'brief-a-cfp');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), "the operator's selection was discarded for the same event").not.toBeNull();
    });

    it('does not rediscover while an attach is on the wire', async () => {
      // Discovery resets the run, which released the write guard and discarded the attach's reply.
      await renderWithDiscovery({ briefId: 'brief-1' });
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(new Subject());
      useSelectionDirectly();

      const discover = host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-discover"]');
      expect(discover?.disabled, 'Discover stayed live during an attach').toBe(true);
      discoverAudience.mockClear();
      (fixture.componentInstance as unknown as { onDiscover(): void }).onDiscover();
      expect(discoverAudience, 'a rediscovery started during an attach').not.toHaveBeenCalled();
    });

    it('reports an audience write in flight to the parent, and its end', async () => {
      await renderWithDiscovery({ briefId: 'brief-1' });
      const seen: boolean[] = [];
      fixture.componentInstance.audienceWriteInFlight.subscribe((busy) => seen.push(busy));
      click('audience-card-grid-toggle-101');
      const reply = new Subject<AudienceAttachExistingResult>();
      attachExistingAudience.mockReturnValue(reply);
      useSelectionDirectly();
      fixture.detectChanges();
      expect(seen.at(-1), 'the parent was not told a write started').toBe(true);

      reply.next({
        master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' },
        suppressionListIds: [],
        audience: { id: 'a', briefId: 'brief-1', platform: 'hubspot', status: 'built', version: 1 },
      } as AudienceAttachExistingResult);
      reply.complete();
      fixture.detectChanges();
      expect(seen.at(-1), 'the parent was not told the write ended').toBe(false);
    });

    it('blocks compose and direct attach while the audience read is still in flight', async () => {
      // The restore opens this tab BEFORE its audience read returns. On a slow read the failure
      // flag is still false, so gating on it alone let the operator compose a second master on
      // top of an audience that was about to be revealed. Pending is the same unknown.
      await renderWithDiscovery({ audienceReadPending: true, briefId: 'brief-1' });
      click('audience-card-grid-toggle-101');

      const compose = (): HTMLButtonElement | null => host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]');
      const direct = (): HTMLButtonElement | null => host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-use-direct"]');
      expect(compose()?.disabled, 'compose was offered during a pending audience read').toBe(true);
      expect(direct()?.disabled, 'direct attach was offered during a pending audience read').toBe(true);
      expect(host().querySelector('[data-testid="campaigns-audience-read-pending"]')).not.toBeNull();

      // The read lands and verifies absence: both unlock, so the gate is not permanently closed.
      fixture.componentRef.setInput('audienceReadPending', false);
      fixture.detectChanges();
      expect(compose()?.disabled).toBe(false);
      expect(direct()?.disabled).toBe(false);
    });

    it('blocks direct attach, not only compose, when the audience read failed, and offers a retry', async () => {
      // Attach records a send audience against the brief exactly as compose does, so a failed read
      // has to block it too -- gating compose alone left this path writing on top of a hidden one.
      await renderWithDiscovery({ audienceReadFailed: true, briefId: 'brief-1' });
      click('audience-card-grid-toggle-101');

      const direct = host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-use-direct"]');
      expect(direct?.disabled, 'direct attach stayed enabled while the audience was unreadable').toBe(true);

      const retried = vi.fn();
      fixture.componentInstance.retryAudienceRead.subscribe(retried);
      click('campaigns-audience-read-retry');
      expect(retried).toHaveBeenCalledTimes(1);
    });

    it('does not re-enable compose after an ordinary failure', async () => {
      // Gating on composeResult/composePartial alone left both null after a plain failure, so
      // the same non-idempotent write re-enabled at once. The case that matters is the one
      // upstream reports as a normal 500: an UNCONFIRMED HubSpot mutation, whose own message
      // says to check the portal first because a list may already exist. Clicking again is
      // exactly how the duplicate appears.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      composeAudienceMaster.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'HubSpot did not confirm whether this change was applied' } }))
      );
      composeMaster();

      const btn = host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]');
      expect(btn?.disabled, 'compose re-enabled after a failure that may have created a list').toBe(true);
    });

    it('does not present an ordinary gateway 502 as a partial compose', async () => {
      // A 502 alone said "partial". An ordinary gateway/network 502 carries no created list —
      // often an HTML error page — so the operator was shown "Partially completed" and told to
      // reconcile an orphan that does not exist, while the real error was suppressed.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: '<html>502 Bad Gateway</html>' })));
      composeMaster();

      expect(host().textContent, 'a bare gateway 502 was rendered as a partial compose').not.toContain('Partially completed');
    });

    it("discards a previous run's late reply instead of writing it onto the new event", async () => {
      // Every request is scoped to component DESTRUCTION, not to the run that issued it, so
      // clearing state in resetRunState does not stop event A's replies from landing. A late
      // suppression response would repopulate the grid under event B — and re-enable compose
      // with event A's exclusions, which is the specific way this becomes a wrong send.
      const slowSuppression = new Subject<AudienceSuppressionList[]>();
      getAudienceSuppressionLists.mockReturnValue(slowSuppression);

      await renderWithDiscovery();

      // A second discovery for a different event, while run 1's suppression is still open.
      getAudienceSuppressionLists.mockReturnValue(of([]));
      typeEventUrl('https://events.example.org/other-2027');
      click('campaigns-audience-discover');
      completeDiscovery();

      // Run 1 finally answers, with rows that belong to the previous event.
      slowSuppression.next([
        {
          key: 'lf_events_gdpr',
          label: 'LF Events GDPR Suppression',
          listId: '9001',
          name: 'Stale Event GDPR Suppression',
          size: 5,
          category: 'standard',
          hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/9001',
        },
      ]);
      slowSuppression.complete();
      fixture.detectChanges();

      expect(host().textContent, "a previous run's suppression list was rendered under the new event").not.toContain('Stale Event GDPR Suppression');
    });

    it('stops the search spinner when a new run resets mid-search', async () => {
      // Guarding onSearch's ERROR handler on the run generation means an in-flight search can
      // no longer clear `searching` itself once the run moves on — its reply is discarded by
      // design. resetRunState has to clear it, or the typeahead spinner never stops.
      const slowSearch = new Subject<never>();
      searchAudienceLists.mockReturnValue(slowSearch);

      await renderWithDiscovery();
      const internals = fixture.componentInstance as unknown as { onSearch(q: string): void; searching(): boolean };
      internals.onSearch('kube');
      fixture.detectChanges();
      expect(internals.searching(), 'fixture precondition: the search must be in flight').toBe(true);

      // A new discovery run starts while that search is still open.
      typeEventUrl('https://events.example.org/other-2027');
      click('campaigns-audience-discover');
      completeDiscovery();

      expect(internals.searching(), 'the search spinner survived a run reset and can never be cleared').toBe(false);
    });

    it('ignores a slow typeahead reply that a newer keystroke superseded', async () => {
      // `runGeneration` orders RUNS, not keystrokes within one. Two searches are in flight against
      // the same run, so only a per-request sequence can separate them: without it the slow reply
      // to "kube" lands last and is displayed as the results for "argo".
      const slow = new Subject<{ listId: string; name: string; size: number }[]>();
      const fast = new Subject<{ listId: string; name: string; size: number }[]>();
      searchAudienceLists.mockReturnValueOnce(slow).mockReturnValueOnce(fast);

      await renderWithDiscovery();
      const internals = fixture.componentInstance as unknown as {
        onSearch(q: string): void;
        searchResults(): { listId: string }[];
      };

      internals.onSearch('kube');
      internals.onSearch('argo');

      fast.next([{ listId: 'argo-1', name: 'Argo', size: 10 }]);
      fast.complete();
      // The superseded request answers LAST — the case the ordering bug depends on.
      slow.next([{ listId: 'kube-1', name: 'Kube', size: 99 }]);
      slow.complete();
      fixture.detectChanges();

      expect(
        internals.searchResults().map((r) => r.listId),
        "a superseded typeahead reply overwrote the newer query's results"
      ).toEqual(['argo-1']);
    });

    it('discards an in-flight preview count when the selection changes', async () => {
      // The grids stay editable while a preview is in flight, so a reply computed for the OLD
      // selection can land after an edit and be displayed as the new selection's size — the one
      // number the operator uses to decide whether to compose.
      const slowPreview = new Subject<{ exact: boolean; estimate: number; count: number; reason: string }>();
      previewAudienceCount.mockReturnValue(slowPreview);

      await renderWithDiscovery();
      // Select through the real UI path — discovery surfaces candidates, it does not auto-select.
      searchAudienceLists.mockReturnValue(of([{ listId: '502', name: 'Synthetic Summit - Sponsors', size: 60, hubspotUrl: 'https://app.hubspot.com/x/502' }]));

      const internals = fixture.componentInstance as unknown as {
        onSearch(q: string): void;
        onPreviewCount(): void;
        onRemoveInclusion(listId: string): void;
        inclusion(): Map<string, string>;
        previewCount(): unknown;
        previewing(): boolean;
      };

      internals.onSearch('sponsors');
      fixture.detectChanges();
      click('audience-missing-signals-add-502');

      const firstId = [...internals.inclusion().keys()][0];
      expect(firstId, 'fixture precondition: the selection must be non-empty').toBe('502');

      internals.onPreviewCount();
      expect(internals.previewing(), 'fixture precondition: the preview must be in flight').toBe(true);

      internals.onRemoveInclusion(firstId);
      slowPreview.next({ exact: true, estimate: 4242, count: 4242, reason: '' });
      slowPreview.complete();
      fixture.detectChanges();

      expect(internals.previewCount(), "a preview computed for the previous selection was shown as the new one's count").toBeNull();
      expect(internals.previewing(), 'the preview spinner survived an invalidation and can never be cleared').toBe(false);
    });

    it('cannot start a new discovery while a compose is in flight', async () => {
      // Compose is not idempotent and a reset does not cancel it: the HubSpot lists are already
      // being created. A discover mid-compose bumps the run, the reply is discarded, and real
      // lists are left with no confirmation and no orphan link — and a retry duplicates them.
      const slowCompose = new Subject<never>();
      composeAudienceMaster.mockReturnValue(slowCompose);

      await renderWithDiscovery();
      searchAudienceLists.mockReturnValue(of([{ listId: '502', name: 'Synthetic Summit - Sponsors', size: 60, hubspotUrl: 'https://app.hubspot.com/x/502' }]));
      const internals = fixture.componentInstance as unknown as { onSearch(q: string): void; onComposeMaster(): void; composing(): boolean };
      internals.onSearch('sponsors');
      fixture.detectChanges();
      click('audience-missing-signals-add-502');

      internals.onComposeMaster();
      fixture.detectChanges();
      expect(internals.composing(), 'fixture precondition: the compose must be in flight').toBe(true);

      const discover = host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-discover"]');
      expect(discover?.disabled, 'discovery could be restarted mid-compose, stranding lists already created in HubSpot').toBe(true);
    });

    it('still fetches suppression when discovery named no event', async () => {
      // Returning early on a null identity left `suppressionFailed` AND `suppressionLoading`
      // both false on a portal that was never queried — which reads downstream as "this
      // portal has no regulatory exclusions", the one answer that must never be inferred.
      // The hygiene lists (GDPR, global opt-out) are portfolio-wide and resolve without an
      // event name, so there is nothing to wait for.
      await render();
      typeEventUrl('https://events.example.org/no-identity');
      click('campaigns-audience-discover');

      // A discovery that produces lists but never emits the `event` frame.
      stream.next({ type: 'discovered', data: discovered() });
      stream.next({ type: 'done', data: {} });
      fixture.detectChanges();

      expect(getAudienceSuppressionLists, 'suppression was skipped for a portal that was never queried').toHaveBeenCalled();
    });

    it('blocks compose while the suppression fetch is still in flight', async () => {
      // The review pane renders as soon as discovery returns, so there is a real window
      // before the suppression response arrives. `suppressionFailed` is false in that
      // window — it only becomes true on an ERROR — so gating on it alone let an operator
      // write a real HubSpot master list before GDPR/CASL exclusions were known.
      const pending = new Subject<AudienceSuppressionList[]>();
      getAudienceSuppressionLists.mockReturnValue(pending);

      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      const composeBtn = host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]');
      expect(composeBtn?.disabled, 'compose was enabled while suppression was still loading').toBe(true);

      pending.next([
        {
          key: 'lf_events_gdpr',
          label: 'LF Events GDPR',
          listId: '201',
          name: 'LF Events - GDPR Suppression',
          size: 5000,
          category: 'standard',
          hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
        },
      ]);
      pending.complete();
      fixture.detectChanges();
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled).toBe(false);
    });

    it('blocks compose and says so when the suppression fetch fails', async () => {
      // A failed fetch and an empty portal produced identical DOM before this: the grid branches on
      // `groups().length === 0`, so an outage read as a VERIFIED absence of regulatory exclusions --
      // and compose is a non-idempotent write that creates real lists in the project's portal. The
      // service returns unresolved rows with an empty `ListID` rather than dropping them for exactly
      // this reason; a transport failure bypassed that care.
      getAudienceSuppressionLists.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      expect(host().querySelector('[data-testid="audience-suppression-error"]'), 'a failed fetch rendered as an empty portal').not.toBeNull();
      expect(host().querySelector('[data-testid="audience-suppression-empty"]'), 'the empty-state arm claimed a verified absence').toBeNull();

      const compose = host().querySelector('[data-testid="campaigns-audience-compose"]') as HTMLButtonElement | null;
      expect(compose?.disabled, 'compose stayed enabled with unreadable exclusions').toBe(true);
    });

    it('lets inclusion win over suppression for the same list', async () => {
      // HubSpot would apply both filters and return nobody. Inclusion wins because it is the
      // operator's explicit intent -- the suppression tick is this component's own recommendation.
      // A list can legitimately appear on both sides: a prior edition's suppression list is also a
      // discovered candidate.
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery(
        discovered({
          lists: [
            ...discovered().lists,
            {
              listId: '201',
              name: 'LF Events - GDPR Suppression',
              signal: 'uncertain',
              size: 5000,
              reason: 'The filter shape did not match any known signal.',
              listType: 'STATIC',
              hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
            },
          ],
        })
      );

      // The exclusion summary only renders alongside a non-empty inclusion set, so the unrelated
      // list is picked first to make the suppression count observable at all. The GDPR row is
      // already ticked: every resolved suppression row arrives pre-ticked.
      click('audience-card-grid-toggle-101');
      expect(host().querySelector('[data-testid="campaigns-audience-exclude-summary"]')?.textContent).toContain('1 list(s) will be excluded');

      click('audience-card-grid-toggle-201');

      expect(host().querySelector('[data-testid="campaigns-audience-exclude-summary"]'), 'a list was both included and excluded').toBeNull();
    });

    it('composes with the selected inclusions and the resolved exclusions', async () => {
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      composeAudienceMaster.mockReturnValue(
        of({
          master: { listId: '901', name: '26Q1 - SYN - Synthetic Summit 2026 - Master', hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/901' },
          suppression: { listId: '902', name: 'Combined Suppression', hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/902' },
          sourceListIds: ['101'],
        })
      );
      composeMaster();

      expect(composeAudienceMaster).toHaveBeenCalledWith('tlf', {
        listIds: ['101'],
        excludeListIds: ['201'],
        eventUrl: 'https://events.example.org/synthetic-summit',
        brandShort: 'SYN',
        eventName: 'Synthetic Summit 2026',
        eventDates: ['2026-03-02', '2026-03-04'],
      });
      expect(host().querySelector('[data-testid="campaigns-audience-compose-result"]')).not.toBeNull();
    });

    it('links the created lists to HubSpot only when they carry a URL, and names them either way', async () => {
      // A blank URL renders href="", which opens this app instead of the list.
      const masterUrl = 'https://app.hubspot.com/contacts/1/objectLists/901';
      const resultBlock = (): HTMLElement | null => host().querySelector<HTMLElement>('[data-testid="campaigns-audience-compose-result"]');
      const compose = async (url: string): Promise<void> => {
        await renderWithDiscovery();
        click('audience-card-grid-toggle-101');
        composeAudienceMaster.mockReturnValue(
          of({
            master: { listId: '901', name: '26Q1 - SYN - Synthetic Summit 2026 - Master', hubspotUrl: url },
            suppression: { listId: '902', name: 'Combined Suppression', hubspotUrl: url && 'https://app.hubspot.com/contacts/1/objectLists/902' },
            sourceListIds: ['101'],
          })
        );
        composeMaster();
      };

      await compose(masterUrl);
      const masterLink = resultBlock()?.querySelector<HTMLAnchorElement>('[data-testid="campaigns-audience-compose-result-master-link"]');
      expect(masterLink?.getAttribute('href')).toBe(masterUrl);
      expect(masterLink?.textContent?.trim()).toBe('26Q1 - SYN - Synthetic Summit 2026 - Master');
      expect(resultBlock()?.querySelector('[data-testid="campaigns-audience-compose-result-master-name"]')).toBeNull();

      await compose('');
      const block = resultBlock();
      expect(block?.querySelectorAll('a').length, 'a blank URL rendered a link back to this app').toBe(0);
      expect(block?.querySelector('[data-testid="campaigns-audience-compose-result-master-name"]')?.textContent?.trim()).toBe(
        '26Q1 - SYN - Synthetic Summit 2026 - Master'
      );
      expect(block?.textContent).toContain('Combined Suppression (standard suppressions, shared)');
    });

    it('will not compose with nothing selected', async () => {
      await renderWithDiscovery();

      composeMaster();

      expect(composeAudienceMaster).not.toHaveBeenCalled();
    });

    it('surfaces the orphaned suppression list on a partial failure, with no retry', async () => {
      // Compose is not idempotent: a second click after the suppression list already exists leaves
      // a duplicate behind. The 502 body carries what was created so the operator can finish or
      // clean up by hand.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      const partial: AudienceComposeMasterPartial = {
        suppression: { listId: '902', name: 'Combined Suppression', hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/902' },
        error: 'HubSpot rejected the master list create.',
      };
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: partial })));
      composeMaster();

      const block = host().querySelector('[data-testid="campaigns-audience-compose-partial"]');
      expect(block, 'a partial compose failure was reported as a plain error').not.toBeNull();
      expect(block?.textContent).toContain('Combined Suppression');
      expect((host().textContent ?? '').toLowerCase(), 'a retry was offered for a non-idempotent write').not.toContain('retry');
    });

    it('never calls the shared standard suppression list an orphan to delete', async () => {
      // On a current deployment a partial's `suppression` is the project's standing list, which
      // every email reuses; "delete it" would remove the hygiene exclusions from all of them.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      const partial: AudienceComposeMasterPartial = {
        suppression: { listId: '31763', name: 'LFX Standard Suppressions - tlf', hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/31763' },
        error: 'The audience could not be recorded.',
      };
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: partial })));
      composeMaster();

      const text = host().querySelector('[data-testid="campaigns-audience-compose-partial"]')?.textContent ?? '';
      expect(text).toContain('shared standard suppression list');
      expect(text).not.toContain('orphaned');
    });

    it('asks the compose to create the ticked current-registrants list', async () => {
      getAudienceSuppressionLists.mockReturnValue(
        of([
          {
            key: 'lf_events_gdpr',
            label: 'LF Events GDPR',
            listId: '201',
            name: 'LF Events - GDPR Suppression',
            size: 5000,
            category: 'standard',
            hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
          },
          {
            key: 'current_registrants',
            label: 'Current registrants - Synthetic Summit 2026',
            listId: '',
            name: 'Synthetic Summit 2026 - Current Registrants',
            category: 'current_registrants',
            hubspotUrl: '',
            willCreate: true,
          },
        ])
      );
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      composeAudienceMaster.mockReturnValue(of({ master: { listId: '5', name: 'm', size: 1, hubspotUrl: 'u' }, sourceListIds: ['101'] }));

      composeMaster();

      const request = composeAudienceMaster.mock.calls.at(-1)?.[1];
      expect(request?.excludeListIds, 'a list that does not exist yet has no id to send').toEqual(['201']);
      expect(request?.currentRegistrantsEvent).toBe('Synthetic Summit 2026');
    });

    it('surfaces an UNCONFIRMED create by name, with no portal link to offer', async () => {
      // Four partial shapes are reachable and only one carries a confirmed `suppression.listId`
      // (campaign-service `docs/api-catalog.md`). Keying on that field alone rendered the other
      // three as ordinary failures, losing the deterministic names the operator needs to search
      // HubSpot for lists that may already exist — and composing again duplicates them.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      const partial: AudienceComposeMasterPartial = {
        suppressionName: '27Q2 - Synthetic Summit - Combined Suppression',
        masterName: '27Q2 - Synthetic Summit - Master',
        error: 'HubSpot did not confirm the creates.',
      };
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: partial })));
      composeMaster();

      const block = host().querySelector('[data-testid="campaigns-audience-compose-partial"]');
      expect(block, 'an unconfirmed compose was reported as a plain error, losing both list names').not.toBeNull();
      expect(block?.textContent, 'the unconfirmed suppression name was not shown').toContain('27Q2 - Synthetic Summit - Combined Suppression');
      expect(block?.textContent, 'the unconfirmed master name was not shown').toContain('27Q2 - Synthetic Summit - Master');
      expect(host().querySelector('[data-testid="campaigns-audience-compose-error"]'), 'a partial was also rendered as a plain error').toBeNull();
    });

    it('renders no portal link for a suppression object with no confirmed id', async () => {
      // Widening the discriminator admits bodies whose suppression object carries no real
      // `listId`. Rendering a HubSpot link for one asserts a list exists when nothing confirmed
      // it — reintroducing, one layer up, the false certainty the widening removed.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      const partial = {
        suppression: { listId: '', name: '', hubspotUrl: '' },
        suppressionName: '27Q2 - Synthetic Summit - Combined Suppression',
        error: 'HubSpot did not confirm the create.',
      } as unknown as AudienceComposeMasterPartial;
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: partial })));
      composeMaster();

      const block = host().querySelector('[data-testid="campaigns-audience-compose-partial"]');
      expect(block, 'the unconfirmed create was not surfaced at all').not.toBeNull();
      expect(block?.querySelector('a'), 'a portal link was rendered for a create nothing confirmed').toBeNull();
      expect(block?.textContent, 'the name the operator must search for was not shown').toContain('27Q2 - Synthetic Summit - Combined Suppression');
    });

    it('warns when a project switch abandons a compose already in flight', async () => {
      // The HubSpot create is NOT cancelled by the reset, and the run-generation guard discards
      // its reply — so the lists may exist with nothing on screen naming them, and the next
      // compose duplicates them. The reset itself is still right (showing project A's discovery
      // under project B is its own defect), so the fix is to say what was left behind.
      const slowCompose = new Subject<never>();
      composeAudienceMaster.mockReturnValue(slowCompose);

      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      composeMaster();
      const internals = fixture.componentInstance as unknown as { composing(): boolean };
      expect(internals.composing(), 'fixture precondition: the compose must be in flight').toBe(true);

      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();

      expect(
        host().querySelector('[data-testid="campaigns-audience-compose-stranded"]'),
        'a compose was abandoned by a project switch with nothing telling the operator the lists may exist'
      ).not.toBeNull();
    });

    it('locks the selection once a compose has been attempted', async () => {
      // Compose snapshots the list ids at request time. Leaving the grids editable afterwards
      // lets the page show one selection beside a master that was built from another — and the
      // result banner stays on screen, so the mismatch outlives the request.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      const grid = host().querySelector('lfx-audience-card-grid');
      expect(grid?.getAttribute('ng-reflect-disabled'), 'fixture precondition: the grid starts editable').not.toBe('true');

      composeAudienceMaster.mockReturnValue(new Subject<never>());
      composeMaster();
      fixture.detectChanges();

      const internals = fixture.componentInstance as unknown as { selectionLocked(): boolean };
      expect(internals.selectionLocked(), 'the selection stayed editable while a master was being built from a snapshot of it').toBe(true);
    });

    it('keeps the stranded-compose warning until the operator acknowledges it', async () => {
      // A discovery cannot reconcile an abandoned HubSpot write, so clearing this warning on the
      // next run let it be dismissed implicitly — the operator could return to the original
      // project and compose duplicates having never read it. Only an explicit acknowledgement
      // clears it.
      const abandoned = new Subject<never>();
      composeAudienceMaster.mockReturnValue(abandoned);
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      composeMaster();
      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();
      expect(
        host().querySelector('[data-testid="campaigns-audience-compose-stranded"]'),
        'fixture precondition: the stranded warning must be showing'
      ).not.toBeNull();

      typeEventUrl('https://events.example.org/a-different-event');
      click('campaigns-audience-discover');
      completeDiscovery();

      expect(
        host().querySelector('[data-testid="campaigns-audience-compose-stranded"]'),
        'a discovery implicitly dismissed a warning about a write it cannot reconcile'
      ).not.toBeNull();

      // The acknowledgement is only accepted once the abandoned request has settled.
      abandoned.error(new HttpErrorResponse({ status: 504 }));
      fixture.detectChanges();
      click('campaigns-audience-compose-stranded-dismiss');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-stranded"]'), 'the warning survived an explicit acknowledgement').toBeNull();
    });

    it('will not let a re-discovery of the same event re-enable compose', async () => {
      // resetRunState clears `composeAttempted`, which IS the duplicate-prevention latch — so a
      // second Discover on the same url rebuilt an identical selection with compose live again,
      // and the operator could build the same master twice against a non-idempotent endpoint.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      composeAudienceMaster.mockReturnValue(
        of({ master: { listId: '900', name: 'Master', size: 10, hubspotUrl: 'https://app.hubspot.com/x/900' }, sourceListIds: [] })
      );
      composeMaster();
      fixture.detectChanges();

      const internals = fixture.componentInstance as unknown as { composeAttempted(): boolean };
      expect(internals.composeAttempted(), 'fixture precondition: a compose must have been attempted').toBe(true);

      // Same URL, so the same event — Discover must refuse rather than start over.
      const discover = host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-discover"]');
      expect(discover?.disabled, 'Discover stayed live for the event a master was already composed for').toBe(true);

      click('campaigns-audience-discover');
      fixture.detectChanges();

      expect(internals.composeAttempted(), 'a re-discovery of the same event cleared the duplicate-prevention latch').toBe(true);
      expect(
        host().querySelector('[data-testid="campaigns-audience-compose-result"]'),
        'the composed result and its HubSpot link were wiped by a refused re-run'
      ).not.toBeNull();
    });

    it('blocks compose in the project whose compose was stranded', async () => {
      // The warning alone did not stop a second compose: lists may already exist under a name
      // the next one would reuse, so an operator could duplicate them without ever
      // acknowledging it. Scoped to the affected project.
      composeAudienceMaster.mockReturnValue(new Subject<never>());
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      composeMaster();

      // Switch away (stranding the compose), then back to the original project.
      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();
      fixture.componentRef.setInput('projectSlug', 'tlf');
      fixture.detectChanges();

      // Rebuild a real selection, so `canCompose` is false for the STRANDED reason and not
      // merely because the resets emptied the inclusion set — without this the test passes
      // whether or not the gate exists.
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');

      const internals = fixture.componentInstance as unknown as { canCompose(): boolean; inclusion(): ReadonlyMap<string, string> };
      expect(internals.inclusion().size, 'fixture precondition: a selection must exist, or canCompose is false for the wrong reason').toBeGreaterThan(0);
      expect(internals.canCompose(), 'compose was available in a project with an unreconciled stranded write').toBe(false);
    });

    it('reports a non-partial compose failure as an error', async () => {
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'Not authorized for this portal.' } })));
      composeMaster();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-error"]')?.textContent).toContain('Not authorized for this portal.');
      expect(host().querySelector('[data-testid="campaigns-audience-compose-partial"]')).toBeNull();
    });
  });

  /**
   * The compose -> attach handoff.
   *
   * The composed master used to be a dead end: this tab created two real HubSpot lists and
   * nothing carried their ids out, so the send still went to an audience the service derived on
   * its own. Upstream now records the master as the brief's send audience inside the compose
   * call, and these tests cover the two things only decidable at this boundary -- WHICH output
   * fires for each outcome, and whether it fires at all once the run it belongs to is stale.
   */
  describe('attaching the composed master to the brief', () => {
    async function renderWithDiscovery(briefId: string): Promise<void> {
      await render({ briefId });
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');
    }

    const RECORDED_AUDIENCE: CampaignAudience = {
      id: 'aud-1',
      briefId: 'brief-1',
      platform: 'hubspot',
      platformMasterListId: '900',
      status: 'built',
      version: 1,
    };

    function listen(): { attached: CampaignAudience[]; unattached: AudienceComposedList[]; scopes: string[] } {
      const attached: CampaignAudience[] = [];
      const unattached: AudienceComposedList[] = [];
      const scopes: string[] = [];
      fixture.componentInstance.audienceAttached.subscribe((a) => attached.push(a));
      fixture.componentInstance.audienceComposeUnattached.subscribe((e) => {
        unattached.push(e.master);
        scopes.push(`${e.projectSlug}/${e.briefId}`);
      });
      return { attached, unattached, scopes };
    }

    it('sends the brief id with the compose so upstream can attach what it creates', async () => {
      // Read at DISPATCH. Upstream attaches inside the same call that creates the lists, so an id
      // arriving any later cannot be used -- there is no second call to put it in.
      await renderWithDiscovery('brief-1');
      composeAudienceMaster.mockReturnValue(
        of({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, sourceListIds: ['101'], recorded: true, audience: RECORDED_AUDIENCE })
      );

      composeMaster();

      expect(composeAudienceMaster.mock.calls.at(-1)?.[1]?.briefId).toBe('brief-1');
    });

    it('omits the brief id entirely when there is no saved plan', async () => {
      // A present-but-EMPTY brief id is a different request upstream: it reads it as an attach,
      // fails the brief lookup and 404s -- refusing to create anything for the exploratory
      // compose these project-scoped routes exist for.
      await renderWithDiscovery('');
      composeAudienceMaster.mockReturnValue(of({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, sourceListIds: ['101'] }));

      composeMaster();

      expect(composeAudienceMaster.mock.calls.at(-1)?.[1]?.briefId).toBeUndefined();
    });

    it('hands the recorded audience row to the parent', async () => {
      await renderWithDiscovery('brief-1');
      const seen = listen();
      composeAudienceMaster.mockReturnValue(
        of({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, sourceListIds: ['101'], recorded: true, audience: RECORDED_AUDIENCE })
      );

      composeMaster();

      expect(seen.attached).toEqual([RECORDED_AUDIENCE]);
      expect(seen.unattached, 'a reconcile warning was raised for a list that IS attached').toEqual([]);
    });

    it('offers a way on to the email once the master is composed, and says it is attached', async () => {
      await renderWithDiscovery('brief-1');
      let continued = 0;
      fixture.componentInstance.continueToEmail.subscribe(() => continued++);
      composeAudienceMaster.mockReturnValue(
        of({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, sourceListIds: ['101'], recorded: true, audience: RECORDED_AUDIENCE })
      );
      expect(host().querySelector('[data-testid="campaigns-audience-continue"]'), 'offered before anything was composed').toBeNull();

      composeMaster();
      expect(host().querySelector('[data-testid="campaigns-audience-compose-attached"]')).not.toBeNull();
      click('campaigns-audience-continue');

      expect(continued).toBe(1);
    });

    it('says an unrecorded compose is not attached, and still lets the operator move on', async () => {
      await renderWithDiscovery('');
      let continued = 0;
      fixture.componentInstance.continueToEmail.subscribe(() => continued++);
      composeAudienceMaster.mockReturnValue(of({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, sourceListIds: ['101'] }));

      composeMaster();
      expect(host().querySelector('[data-testid="campaigns-audience-compose-not-attached"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-compose-attached"]')).toBeNull();
      click('campaigns-audience-continue');

      expect(continued).toBe(1);
    });

    /**
     * `recorded` is read, never inferred from the presence of `audience`. Goa ignores unknown
     * body fields, so a campaign-service deployed before this feature accepts the brief id,
     * composes normally and answers without either -- and reporting that as attached would tell
     * the operator a send is wired up to a list nothing points at.
     */
    it('reports an unrecorded compose as a loose list rather than an attachment', async () => {
      await renderWithDiscovery('brief-1');
      const seen = listen();
      const master = { listId: '900', name: 'Master', hubspotUrl: 'u' };
      composeAudienceMaster.mockReturnValue(of({ master, sourceListIds: ['101'] }));

      composeMaster();

      expect(seen.attached).toEqual([]);
      expect(seen.unattached).toEqual([master]);
    });

    it('scopes a loose list to the brief and project it was DISPATCHED for', async () => {
      // A brief switch does not cancel a compose in flight. Scoped by the brief on screen when the
      // reply landed, the warning told the operator to use the previous brief's list for this one.
      await renderWithDiscovery('brief-1');
      const seen = listen();
      const master = { listId: '900', name: 'Master', hubspotUrl: 'u' };
      const reply = new Subject<AudienceComposeMasterResult>();
      composeAudienceMaster.mockReturnValue(reply);

      composeMaster();
      fixture.componentRef.setInput('briefId', 'brief-2');
      fixture.detectChanges();
      reply.next({ master, sourceListIds: ['101'], recorded: false });
      reply.complete();

      expect(seen.scopes, 'the loose list was filed under the brief on screen, not the one composed for').toEqual(['tlf/brief-1']);
    });

    it('puts a loose master into the reuse grid so its recovery action exists', async () => {
      // The warning's recovery is "Use for this email" on that master, but the grid is loaded once
      // at discovery and re-discovery is blocked after a compose -- so the list was never there.
      await renderWithDiscovery('brief-1');
      const master = { listId: '900', name: 'Master', hubspotUrl: 'u' };
      composeAudienceMaster.mockReturnValue(of({ master, sourceListIds: ['101'], recorded: false }));

      composeMaster();

      const use = host().querySelector<HTMLButtonElement>('[data-testid="audience-last-sent-master-use-900"]');
      expect(use, 'the loose master never reached the reuse grid').not.toBeNull();
      expect(use?.disabled, 'the recovery action was offered but unusable').toBe(false);
    });

    it("blocks compose over the brief's existing audience until replacing it is chosen", async () => {
      // A restored brief mounted a fresh builder: both read flags were false once the read answered
      // and nothing here knew an audience existed, so compose minted a second HubSpot master.
      await renderWithDiscovery('brief-1');
      fixture.componentRef.setInput('existingAudience', RECORDED_AUDIENCE);
      fixture.detectChanges();

      const compose = (): HTMLButtonElement | null => host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]');
      expect(host().querySelector('[data-testid="campaigns-audience-existing"]')?.textContent).toContain('900');
      expect(compose()?.disabled, 'compose ran over an existing audience by default').toBe(true);

      click('campaigns-audience-existing-replace');
      expect(compose()?.disabled, 'an explicit replacement must unlock compose').toBe(false);
    });

    it("does not offer to replace the audience this panel's own compose just recorded", async () => {
      // The recorded compose feeds `existingAudience` straight back. Offering "replace" there was a
      // button that could not work (`composeAttempted` blocks compose) beside a banner it contradicted.
      await renderWithDiscovery('brief-1');
      composeAudienceMaster.mockReturnValue(
        of({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, sourceListIds: ['101'], recorded: true, audience: RECORDED_AUDIENCE })
      );
      composeMaster();
      fixture.componentRef.setInput('existingAudience', RECORDED_AUDIENCE);
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-existing"]')).toBeNull();
    });

    it('withholds the replace action while there is no brief to attach a replacement to', async () => {
      // With `briefId` empty a "replacement" composes unrecorded and leaves the restored audience
      // as the send list -- a second master, the duplicate the prompt exists to prevent.
      await renderWithDiscovery('');
      fixture.componentRef.setInput('existingAudience', RECORDED_AUDIENCE);
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-existing-replace"]')).toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-existing-replace-unavailable"]')).not.toBeNull();
    });

    it('blocks writes with no retry when the audience lookup is unavailable', async () => {
      // `enabled: false` is deploy-time: a retry cannot succeed, so none is offered.
      await renderWithDiscovery('brief-1');
      fixture.componentRef.setInput('audienceReadUnavailable', true);
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-read-unavailable"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-read-retry"]')).toBeNull();
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled).toBe(true);
    });

    it('keeps the recovery copy when the plan save fills the brief id for the SAME send', async () => {
      // A compose dispatched before the plan was saved carries no brief id; the save then fills
      // `briefId` for the same send. Comparing ids read that as another email and hid the recovery.
      await renderWithDiscovery('');
      composeAudienceMaster.mockReturnValue(of({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, sourceListIds: ['101'], recorded: false }));
      composeMaster();
      fixture.componentRef.setInput('briefId', 'brief-1');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-other-brief"]'), 'the same send was called a different email').toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-compose-not-attached"]')).not.toBeNull();
    });

    it('calls a brief-less compose another send once the parent resets', async () => {
      await renderWithDiscovery('');
      composeAudienceMaster.mockReturnValue(of({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, sourceListIds: ['101'], recorded: false }));
      composeMaster();
      fixture.componentRef.setInput('audienceScope', 1);
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-other-brief"]')).not.toBeNull();
    });

    it('still shows an existing audience that points elsewhere after an unrecorded compose here', async () => {
      // Keyed on "a write happened", the box vanished once this panel composed anything -- so an
      // audience restored afterwards, pointing at a DIFFERENT list, was never shown.
      await renderWithDiscovery('brief-1');
      composeAudienceMaster.mockReturnValue(of({ master: { listId: '777', name: 'Loose', hubspotUrl: 'u' }, sourceListIds: ['101'], recorded: false }));
      composeMaster();
      fixture.componentRef.setInput('existingAudience', RECORDED_AUDIENCE);
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-existing"]')?.textContent).toContain('900');
      expect(host().querySelector('[data-testid="campaigns-audience-existing-replace"]'), 'a replace that cannot run was offered').toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-existing-replace-loose"]')).not.toBeNull();
    });

    it('points at the master a 502 partial confirmed, not at a reload', async () => {
      // The partial whose attach failed after both lists existed leaves `composeResult` null but
      // puts its master in the reuse grid. Keyed on `composeResult.recorded`, the copy fell through
      // to "reload" instead of naming the list that already exists.
      await renderWithDiscovery('brief-1');
      const partial = {
        master: { listId: '777', name: 'Loose', hubspotUrl: 'u' },
        error: 'Lists created but not attached.',
      } as unknown as AudienceComposeMasterPartial;
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: partial })));
      composeMaster();
      fixture.componentRef.setInput('existingAudience', RECORDED_AUDIENCE);
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-existing-replace-loose"]'), 'the confirmed partial master was not named').not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-existing-replace-after-compose"]')).toBeNull();
    });

    it('does not point at a master that a FAILED compose never created', async () => {
      // `composeAttempted` survives an ordinary failure, so copy keyed on it told the operator to
      // attach a master that does not exist.
      await renderWithDiscovery('brief-1');
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'boom' } })));
      composeMaster();
      fixture.componentRef.setInput('existingAudience', RECORDED_AUDIENCE);
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-existing-replace-loose"]')).toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-existing-replace-after-compose"]')).not.toBeNull();
    });

    it("keeps a brief's recorded compose as this email's after the parent resets for the same brief", async () => {
      // Re-proceeding from Plan bumps the parent's generation but resolves the SAME brief. Keyed on
      // the generation alone, the email's actual send list was called another email's.
      await renderWithDiscovery('brief-1');
      composeAudienceMaster.mockReturnValue(
        of({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, sourceListIds: ['101'], recorded: true, audience: RECORDED_AUDIENCE })
      );
      composeMaster();
      fixture.componentRef.setInput('audienceScope', 1);
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-other-brief"]'), "the brief's own list was called another email's").toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-compose-attached"]')).not.toBeNull();
    });

    it("does not describe another brief's compose as this email's", async () => {
      await renderWithDiscovery('brief-1');
      composeAudienceMaster.mockReturnValue(
        of({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, sourceListIds: ['101'], recorded: true, audience: RECORDED_AUDIENCE })
      );
      composeMaster();
      fixture.componentRef.setInput('briefId', 'brief-2');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-attached"]'), "brief 1's compose read as attached to brief 2").toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-compose-other-brief"]')).not.toBeNull();
    });

    it('blocks compose over a restored audience even when the brief id is empty', async () => {
      // An unapproved restore leaves `briefId` empty ON PURPOSE while the parent holds the brief's
      // audience. Matching the two let exactly that restore through with no prompt.
      await renderWithDiscovery('');
      fixture.componentRef.setInput('existingAudience', RECORDED_AUDIENCE);
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-existing"]')).not.toBeNull();
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled).toBe(true);
    });

    it.each([
      ['lands after the compose', (masters: Subject<never[]>) => masters.next([])],
      ['fails after the compose', (masters: Subject<never[]>) => masters.error(new Error('boom'))],
    ])('keeps a loose master in the reuse grid when the masters fetch %s', async (_label, settle) => {
      // The masters fetch is not awaited by compose. Writing the loose row into the fetched list let
      // a later `set` wipe it, and a failed fetch hid the grid entirely -- removing the recovery
      // action the unattached warning points to.
      const masters = new Subject<never[]>();
      getAudienceExistingMasterLists.mockReturnValue(masters);
      await renderWithDiscovery('brief-1');
      const master = { listId: '900', name: 'Master', hubspotUrl: 'u' };
      composeAudienceMaster.mockReturnValue(of({ master, sourceListIds: ['101'], recorded: false }));

      composeMaster();
      settle(masters);
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="audience-last-sent-master-use-900"]'), 'the masters fetch wiped the loose row').not.toBeNull();
    });

    it('reports a compose the operator ran with no saved plan as a loose list', async () => {
      await renderWithDiscovery('');
      const seen = listen();
      const master = { listId: '900', name: 'Master', hubspotUrl: 'u' };
      composeAudienceMaster.mockReturnValue(of({ master, sourceListIds: ['101'] }));

      composeMaster();

      expect(seen.unattached).toEqual([master]);
    });

    /**
     * The fifth partial shape: both lists exist and only the attach failed. It is the one partial
     * whose master is CONFIRMED, so the operator's route out is that exact list -- a generic
     * failure would leave them with nothing to act on.
     */
    it('carries a confirmed master out of a failed attach', async () => {
      await renderWithDiscovery('brief-1');
      const seen = listen();
      const master = { listId: '900', name: 'Master', hubspotUrl: 'u' };
      const partial = { master, error: 'Lists created but not attached.' } as unknown as AudienceComposeMasterPartial;
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: partial })));

      composeMaster();

      expect(seen.unattached).toEqual([master]);
      expect(seen.attached).toEqual([]);
    });

    it('emits nothing for a partial that confirmed no master', async () => {
      await renderWithDiscovery('brief-1');
      const seen = listen();
      const partial = {
        suppression: { listId: '201', name: 'Combined Suppression', hubspotUrl: 'u' },
        error: 'The master list was not created.',
      } as unknown as AudienceComposeMasterPartial;
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: partial })));

      composeMaster();

      expect(seen.unattached, 'the parent was pointed at a master list that was never created').toEqual([]);
    });

    /**
     * THE REASON both emissions sit inside the run-generation guard. The reply arrives after a
     * project switch has already reset this tab, and the parent has moved to another project's
     * brief by then -- so an emission here would attach one project's HubSpot list to a different
     * project's send, or raise a reconcile warning on a campaign that composed nothing.
     */
    it('emits nothing when a project switch has already superseded the run', async () => {
      await renderWithDiscovery('brief-1');
      const seen = listen();
      const slowCompose = new Subject<{ master: AudienceComposedList; sourceListIds: string[]; recorded: boolean; audience: CampaignAudience }>();
      composeAudienceMaster.mockReturnValue(slowCompose);
      composeMaster();

      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();
      slowCompose.next({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, sourceListIds: ['101'], recorded: true, audience: RECORDED_AUDIENCE });
      fixture.detectChanges();

      expect(seen.attached, "a late reply attached one project's list to another project's brief").toEqual([]);
      expect(seen.unattached).toEqual([]);
    });

    /**
     * The note that replaced the old "go and attach it yourself" cross-link. Two states, because
     * an empty brief id genuinely means something different rather than being a not-ready version
     * of the same thing -- and saying so BEFORE the compose is the only point at which it is
     * still free to act on. The testid is unchanged on purpose.
     */
    it('promises the attach once a plan is saved', async () => {
      await render({ briefId: 'brief-1' });

      const note = host().querySelector('[data-testid="campaigns-audience-crosslink"]');
      expect(note?.textContent).toContain('attaches it to this campaign');
    });

    it('warns that a compose with no saved plan attaches nothing', async () => {
      await render({ briefId: '' });

      const note = host().querySelector('[data-testid="campaigns-audience-crosslink"]');
      expect(note?.textContent).toContain('not attached');
    });

    /**
     * An empty brief id used to read "Save the plan on the Plan tab first" even though the plan is
     * saved automatically when this tab opens. The banner now names the real reason.
     */
    it('says the plan is still saving, with no retry, while the brief resolves', async () => {
      await render({ briefId: '' });
      fixture.componentRef.setInput('briefState', 'resolving');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-brief-state-message"]')?.textContent).toContain('Saving');
      expect(host().querySelector('[data-testid="campaigns-audience-brief-retry"]')).toBeNull();
    });

    it('offers a retry when saving the plan failed', async () => {
      await render({ briefId: '' });
      fixture.componentRef.setInput('briefState', 'failed');
      fixture.detectChanges();
      const retried = vi.fn();
      fixture.componentInstance.retryBrief.subscribe(retried);

      expect(host().querySelector('[data-testid="campaigns-audience-brief-state"]')).not.toBeNull();
      click('campaigns-audience-brief-retry');
      expect(retried).toHaveBeenCalledTimes(1);
    });

    it('points at restoring the saved plan, with no retry, when an earlier brief was not opened here', async () => {
      // Retry re-sends the same save, which is refused the same way until the existing row is
      // loaded -- so offering it here would be a button that can never work.
      await render({ briefId: '' });
      fixture.componentRef.setInput('briefState', 'unopened');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-brief-state-message"]')?.textContent).toContain('re-enter the event URL');
      expect(host().querySelector('[data-testid="campaigns-audience-brief-retry"]')).toBeNull();
    });

    it('shows no brief banner once the brief is ready', async () => {
      await render({ briefId: 'brief-1' });
      fixture.componentRef.setInput('briefState', 'ready');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-brief-state"]')).toBeNull();
    });
  });

  /**
   * Reusing an earlier send's lists, or one already-built list, as this email's audience with
   * NO compose — the path that avoids creating yet another master list in HubSpot.
   */
  describe('attaching existing lists without composing', () => {
    const PAST_SEND: AudienceLastSentEmail = {
      emailId: 'em-7',
      emailName: 'Synthetic Summit 2026 - Early bird',
      sentAt: '2026-01-10T15:00:00Z',
      hubspotUrl: 'https://app.hubspot.com/email/1/details/em-7/performance',
      includedLists: [{ listId: '501', name: 'Synthetic Summit - Prospects', size: 3000, missing: false }],
      suppressionLists: [
        { listId: '201', name: 'LF Events - GDPR Suppression', size: 5000, missing: false },
        { listId: '777', name: 'Synthetic Summit - Already registered', size: 40, missing: false },
      ],
    };

    const ATTACHED_AUDIENCE: CampaignAudience = {
      id: 'aud-2',
      briefId: 'brief-1',
      platform: 'hubspot',
      platformMasterListId: '501',
      status: 'built',
      version: 1,
    };

    async function renderWithPastSend(briefId: string): Promise<void> {
      getAudienceLastSent.mockReturnValue(of([PAST_SEND]));
      await render({ briefId });
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
    }

    it("attaches a past send's include and suppression lists as they are", async () => {
      await renderWithPastSend('brief-1');
      const attached: CampaignAudience[] = [];
      fixture.componentInstance.audienceAttached.subscribe((a) => attached.push(a));
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '501', name: 'Synthetic Summit - Prospects', hubspotUrl: 'u' },
          suppressionListIds: ['201', '777'],
          audience: ATTACHED_AUDIENCE,
        })
      );

      click('audience-last-sent-use-em-7');

      confirmReuseIfAsked();

      const [project, request] = attachExistingAudience.mock.calls.at(-1) ?? [];
      expect(project).toBe('tlf');
      expect(request).toMatchObject({ briefId: 'brief-1', masterListId: '501', suppressionListIds: ['201', '777'] });
      expect(composeAudienceMaster, 'a compose ran for lists that already exist').not.toHaveBeenCalled();
      expect(attached).toEqual([ATTACHED_AUDIENCE]);
      expect(host().querySelector('[data-testid="campaigns-audience-attach-result"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-summary-attached"]')).not.toBeNull();

      let continued = 0;
      fixture.componentInstance.continueToEmail.subscribe(() => continued++);
      click('campaigns-audience-attach-continue');
      expect(continued).toBe(1);
    });

    it('blocks attach while a compose is still in flight', async () => {
      // Compose and attach both RECORD an audience against the same brief, and neither guard
      // used to know about the other -- `canAttach` ignored `composing()`. Started together, the
      // displayed selection and the recorded audience are decided by response arrival order, so
      // the operator can be looking at one list while the send points at another.
      //
      // There is no correct merge of two audiences for one brief, so they are serialized.
      await renderWithPastSend('brief-1');

      // A compose that never settles: the window the race lives in.
      composeAudienceMaster.mockReturnValue(new Subject().asObservable());
      click('audience-card-grid-toggle-101');
      composeMaster();

      click('audience-last-sent-use-em-7');

      confirmReuseIfAsked();

      expect(attachExistingAudience, 'an attach started while a compose was still writing').not.toHaveBeenCalled();
    });

    it("copies a past send's selection into include AND exclude", async () => {
      await renderWithPastSend('brief-1');

      click('audience-last-sent-copy-em-7');

      expect(host().querySelector('[data-testid="campaigns-audience-remove-501"]'), 'the include list was not copied').not.toBeNull();
      // 201 is a standard grid row, so it is ticked THROUGH that row (shown in the standard group's
      // chip); 777 is not, so it gets its own key.
      expect(host().querySelector('[data-testid="campaigns-audience-remove-exclude-group:standard"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-remove-exclude-copied:777"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-summary-excluded"]')?.textContent?.trim()).toBe('2');
    });

    it('sends to a single selected list directly, with the pre-ticked suppression', async () => {
      await renderWithPastSend('brief-1');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(
        of({ master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' }, suppressionListIds: ['201'], audience: ATTACHED_AUDIENCE })
      );

      useSelectionDirectly();

      expect(attachExistingAudience.mock.calls.at(-1)?.[1]).toMatchObject({ masterListId: '101', suppressionListIds: ['201'] });
      expect(composeAudienceMaster).not.toHaveBeenCalled();
    });

    it('names the shared standard suppression list and still treats the attach as current', async () => {
      await renderWithPastSend('brief-1');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' },
          suppressionListIds: ['40000'],
          standardSuppression: { listId: '40000', name: 'LFX Standard Suppressions - tlf', hubspotUrl: 'https://app.hubspot.com/l/2' },
          audience: ATTACHED_AUDIENCE,
        })
      );

      useSelectionDirectly();

      const note = host().querySelector('[data-testid="campaigns-audience-attach-suppression"]')?.textContent ?? '';
      expect(note).toContain('through the shared list');
      expect(note).toContain('LFX Standard Suppressions - tlf');
      // The record holds the standing list's id, but QA and the "used" match compare the standard rows it stands for.
      const sent = attachExistingAudience.mock.calls.at(-1)?.[1].suppressionListIds;
      expect((fixture.componentInstance as unknown as { attachedExclusions: () => readonly string[] }).attachedExclusions()).toEqual(sent);
    });

    it('ticks the current-registrants row by default and asks the attach to create its list', async () => {
      getAudienceSuppressionLists.mockReturnValue(
        of([
          {
            key: 'lf_events_gdpr',
            label: 'LF Events GDPR',
            listId: '201',
            name: 'LF Events - GDPR Suppression',
            size: 5000,
            category: 'standard',
            hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
          },
          {
            key: 'current_registrants',
            label: 'Current registrants - Synthetic Summit 2026',
            listId: '',
            name: 'Synthetic Summit 2026 - Current Registrants',
            category: 'current_registrants',
            hubspotUrl: '',
            willCreate: true,
          },
        ])
      );
      await renderWithPastSend('brief-1');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(
        of({ master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' }, suppressionListIds: ['201', '9001'], audience: ATTACHED_AUDIENCE })
      );

      expect(host().querySelector<HTMLInputElement>('[data-testid="audience-suppression-grid-toggle-current_registrants"]')?.checked).toBe(true);
      useSelectionDirectly();

      const request = attachExistingAudience.mock.calls.at(-1)?.[1];
      expect(request.suppressionListIds, 'a list that does not exist yet has no id to send').toEqual(['201']);
      expect(request.currentRegistrantsEvent).toBe('Synthetic Summit 2026');
    });

    it('keeps writes serialized across a brief switch away and back while an attach is outstanding', async () => {
      // The brief-switch reset cleared the SPINNER, which was also the write guard. A -> B -> A then
      // let a second attach for A start, and an out-of-order reply let the older one overwrite the
      // record with the earlier selection.
      await renderWithPastSend('brief-1');
      click('audience-card-grid-toggle-101');
      const first = new Subject<AudienceAttachExistingResult>();
      attachExistingAudience.mockReturnValue(first);
      useSelectionDirectly();

      fixture.componentRef.setInput('briefId', 'brief-2');
      fixture.detectChanges();
      fixture.componentRef.setInput('briefId', 'brief-1');
      fixture.detectChanges();
      useSelectionDirectly();
      composeMaster();

      expect(attachExistingAudience, 'a second attach started while the first was on the wire').toHaveBeenCalledTimes(1);
      expect(composeAudienceMaster, 'a compose started while an attach was on the wire').not.toHaveBeenCalled();

      // Settling releases it: the guard is not permanently closed.
      first.next({
        master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' },
        suppressionListIds: [],
        audience: ATTACHED_AUDIENCE,
      } as AudienceAttachExistingResult);
      first.complete();
      fixture.detectChanges();
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-use-direct"]')?.disabled).toBe(false);
    });

    it('holds the direct attach while the suppression fetch has failed', async () => {
      getAudienceSuppressionLists.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));
      await renderWithPastSend('brief-1');
      click('audience-card-grid-toggle-101');

      useSelectionDirectly();

      expect(attachExistingAudience, 'a send was recorded with its GDPR/CASL exclusions unread').not.toHaveBeenCalled();
    });

    it('drops the attach result when the parent moves to another brief', async () => {
      await renderWithPastSend('brief-1');
      attachExistingAudience.mockReturnValue(
        of({ master: { listId: '501', name: 'Synthetic Summit - Prospects', hubspotUrl: 'u' }, suppressionListIds: ['201'], audience: ATTACHED_AUDIENCE })
      );
      click('audience-last-sent-use-em-7');
      confirmReuseIfAsked();
      expect(host().querySelector('[data-testid="campaigns-audience-attach-result"]'), 'fixture precondition').not.toBeNull();

      fixture.componentRef.setInput('briefId', 'brief-2');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-attach-result"]'), "brief-1's attach read as brief-2's").toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-summary-attached"]')).toBeNull();
    });

    it('offers no direct attach without a saved plan', async () => {
      await renderWithPastSend('');
      click('audience-card-grid-toggle-101');

      // The button stays visible so the operator can see the option, but it is disabled and says why.
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-use-direct"]')?.disabled).toBe(true);
      expect(host().querySelector('[data-testid="campaigns-audience-use-direct-unavailable"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="audience-last-sent-attach-unavailable"]')).not.toBeNull();
    });

    /** Two discovered lists, so a selection can hold several includes or one include and one exclude. */
    async function renderWithTwoLists(): Promise<void> {
      await render({ briefId: 'brief-1' });
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery(
        discovered({
          lists: [
            ...discovered().lists,
            {
              listId: '102',
              name: 'Synthetic Summit 2026 - Speakers',
              signal: 'event_speakers',
              size: 80,
              reason: 'The filter selects on speakers for this event.',
              listType: 'STATIC',
              hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/102',
            },
          ],
        })
      );
    }

    it('sends several selected lists directly as include lists, with no master list composed', async () => {
      await renderWithTwoLists();
      click('audience-card-grid-toggle-101');
      click('audience-card-grid-toggle-102');
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '101', name: 'Synthetic Summit 2026 - Registrants', hubspotUrl: 'u' },
          suppressionListIds: ['201'],
          audience: { ...ATTACHED_AUDIENCE, platformMasterListId: '101', includeListIds: ['101', '102'] },
        })
      );

      useSelectionDirectly();

      const request = attachExistingAudience.mock.calls.at(-1)?.[1];
      expect(request).toMatchObject({ briefId: 'brief-1', includeListIds: ['101', '102'], suppressionListIds: ['201'] });
      expect(request?.masterListId, 'a multi-list attach also named a single master').toBeUndefined();
      expect(composeAudienceMaster, 'a master list was composed for lists that already exist').not.toHaveBeenCalled();
      expect(host().querySelector('[data-testid="campaigns-audience-attach-includes"]')?.textContent).toContain('Synthetic Summit 2026 - Speakers');
      expect(host().querySelector('[data-testid="campaigns-audience-attach-continue"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-continue"]'), 'Continue to Implement was offered twice').toBeNull();
    });

    it('requires at least one suppression list before composing or attaching', async () => {
      await renderWithTwoLists();
      click('audience-card-grid-toggle-101');
      expect(host().querySelector('[data-testid="campaigns-audience-suppression-required"]'), 'the pre-ticked suppression read as missing').toBeNull();

      toggleStandardRow('lf_events_gdpr');

      expect(host().querySelector('[data-testid="campaigns-audience-suppression-required"]')).not.toBeNull();
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled).toBe(true);
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-use-direct"]')?.disabled).toBe(true);
      useSelectionDirectly();
      expect(attachExistingAudience, 'a send was recorded with no suppression list').not.toHaveBeenCalled();
    });

    it('excludes a list marked Exclude instead of including it', async () => {
      await renderWithTwoLists();
      click('audience-card-grid-toggle-101');
      click('audience-card-grid-toggle-102');

      // Exclude is the other side of the same choice, so it takes 102 out of the inclusions.
      click('audience-card-grid-exclude-102');

      expect(host().querySelector('[data-testid="campaigns-audience-exclusions"]')?.textContent).toContain('Synthetic Summit 2026 - Speakers');
      expect(host().querySelector('[data-testid="campaigns-audience-remove-102"]'), 'an excluded list stayed included').toBeNull();

      // Removing the chip stops excluding it; mark it again for the attach below.
      click('campaigns-audience-remove-exclusion-102');
      expect(host().querySelector('[data-testid="campaigns-audience-exclusions"]')).toBeNull();
      click('audience-card-grid-exclude-102');

      attachExistingAudience.mockReturnValue(
        of({ master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' }, suppressionListIds: ['201', '102'], audience: ATTACHED_AUDIENCE })
      );
      useSelectionDirectly();
      const request = attachExistingAudience.mock.calls.at(-1)?.[1];
      expect(request?.masterListId).toBe('101');
      expect([...(request?.suppressionListIds ?? [])].sort()).toEqual(['102', '201']);
    });

    // A second send on the SAME master, differing only in its exclusions -- the pair that made
    // matching on the master alone wrong.
    const SIBLING_SEND: AudienceLastSentEmail = {
      ...PAST_SEND,
      emailId: 'em-8',
      emailName: 'Synthetic Summit 2026 - Final call',
      sentAt: '2026-02-01T15:00:00Z',
      suppressionLists: [{ listId: '888', name: 'Synthetic Summit - Opened already', size: 90, missing: false }],
    };

    /** Renders with BOTH sends on master 501, so only the exclusions tell them apart. */
    async function renderWithSiblingSends(): Promise<void> {
      getAudienceLastSent.mockReturnValue(of([PAST_SEND, SIBLING_SEND]));
      await render({ briefId: 'brief-1' });
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
    }

    function badgeFor(emailId: string): string {
      return host().querySelector(`[data-testid="audience-last-sent-use-${emailId}"]`)?.textContent?.trim() ?? '';
    }

    it('marks only the send whose exclusions were actually recorded', async () => {
      await renderWithSiblingSends();
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '501', name: 'Synthetic Summit - Prospects', hubspotUrl: 'u' },
          suppressionListIds: ['201', '777'],
          audience: ATTACHED_AUDIENCE,
        })
      );

      click('audience-last-sent-use-em-7');

      confirmReuseIfAsked();

      expect(badgeFor('em-7')).toContain('Same lists used for this email');
      expect(badgeFor('em-8'), 'a send sharing the master but not the exclusions read as attached').toContain('Use these lists for this email');
    });

    // The exclusions are read off the attach RESULT, not off what was sent, so a failed attach
    // cannot leave the master from the successful write beside the exclusions from the failed one.
    it('keeps describing the recorded selection after a later attach fails', async () => {
      await renderWithSiblingSends();
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '501', name: 'Synthetic Summit - Prospects', hubspotUrl: 'u' },
          suppressionListIds: ['201', '777'],
          audience: ATTACHED_AUDIENCE,
        })
      );
      click('audience-last-sent-use-em-7');
      confirmReuseIfAsked();
      expect(badgeFor('em-7'), 'fixture precondition').toContain('Same lists used for this email');

      attachExistingAudience.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: { message: 'HubSpot rejected the list' } })));
      click('audience-last-sent-use-em-8');
      confirmReuseIfAsked();

      expect(host().querySelector('[data-testid="campaigns-audience-attach-error"]'), 'fixture precondition').not.toBeNull();
      expect(badgeFor('em-8'), "the failed attempt's exclusions were reported as the brief's").toContain('Use these lists for this email');
      expect(badgeFor('em-7'), 'the recorded selection stopped being reported after an unrelated failure').toContain('Same lists used for this email');
    });

    it('shows the server error when an attach fails', async () => {
      await renderWithPastSend('brief-1');
      attachExistingAudience.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: { message: 'HubSpot rejected the list' } })));

      click('audience-last-sent-use-em-7');

      confirmReuseIfAsked();

      expect(host().querySelector('[data-testid="campaigns-audience-attach-error"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-attach-result"]')).toBeNull();
    });
  });

  describe('manual search', () => {
    /** Types into the gaps section's typeahead and lets its debounce window close. */
    function search(query: string): void {
      const input = host().querySelector<HTMLInputElement>('[data-testid="audience-missing-signals-search-input"]');
      if (input === null) {
        throw new Error('the gaps-section search input is not rendered');
      }
      vi.useFakeTimers();
      try {
        input.value = query;
        input.dispatchEvent(new Event('input'));
        vi.advanceTimersByTime(AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS);
      } finally {
        vi.useRealTimers();
      }
      fixture.detectChanges();
    }

    async function renderWithDiscovery(): Promise<void> {
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
    }

    it('adds a manually found list to the same inclusion set the grids feed', async () => {
      // Search results and discovered cards are different sections but one selection set; a
      // separate list would silently drop manual picks from the compose request.
      await renderWithDiscovery();

      searchAudienceLists.mockReturnValue(of([{ listId: '502', name: 'Synthetic Summit - Sponsors', size: 60, hubspotUrl: 'https://app.hubspot.com/x/502' }]));
      search('sponsors');
      click('audience-missing-signals-add-502');

      expect(searchAudienceLists).toHaveBeenCalledWith('tlf', 'sponsors');
      expect(host().querySelector('[data-testid="campaigns-audience-remove-502"]'), 'a manually added list is not in the selection').not.toBeNull();
    });

    it('swallows a typeahead failure rather than raising a banner', async () => {
      // The operator's next keystroke retries it; a banner per failed keystroke would bury the
      // page in alerts about a transient lookup.
      await renderWithDiscovery();

      searchAudienceLists.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      search('speakers');

      expect(host().querySelectorAll('[role="alert"]').length).toBe(0);
    });
  });

  describe('custom audiences', () => {
    async function renderWithDiscovery(missing: AudienceSignal[] = []): Promise<void> {
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery({ ...discovered(), missingSignals: missing });
    }

    function builder(): AudienceCustomBuilderComponent {
      return fixture.debugElement.query(By.directive(AudienceCustomBuilderComponent)).componentInstance as AudienceCustomBuilderComponent;
    }

    it('adds a list the custom builder created to the inclusion set', async () => {
      await renderWithDiscovery();

      builder().created.emit({ listId: '7777', name: '26Q1 - Seoul - Mailable Contacts', hubspotUrl: 'https://app.hubspot.com/x/7777' });
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-7777"]'), 'a created list must join Include like a hand-added one').not.toBeNull();
    });

    it('opens the builder with a reviewable speakers preset for a missing speakers signal', async () => {
      await renderWithDiscovery(['event_speakers']);

      click('audience-missing-signals-create-event_speakers');

      expect(builder().preset()).toMatchObject({
        criteria: { label: 'Synthetic Summit 2026', speakers: { scope: 'current', eventNames: ['Synthetic Summit 2026'] } },
      });
    });

    it('holds compose while a custom create is still landing', async () => {
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      const compose = (): HTMLButtonElement | null => host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]');
      expect(compose()?.disabled, 'precondition: compose is offered').toBe(false);

      builder().creatingChange.emit(true);
      fixture.detectChanges();

      expect(compose()?.disabled, 'compose would snapshot the selection before the created list joins it').toBe(true);
    });

    it('starts the custom builder over with the run, and forgets the planned event', async () => {
      await renderWithDiscovery();
      const before = builder().resetKey();

      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();

      expect(builder().resetKey()).toBeGreaterThan(before);
    });

    it('drops a suppression count when the project changes', async () => {
      await renderWithDiscovery();
      previewAudienceCount.mockReturnValue(of({ exact: true, estimate: 900, count: 900, reason: '' }));
      click('campaigns-audience-suppression-count-run');
      expect(host().querySelector('[data-testid="campaigns-audience-suppression-count-value"]')).not.toBeNull();

      fixture.componentRef.setInput('projectSlug', 'another-foundation');
      fixture.detectChanges();
      // Portal B resolves a suppression list with the SAME numeric id, so the count's display key
      // matches again: only the reset keeps A's count from reading as B's.
      stream = new Subject<SSEEvent<AudienceDiscoverySSEEventType>>();
      discoverAudience.mockReturnValue(stream.asObservable());
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();

      expect(host().querySelector('[data-testid="campaigns-audience-suppression-count-value"]'), "project A's count must not read as B's").toBeNull();
    });

    it('shows a zero estimate as unavailable, never as a measured zero', async () => {
      await renderWithDiscovery();
      previewAudienceCount.mockReturnValue(of({ exact: false, estimate: 0, count: 0, reason: 'a list did not report a size' }));
      click('campaigns-audience-suppression-count-run');

      const value = host().querySelector('[data-testid="campaigns-audience-suppression-count-value"]')?.textContent ?? '';
      expect(value).toContain('unavailable');
      expect(value).not.toContain('0 contacts');
    });

    it('keeps the existing-list search results to its own box', async () => {
      await render();
      searchAudienceLists.mockReturnValue(of([{ listId: '777', name: 'Prospects', size: 10, hubspotUrl: 'https://app.hubspot.com/x/777' }]));
      const input = host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-use-existing-search"]');
      if (input === null) throw new Error('the existing-list search is not rendered');
      vi.useFakeTimers();
      try {
        input.value = 'prospects';
        input.dispatchEvent(new Event('input'));
        vi.advanceTimersByTime(AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS);
      } finally {
        vi.useRealTimers();
      }
      fixture.detectChanges();

      // The Fill gaps search answers with a different list; the existing-list box must keep its own.
      searchAudienceLists.mockReturnValue(of([{ listId: '888', name: 'Speakers', size: 5, hubspotUrl: 'https://app.hubspot.com/x/888' }]));
      (fixture.componentInstance as unknown as { onSearch(q: string): void }).onSearch('speakers');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-use-existing-777"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-use-existing-888"]')).toBeNull();
    });

    it('keeps one event field, outside both tabs, for drafting and discovering', async () => {
      await render();
      typeEventUrl('https://events.example.org/typed-in-build');

      click('campaigns-audience-mode-reuse');

      const fields = host().querySelectorAll<HTMLInputElement>('input[type="url"]');
      expect(fields.length, 'the event url is asked for twice').toBe(1);
      expect(fields[0].value).toBe('https://events.example.org/typed-in-build');
    });

    it('loads suppressions scoped to a planned event for a list used without discovery', async () => {
      await render();
      builder().eventPlanned.emit({ eventName: 'Synthetic Summit 2026', brandShort: 'SYN', eventDates: [] });
      builder().created.emit({ listId: '7777', name: 'Seoul', hubspotUrl: 'https://app.hubspot.com/x/7777' });
      fixture.detectChanges();

      expect(getAudienceSuppressionLists).toHaveBeenLastCalledWith('tlf', 'SYN', 'Synthetic Summit 2026', 'Synthetic Summit 2026');
    });

    it("takes the edition's year from the brief's dates when the event has none of its own", async () => {
      await render();
      fixture.componentRef.setInput('briefEventName', 'Synthetic Summit');
      fixture.componentRef.setInput('briefEventDates', 'September 10-11, 2026');
      builder().eventPlanned.emit({ eventName: 'Synthetic Summit', brandShort: 'SYN', eventDates: [] });
      builder().created.emit({ listId: '7777', name: 'Seoul', hubspotUrl: 'https://app.hubspot.com/x/7777' });
      fixture.detectChanges();

      expect(getAudienceSuppressionLists).toHaveBeenLastCalledWith('tlf', 'SYN', 'Synthetic Summit', 'Synthetic Summit 2026');
    });

    it("never borrows the brief's year for a different event, and asks for no registrants row without one", async () => {
      await render();
      fixture.componentRef.setInput('briefEventName', 'Another Conference');
      fixture.componentRef.setInput('briefEventDates', 'September 10-11, 2026');
      builder().eventPlanned.emit({ eventName: 'Synthetic Summit', brandShort: 'SYN', eventDates: [] });
      builder().created.emit({ listId: '7777', name: 'Seoul', hubspotUrl: 'https://app.hubspot.com/x/7777' });
      fixture.detectChanges();

      expect(getAudienceSuppressionLists).toHaveBeenLastCalledWith('tlf', 'SYN', 'Synthetic Summit', '');
    });

    it("reloads the rows when the brief's dates give the edition its year after the first load", async () => {
      await render();
      fixture.componentRef.setInput('briefEventName', 'Synthetic Summit');
      builder().eventPlanned.emit({ eventName: 'Synthetic Summit', brandShort: 'SYN', eventDates: [] });
      builder().created.emit({ listId: '7777', name: 'Seoul', hubspotUrl: 'https://app.hubspot.com/x/7777' });
      fixture.detectChanges();
      expect(getAudienceSuppressionLists).toHaveBeenLastCalledWith('tlf', 'SYN', 'Synthetic Summit', '');

      fixture.componentRef.setInput('briefEventDates', 'September 10-11, 2026');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(getAudienceSuppressionLists).toHaveBeenLastCalledWith('tlf', 'SYN', 'Synthetic Summit', 'Synthetic Summit 2026');
    });

    it('loads the planned scope once a portfolio-wide load already on the wire settles', async () => {
      await render();
      const generic = new Subject<AudienceSuppressionList[]>();
      getAudienceSuppressionLists.mockReturnValueOnce(generic);
      builder().created.emit({ listId: '7777', name: 'Seoul', hubspotUrl: 'https://app.hubspot.com/x/7777' });
      fixture.detectChanges();
      expect(getAudienceSuppressionLists).toHaveBeenLastCalledWith('tlf', '', '', '');

      builder().eventPlanned.emit({ eventName: 'Synthetic Summit 2026', brandShort: 'SYN', eventDates: [] });
      generic.next([
        {
          key: 'lf_events_gdpr',
          label: 'LF Events GDPR',
          listId: '201',
          name: 'LF Events - GDPR Suppression',
          size: 5000,
          category: 'standard',
          hubspotUrl: '',
        },
      ]);
      generic.complete();
      fixture.detectChanges();

      expect(getAudienceSuppressionLists).toHaveBeenLastCalledWith('tlf', 'SYN', 'Synthetic Summit 2026', 'Synthetic Summit 2026');
    });

    it('holds Discover while a custom create is still landing', async () => {
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      builder().creatingChange.emit(true);
      fixture.detectChanges();

      click('campaigns-audience-discover');
      // The handler holds too, not only the button.
      (fixture.componentInstance as unknown as { onDiscover(): void }).onDiscover();

      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-discover"]')?.disabled).toBe(true);
      expect(discoverAudience, "discovery's reset would discard the create's reply").not.toHaveBeenCalled();
    });

    it('rescopes after a portfolio-wide load that found no rows', async () => {
      await render();
      const generic = new Subject<AudienceSuppressionList[]>();
      getAudienceSuppressionLists.mockReturnValueOnce(generic);
      builder().created.emit({ listId: '7777', name: 'Seoul', hubspotUrl: 'https://app.hubspot.com/x/7777' });
      fixture.detectChanges();
      builder().eventPlanned.emit({ eventName: 'Synthetic Summit 2026', brandShort: 'SYN', eventDates: [] });
      generic.next([]);
      generic.complete();
      fixture.detectChanges();

      expect(getAudienceSuppressionLists).toHaveBeenLastCalledWith('tlf', 'SYN', 'Synthetic Summit 2026', 'Synthetic Summit 2026');
    });

    it('retries a failed planned rescope on the next trigger', async () => {
      await render();
      builder().created.emit({ listId: '7777', name: 'Seoul', hubspotUrl: 'https://app.hubspot.com/x/7777' });
      fixture.detectChanges();
      getAudienceSuppressionLists.mockReturnValueOnce(throwError(() => new Error('down')));
      builder().eventPlanned.emit({ eventName: 'Synthetic Summit 2026', brandShort: 'SYN', eventDates: [] });
      fixture.detectChanges();

      builder().created.emit({ listId: '8888', name: 'Busan', hubspotUrl: 'https://app.hubspot.com/x/8888' });
      fixture.detectChanges();

      // Retried at the latest on the next trigger (the edition gaining its year can retry sooner).
      const plannedLoads = getAudienceSuppressionLists.mock.calls.filter((call) => call[1] === 'SYN');
      expect(plannedLoads.length, 'the failed scope is loaded again').toBeGreaterThanOrEqual(2);
      expect(getAudienceSuppressionLists).toHaveBeenLastCalledWith('tlf', 'SYN', 'Synthetic Summit 2026', 'Synthetic Summit 2026');
      expect((fixture.componentInstance as unknown as { suppressionFailed(): boolean }).suppressionFailed()).toBe(false);
    });

    it('keeps a row the operator unticked unticked when a failed rescope is retried', async () => {
      await render();
      builder().created.emit({ listId: '7777', name: 'Seoul', hubspotUrl: 'https://app.hubspot.com/x/7777' });
      fixture.detectChanges();
      const tab = fixture.componentInstance as unknown as { suppression(): ReadonlyMap<string, string>; onToggleSuppression(key: string): void };
      expect(tab.suppression().has('lf_events_gdpr'), 'precondition: the generic row is pre-ticked').toBe(true);
      tab.onToggleSuppression('lf_events_gdpr');
      fixture.detectChanges();
      getAudienceSuppressionLists.mockReturnValueOnce(throwError(() => new Error('down')));
      builder().eventPlanned.emit({ eventName: 'Synthetic Summit 2026', brandShort: 'SYN', eventDates: [] });
      fixture.detectChanges();

      builder().created.emit({ listId: '8888', name: 'Busan', hubspotUrl: 'https://app.hubspot.com/x/8888' });
      fixture.detectChanges();

      expect(getAudienceSuppressionLists).toHaveBeenLastCalledWith('tlf', 'SYN', 'Synthetic Summit 2026', 'Synthetic Summit 2026');
      expect(tab.suppression().has('lf_events_gdpr'), 'the operator unticked it; a retry must not re-tick it').toBe(false);
    });

    it('sends a typed master name with the compose', async () => {
      await renderWithDiscovery();
      composeAudienceMaster.mockReturnValue(NEVER);
      click('audience-card-grid-toggle-101');
      const name = host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-compose-name"]');
      if (name === null) {
        throw new Error('the master name field is not rendered');
      }
      name.value = '  My Master  ';
      name.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      composeMaster();

      expect(composeAudienceMaster.mock.calls.at(-1)?.[1]?.name).toBe('My Master');
    });
  });

  describe('legacy parity additions', () => {
    async function discover(missing: AudienceSignal[] = []): Promise<void> {
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit/');
      click('campaigns-audience-discover');
      completeDiscovery({ ...discovered(), missingSignals: missing });
    }

    function builderPreset(): unknown {
      return (fixture.debugElement.query(By.directive(AudienceCustomBuilderComponent)).componentInstance as AudienceCustomBuilderComponent).preset();
    }

    it('pre-fills a page-view list from the event URL, without the scheme', async () => {
      await discover(['page_view']);

      click('audience-missing-signals-create-page_view');

      expect(builderPreset()).toMatchObject({ criteria: { pageViewUrls: ['events.example.org/synthetic-summit'] } });
    });

    it('asks the model for an education list scoped to the brand', async () => {
      await discover(['education_enrollment']);

      click('audience-missing-signals-create-education_enrollment');

      expect((builderPreset() as { request: string }).request).toContain("SYN's education courses");
    });

    it('plans an event audience from the event page through the model', async () => {
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit/');

      click('campaigns-audience-event-generate');

      expect(builderPreset()).toMatchObject({ eventUrl: 'https://events.example.org/synthetic-summit/' });
      expect((builderPreset() as { request: string }).request).toContain('not limited to any location');
    });

    describe('opt-in lists for an event draft', () => {
      function optIn(listId: string, signal: AudienceSignal, size?: number): AudienceDiscoveredList {
        return { listId, name: `Opt-in ${listId}`, signal, size, reason: 'Subscribed', listType: 'DYNAMIC', hubspotUrl: '' };
      }

      function draftBuilder(): AudienceCustomBuilderComponent {
        return fixture.debugElement.query(By.directive(AudienceCustomBuilderComponent)).componentInstance as AudienceCustomBuilderComponent;
      }

      /** The drafted list is created; the draft's opt-ins wait for it. */
      function createDraftedList(listId = '7777'): void {
        draftBuilder().created.emit({ listId, name: 'Synthetic Summit - Event audience', hubspotUrl: `https://app.hubspot.com/x/${listId}` });
        fixture.detectChanges();
      }

      async function draftWith(lists: AudienceDiscoveredList[], missingSignals: AudienceSignal[] = [], create = true): Promise<void> {
        await render();
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');
        completeDiscovery(discovered({ lists: [...discovered().lists, ...lists], missingSignals }));
        if (create) {
          createDraftedList();
        }
      }

      it('adds the largest project and LF Newsletter opt-in list to Include, and offers the rest', async () => {
        await draftWith([optIn('301', 'project_opt_in', 50), optIn('302', 'project_opt_in', 900), optIn('401', 'lf_newsletter_opt_in', 4000)]);

        expect(discoverAudience).toHaveBeenCalledWith('tlf', { eventUrl: 'https://events.example.org/synthetic-summit/' });
        expect(host().querySelector('[data-testid="campaigns-audience-remove-302"]'), 'the largest project opt-in list was not included').not.toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), 'the LF Newsletter list was not included').not.toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-remove-301"]'), 'every opt-in variant joined the send').toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-remove-101"]'), 'a non-opt-in discovered list joined Include').toBeNull();

        click('campaigns-audience-opt-in-add-301');

        expect(host().querySelector('[data-testid="campaigns-audience-remove-301"]')).not.toBeNull();
      });

      it('leaves the Use existing lists steps as they were', async () => {
        await draftWith([optIn('401', 'lf_newsletter_opt_in', 4000)]);

        expect(host().querySelector('[data-testid="campaigns-audience-mode-build"]')?.getAttribute('aria-selected')).toBe('true');
        click('campaigns-audience-mode-reuse');
        expect(
          host().querySelector('[data-testid="campaigns-audience-discovered-steps"]')?.classList.contains('hidden'),
          'the opt-in lookup filled the discovered grid'
        ).toBe(true);
      });

      it("takes the last draft's opt-in lists out of Include when the event changes", async () => {
        await draftWith([optIn('401', 'lf_newsletter_opt_in', 4000)]);
        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), 'fixture precondition').not.toBeNull();

        typeEventUrl('https://events.example.org/other-summit/');
        click('campaigns-audience-event-generate');
        // A draft for another page starts over once confirmed (the first draft's list is hand work).
        click('campaigns-audience-start-over-confirm');
        completeDiscovery(discovered({ lists: [optIn('402', 'lf_newsletter_opt_in', 10)] }));
        createDraftedList('7778');

        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), "the first event's opt-in list stayed in the send").toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-remove-402"]')).not.toBeNull();
      });

      it('holds the opt-in lists until the drafted list is created, so attach cannot send to them alone', async () => {
        await render({ briefId: 'brief-1' });
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');
        completeDiscovery(discovered({ lists: [optIn('401', 'lf_newsletter_opt_in', 4000)] }));

        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), 'the newsletter list joined Include before the draft existed').toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-pending-401"]')).not.toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-use-direct"]'), 'attach was offered with only an opt-in list selected').toBeNull();

        createDraftedList();

        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]')).not.toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-added-401"]')).not.toBeNull();
      });

      it('adds held opt-ins at once when the lookup settles after the drafted list was created', async () => {
        await render();
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');
        createDraftedList();
        completeDiscovery(discovered({ lists: [optIn('401', 'lf_newsletter_opt_in', 4000)] }));

        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]')).not.toBeNull();
      });

      it('never takes out a list the operator had already included when a later draft cleans up', async () => {
        await render();
        // The operator included 401 by hand before drafting.
        (fixture.componentInstance as unknown as { add: (id: string, name: string) => boolean }).add('401', 'Opt-in 401');
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');
        completeDiscovery(discovered({ lists: [optIn('401', 'lf_newsletter_opt_in', 4000)] }));
        createDraftedList();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-added-401"]'), "the operator's own list was recorded as the lookup's").toBeNull();

        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');

        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), "a later draft removed the operator's list").not.toBeNull();
      });

      it('does not un-mark a list the operator marked Exclude', async () => {
        await render();
        (fixture.componentInstance as unknown as { onExcludeList: (list: { listId: string; name: string }) => void }).onExcludeList({
          listId: '401',
          name: 'Opt-in 401',
        });
        fixture.detectChanges();
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');
        completeDiscovery(discovered({ lists: [optIn('401', 'lf_newsletter_opt_in', 4000)] }));
        createDraftedList();

        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), 'an excluded list was auto-included').toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-remove-exclusion-401"]'), 'the Exclude mark was dropped').not.toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-add-401"]'), 'it is offered to add by hand').not.toBeNull();
      });

      it('adds the held opt-ins when the draft reuses an existing list instead of creating one', async () => {
        await draftWith([optIn('401', 'lf_newsletter_opt_in', 4000)], [], false);
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-pending-401"]'), 'fixture precondition').not.toBeNull();

        draftBuilder().reuse.emit({ listId: '8888', name: 'Synthetic Summit - Existing audience', size: 900, hubspotUrl: 'https://app.hubspot.com/x/8888' });
        fixture.detectChanges();

        expect(host().querySelector('[data-testid="campaigns-audience-remove-8888"]')).not.toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), 'the opt-ins waited forever after a reuse').not.toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-pending-401"]')).toBeNull();
      });

      it('reads the opt-ins from a discovery already run for the same page instead of streaming another', async () => {
        await render();
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-discover');
        completeDiscovery(discovered({ lists: [...discovered().lists, optIn('401', 'lf_newsletter_opt_in', 4000)] }));
        expect(discoverAudience, 'fixture precondition').toHaveBeenCalledTimes(1);

        click('campaigns-audience-event-generate');

        expect(discoverAudience, 'a second discovery stream was opened for the same page').toHaveBeenCalledTimes(1);
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-pending-401"]')).not.toBeNull();
      });

      it('offers late opt-ins by hand when another preset replaced the draft before they settled', async () => {
        await render();
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');
        (fixture.componentInstance as unknown as { onCreateForSignal: (signal: AudienceSignal) => void }).onCreateForSignal('project_opt_in');
        fixture.detectChanges();

        completeDiscovery(discovered({ lists: [optIn('401', 'lf_newsletter_opt_in', 4000)] }));

        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-pending-401"]'), 'stranded as pending').toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-add-401"]')).not.toBeNull();
      });

      it('holds attach and compose until the active draft opt-in lookup settles', async () => {
        await render({ briefId: 'brief-1' });
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');
        createDraftedList();

        expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-use-direct"]')?.disabled, 'attach ran before the opt-ins').toBe(true);
        expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled).toBe(true);

        completeDiscovery(discovered({ lists: [optIn('401', 'lf_newsletter_opt_in', 4000)] }));

        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]')).not.toBeNull();
        expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled).toBe(false);
      });

      it('drops the automatic opt-ins when the operator starts the builder over', async () => {
        await render();
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');
        completeDiscovery(discovered({ lists: [optIn('401', 'lf_newsletter_opt_in', 4000)] }));

        draftBuilder().startedOver.emit();
        fixture.detectChanges();
        createDraftedList('8888');

        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), "an abandoned draft's opt-ins joined an unrelated list").toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-add-401"]')).not.toBeNull();
      });

      it('stops calling a removed opt-in list added, and offers it again', async () => {
        await draftWith([optIn('401', 'lf_newsletter_opt_in', 4000)]);
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-added-401"]'), 'fixture precondition').not.toBeNull();

        click('campaigns-audience-remove-401');

        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-added-401"]')).toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-add-401"]')).not.toBeNull();
      });

      it('offers the opt-ins by hand when a list is picked from the search instead of the draft', async () => {
        await render();
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');
        completeDiscovery(discovered({ lists: [optIn('401', 'lf_newsletter_opt_in', 4000)] }));

        (fixture.componentInstance as unknown as { onUseExistingList: (list: { listId: string; name: string }) => void }).onUseExistingList({
          listId: '9999',
          name: 'Hand-picked list',
        });
        fixture.detectChanges();

        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-pending-401"]')).toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-add-401"]')).not.toBeNull();
      });

      it('does not add late opt-ins once the drafted list was removed', async () => {
        await render();
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');
        createDraftedList();
        click('campaigns-audience-remove-7777');

        completeDiscovery(discovered({ lists: [optIn('401', 'lf_newsletter_opt_in', 4000)] }));

        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), 'the opt-ins joined without the event audience').toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-add-401"]')).not.toBeNull();
      });

      it('never removes an opt-in list the operator added back by hand', async () => {
        await draftWith([optIn('401', 'lf_newsletter_opt_in', 4000)]);
        click('campaigns-audience-remove-401');
        click('campaigns-audience-opt-in-add-401');
        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), 'fixture precondition').not.toBeNull();

        click('campaigns-audience-event-generate');
        completeDiscovery(discovered({ lists: [optIn('401', 'lf_newsletter_opt_in', 4000)] }));

        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), 'a later draft removed a hand-picked list').not.toBeNull();
      });

      it('withdraws the auto-added opt-ins when the drafted list leaves Include, and offers them by hand', async () => {
        await draftWith([optIn('401', 'lf_newsletter_opt_in', 4000)]);
        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), 'fixture precondition').not.toBeNull();

        click('campaigns-audience-remove-7777');

        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), 'the opt-ins stayed without the event audience').toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-add-401"]')).not.toBeNull();
      });

      it('keeps the opt-ins with the earlier drafted list on a re-draft of the same page, never stranded as pending', async () => {
        await draftWith([optIn('401', 'lf_newsletter_opt_in', 4000)]);

        click('campaigns-audience-event-generate');
        completeDiscovery(discovered({ lists: [optIn('401', 'lf_newsletter_opt_in', 4000)] }));

        expect(host().querySelector('[data-testid="campaigns-audience-remove-7777"]')).not.toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-remove-401"]'), 'the opt-in left with the earlier list still included').not.toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-pending-401"]'), 'stranded as pending').toBeNull();
      });

      it('says which opt-in signal has no list', async () => {
        await draftWith([optIn('401', 'lf_newsletter_opt_in', 4000)]);

        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-missing-project_opt_in"]')).not.toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-opt-in-missing-lf_newsletter_opt_in"]')).toBeNull();
      });

      it('points to the search when the lookup fails', async () => {
        await render();
        typeEventUrl('https://events.example.org/synthetic-summit/');
        click('campaigns-audience-event-generate');
        stream.next({ type: 'error', data: 'portal unreachable' });
        fixture.detectChanges();

        expect(host().querySelector('[data-testid="campaigns-audience-opt-ins-failed"]')).not.toBeNull();
        expect(host().querySelector('[data-testid="campaigns-audience-discover-error"]'), 'the lookup failure was reported as a discovery').toBeNull();
      });
    });

    it('offers two tabs, opens on Build a new audience, and switches to existing lists', async () => {
      await render();

      const tabs = [...host().querySelectorAll('[data-testid^="campaigns-audience-mode-"]')].map((tab) => tab.textContent?.trim());
      expect(tabs).toEqual(['Build a new audience', 'Use existing lists']);
      expect(host().querySelector('[data-testid="campaigns-audience-mode-build"]')?.getAttribute('aria-selected')).toBe('true');
      expect(host().querySelector('[data-testid="campaigns-audience-event-panel"]'), 'the event-page draft lives in the Build tab').not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-custom"]')?.classList.contains('hidden'), 'and so does the description builder').toBe(
        false
      );
      expect(host().querySelector('[data-testid="campaigns-audience-reuse-view"]')?.classList.contains('hidden')).toBe(true);

      click('campaigns-audience-mode-reuse');

      expect(host().querySelector('[data-testid="campaigns-audience-reuse-view"]')?.classList.contains('hidden')).toBe(false);
      expect(host().querySelector('[data-testid="campaigns-audience-custom"]')?.classList.contains('hidden')).toBe(true);
    });

    it('uses an existing list without discovery, and loads the suppressions it needs', async () => {
      await render();
      searchAudienceLists.mockReturnValue(of([{ listId: '777', name: 'Synthetic Summit - Prospects', size: 10, hubspotUrl: 'https://app.hubspot.com/x/777' }]));
      const input = host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-use-existing-search"]');
      if (input === null) throw new Error('the existing-list search is not rendered');
      vi.useFakeTimers();
      try {
        input.value = 'prospects';
        input.dispatchEvent(new Event('input'));
        vi.advanceTimersByTime(AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS);
      } finally {
        vi.useRealTimers();
      }
      fixture.detectChanges();

      click('campaigns-audience-use-existing-777');

      expect(
        host().querySelector('[data-testid="campaigns-audience-remove-777"]'),
        'the Review step appears for a list chosen without discovery'
      ).not.toBeNull();
      expect(getAudienceSuppressionLists).toHaveBeenCalledWith('tlf', '', '', '');
    });

    it('adds a reused existing list to Include', async () => {
      await discover();

      (fixture.debugElement.query(By.directive(AudienceCustomBuilderComponent)).componentInstance as AudienceCustomBuilderComponent).reuse.emit({
        listId: '411',
        name: '25Q3 - Seoul - Mailable Contacts',
        hubspotUrl: 'https://app.hubspot.com/x/411',
      });
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-remove-411"]')).not.toBeNull();
    });

    it('counts the ticked suppressions exactly, and hides the count once they change', async () => {
      await discover();
      previewAudienceCount.mockReturnValue(of({ exact: true, count: 1234, estimate: 1300 }));

      click('campaigns-audience-suppression-count-run');

      expect(previewAudienceCount).toHaveBeenLastCalledWith('tlf', { listIds: expect.arrayContaining(['201']) });
      expect(host().querySelector('[data-testid="campaigns-audience-suppression-count-value"]')?.textContent).toContain('1,234');
    });
  });

  describe('layout', () => {
    function stepNumber(step: string): string {
      return host().querySelector(`[data-testid="campaigns-audience-step-${step}-step"]`)?.textContent?.trim() ?? '';
    }

    async function discoverInReuse(): Promise<void> {
      await render();
      click('campaigns-audience-mode-reuse');
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
    }

    it('numbers only the steps on screen in the Build tab', async () => {
      await render();
      (fixture.debugElement.query(By.directive(AudienceCustomBuilderComponent)).componentInstance as AudienceCustomBuilderComponent).reuse.emit({
        listId: '411',
        name: 'Synthetic Summit - Prospects',
        hubspotUrl: 'https://app.hubspot.com/x/411',
      });
      fixture.detectChanges();

      expect([stepNumber('exclude'), stepNumber('compose'), stepNumber('qa')], 'the Build tab read 3 → 6 → 2').toEqual(['1', '2', '3']);
    });

    it('numbers every step in order after a discovery', async () => {
      await discoverInReuse();

      expect(['discover', 'include', 'exclude', 'reuse', 'gaps', 'compose', 'qa'].map(stepNumber)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    });

    it('shows the most urgent notice and folds the rest behind a toggle', async () => {
      await render({ audienceReadFailed: true });
      fixture.componentRef.setInput('stagingInFlight', true);
      fixture.detectChanges();

      const failed = host().querySelector('[data-testid="campaigns-audience-read-failed"]');
      const staging = host().querySelector('[data-testid="campaigns-audience-staging-pause"]');
      expect(failed?.classList.contains('hidden'), 'the warning was not the one shown').toBe(false);
      expect(staging?.classList.contains('hidden'), 'the wait was shown beside the warning').toBe(true);
      expect(host().querySelector('[data-testid="campaigns-audience-readiness-toggle"]')?.textContent?.trim()).toBe('1 more');

      click('campaigns-audience-readiness-toggle');

      expect(staging?.classList.contains('hidden')).toBe(false);
    });

    it('re-reads the audience from the readiness banner', async () => {
      await render({ audienceReadFailed: true });
      let retried = 0;
      fixture.componentInstance.retryAudienceRead.subscribe(() => retried++);

      click('campaigns-audience-read-retry');

      expect(retried).toBe(1);
    });

    it('asks before composing, and composes nothing on cancel', async () => {
      await discoverInReuse();
      click('audience-card-grid-toggle-101');

      click('campaigns-audience-compose');
      expect(host().querySelector('[data-testid="campaigns-audience-compose-confirming"]')).not.toBeNull();
      click('campaigns-audience-compose-cancel');

      expect(composeAudienceMaster, 'the first click created lists').not.toHaveBeenCalled();
      expect(host().querySelector('[data-testid="campaigns-audience-compose-confirming"]')).toBeNull();
    });

    it('moves between the mode tabs with the arrow keys', async () => {
      await render();

      host()
        .querySelector('[role="tablist"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-mode-reuse"]')?.getAttribute('aria-selected')).toBe('true');
      expect(host().querySelector('[data-testid="campaigns-audience-mode-build"]')?.getAttribute('tabindex')).toBe('-1');
    });

    it('keeps the existing-list search to the Build tab', async () => {
      await render();
      click('campaigns-audience-mode-reuse');

      expect(host().querySelector('[data-testid="campaigns-audience-use-existing"]')?.classList.contains('hidden')).toBe(true);
    });
  });

  describe('end-to-end test fixes', () => {
    async function discover(result: Partial<AudienceDiscoveryResult> = {}): Promise<void> {
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit/');
      click('campaigns-audience-discover');
      completeDiscovery({ ...discovered(), ...result });
    }

    it('says how many lists discovery kept out of Include', async () => {
      await discover({ hidden: 4 });

      expect(host().querySelector('[data-testid="campaigns-audience-hidden-count"]')?.textContent).toContain('4 more list(s)');
    });

    it('gives QA the edition name, year included, so the current-registrants check runs', async () => {
      await discover();

      const qa = fixture.debugElement.query(By.css('lfx-audience-qa-panel')).componentInstance as { eventName: () => string };
      expect(qa.eventName()).toBe('Synthetic Summit 2026');
    });

    it('gives QA the planned event when no discovery ran', async () => {
      await render();
      (fixture.debugElement.query(By.directive(AudienceCustomBuilderComponent)).componentInstance as AudienceCustomBuilderComponent).eventPlanned.emit({
        eventName: 'AGNTCon + MCPCon Japan',
        brandShort: 'AAIF',
        eventDates: ['2026-09-10'],
      });
      fixture.detectChanges();

      const qa = fixture.debugElement.query(By.css('lfx-audience-qa-panel')).componentInstance as { eventName: () => string };
      expect(qa.eventName()).toBe('AGNTCon + MCPCon Japan 2026');
    });

    it('pre-fills speakers with the edition name, year included', async () => {
      await discover({ missingSignals: ['event_speakers'] });

      click('audience-missing-signals-create-event_speakers');

      expect(
        (fixture.debugElement.query(By.directive(AudienceCustomBuilderComponent)).componentInstance as AudienceCustomBuilderComponent).preset()
      ).toMatchObject({ criteria: { speakers: { eventNames: ['Synthetic Summit 2026'] } } });
    });
  });

  describe('standing suppressions, start-over and registrants (review fixes)', () => {
    const GDPR: AudienceSuppressionList = {
      key: 'lf_events_gdpr',
      label: 'LF Events GDPR',
      listId: '201',
      name: 'LF Events - GDPR Suppression',
      size: 5000,
      category: 'standard',
      hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
    };
    const OPT_OUT: AudienceSuppressionList = {
      key: 'global_opt_out',
      label: 'Global opt-out',
      listId: '202',
      name: 'Global Opt-out',
      size: 900,
      category: 'standard',
      hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/202',
    };
    const REGISTRANTS: AudienceSuppressionList = {
      key: 'current_registrants',
      label: 'Current registrants - Synthetic Summit 2026',
      listId: '',
      name: 'Synthetic Summit 2026 - Current Registrants',
      category: 'current_registrants',
      hubspotUrl: '',
      willCreate: true,
    };
    const STANDING: AudienceComposedList = { listId: '300', name: 'LFX Standard Suppressions - tlf', hubspotUrl: 'https://app.hubspot.com/l/300' };
    const AUDIENCE: CampaignAudience = { id: 'aud-9', briefId: 'brief-1', platform: 'hubspot', platformMasterListId: '101', status: 'built', version: 1 };

    async function discover(briefId = '', url = 'https://events.example.org/synthetic-summit'): Promise<void> {
      await render({ briefId });
      typeEventUrl(url);
      click('campaigns-audience-discover');
      completeDiscovery();
    }

    function builder(): AudienceCustomBuilderComponent {
      return fixture.debugElement.query(By.directive(AudienceCustomBuilderComponent)).componentInstance as AudienceCustomBuilderComponent;
    }

    it('says the shared standard list will be created while it does not exist, and links it once it does', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, OPT_OUT] }));
      await discover();
      expect(host().querySelector('[data-testid="audience-suppression-standard-will-create"]')).not.toBeNull();
      expect((fixture.componentInstance as unknown as { standingWillCreate: () => boolean }).standingWillCreate()).toBe(true);

      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, OPT_OUT], standardList: STANDING }));
      typeEventUrl('https://events.example.org/other');
      click('campaigns-audience-discover');
      completeDiscovery();
      expect(host().querySelector('[data-testid="audience-suppression-standard-will-create"]')).toBeNull();
      expect(host().querySelector('[data-testid="audience-suppression-standard-standing-link"]')?.textContent?.trim()).toBe(STANDING.name);
    });

    it('says which lists an attach created: the standing list on first use and the registrants list', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS] }));
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' },
          suppressionListIds: ['300', '9001'],
          standardSuppression: STANDING,
          audience: AUDIENCE,
        })
      );
      const loadsBefore = getAudienceSuppressionLists.mock.calls.length;

      useSelectionDirectly();

      const text = host().querySelector('[data-testid="campaigns-audience-attach-created"]')?.textContent ?? '';
      expect(text).toContain(`the project's shared standard suppression list "${STANDING.name}"`);
      expect(text).toContain('"Synthetic Summit 2026 - Current Registrants"');
      expect(text).not.toContain('No new list was created');
      expect(getAudienceSuppressionLists.mock.calls.length, 'the created lists are reloaded to show their ids').toBeGreaterThan(loadsBefore);
    });

    it('says nothing was created when the standing list already existed and no registrants list was asked for', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR], standardList: STANDING }));
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(
        of({ master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' }, suppressionListIds: ['300'], standardSuppression: STANDING, audience: AUDIENCE })
      );

      useSelectionDirectly();

      const text = host().querySelector('[data-testid="campaigns-audience-attach-created"]')?.textContent ?? '';
      expect(text).toContain('No new list was created in HubSpot');
      expect(text).toContain('reused');
    });

    it('asks before a Discover wipes hand-built work, and keeps it on cancel', async () => {
      await render();
      builder().created.emit({ listId: '7777', name: 'Seoul', hubspotUrl: 'https://app.hubspot.com/x/7777' });
      fixture.detectChanges();
      typeEventUrl('https://events.example.org/synthetic-summit');

      click('campaigns-audience-discover');
      expect(discoverAudience, 'discovery ran over hand-built work without asking').not.toHaveBeenCalled();
      expect(host().querySelector('[data-testid="campaigns-audience-start-over-discover"]')).not.toBeNull();

      click('campaigns-audience-start-over-cancel');
      expect(host().querySelector('[data-testid="campaigns-audience-remove-7777"]'), 'cancel wiped the work').not.toBeNull();

      click('campaigns-audience-discover');
      click('campaigns-audience-start-over-confirm');
      expect(discoverAudience).toHaveBeenCalledTimes(1);
      expect(host().querySelector('[data-testid="campaigns-audience-remove-7777"]')).toBeNull();
    });

    it('discovers straight away when there is no hand work', async () => {
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      expect(discoverAudience).toHaveBeenCalledTimes(1);
      expect(host().querySelector('[data-testid="campaigns-audience-start-over-discover"]')).toBeNull();
    });

    it('does not mix a draft from another event page with the lists discovered for the first', async () => {
      await discover();
      typeEventUrl('https://events.example.org/other-event');

      click('campaigns-audience-event-generate');
      expect(builder().preset(), 'drafted without asking over another event').toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-start-over-draft"]')).not.toBeNull();

      click('campaigns-audience-start-over-confirm');
      expect(builder().preset()).toMatchObject({ eventUrl: 'https://events.example.org/other-event' });
      // Discovery's event no longer drives QA or the registrants suppression: the draft's will.
      const qa = fixture.debugElement.query(By.css('lfx-audience-qa-panel')).componentInstance as { eventName: () => string };
      expect(qa.eventName()).toBe('');
      expect(host().querySelector('[data-testid="campaigns-audience-identity"]')).toBeNull();
    });

    it('drafts directly from the event page it discovered', async () => {
      await discover();
      click('campaigns-audience-event-generate');
      expect(host().querySelector('[data-testid="campaigns-audience-start-over-draft"]')).toBeNull();
      expect(builder().preset()).toMatchObject({ eventUrl: 'https://events.example.org/synthetic-summit' });
    });

    it('explains that a current-registrants list still to be created cannot be the only suppression', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS] }));
      await discover('brief-1');
      toggleStandardRow('lf_events_gdpr');

      const required = host().querySelector('[data-testid="campaigns-audience-suppression-required"]')?.textContent ?? '';
      expect(required).toContain("current-registrants list cannot be the send's only suppression");
      expect(required).not.toContain('Select at least one suppression list');
    });

    it('removes the standard suppressions as one group from the review step', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, OPT_OUT] }));
      await discover();
      expect(host().querySelector('[data-testid="campaigns-audience-remove-exclude-lf_events_gdpr"]'), 'a standard row has its own chip').toBeNull();

      click('campaigns-audience-remove-exclude-group:standard');

      expect(host().querySelector<HTMLInputElement>('[data-testid="audience-suppression-grid-toggle-standard"]')?.checked).toBe(false);
      expect(host().querySelector<HTMLInputElement>('[data-testid="audience-suppression-grid-toggle-standard"]')?.indeterminate).toBe(false);
    });

    const CONFLICT_MESSAGE = 'A HubSpot list "LFX Standard Suppressions - tlf" (id 4242) already uses this name. Rename or remove it in HubSpot.';
    const conflict = (): HttpErrorResponse => new HttpErrorResponse({ status: 409, error: { error: CONFLICT_MESSAGE, code: 'CONFLICT' } });

    it('shows a 409 squatted-name compose as an actionable conflict, held until the operator fixes it', async () => {
      await discover();
      click('audience-card-grid-toggle-101');
      composeAudienceMaster.mockReturnValue(throwError(conflict));

      composeMaster();

      expect(host().querySelector('[data-testid="campaigns-audience-name-conflict-message"]')?.textContent?.trim()).toBe(CONFLICT_MESSAGE);
      expect(host().querySelector('[data-testid="campaigns-audience-compose-error"]'), 'shown as a dead-end error').toBeNull();
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled, 'a plain retry gets the same 409').toBe(true);
      const loads = getAudienceSuppressionLists.mock.calls.length;

      click('campaigns-audience-name-conflict-resolved');

      expect(host().querySelector('[data-testid="campaigns-audience-name-conflict"]')).toBeNull();
      expect(
        host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled,
        'no master was created, so compose is free again'
      ).toBe(false);
      expect(getAudienceSuppressionLists.mock.calls.length, 'the rows are reloaded after the fix').toBe(loads + 1);
    });

    it('holds attach on a 409 squatted-name conflict instead of offering a plain retry', async () => {
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(throwError(conflict));

      useSelectionDirectly();

      expect(host().querySelector('[data-testid="campaigns-audience-name-conflict-message"]')?.textContent?.trim()).toBe(CONFLICT_MESSAGE);
      expect(host().querySelector('[data-testid="campaigns-audience-attach-error"]')).toBeNull();
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-use-direct"]')?.disabled).toBe(true);

      click('campaigns-audience-name-conflict-resolved');
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-use-direct"]')?.disabled).toBe(false);
    });

    it("matches the recorded attach on the response's suppression ids, not the ids it sent", async () => {
      // Upstream records the standing list in place of the standard rows and appends the
      // registrants list it created, so the sent ids never equal the recorded ones.
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, OPT_OUT, REGISTRANTS] }));
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      getAudienceSuppressionLists.mockReturnValue(
        of({ lists: [GDPR, OPT_OUT, { ...REGISTRANTS, listId: '9001', willCreate: undefined }], standardList: STANDING })
      );
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' },
          suppressionListIds: ['300', '9001'],
          standardSuppression: STANDING,
          audience: AUDIENCE,
        })
      );

      useSelectionDirectly();

      expect(attachExistingAudience.mock.calls.at(-1)?.[1].suppressionListIds).toEqual(['201', '202']);
      const tab = fixture.componentInstance as unknown as { attachedMasterId: () => string | null; attachedExclusions: () => readonly string[] };
      expect([...tab.attachedExclusions()].sort()).toEqual(['201', '202', '9001']);
      expect(tab.attachedMasterId(), 'the recorded attach read as different from the ticks it was made from').toBe('101');
    });

    it('sends a ticked EXISTING registrants list as its edition, never as a plain suppression id', async () => {
      const existing: AudienceSuppressionList = { ...REGISTRANTS, listId: '9001', willCreate: undefined, hubspotUrl: 'https://app.hubspot.com/l/9001' };
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, existing] }));
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(
        of({ master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' }, suppressionListIds: ['201', '9001'], audience: AUDIENCE })
      );

      useSelectionDirectly();

      const attach = attachExistingAudience.mock.calls.at(-1)?.[1];
      expect(attach.suppressionListIds).toEqual(['201']);
      expect(attach.currentRegistrantsEvent).toBe('Synthetic Summit 2026');
      // Nothing new: the registrants list already existed.
      expect(host().querySelector('[data-testid="campaigns-audience-attach-created"]')?.textContent).not.toContain('Current Registrants');
    });

    it('composes with a ticked existing registrants list as its edition too', async () => {
      const existing: AudienceSuppressionList = { ...REGISTRANTS, listId: '9001', willCreate: undefined };
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, existing] }));
      await discover();
      click('audience-card-grid-toggle-101');
      composeAudienceMaster.mockReturnValue(NEVER);

      composeMaster();

      const compose = composeAudienceMaster.mock.calls.at(-1)?.[1];
      expect(compose.excludeListIds).toEqual(['201']);
      expect(compose.currentRegistrantsEvent).toBe('Synthetic Summit 2026');
    });

    it("states the compose's excluded lists from its result, and still renders without them", async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, OPT_OUT, REGISTRANTS] }));
      await discover();
      click('audience-card-grid-toggle-101');
      const master = { listId: '900', name: 'Master', hubspotUrl: 'https://app.hubspot.com/l/900' };
      composeAudienceMaster.mockReturnValue(
        of({ master, suppression: STANDING, sourceListIds: ['101'], suppressionListIds: ['300', '9001'], recorded: false })
      );

      composeMaster();

      const text = host().querySelector('[data-testid="campaigns-audience-compose-suppression"]')?.textContent ?? '';
      expect(text).toContain('It excludes 2 suppression list(s).');
      expect(text).toContain(`the project's shared standard suppression list "${STANDING.name}"`);
      expect(text).toContain('"Synthetic Summit 2026 - Current Registrants"');
    });

    it('renders an older compose result that reports no suppression ids', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR], standardList: STANDING }));
      await discover();
      click('audience-card-grid-toggle-101');
      composeAudienceMaster.mockReturnValue(
        of({ master: { listId: '900', name: 'Master', hubspotUrl: 'u' }, suppression: STANDING, sourceListIds: ['101'], recorded: false })
      );

      composeMaster();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-result"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-compose-suppression"]'), 'nothing known, nothing claimed').toBeNull();
    });

    it('queues a suppression reload asked for while a load is on the wire', async () => {
      await discover();
      const slow = new Subject<AudienceSuppressionList[]>();
      getAudienceSuppressionLists.mockReturnValue(slow);
      const tab = fixture.componentInstance as unknown as { reloadSuppressionRows: () => void };
      tab.reloadSuppressionRows();
      const calls = getAudienceSuppressionLists.mock.calls.length;

      tab.reloadSuppressionRows();
      expect(getAudienceSuppressionLists.mock.calls.length, 'a second load overlapped the first').toBe(calls);

      getAudienceSuppressionLists.mockReturnValue(of([GDPR]));
      slow.next([GDPR]);
      slow.complete();
      expect(getAudienceSuppressionLists.mock.calls.length, 'the queued reload was dropped').toBe(calls + 1);
    });
  });

  describe('event URL state and recorded matches (pre-PR review)', () => {
    const GDPR: AudienceSuppressionList = {
      key: 'lf_events_gdpr',
      label: 'LF Events GDPR',
      listId: '201',
      name: 'LF Events - GDPR Suppression',
      size: 5000,
      category: 'standard',
      hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
    };
    const STANDING: AudienceComposedList = { listId: '300', name: 'LFX Standard Suppressions - tlf', hubspotUrl: 'https://app.hubspot.com/l/300' };

    function disabled(testId: string): boolean | undefined {
      return host().querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.disabled;
    }

    it('enables Generate and Discover after a reseed fills an emptied field', async () => {
      await render();
      fixture.componentRef.setInput('eventKey', 'event-a');
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/a');
      fixture.detectChanges();
      typeEventUrl('');
      expect(disabled('campaigns-audience-discover'), 'fixture precondition').toBe(true);

      // A different event's brief reseeds the typed (dirty) field without emitting.
      fixture.componentRef.setInput('eventKey', 'event-b');
      fixture.componentRef.setInput('initialEventUrl', 'https://events.example.org/b');
      fixture.detectChanges();

      expect(host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-event-url"]')?.value).toBe('https://events.example.org/b');
      expect(disabled('campaigns-audience-discover'), 'Discover judged the stale empty URL').toBe(false);
      expect(disabled('campaigns-audience-event-generate'), 'Generate judged the stale empty URL').toBe(false);
    });

    it('disables Generate and Discover when a project switch empties the field', async () => {
      await render();
      typeEventUrl('https://events.example.org/a');
      expect(disabled('campaigns-audience-discover'), 'fixture precondition').toBe(false);

      fixture.componentRef.setInput('projectSlug', 'other');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(disabled('campaigns-audience-discover')).toBe(true);
      expect(disabled('campaigns-audience-event-generate')).toBe(true);
    });

    it('keeps matching a recorded attach on its standing list when the reload after it fails', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR] }));
      await render({ briefId: 'brief-1' });
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');
      getAudienceSuppressionLists.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' },
          suppressionListIds: ['300'],
          standardSuppression: STANDING,
          audience: { id: 'aud-9', briefId: 'brief-1', platform: 'hubspot', platformMasterListId: '101', status: 'built', version: 1 },
        })
      );

      useSelectionDirectly();

      const tab = fixture.componentInstance as unknown as { attachedMasterId: () => string | null; attachedExclusions: () => readonly string[] };
      expect(getAudienceSuppressionLists.mock.calls.length, 'the post-attach reload ran').toBeGreaterThan(1);
      expect([...tab.attachedExclusions()]).toEqual(['201']);
      expect(tab.attachedMasterId(), 'a failed reload made the recorded attach read as stale').toBe('101');
    });
  });

  describe('final campaign-service contract (cs#396)', () => {
    async function discover(briefId = ''): Promise<void> {
      await render({ briefId });
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
      click('audience-card-grid-toggle-101');
    }

    const refusal = (message: string): HttpErrorResponse => new HttpErrorResponse({ status: 400, error: { error: message, code: 'BAD_REQUEST' } });

    it("shows upstream's 400 for a compose and lets the operator fix it and compose again", async () => {
      await discover();
      const message = 'the master would carry 2,601 filter conditions (51 lists x 51); the limit is 2,500';
      composeAudienceMaster.mockReturnValue(throwError(() => refusal(message)));

      composeMaster();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-error"]')?.textContent?.trim()).toBe(message);
      expect(
        host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled,
        'a 400 created nothing, so compose must not stay locked'
      ).toBe(false);
    });

    it('keeps compose locked after a failure that may have created something', async () => {
      await discover();
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'boom', code: 'INTERNAL_ERROR' } })));

      composeMaster();

      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]')?.disabled).toBe(true);
    });

    it("shows upstream's overlap 400 for an attach", async () => {
      await discover('brief-1');
      const message = 'list 300 (LFX Standard Suppressions - tlf) is in both the send and its suppressions';
      attachExistingAudience.mockReturnValue(throwError(() => refusal(message)));

      useSelectionDirectly();

      expect(host().querySelector('[data-testid="campaigns-audience-attach-error"]')?.textContent?.trim()).toBe(message);
    });

    it('never tells the operator to delete a suppression list from a compose partial', async () => {
      await discover();
      const partial: AudienceComposeMasterPartial = {
        error: 'Master list create failed',
        suppression: { listId: '99', name: 'Legacy suppression', hubspotUrl: 'https://app.hubspot.com/l/99' },
      };
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: partial })));

      composeMaster();

      const text = host().querySelector('[data-testid="campaigns-audience-compose-partial"]')?.textContent ?? '';
      expect(text).toContain('Legacy suppression');
      expect(text.toLowerCase()).not.toContain('orphaned');
      expect(text).not.toMatch(/\bDelete it\b/);
    });

    it('shows only the master for the recording partial, with no suppression line', async () => {
      await discover('brief-1');
      const partial: AudienceComposeMasterPartial = {
        error: 'Lists created but not attached.',
        master: { listId: '900', name: 'Master', hubspotUrl: 'https://app.hubspot.com/l/900' },
      };
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: partial })));

      composeMaster();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-partial"]')).not.toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-compose-partial-suppression-link"]')).toBeNull();
    });
  });

  describe('attach confirmation, compose withdrawal and reach label (review fixes)', () => {
    const GDPR: AudienceSuppressionList = {
      key: 'lf_events_gdpr',
      label: 'LF Events GDPR',
      listId: '201',
      name: 'LF Events - GDPR Suppression',
      size: 5000,
      category: 'standard',
      hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
    };
    const REGISTRANTS: AudienceSuppressionList = {
      key: 'current_registrants',
      label: 'Current registrants - Synthetic Summit 2026',
      listId: '',
      name: 'Synthetic Summit 2026 - Current Registrants',
      category: 'current_registrants',
      hubspotUrl: '',
      willCreate: true,
    };
    const STANDING: AudienceComposedList = { listId: '300', name: 'LFX Standard Suppressions - tlf', hubspotUrl: 'https://app.hubspot.com/l/300' };
    const AUDIENCE: CampaignAudience = { id: 'aud-9', briefId: 'brief-1', platform: 'hubspot', platformMasterListId: '101', status: 'built', version: 1 };

    async function discover(briefId = ''): Promise<void> {
      await render({ briefId });
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
    }

    function note(): string {
      return host().querySelector('[data-testid="campaigns-audience-use-direct-note"]')?.textContent ?? '';
    }

    it('says nothing is created only when nothing is, and asks before an attach that creates lists', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS] }));
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' },
          suppressionListIds: ['300', '9001'],
          standardSuppression: STANDING,
          audience: AUDIENCE,
        })
      );

      expect(note()).not.toContain('Nothing new is created');
      expect(note()).toContain("the project's shared standard suppression list");
      expect(note()).toContain('"Synthetic Summit 2026 - Current Registrants"');

      click('campaigns-audience-use-direct');
      expect(attachExistingAudience, 'an attach that creates lists ran without asking').not.toHaveBeenCalled();
      const confirming = host().querySelector('[data-testid="campaigns-audience-use-direct-confirming"]')?.textContent ?? '';
      expect(confirming).toContain('Synthetic Summit 2026 - Current Registrants');

      click('campaigns-audience-use-direct-confirm');
      expect(attachExistingAudience).toHaveBeenCalledTimes(1);
    });

    it('attaches straight away when nothing would be created', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR], standardList: STANDING }));
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(NEVER);

      expect(note()).toContain('Nothing new is created in HubSpot');
      click('campaigns-audience-use-direct');
      expect(attachExistingAudience).toHaveBeenCalledTimes(1);
    });

    it('withdraws an open attach confirmation when the suppression ticks change', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS] }));
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      click('campaigns-audience-use-direct');
      expect(host().querySelector('[data-testid="campaigns-audience-use-direct-confirming"]')).not.toBeNull();

      click('audience-suppression-grid-toggle-current_registrants');

      expect(host().querySelector('[data-testid="campaigns-audience-use-direct-confirming"]'), 'confirmed a request that changed').toBeNull();
    });

    it('withdraws an open compose confirmation when a reload fills in a suppression id', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS] }));
      await discover();
      click('audience-card-grid-toggle-101');
      click('campaigns-audience-compose');
      const creates = host().querySelector('[data-testid="campaigns-audience-compose-confirm-creates"]')?.textContent ?? '';
      expect(creates, 'the confirmation did not name the lists compose creates').toContain('Synthetic Summit 2026 - Current Registrants');

      // A reload (e.g. after another write created it) resolves the registrants list's id.
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, { ...REGISTRANTS, listId: '9001', willCreate: undefined }] }));
      (fixture.componentInstance as unknown as { reloadSuppressionRows: () => void }).reloadSuppressionRows();
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-confirming"]'), 'confirmed a compose whose request changed').toBeNull();
    });

    it('asks before a step-4 master attach that creates lists, and says so in the reuse note', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS], standardList: STANDING }));
      getAudienceExistingMasterLists.mockReturnValue(of([{ listId: '501', name: 'Synthetic Summit - Master', size: 3000, hubspotUrl: 'u' }]));
      await discover('brief-1');
      attachExistingAudience.mockReturnValue(NEVER);

      expect(host().querySelector('[data-testid="audience-last-sent-attach-note"]')?.textContent).toContain('Synthetic Summit 2026 - Current Registrants');

      click('audience-last-sent-master-use-501');
      expect(attachExistingAudience, 'a reuse attach that creates a list ran without asking').not.toHaveBeenCalled();
      expect(host().querySelector('[data-testid="campaigns-audience-reuse-attach-confirming"]')?.textContent).toContain('Synthetic Summit - Master');

      click('campaigns-audience-reuse-attach-confirm');
      expect(attachExistingAudience).toHaveBeenCalledTimes(1);
      expect(attachExistingAudience.mock.calls[0][1]).toMatchObject({ masterListId: '501', currentRegistrantsEvent: 'Synthetic Summit 2026' });
    });

    it('attaches a step-4 master straight away when nothing would be created', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR], standardList: STANDING }));
      getAudienceExistingMasterLists.mockReturnValue(of([{ listId: '501', name: 'Synthetic Summit - Master', size: 3000, hubspotUrl: 'u' }]));
      await discover('brief-1');
      attachExistingAudience.mockReturnValue(NEVER);

      expect(host().querySelector('[data-testid="audience-last-sent-attach-note"]')?.textContent).toContain('nothing new is created');
      click('audience-last-sent-master-use-501');
      expect(attachExistingAudience).toHaveBeenCalledTimes(1);
    });

    it('counts the standard rows as the one standing list in the compose confirmation', async () => {
      const optOut: AudienceSuppressionList = { ...GDPR, key: 'global_opt_out', listId: '202', name: 'Global Opt-out' };
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, optOut, REGISTRANTS], standardList: STANDING }));
      await discover();
      click('audience-card-grid-toggle-101');

      click('campaigns-audience-compose');

      // Upstream reports [standing, registrants]: two lists, not the three rows ticked.
      expect(host().querySelector('#audience-compose-confirm-title')?.textContent).toContain('excluding 2?');
    });

    it('shows the excluded count as a dash while the suppression rows load', async () => {
      const pending = new Subject<AudienceSuppressionList[]>();
      getAudienceSuppressionLists.mockReturnValue(pending);
      await discover();
      click('audience-card-grid-toggle-101');

      expect(host().querySelector('[data-testid="campaigns-audience-summary-bar-excluded"]')?.textContent?.trim()).toBe('—');
      expect(host().querySelector('[data-testid="campaigns-audience-summary-excluded"]')?.textContent?.trim()).toBe('—');

      pending.next([GDPR]);
      pending.complete();
      fixture.detectChanges();
      expect(host().querySelector('[data-testid="campaigns-audience-summary-bar-excluded"]')?.textContent?.trim()).toBe('1');
    });

    it('labels the summary bar by what the reach figure is', async () => {
      await discover();
      click('audience-card-grid-toggle-101');
      const label = (): string => host().querySelector('[data-testid="campaigns-audience-summary-bar-reach-label"]')?.textContent?.trim() ?? '';
      expect(label(), 'every included list reported a size, so the sum is an upper bound').toBe('Reach (at most)');

      previewAudienceCount.mockReturnValue(of({ exact: true, estimate: 1200, count: 1200, reason: '' }));
      click('campaigns-audience-preview-count');
      expect(label()).toBe('Reach before exclusions');

      previewAudienceCount.mockReturnValue(of({ exact: false, estimate: 1200, count: 0, reason: 'degraded' }));
      click('campaigns-audience-preview-count');
      expect(label()).toBe('Reach estimate before exclusions');
    });

    it('labels the review summary the same way as the summary bar, never an estimate as exact', async () => {
      await discover();
      click('audience-card-grid-toggle-101');
      const summaryLabel = (): string => host().querySelector('[data-testid="campaigns-audience-summary-reach-label"]')?.textContent?.trim() ?? '';
      const barLabel = (): string => host().querySelector('[data-testid="campaigns-audience-summary-bar-reach-label"]')?.textContent?.trim() ?? '';

      previewAudienceCount.mockReturnValue(of({ exact: false, estimate: 1200, count: 0, reason: 'degraded' }));
      click('campaigns-audience-preview-count');
      expect(summaryLabel()).toBe('Reach estimate before exclusions');
      expect(summaryLabel()).toBe(barLabel());

      previewAudienceCount.mockReturnValue(of({ exact: true, estimate: 1200, count: 1200, reason: '' }));
      click('campaigns-audience-preview-count');
      expect(summaryLabel()).toBe('Reach before exclusions');
    });

    it('calls a sum over only some lists partial, not a reach', async () => {
      await discover();
      click('audience-card-grid-toggle-101');
      (fixture.componentInstance as unknown as { add: (id: string, name: string) => void }).add('555', 'Unsized list');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-summary-bar-reach-label"]')?.textContent?.trim()).toBe('Known sizes (1 of 2 lists)');
    });
  });

  describe('PR review fixes (#4461)', () => {
    const GDPR: AudienceSuppressionList = {
      key: 'lf_events_gdpr',
      label: 'LF Events GDPR',
      listId: '201',
      name: 'LF Events - GDPR Suppression',
      size: 5000,
      category: 'standard',
      hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
    };
    const REGISTRANTS: AudienceSuppressionList = {
      key: 'current_registrants',
      label: 'Current registrants - Synthetic Summit 2026',
      listId: '',
      name: 'Synthetic Summit 2026 - Current Registrants',
      category: 'current_registrants',
      hubspotUrl: '',
      willCreate: true,
    };
    const STANDING: AudienceComposedList = { listId: '300', name: 'LFX Standard Suppressions - tlf', hubspotUrl: 'https://app.hubspot.com/l/300' };
    const AUDIENCE: CampaignAudience = { id: 'aud-9', briefId: 'brief-1', platform: 'hubspot', platformMasterListId: '101', status: 'built', version: 1 };

    async function discover(briefId = ''): Promise<void> {
      await render({ briefId });
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
    }

    it('keeps the attach matched when the reload after creating the registrants list fails', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS], standardList: STANDING }));
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      getAudienceSuppressionLists.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' },
          suppressionListIds: ['300', '9001'],
          standardSuppression: STANDING,
          audience: AUDIENCE,
        })
      );

      useSelectionDirectly();

      const tab = fixture.componentInstance as unknown as { attachedMasterId: () => string | null };
      expect(tab.attachedMasterId(), 'the saved audience read as stale after a failed reload').toBe('101');
    });

    it('sends QA the suppression ids the attach recorded, the standing list as itself', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR], standardList: STANDING }));
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(
        of({ master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' }, suppressionListIds: ['300'], standardSuppression: STANDING, audience: AUDIENCE })
      );

      click('campaigns-audience-use-direct');

      const qa = fixture.debugElement.query(By.css('lfx-audience-qa-panel')).componentInstance as { sendSuppressionIds: () => readonly string[] };
      expect([...qa.sendSuppressionIds()]).toEqual(['300']);
    });

    it('reads a reused past send that excluded the standing list as the same lists once it is attached', async () => {
      const send: AudienceLastSentEmail = {
        emailId: 'em-8',
        emailName: 'Synthetic Summit 2026 - Reminder',
        sentAt: '2026-02-10T15:00:00Z',
        hubspotUrl: 'https://app.hubspot.com/email/1/details/em-8/performance',
        includedLists: [{ listId: '501', name: 'Synthetic Summit - Prospects', size: 3000, missing: false }],
        suppressionLists: [{ listId: '300', name: STANDING.name, size: 10, missing: false }],
      };
      getAudienceLastSent.mockReturnValue(of([send]));
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR], standardList: STANDING }));
      await discover('brief-1');
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '501', name: 'Synthetic Summit - Prospects', hubspotUrl: 'u' },
          suppressionListIds: ['300'],
          standardSuppression: STANDING,
          audience: { ...AUDIENCE, platformMasterListId: '501' },
        })
      );

      click('audience-last-sent-use-em-8');

      expect(host().querySelector('[data-testid="audience-last-sent-use-em-8"]')?.textContent).toContain('Same lists used for this email');
    });

    it('unticks a current-registrants row a reload no longer carries, so its old id is not sent', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, { ...REGISTRANTS, listId: '9001', willCreate: undefined }] }));
      await discover();
      const tab = fixture.componentInstance as unknown as { excludeIds: () => readonly string[]; reloadSuppressionRows: () => void };
      expect(tab.excludeIds(), 'fixture precondition').toContain('9001');

      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR] }));
      tab.reloadSuppressionRows();
      fixture.detectChanges();

      expect(tab.excludeIds()).not.toContain('9001');
    });

    it('says the exact suppression count leaves out a registrants list still to be created', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS] }));
      await discover();
      previewAudienceCount.mockReturnValue(of({ exact: true, estimate: 5000, count: 5000, reason: '' }));

      click('campaigns-audience-suppression-count-run');

      expect(host().querySelector('[data-testid="campaigns-audience-suppression-count-omits-registrants"]')).not.toBeNull();
    });

    it('recognises the standing list in a compose partial by id, not only by name', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR], standardList: STANDING }));
      await discover();
      click('audience-card-grid-toggle-101');
      const partial: AudienceComposeMasterPartial = { error: 'Master list create failed', suppression: { ...STANDING, name: 'Renamed standing list' } };
      composeAudienceMaster.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: partial })));

      composeMaster();

      expect(host().querySelector('[data-testid="campaigns-audience-compose-partial"]')?.textContent).toContain("project's shared standard suppression list");
    });

    it('reads a year joined to the event name, as campaign-service does, and does not add a second', async () => {
      await render();
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      stream.next({ type: 'event', data: { eventName: 'Synthetic Summit2026', brandShort: 'SYN', eventDates: ['2026-03-02'] } });
      stream.next({ type: 'discovered', data: discovered() });
      stream.next({ type: 'done', data: {} });
      fixture.detectChanges();

      expect(getAudienceSuppressionLists).toHaveBeenLastCalledWith('tlf', 'SYN', 'Synthetic Summit2026', 'Synthetic Summit2026');
    });

    it('offers a read-only reload of the suppression lists after a failed load', async () => {
      getAudienceSuppressionLists.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));
      await discover();
      expect(host().querySelector('[data-testid="audience-suppression-error"]'), 'fixture precondition').not.toBeNull();

      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR], standardList: STANDING }));
      click('campaigns-audience-suppression-retry');

      expect(host().querySelector('[data-testid="audience-suppression-error"]')).toBeNull();
      expect(host().querySelector('[data-testid="campaigns-audience-suppression-retry"]')).toBeNull();
      expect(discoverAudience, 'the retry re-ran discovery').toHaveBeenCalledTimes(1);
    });

    it('unticks a vanished registrants row even when a failed load came between', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, { ...REGISTRANTS, listId: '9001', willCreate: undefined }] }));
      await discover();
      const tab = fixture.componentInstance as unknown as { excludeIds: () => readonly string[]; reloadSuppressionRows: () => void };
      getAudienceSuppressionLists.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));
      tab.reloadSuppressionRows();
      fixture.detectChanges();

      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR] }));
      click('campaigns-audience-suppression-retry');

      expect(tab.excludeIds(), 'the old registrants id survived the failed load').not.toContain('9001');
    });

    it('matches a partial-standard reuse whose recorded ids keep the standing list as itself', async () => {
      const OPT_OUT: AudienceSuppressionList = { ...GDPR, key: 'global_opt_out', listId: '202', name: 'Global Opt-out' };
      const send: AudienceLastSentEmail = {
        emailId: 'em-8',
        emailName: 'Synthetic Summit 2026 - Reminder',
        sentAt: '2026-02-10T15:00:00Z',
        hubspotUrl: 'https://app.hubspot.com/email/1/details/em-8/performance',
        includedLists: [{ listId: '501', name: 'Synthetic Summit - Prospects', size: 3000, missing: false }],
        suppressionLists: [{ listId: '300', name: STANDING.name, size: 10, missing: false }],
      };
      getAudienceLastSent.mockReturnValue(of([send]));
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, OPT_OUT], standardList: STANDING }));
      await discover('brief-1');
      toggleStandardRow('global_opt_out');
      attachExistingAudience.mockReturnValue(
        of({
          master: { listId: '501', name: 'Synthetic Summit - Prospects', hubspotUrl: 'u' },
          suppressionListIds: ['300', '201'],
          audience: { ...AUDIENCE, platformMasterListId: '501' },
        })
      );

      click('audience-last-sent-use-em-8');

      expect(host().querySelector('[data-testid="audience-last-sent-use-em-8"]')?.textContent).toContain('Same lists used for this email');
    });

    it('treats a newly ticked registrants list still to be created as a change from the recorded audience', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS], standardList: STANDING }));
      await discover('brief-1');
      click('audience-suppression-grid-toggle-current_registrants');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(
        of({ master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' }, suppressionListIds: ['300'], standardSuppression: STANDING, audience: AUDIENCE })
      );
      click('campaigns-audience-use-direct');
      const tab = fixture.componentInstance as unknown as { attachedMasterId: () => string | null };
      expect(tab.attachedMasterId(), 'fixture precondition').toBe('101');

      click('audience-suppression-grid-toggle-current_registrants');

      expect(tab.attachedMasterId(), 'a pending registrants exclusion read as already recorded').toBeNull();
    });

    it('says the suppression is too large to count exactly instead of sending a refused count', async () => {
      const many: AudienceSuppressionList[] = Array.from({ length: 50 }, (_, i) => ({
        key: `brand_${i}`,
        label: `Brand opt-out ${i}`,
        listId: String(400 + i),
        name: `Brand opt-out ${i}`,
        size: 10,
        category: 'brand',
        hubspotUrl: '',
      }));
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, ...many], standardList: STANDING }));
      await discover();

      click('campaigns-audience-suppression-count-run');

      expect(previewAudienceCount, 'a count over the 50-list limit was sent').not.toHaveBeenCalled();
      expect(host().querySelector('[data-testid="campaigns-audience-suppression-count-too-many"]')?.textContent).toContain('52');
      expect(host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-suppression-count-run"]')?.disabled).toBe(true);
    });

    it('counts the standing list beside the standard rows once it exists', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR], standardList: STANDING }));
      await discover();
      previewAudienceCount.mockReturnValue(of({ exact: true, estimate: 5100, count: 5100, reason: '' }));

      click('campaigns-audience-suppression-count-run');

      // Both: the standing list can hold older standard lists, and a newly resolved row is only
      // added to it by the next attach or compose.
      expect(previewAudienceCount).toHaveBeenLastCalledWith('tlf', { listIds: ['300', '201'] });
      expect(host().querySelector('[data-testid="campaigns-audience-suppression-count-value"]')?.textContent).toContain('5,100');
    });

    it('asks before a draft for another event page replaces a Build-tab list drafted for the first', async () => {
      await render();
      typeEventUrl('https://events.example.org/a');
      click('campaigns-audience-event-generate');
      (fixture.debugElement.query(By.directive(AudienceCustomBuilderComponent)).componentInstance as AudienceCustomBuilderComponent).created.emit({
        listId: '7777',
        name: 'Event A audience',
        hubspotUrl: 'https://app.hubspot.com/x/7777',
      });
      fixture.detectChanges();

      typeEventUrl('https://events.example.org/b');
      click('campaigns-audience-event-generate');

      expect(host().querySelector('[data-testid="campaigns-audience-start-over-draft"]'), "B's draft kept A's list without asking").not.toBeNull();
      click('campaigns-audience-start-over-confirm');
      expect(host().querySelector('[data-testid="campaigns-audience-remove-7777"]')).toBeNull();
    });

    it('does not write the event URL back into the input being typed in', async () => {
      await render();
      const control = (fixture.componentInstance as unknown as { eventUrlControl: { setValue: (v: string, o?: unknown) => void } }).eventUrlControl;
      const setValue = vi.spyOn(control, 'setValue');

      typeEventUrl('https://events.example.org/a');

      // The forms directive's own write (emitModelToViewChange: false) is expected; a write-back to
      // the views (`emitEvent: false`) is what moved the caret.
      expect(
        setValue.mock.calls.filter(([, options]) => (options as { emitEvent?: boolean } | undefined)?.emitEvent === false),
        'every keystroke rewrote the field and moved its caret'
      ).toHaveLength(0);
      click('campaigns-audience-mode-reuse');
      expect(host().querySelector<HTMLInputElement>('[data-testid="campaigns-audience-event-url"]')?.value).toBe('https://events.example.org/a');
    });
  });

  describe('PR review fixes (#4462)', () => {
    const GDPR: AudienceSuppressionList = {
      key: 'lf_events_gdpr',
      label: 'LF Events GDPR',
      listId: '201',
      name: 'LF Events - GDPR Suppression',
      size: 5000,
      category: 'standard',
      hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
    };
    const OPT_OUT: AudienceSuppressionList = { ...GDPR, key: 'global_opt_out', listId: '202', name: 'Global Opt-out' };
    const REGISTRANTS: AudienceSuppressionList = {
      key: 'current_registrants',
      label: 'Current registrants - Synthetic Summit 2026',
      listId: '',
      name: 'Synthetic Summit 2026 - Current Registrants',
      category: 'current_registrants',
      hubspotUrl: '',
      willCreate: true,
    };
    const STANDING: AudienceComposedList = { listId: '300', name: 'LFX Standard Suppressions - tlf', hubspotUrl: 'https://app.hubspot.com/l/300' };
    const AUDIENCE: CampaignAudience = { id: 'aud-9', briefId: 'brief-1', platform: 'hubspot', platformMasterListId: '101', status: 'built', version: 1 };

    async function discover(briefId = ''): Promise<void> {
      await render({ briefId });
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
    }

    function barText(testId: string): string {
      return host().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
    }

    it('moves focus into the compose confirmation, and back to Compose on cancel', async () => {
      await discover();
      click('audience-card-grid-toggle-101');

      click('campaigns-audience-compose');
      await fixture.whenStable();
      expect(document.activeElement?.getAttribute('data-testid')).toBe('campaigns-audience-compose-cancel');

      click('campaigns-audience-compose-cancel');
      await fixture.whenStable();
      expect(document.activeElement?.getAttribute('data-testid')).toBe('campaigns-audience-compose');
    });

    it('keeps the compose disclosure a working toggle after a compose', async () => {
      await discover();
      click('audience-card-grid-toggle-101');
      composeAudienceMaster.mockReturnValue(NEVER);
      composeMaster();
      const options = (): HTMLElement | null => host().querySelector('#audience-compose-options');
      expect(options()?.classList.contains('hidden')).toBe(false);

      click('campaigns-audience-compose-toggle');

      expect(options()?.classList.contains('hidden'), 'the toggle did nothing once a compose was attempted').toBe(true);
      expect(host().querySelector('[data-testid="campaigns-audience-compose-toggle"]')?.getAttribute('aria-expanded')).toBe('false');
    });

    it('shows the same excluded count in the summary bar as the compose confirmation', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, OPT_OUT], standardList: STANDING }));
      await discover();
      click('audience-card-grid-toggle-101');

      // Upstream excludes the two standard rows as ONE standing list.
      expect(barText('campaigns-audience-summary-bar-excluded')).toBe('1');
      expect(barText('campaigns-audience-summary-excluded')).toBe('1');
    });

    it('stops reading as attached once the selection on screen differs from the recorded one', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR], standardList: STANDING }));
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(
        of({ master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' }, suppressionListIds: ['300'], standardSuppression: STANDING, audience: AUDIENCE })
      );
      useSelectionDirectly();
      expect(host().querySelector('[data-testid="campaigns-audience-summary-bar-review"]'), 'fixture precondition').toBeNull();

      (fixture.componentInstance as unknown as { add: (id: string, name: string) => boolean }).add('102', 'Another list');
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-summary-bar-review"]'), 'an edited selection read as attached').not.toBeNull();
    });

    it('stops reading as attached when a registrants list still to be created is ticked after the attach', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS], standardList: STANDING }));
      await discover('brief-1');
      click('audience-suppression-grid-toggle-current_registrants');
      click('audience-card-grid-toggle-101');
      attachExistingAudience.mockReturnValue(
        of({ master: { listId: '101', name: 'Registrants', hubspotUrl: 'u' }, suppressionListIds: ['300'], standardSuppression: STANDING, audience: AUDIENCE })
      );
      useSelectionDirectly();
      expect(host().querySelector('[data-testid="campaigns-audience-summary-bar-review"]'), 'fixture precondition').toBeNull();

      click('audience-suppression-grid-toggle-current_registrants');

      expect(host().querySelector('[data-testid="campaigns-audience-summary-bar-review"]')).not.toBeNull();
    });

    it('withdraws an open confirmation when the email it was opened for changes', async () => {
      await discover('brief-1');
      click('audience-card-grid-toggle-101');
      click('campaigns-audience-use-direct');
      expect(host().querySelector('[data-testid="campaigns-audience-use-direct-confirming"]'), 'fixture precondition').not.toBeNull();

      fixture.componentRef.setInput('briefId', 'brief-2');
      fixture.detectChanges();

      expect(
        host().querySelector('[data-testid="campaigns-audience-use-direct-confirming"]'),
        'a confirmation for one email stayed open for another'
      ).toBeNull();
    });

    it('asks before a past-send attach whose own exclusions complete the standard set', async () => {
      const send: AudienceLastSentEmail = {
        emailId: 'em-9',
        emailName: 'Synthetic Summit 2026 - Last call',
        sentAt: '2026-02-20T15:00:00Z',
        hubspotUrl: 'https://app.hubspot.com/email/1/details/em-9/performance',
        includedLists: [{ listId: '501', name: 'Synthetic Summit - Prospects', size: 3000, missing: false }],
        suppressionLists: [{ listId: '202', name: 'Global Opt-out', size: 900, missing: false }],
      };
      getAudienceLastSent.mockReturnValue(of([send]));
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, OPT_OUT] }));
      await discover('brief-1');
      toggleStandardRow('global_opt_out');
      attachExistingAudience.mockReturnValue(NEVER);
      expect((fixture.componentInstance as unknown as { writeCreates: () => readonly string[] }).writeCreates(), 'fixture precondition').toEqual([]);

      click('audience-last-sent-use-em-9');

      expect(attachExistingAudience, 'the attach created the standing list without asking').not.toHaveBeenCalled();
      expect(host().querySelector('[data-testid="campaigns-audience-reuse-attach-confirming"]')?.textContent).toContain(
        "the project's shared standard suppression list"
      );
    });

    it('names the suppression step by its heading, not a fixed number', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR] }));
      await discover('brief-1');
      toggleStandardRow('lf_events_gdpr');
      const tab = fixture.componentInstance as unknown as { attachUnavailableMessage: () => string };

      expect(tab.attachUnavailableMessage()).toContain('under Standard suppressions');
      expect(tab.attachUnavailableMessage()).not.toContain('step 3');
    });
  });

  describe('PR review fixes, round 2 (#4462)', () => {
    const GDPR: AudienceSuppressionList = {
      key: 'lf_events_gdpr',
      label: 'LF Events GDPR',
      listId: '201',
      name: 'LF Events - GDPR Suppression',
      size: 5000,
      category: 'standard',
      hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
    };
    const REGISTRANTS: AudienceSuppressionList = {
      key: 'current_registrants',
      label: 'Current registrants - Synthetic Summit 2026',
      listId: '',
      name: 'Synthetic Summit 2026 - Current Registrants',
      category: 'current_registrants',
      hubspotUrl: '',
      willCreate: true,
    };
    const STANDING: AudienceComposedList = { listId: '300', name: 'LFX Standard Suppressions - tlf', hubspotUrl: 'https://app.hubspot.com/l/300' };
    const MASTER = { listId: '501', name: 'Synthetic Summit - Master', size: 3000, hubspotUrl: 'u' };

    async function discover(briefId = ''): Promise<void> {
      await render({ briefId });
      typeEventUrl('https://events.example.org/synthetic-summit');
      click('campaigns-audience-discover');
      completeDiscovery();
    }

    it('returns focus to the step-4 button a cancelled reuse confirmation was opened from', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS], standardList: STANDING }));
      getAudienceExistingMasterLists.mockReturnValue(of([MASTER]));
      await discover('brief-1');
      click('audience-last-sent-master-use-501');

      click('campaigns-audience-reuse-attach-cancel');
      await fixture.whenStable();

      expect(document.activeElement?.getAttribute('data-testid')).toBe('audience-last-sent-master-use-501');
    });

    it("counts a copied past send's standing-list id as the one standing list", async () => {
      const send: AudienceLastSentEmail = {
        emailId: 'em-8',
        emailName: 'Synthetic Summit 2026 - Reminder',
        sentAt: '2026-02-10T15:00:00Z',
        hubspotUrl: 'https://app.hubspot.com/email/1/details/em-8/performance',
        includedLists: [{ listId: '501', name: 'Synthetic Summit - Prospects', size: 3000, missing: false }],
        suppressionLists: [{ listId: '300', name: STANDING.name, size: 10, missing: false }],
      };
      getAudienceLastSent.mockReturnValue(of([send]));
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR], standardList: STANDING }));
      await discover();

      click('audience-last-sent-copy-em-8');

      expect(host().querySelector('[data-testid="campaigns-audience-summary-bar-excluded"]')?.textContent?.trim()).toBe('1');
    });

    it('moves focus to the review step from the summary bar', async () => {
      await discover();
      click('audience-card-grid-toggle-101');

      click('campaigns-audience-summary-bar-review');
      await fixture.whenStable();

      expect(document.activeElement?.getAttribute('data-testid')).toBe('campaigns-audience-step-compose');
    });

    it('withdraws a reuse confirmation once attaching is no longer possible', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR, REGISTRANTS], standardList: STANDING }));
      getAudienceExistingMasterLists.mockReturnValue(of([MASTER]));
      await discover('brief-1');
      click('audience-last-sent-master-use-501');
      expect(host().querySelector('[data-testid="campaigns-audience-reuse-attach-confirming"]'), 'fixture precondition').not.toBeNull();

      fixture.componentRef.setInput('stagingInFlight', true);
      fixture.detectChanges();

      expect(host().querySelector('[data-testid="campaigns-audience-reuse-attach-confirming"]')).toBeNull();
    });

    it('does not promise step 4 creates nothing while the standing list does not exist', async () => {
      getAudienceSuppressionLists.mockReturnValue(of({ lists: [GDPR] }));
      await discover('brief-1');
      toggleStandardRow('lf_events_gdpr');

      expect(host().querySelector('[data-testid="audience-last-sent-attach-note"]')?.textContent).not.toContain('nothing new is created');
    });
  });
});
