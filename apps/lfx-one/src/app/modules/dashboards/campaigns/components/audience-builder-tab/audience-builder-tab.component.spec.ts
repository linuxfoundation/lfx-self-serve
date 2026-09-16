// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CampaignService } from '@services/campaign.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS, AUDIENCE_UNION_EXACT_CAP } from '@lfx-one/shared/constants';
import type {
  AudienceComposeMasterPartial,
  AudienceDiscoveredEvent,
  AudienceDiscoveredList,
  AudienceDiscoveryResult,
  AudienceDiscoverySSEEventType,
  AudienceSuppressionList,
  SSEEvent,
} from '@lfx-one/shared/interfaces';

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
        {
          provide: CampaignService,
          useValue: {
            getAudienceCapabilities,
            discoverAudience,
            searchAudienceLists,
            getAudienceSuppressionLists,
            getAudienceLastSent,
            getAudienceExistingMasterLists,
            previewAudienceCount,
            composeAudienceMaster,
            runAudienceQa,
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
  async function render(inputs: { active?: boolean; initialEventUrl?: string } = {}): Promise<void> {
    fixture = TestBed.createComponent(AudienceBuilderTabComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('active', inputs.active ?? true);
    fixture.componentRef.setInput('initialEventUrl', inputs.initialEventUrl ?? '');
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

      expect(getAudienceSuppressionLists).toHaveBeenCalledWith('tlf', 'SYN', 'Synthetic Summit 2026');
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
    async function renderWithDiscovery(): Promise<void> {
      await render();
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

      click('audience-suppression-grid-toggle-lf_events_gdpr');
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

      // A second, different event. Its result shares no list id with the first.
      typeEventUrl('https://events.example.org/other-2027');
      click('campaigns-audience-discover');
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
      click('campaigns-audience-compose');

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
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      click('audience-suppression-grid-toggle-lf_events_gdpr');

      const banner = host().querySelector('[data-testid="campaigns-audience-conflict"]');
      expect(banner, 'a list ticked on both sides was resolved silently').not.toBeNull();
      expect(banner?.textContent).toContain('Synthetic Summit 2026 - Registrants');

      const btn = host().querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-compose"]');
      expect(btn?.disabled, 'compose stayed enabled with an unresolved include/exclude conflict').toBe(true);
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
      click('campaigns-audience-compose');

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
      click('campaigns-audience-compose');

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

      pending.next([]);
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
      // list is picked first to make the suppression count observable at all.
      click('audience-card-grid-toggle-101');
      click('audience-suppression-grid-toggle-lf_events_gdpr');
      expect(host().querySelector('[data-testid="campaigns-audience-exclude-summary"]')?.textContent).toContain('1 suppression list');

      click('audience-card-grid-toggle-201');

      expect(host().querySelector('[data-testid="campaigns-audience-exclude-summary"]'), 'a list was both included and excluded').toBeNull();
    });

    it('composes with the selected inclusions and the resolved exclusions', async () => {
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      click('audience-suppression-grid-toggle-lf_events_gdpr');

      composeAudienceMaster.mockReturnValue(
        of({
          master: { listId: '901', name: '26Q1 - SYN - Synthetic Summit 2026 - Master', hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/901' },
          suppression: { listId: '902', name: 'Combined Suppression', hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/902' },
          sourceListIds: ['101'],
        })
      );
      click('campaigns-audience-compose');

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

    it('will not compose with nothing selected', async () => {
      await renderWithDiscovery();

      click('campaigns-audience-compose');

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
      click('campaigns-audience-compose');

      const block = host().querySelector('[data-testid="campaigns-audience-compose-partial"]');
      expect(block, 'a partial compose failure was reported as a plain error').not.toBeNull();
      expect(block?.textContent).toContain('Combined Suppression');
      expect((host().textContent ?? '').toLowerCase(), 'a retry was offered for a non-idempotent write').not.toContain('retry');
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
      click('campaigns-audience-compose');

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
      click('campaigns-audience-compose');

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
      click('campaigns-audience-compose');
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
      click('campaigns-audience-compose');
      fixture.detectChanges();

      const internals = fixture.componentInstance as unknown as { selectionLocked(): boolean };
      expect(internals.selectionLocked(), 'the selection stayed editable while a master was being built from a snapshot of it').toBe(true);
    });

    it('keeps the stranded-compose warning until the operator acknowledges it', async () => {
      // A discovery cannot reconcile an abandoned HubSpot write, so clearing this warning on the
      // next run let it be dismissed implicitly — the operator could return to the original
      // project and compose duplicates having never read it. Only an explicit acknowledgement
      // clears it.
      composeAudienceMaster.mockReturnValue(new Subject<never>());
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      click('campaigns-audience-compose');
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
      click('campaigns-audience-compose');
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
      click('campaigns-audience-compose');

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
      click('campaigns-audience-compose');

      expect(host().querySelector('[data-testid="campaigns-audience-compose-error"]')?.textContent).toContain('Not authorized for this portal.');
      expect(host().querySelector('[data-testid="campaigns-audience-compose-partial"]')).toBeNull();
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
});
