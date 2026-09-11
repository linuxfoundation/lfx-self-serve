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

      click('audience-suppression-grid-toggle-201');
      expect(host().querySelector('[data-testid="campaigns-audience-count"]'), 'a count survived a selection edit').toBeNull();
    });

    it('reports a capped union as a bound, never a fabricated exact number', async () => {
      // Above the cap the server stops the union sweep and returns the naive SUM, which
      // double-counts every contact in more than one list. Rendering it as a precise total would
      // be a number an operator plans a send around.
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');

      previewAudienceCount.mockReturnValue(of({ exact: false, estimate: 41_000, count: 41_000, reason: 'Union above the exact-count cap.' }));
      click('campaigns-audience-preview-count');

      const text = host().querySelector('[data-testid="campaigns-audience-count"]')?.textContent ?? '';
      expect(text).toContain(`${AUDIENCE_UNION_EXACT_CAP.toLocaleString('en-US')}+`);
      expect(text, 'the inexact sum was rendered as an exact total').not.toContain('41,000');
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
      click('audience-suppression-grid-toggle-201');
      expect(host().querySelector('[data-testid="campaigns-audience-exclude-summary"]')?.textContent).toContain('1 suppression list');

      click('audience-card-grid-toggle-201');

      expect(host().querySelector('[data-testid="campaigns-audience-exclude-summary"]'), 'a list was both included and excluded').toBeNull();
    });

    it('composes with the selected inclusions and the resolved exclusions', async () => {
      await renderWithDiscovery();
      click('audience-card-grid-toggle-101');
      click('audience-suppression-grid-toggle-201');

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
