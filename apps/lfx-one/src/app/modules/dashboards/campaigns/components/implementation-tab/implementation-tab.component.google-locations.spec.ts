// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { GOOGLE_ADS_GEO_SEARCH_DEBOUNCE_MS, GOOGLE_ADS_GEO_SEARCH_PICKER_LIMIT, GOOGLE_ADS_MAX_GEO_TARGETS } from '@lfx-one/shared/constants';
import type { CampaignImplementationDraft, GoogleAdsGeoTargetSearchResult, GoogleAdsGeoTargetSuggestion, ProjectContext } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { AutoComplete } from 'primeng/autocomplete';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { configureGoogleTab, restoreGoogleDraft, seedChannel, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * The location picker (campaign-service #411): with `googleGeoSearchEnabled`, the postal-code box
 * becomes a debounced search of Google's geo target table, and a picked row adds its id to the same
 * list a typed id goes into, with Google's canonical name kept as its display label.
 */
describe('ImplementationTabComponent google location picker', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  let search: ReturnType<typeof vi.fn>;

  // jsdom doesn't implement matchMedia; PrimeNG's Overlay (rendered under p-autoComplete once the
  // panel opens) calls it to decide modal/non-modal mode — the autocomplete wrapper spec's stub.
  beforeAll(() => {
    window.matchMedia ??= ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  });

  const AUSTIN: GoogleAdsGeoTargetSuggestion = {
    id: '1026201',
    name: 'Austin',
    canonicalName: 'Austin,Texas,United States',
    countryCode: 'US',
    targetType: 'City',
    status: 'ENABLED',
  };
  const ZIP: GoogleAdsGeoTargetSuggestion = {
    id: '9031945',
    name: '78701',
    canonicalName: '78701,Texas,United States',
    countryCode: 'US',
    targetType: 'Postal Code',
    status: 'ENABLED',
  };

  beforeEach(async () => {
    // Noop animations: the DOM-level spec opens PrimeNG's popup, whose overlay is animated.
    await configureGoogleTab([provideNoopAnimations()]);
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
    search = vi.fn(() => of({ suggestions: [AUSTIN, ZIP], truncated: false }));
    vi.spyOn(TestBed.inject(CampaignService), 'searchGoogleAdsGeoTargets').mockImplementation(search as never);
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    // Timers only, after the fixture is stable: the debounce is an RxJS `timer`, and advancing a fake
    // clock is exact where a real wait is slow and, on a loaded runner, close to flaky.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  /** Search on, Search channel, campaign-service road. */
  function seedPicker(enabled: boolean | null = true): Record<string, any> {
    const c = seedChannel(fixture, { includeSearch: true });
    fixture.componentRef.setInput('googleGeoSearchEnabled', enabled);
    fixture.detectChanges();
    return c;
  }

  /** Flush the query into its observable, then let the debounce elapse on the fake clock. */
  async function afterDebounce(): Promise<void> {
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(GOOGLE_ADS_GEO_SEARCH_DEBOUNCE_MS);
    fixture.detectChanges();
  }

  it.each([[null], [false]])('keeps the typed-id box while googleGeoSearchEnabled is %s', (enabled) => {
    const c = seedPicker(enabled);

    expect(c['googleGeoSearchAvailable']()).toBe(false);
    expect(find('implementation-google-postal-add')).not.toBeNull();
    expect(find('implementation-google-geo-search')).toBeNull();
  });

  it('replaces the typed-id box with the lfx-autocomplete picker once enabled', () => {
    seedPicker();

    expect(find('implementation-google-geo-search')?.tagName.toLowerCase()).toBe('lfx-autocomplete');
    expect(find('implementation-google-postal-add')).toBeNull();
    expect(find('implementation-google-postal-hint')?.textContent).toContain("Search Google's location table");
    // `inputId` lands on the focusable input, so the section's `<label for>` still names it.
    expect(fixture.nativeElement.querySelector('#google-postal-add')).not.toBeNull();
  });

  /** A picked id rides the campaign-service road only, so the picker is withheld wherever the ids are. */
  it('is not offered on the legacy road even with the capability on', () => {
    const c = seedPicker();
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    expect(c['googleGeoSearchAvailable']()).toBe(false);
    expect(find('implementation-google-geo-search')).toBeNull();
  });

  it('debounces the search, asks once for the latest query, and marks an already-added row disabled', async () => {
    const c = seedPicker();
    c['addGooglePostalGeoTarget'](ZIP.id);

    c['onGoogleGeoSearch']({ query: 'Aus' });
    c['onGoogleGeoSearch']({ query: '  Austin ' });
    await afterDebounce();

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('tlf', 'Austin', { limit: GOOGLE_ADS_GEO_SEARCH_PICKER_LIMIT });
    expect(c['googleGeoSearchOptions']()).toEqual([
      { ...AUSTIN, disabled: false },
      { ...ZIP, disabled: true },
    ]);
  });

  /**
   * A repeat that trims to the query already searched still reaches the search — PrimeNG waits on
   * suggestions after every completion — which is also how a failed search is retried.
   */
  it('searches again on a repeated completion that trims to the same query', async () => {
    const c = seedPicker();

    c['onGoogleGeoSearch']({ query: 'Austin' });
    await afterDebounce();
    c['onGoogleGeoSearch']({ query: 'Austin ' });
    await afterDebounce();

    expect(search).toHaveBeenCalledTimes(2);
  });

  /**
   * An edit cancels the request still out for the previous text and clears its rows at once, so an
   * answer for text the operator has already changed can never become a pickable row.
   */
  it('never offers rows from a superseded search', async () => {
    const first = new Subject<GoogleAdsGeoTargetSearchResult>();
    const second = new Subject<GoogleAdsGeoTargetSearchResult>();
    search.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const c = seedPicker();

    c['onGoogleGeoSearch']({ query: '787' });
    await afterDebounce();
    expect(search).toHaveBeenCalledWith('tlf', '787', expect.anything());

    c['onGoogleGeoSearch']({ query: '78701' });
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    // The old answer lands during the new query's debounce: it is not shown.
    first.next({ suggestions: [AUSTIN], truncated: false });
    fixture.detectChanges();
    expect(c['googleGeoSearchOptions']()).toEqual([]);

    await vi.advanceTimersByTimeAsync(GOOGLE_ADS_GEO_SEARCH_DEBOUNCE_MS);
    second.next({ suggestions: [ZIP], truncated: false });
    fixture.detectChanges();
    expect(c['googleGeoSearchOptions']()).toEqual([{ ...ZIP, disabled: false }]);
  });

  /** Text left in the typed-id box must not leave its errors under the picker, which does not show it. */
  it('hides the typed-id box errors once the picker replaces it', () => {
    const c = seedPicker(null);
    c['googlePostalGeoForm'].controls.postalId.setValue('SW1A 1AA');
    fixture.detectChanges();
    expect(find('implementation-google-postal-not-id')).not.toBeNull();

    fixture.componentRef.setInput('googleGeoSearchEnabled', true);
    fixture.detectChanges();

    expect(find('implementation-google-postal-not-id')).toBeNull();
  });

  /** A foundation switch mid-debounce cancels the search rather than finishing it for the old project. */
  it('cancels a pending search when the foundation changes', async () => {
    const c = seedPicker();
    c['onGoogleGeoSearch']({ query: 'Austin' });
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(GOOGLE_ADS_GEO_SEARCH_DEBOUNCE_MS / 2);

    TestBed.inject(ProjectContextService).setFoundation({ uid: 'uid-cncf', slug: 'cncf', name: 'cncf' } as ProjectContext, false);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(GOOGLE_ADS_GEO_SEARCH_DEBOUNCE_MS / 2 + 1);

    // The search for the old project never went out; the one now running is for the new one.
    expect(search).not.toHaveBeenCalledWith('tlf', expect.anything(), expect.anything());
  });

  /** The capability going away mid-debounce cancels the search and clears its state. */
  it('cancels a pending search and clears it when the picker stops being offered', async () => {
    const c = seedPicker();
    c['onGoogleGeoSearch']({ query: 'Austin' });
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    expect(c['googleGeoSearchPending']()).toBe(true);

    fixture.componentRef.setInput('googleGeoSearchEnabled', false);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(GOOGLE_ADS_GEO_SEARCH_DEBOUNCE_MS);

    expect(search).not.toHaveBeenCalled();
    expect(c['googleGeoSearchPending']()).toBe(false);
  });

  /** Each blank completion yields a NEW empty state, so PrimeNG gets suggestions back every time. */
  it('answers every blank completion with a fresh empty state', async () => {
    const c = seedPicker();
    c['onGoogleGeoSearch']({ query: '   ' });
    await afterDebounce();
    const first = c['googleGeoSearchOptions']();

    c['onGoogleGeoSearch']({ query: '  ' });
    await afterDebounce();

    expect(c['googleGeoSearchOptions']()).toEqual([]);
    expect(c['googleGeoSearchOptions']()).not.toBe(first);
  });

  /**
   * While a search is out its rows are cleared, but "nothing matched" is not yet true: the popup's
   * empty template says the search is running, until the answer lands.
   */
  it('says searching, not no matches, while a later search is pending', async () => {
    const later = new Subject<GoogleAdsGeoTargetSearchResult>();
    search.mockReturnValueOnce(of({ suggestions: [AUSTIN], truncated: false })).mockReturnValueOnce(later);
    const c = seedPicker();
    c['onGoogleGeoSearch']({ query: 'Austin' });
    await afterDebounce();

    c['onGoogleGeoSearch']({ query: 'Austin Texas' });
    await afterDebounce();

    expect(c['googleGeoSearchOptions']()).toEqual([]);
    expect(c['googleGeoSearchEmptyMessage']()).toBe('Searching…');
    expect(find('implementation-google-geo-search-status')?.textContent).toContain('Searching');

    later.next({ suggestions: [ZIP], truncated: false });
    fixture.detectChanges();

    expect(c['googleGeoSearchEmptyMessage']()).toBe('No matching locations.');
    expect(find('implementation-google-geo-search-status')?.textContent?.trim()).toBe('');
    expect(c['googleGeoSearchOptions']()).toEqual([{ ...ZIP, disabled: false }]);
  });

  /**
   * Through the REAL input and PrimeNG's own completion: two keystrokes before the debounce expires.
   * The cleared rows the second query starts with must not close the popup and spend PrimeNG's
   * loading cycle, or the answer lands in a popup that never reopens.
   */
  it('shows the returned rows after typing twice into the picker before the debounce expires', async () => {
    seedPicker();
    const input = fixture.nativeElement.querySelector('#google-postal-add') as HTMLInputElement;
    const type = async (text: string): Promise<void> => {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // PrimeNG's own `delay` is 0 here, still a timeout: let it emit the completion.
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
    };
    input.focus();
    input.dispatchEvent(new Event('focus'));

    await type('Aus');
    await type('Austin');
    await afterDebounce();
    fixture.detectChanges();

    const autocomplete = fixture.debugElement.query(By.directive(AutoComplete)).componentInstance as AutoComplete;
    expect(search).toHaveBeenCalledTimes(1);
    expect(autocomplete.overlayVisible).toBe(true);
    expect(document.querySelector(`[data-testid="implementation-google-geo-search-option-${AUSTIN.id}"]`)).not.toBeNull();
  });

  it('sends no request for a blank query', async () => {
    const c = seedPicker();

    c['onGoogleGeoSearch']({ query: '   ' });
    await afterDebounce();

    expect(search).not.toHaveBeenCalled();
    expect(c['googleGeoSearchOptions']()).toEqual([]);
  });

  it("cuts a query to upstream's 100 characters rather than sending one it refuses", () => {
    const c = seedPicker();

    c['onGoogleGeoSearch']({ query: 'a'.repeat(120) });

    expect(c['googleGeoSearchQuery']()).toBe('a'.repeat(100));
  });

  it('adds a picked id to the postal list, labelled by its canonical name, and clears the box', () => {
    const c = seedPicker();
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    c['googleGeoSearchForm'].controls.location.setValue('Austin');

    c['onGoogleGeoSearchSelect']({ value: { ...AUSTIN, disabled: false } });
    fixture.detectChanges();

    expect(c['googlePostalGeoTargets']()).toEqual([AUSTIN.id]);
    expect(find(`implementation-google-postal-chip-${AUSTIN.id}`)?.textContent).toContain('Austin,Texas,United States');
    expect(c['googleGeoSearchForm'].controls.location.value).toBeNull();
    expect(c['googleGeoSearchQuery']()).toBe('');
    // The draft the add emitted already carries the label: it is recorded before the add, not after.
    expect(emitted?.googlePostalGeoTargets).toEqual([AUSTIN.id]);
    expect(emitted?.googlePostalGeoLabels).toEqual({ [AUSTIN.id]: 'Austin,Texas,United States' });
  });

  it('does not add a disabled row, and records no label for it', () => {
    const c = seedPicker();
    c['addGooglePostalGeoTarget'](ZIP.id);

    c['onGoogleGeoSearchSelect']({ value: { ...ZIP, disabled: true } });

    expect(c['googlePostalGeoTargets']()).toEqual([ZIP.id]);
    expect(c['googlePostalGeoLabels']()).toEqual({});
  });

  it('withdraws the label when the shared cap refuses the pick', () => {
    const c = seedPicker();
    c['googlePostalGeoTargets'].set(Array.from({ length: GOOGLE_ADS_MAX_GEO_TARGETS }, (_, i) => String(9031900 + i)));

    expect(c['addGooglePickedGeoTarget'](AUSTIN)).toBe(false);
    expect(c['googlePostalGeoLabels']()).toEqual({});
  });

  /** A picked id dispatches exactly as a typed one does: the bare id, in `geoTargets`. */
  it('submits the picked id in geoTargets, with no label on the wire', async () => {
    // No debounce here, and `whenStable` below waits on the real scheduler, so the real clock is back.
    vi.useRealTimers();
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedPicker();
    c['addGoogleGeoTarget']('US');
    c['onGoogleGeoSearchSelect']({ value: { ...ZIP, disabled: false } });
    fixture.detectChanges();
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    const request = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(request['geoTargets']).toEqual(['US', ZIP.id]);
    expect(JSON.stringify(request)).not.toContain('78701,Texas');
  });

  it('removes a picked chip together with its label', () => {
    const c = seedPicker();
    c['onGoogleGeoSearchSelect']({ value: { ...AUSTIN, disabled: false } });
    c['onGoogleGeoSearchSelect']({ value: { ...ZIP, disabled: false } });

    c['removeGooglePostalGeoTarget'](0);

    expect(c['googlePostalGeoTargets']()).toEqual([ZIP.id]);
    expect(c['googlePostalGeoLabels']()).toEqual({ [ZIP.id]: '78701,Texas,United States' });
  });

  it('round-trips the labels through a draft, dropping a non-string one', () => {
    const c = seedPicker();

    restoreGoogleDraft(fixture, c, {
      includeSearch: true,
      googlePostalGeoTargets: [AUSTIN.id, ZIP.id],
      googlePostalGeoLabels: { [AUSTIN.id]: 'Austin,Texas,United States', [ZIP.id]: { bad: true } },
    });

    expect(c['googlePostalGeoLabels']()).toEqual({ [AUSTIN.id]: 'Austin,Texas,United States' });
    // An id with no label renders as itself, as a typed one always has.
    expect(c['googlePostalGeoChips']()).toEqual([
      { id: AUSTIN.id, label: 'Austin,Texas,United States' },
      { id: ZIP.id, label: ZIP.id },
    ]);
  });

  /** "The search failed" is not "nothing matched": it gets its own line, wired to the input. */
  it('names a failed search and points the input at the failure line', async () => {
    search.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    const c = seedPicker();

    c['onGoogleGeoSearch']({ query: 'Austin' });
    await afterDebounce();

    expect(c['googleGeoSearchFailed']()).toBe(true);
    expect(find('implementation-google-geo-search-failed')).not.toBeNull();
    expect(c['googleGeoSearchDescribedBy']()).toBe('google-geo-search-failed');
  });

  it('recovers from a failed search on the next query', async () => {
    search.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    const c = seedPicker();
    c['onGoogleGeoSearch']({ query: 'Austin' });
    await afterDebounce();

    c['onGoogleGeoSearch']({ query: 'Austin TX' });
    await afterDebounce();

    expect(c['googleGeoSearchFailed']()).toBe(false);
    expect(c['googleGeoSearchOptions']()).toHaveLength(2);
  });

  it('says when more locations matched than were listed', async () => {
    search.mockReturnValueOnce(of({ suggestions: [AUSTIN], truncated: true }));
    const c = seedPicker();

    c['onGoogleGeoSearch']({ query: 'Austin' });
    await afterDebounce();

    expect(find('implementation-google-geo-search-truncated')).not.toBeNull();
  });
});

/**
 * The review fixes on #4455: what the postal-code and radius controls do once the capability is not
 * an explicit yes, and the edge spellings each box has to judge.
 */
describe('ImplementationTabComponent google location targets held by the capability', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const SYDNEY_DRAFT = { latitude: '-33.8688', longitude: '151.2093', radius: '25', radiusUnit: 'KILOMETERS' };

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  /** Search with one postal code and one radius added on the campaign-service road, then the answer taken away. */
  function seedHeld(
    capability: boolean | null,
    read: 'unknown' | 'pending' | 'ready' | 'failed',
    briefId: string | null,
    channel: Record<string, unknown> = { includeSearch: true }
  ): Record<string, any> {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGooglePostalGeoTarget']('9031945');
    c['addGoogleProximityTarget'](SYDNEY_DRAFT);
    c['campaignForm'].patchValue({ includeSearch: false, ...channel });
    fixture.componentRef.setInput('briefPersistence', { status: briefId ? 'saved' : 'off', briefId, message: null, approved: !!briefId });
    fixture.componentRef.setInput('createCapabilityRead', read);
    fixture.componentRef.setInput('googleCreativeEnabled', capability);
    fixture.detectChanges();
    return c;
  }

  /**
   * The finding: withholding the lists does not shrink the campaign, it WIDENS it to the event
   * country. So Create is blocked, unlike the extensions block, until a retry succeeds or the
   * operator removes the targets.
   */
  it.each([['failed'], ['unknown']])('blocks Create and offers Retry when the read is %s', (read) => {
    const retried = vi.fn();
    fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);
    const c = seedHeld(null, read as 'failed' | 'unknown', 'brief-1');

    expect(c['googleLocationsCapabilityBlock']()?.kind).toBe('failed');
    expect(c['canSubmit']()).toBe(false);
    expect(find('implementation-google-locations-capability-failed')?.textContent).toContain('1 postal-code target and 1 radius target');
    expect(find('implementation-google-locations-capability-live')?.textContent?.trim()).toBe(c['googleLocationsCapabilityMessage']());
    (find('implementation-google-locations-capability-retry')?.querySelector('button') as HTMLButtonElement).click();

    expect(retried).toHaveBeenCalledTimes(1);
  });

  it('blocks Create while the check is in flight, and says why waiting matters', () => {
    const c = seedHeld(null, 'pending', 'brief-1');

    expect(c['googleLocationsCapabilityBlock']()?.kind).toBe('pending');
    expect(c['canSubmit']()).toBe(false);
    expect(find('implementation-google-locations-capability-pending')?.textContent).toContain('whole event country');
    expect(find('implementation-google-locations-capability-remove')).toBeNull();
  });

  it('names the deployment when the capability answered no, with no Retry', () => {
    const c = seedHeld(false, 'ready', 'brief-1');

    expect(c['googleLocationsCapabilityBlock']()?.kind).toBe('unsupported');
    expect(c['canSubmit']()).toBe(false);
    expect(find('implementation-google-locations-capability-retry')).toBeNull();
    expect(find('implementation-google-locations-capability-remove')).not.toBeNull();
  });

  it('asks for the brief to be saved when there is nothing to check against', () => {
    const c = seedHeld(null, 'unknown', null);

    expect(c['googleLocationsCapabilityBlock']()?.kind).toBe('unsaved');
  });

  /** The explicit way past the block: drop the held targets and create with country targeting. */
  it('lets the operator remove the held targets, which unblocks Create', () => {
    const c = seedHeld(null, 'failed', 'brief-1');

    (find('implementation-google-locations-capability-remove')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(c['googlePostalGeoTargets']()).toEqual([]);
    expect(c['googleProximityTargets']()).toEqual([]);
    expect(c['googleLocationsCapabilityBlock']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('clears once the capability answers yes, and the lists are sent again', () => {
    const c = seedHeld(null, 'failed', 'brief-1');

    fixture.componentRef.setInput('googleCreativeEnabled', true);
    fixture.detectChanges();

    expect(c['googleLocationsCapabilityBlock']()).toBeNull();
    expect(c['googleEffectiveGeoTargets']()).toEqual(['9031945']);
  });

  /** Radius targets on Demand Gen are withheld by the CHANNEL whatever the answer, and their own notice says so. */
  it('does not count radius targets on demand-gen, where only the postal code is held by the capability', () => {
    seedHeld(null, 'failed', 'brief-1', { includeDemandGen: true });

    expect(find('implementation-google-locations-capability-failed')?.textContent).toContain('1 postal-code target on this brief');
  });

  /** "Remove them" names only the postal codes on Demand Gen, so it must keep the channel-held radii. */
  it('keeps radius targets held by the demand-gen channel when the operator removes the postal codes', () => {
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    const c = seedHeld(null, 'failed', 'brief-1', { includeDemandGen: true });

    (find('implementation-google-locations-capability-remove')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(c['googlePostalGeoTargets']()).toEqual([]);
    expect(c['googleProximityTargets']()).toHaveLength(1);
    expect(emitted?.googleProximityTargets).toHaveLength(1);
    expect(c['googleLocationsCapabilityBlock']()).toBeNull();
  });

  /**
   * The channel notice must not wait on the capability: the block leaves Demand Gen radii to it, so a
   * muted notice would drop them with nothing on screen.
   */
  it.each([[null], [false]])('names held demand-gen radius targets while googleCreativeEnabled is %s', (capability) => {
    const c = seedHeld(capability, 'failed', 'brief-1', { includeDemandGen: true });

    expect(c['googleProximityWithheldOn']()).toBe('Demand Gen');
    expect(find('implementation-google-proximity-withheld')).not.toBeNull();
  });

  /** The region is mounted before the switch, so the switch itself is what it announces. */
  it('announces held demand-gen radius targets through an always-mounted polite region', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleProximityTarget'](SYDNEY_DRAFT);
    fixture.detectChanges();
    const region = find('implementation-google-proximity-withheld-live');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.textContent?.trim()).toBe('');

    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
    fixture.detectChanges();

    // The SAME element, now carrying the sentence the visible notice shows.
    expect(find('implementation-google-proximity-withheld-live')).toBe(region);
    expect(region?.textContent?.trim()).toBe(c['googleProximityWithheldMessage']());
    expect(region?.textContent).toContain('Demand Gen campaigns do not take radius targets');
    expect(find('implementation-google-proximity-withheld')?.getAttribute('role')).toBeNull();
  });

  it('says nothing when no postal code or radius is held', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    fixture.componentRef.setInput('googleCreativeEnabled', null);
    fixture.detectChanges();

    expect(c['googleLocationsCapabilityBlock']()).toBeNull();
  });

  /**
   * Ids held on the legacy road are neither shown nor sent there, so they must not take up the
   * country picker's share of the cap, where the operator could not see or remove them.
   */
  it('does not count held postal ids against the country cap', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googlePostalGeoTargets'].set(Array.from({ length: GOOGLE_ADS_MAX_GEO_TARGETS }, (_, i) => String(9031900 + i)));
    expect(c['googleGeoTargetsFull']()).toBe(true);

    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();
    c['addGoogleGeoTarget']('CA');

    expect(c['googleGeoTargetCount']()).toBe(1);
    expect(c['googleGeoTargets']()).toEqual(['CA']);
  });

  /**
   * Postal ids held while the capability is unanswered do not count against the cap, so countries
   * can still be added; a late yes then releases a list over the cap. Create waits, and says why.
   */
  it('blocks Create when a late capability yes releases more than the cap allows', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    fixture.componentRef.setInput('googleCreativeEnabled', null);
    fixture.detectChanges();
    // Ten more held ids than the countries leave room for, so the released list is ten over the cap.
    const held = GOOGLE_ADS_MAX_GEO_TARGETS - c['googleGeoOptions'].length + 10;
    // `includeSearch` kept on: the base draft unticks every channel, which would close the section.
    restoreGoogleDraft(fixture, c, { includeSearch: true, googlePostalGeoTargets: Array.from({ length: held }, (_, i) => String(9031900 + i)) });
    for (const code of c['googleGeoOptions']) c['addGoogleGeoTarget'](code);
    expect(c['googleGeoTargets']()).toHaveLength(c['googleGeoOptions'].length);

    fixture.componentRef.setInput('googleCreativeEnabled', true);
    fixture.detectChanges();

    expect(c['googleGeoTargetCount']()).toBe(GOOGLE_ADS_MAX_GEO_TARGETS + 10);
    expect(c['googleGeoTargetsOverCap']()).toBe(true);
    expect(c['canSubmit']()).toBe(false);
    expect(find('implementation-google-geo-over-cap')?.textContent).toContain(`at most ${GOOGLE_ADS_MAX_GEO_TARGETS}`);

    for (let i = 0; i < 10; i++) c['removeGooglePostalGeoTarget'](0);
    fixture.detectChanges();

    expect(c['googleGeoTargetCount']()).toBe(GOOGLE_ADS_MAX_GEO_TARGETS);
    expect(c['googleGeoTargetsOverCap']()).toBe(false);
    expect(c['canSubmit']()).toBe(true);
    expect(find('implementation-google-geo-over-cap')).toBeNull();
  });

  /** `Number()` reads these as 26, 3 and 100; the form takes decimal degrees only. */
  it.each([['0x1A'], ['0b11'], ['1e2'], ['Infinity']])('refuses the non-decimal spelling %s and names it', (text) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googleProximityForm'].setValue({ ...SYDNEY_DRAFT, latitude: text });
    fixture.detectChanges();

    expect(c['googleProximityLatitudeInvalid']()).toBe(true);
    expect(find('implementation-google-proximity-latitude-invalid')).not.toBeNull();
    expect(c['addGoogleProximityTarget']({ ...SYDNEY_DRAFT, latitude: text })).toBe(false);
  });

  it.each([['-33.'], ['+33.5'], ['.5']])('accepts the decimal spelling %s', (text) => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['addGoogleProximityTarget']({ ...SYDNEY_DRAFT, latitude: text })).toBe(true);
  });

  /** A soft warning: upstream accepts the entry, so the add stays allowed. */
  it('warns that a short numeric entry looks like a postal code, without refusing it', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googlePostalGeoForm'].controls.postalId.setValue('94103');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('[data-testid="implementation-google-postal-add"] input') as HTMLInputElement;

    expect(find('implementation-google-postal-looks-like-code')).not.toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe('google-postal-looks-like-code');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(c['addGooglePostalGeoTarget']('94103')).toBe(true);
  });

  it('does not warn about a seven-digit postal-code id', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googlePostalGeoForm'].controls.postalId.setValue('9031945');
    fixture.detectChanges();

    expect(find('implementation-google-postal-looks-like-code')).toBeNull();
  });

  it('gives the latitude box its own accessible name', () => {
    seedChannel(fixture, { includeSearch: true });
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('[data-testid="implementation-google-proximity-latitude"] input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Radius target latitude');
    // `inputId` lands on the focusable input, so the section's `<label for>` still names it.
    expect(input.id).toBe('google-proximity-latitude');
  });

  /** frontend-checklist 14.1: the geo controls are the LFX wrappers, bound to the transient form. */
  it('renders the postal and radius controls as lfx wrappers', () => {
    seedChannel(fixture, { includeSearch: true });
    fixture.detectChanges();

    expect(find('implementation-google-postal-add')?.tagName.toLowerCase()).toBe('lfx-input-text');
    for (const testId of ['latitude', 'longitude', 'radius']) {
      expect(find(`implementation-google-proximity-${testId}`)?.tagName.toLowerCase()).toBe('lfx-input-text');
    }
    expect(find('implementation-google-proximity-unit')?.tagName.toLowerCase()).toBe('lfx-select');
  });

  /** Picking the unit through the select's control reaches the draft the add reads. */
  it('reads the unit from the select control, and an unpicked unit as empty', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    expect(c['googleProximityDraft']().radiusUnit).toBe('');

    c['googleProximityForm'].patchValue({ radiusUnit: 'MILES' });

    expect(c['googleProximityDraft']().radiusUnit).toBe('MILES');
  });
});
