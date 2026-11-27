// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { META_TARGETING_SEARCH_BUSY_MESSAGE, META_TARGETING_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import type { MetaDetailedTargetingPicks, MetaTargetingSearchResult, MetaTargetingSearchType } from '@lfx-one/shared/interfaces';
import { emptyMetaDetailedTargetingPicks } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MetaDetailedTargetingComponent } from './meta-detailed-targeting.component';

// The rules (which boxes show, what is searched, which rows can be picked and into which list, the caps, the labels,
// the failure text) are tested in campaign-meta-detailed-targeting.utils.spec.ts; this spec only checks the wiring: a
// typed query reaches the search after the debounce, a picked row reaches the model and its chip removes it, a
// location row lands in the list its type names, a failed search shows why.
const RESULT: MetaTargetingSearchResult = {
  type: 'interest',
  options: [{ id: '6003', name: 'Open source', path: ['Interests', 'Technology'] }],
};

describe('MetaDetailedTargetingComponent', () => {
  let fixture: ComponentFixture<MetaDetailedTargetingComponent>;
  let searchMetaTargetingOptions: ReturnType<
    typeof vi.fn<(slug: string, type: MetaTargetingSearchType, query: string) => Observable<MetaTargetingSearchResult>>
  >;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const call = (name: string, ...args: unknown[]): void => (fixture.componentInstance as unknown as Record<string, (...a: unknown[]) => void>)[name](...args);
  const lists = (): { key: string; choices: { id: string; disabled: boolean }[] }[] =>
    (fixture.componentInstance as unknown as { lists(): { key: string; choices: { id: string; disabled: boolean }[] }[] }).lists();

  async function search(type: MetaTargetingSearchType, text: string): Promise<void> {
    call('onSearch', type, { query: text, originalEvent: new Event('input') });
    await vi.advanceTimersByTimeAsync(META_TARGETING_SEARCH_DEBOUNCE_MS);
    fixture.detectChanges();
  }
  const searchInterests = (text: string): Promise<void> => search('interest', text);

  beforeEach(async () => {
    vi.useFakeTimers();
    searchMetaTargetingOptions = vi.fn(() => of(RESULT));
    await TestBed.configureTestingModule({
      imports: [MetaDetailedTargetingComponent],
      providers: [{ provide: CampaignService, useValue: { searchMetaTargetingOptions } }],
    }).compileComponents();
    fixture = TestBed.createComponent(MetaDetailedTargetingComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('interestEnabled', true);
    fixture.componentRef.setInput('behaviorEnabled', true);
    fixture.componentRef.setInput('localeEnabled', true);
    fixture.componentRef.setInput('regionEnabled', true);
    fixture.componentRef.setInput('picks', emptyMetaDetailedTargetingPicks());
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('searches the typed box after the debounce and lists the answer there only', async () => {
    await searchInterests('  open source ');
    expect(searchMetaTargetingOptions).toHaveBeenCalledWith('tlf', 'interest', 'open source');
    expect(lists().map((list) => [list.key, list.choices.map((c) => c.id)])).toEqual([
      ['interests', ['6003']],
      ['behaviors', []],
      ['workPositions', []],
      ['locales', []],
      ['locations', []],
    ]);
  });

  it('adds a picked row to the model as a chip, and its remove button takes it out', async () => {
    let picks: MetaDetailedTargetingPicks | null = null;
    fixture.componentInstance.picks.subscribe((value) => (picks = value));
    await searchInterests('open source');
    call('onSelect', lists()[0], { value: lists()[0].choices[0], originalEvent: new Event('click') });
    fixture.detectChanges();
    expect(picks).toEqual({ ...emptyMetaDetailedTargetingPicks(), interests: [{ id: '6003', name: 'Open source' }] });

    query('meta-detailed-targeting-interests-remove-6003')?.click();
    fixture.detectChanges();
    expect(picks).toEqual(emptyMetaDetailedTargetingPicks());
    expect(query('meta-detailed-targeting-interests-6003')).toBeNull();
  });

  it('puts a picked location row in the list its type names, with a chip that says which and removes it', async () => {
    let picks: MetaDetailedTargetingPicks | null = null;
    fixture.componentInstance.picks.subscribe((value) => (picks = value));
    searchMetaTargetingOptions.mockReturnValue(
      of<MetaTargetingSearchResult>({
        type: 'location',
        options: [{ id: '2420379', name: 'Austin', path: [], locationType: 'city', countryCode: 'US', region: 'Texas' }],
      })
    );
    await search('location', 'austin');
    expect(searchMetaTargetingOptions).toHaveBeenCalledWith('tlf', 'location', 'austin');
    const box = lists()[4];
    call('onSelect', box, { value: box.choices[0], originalEvent: new Event('click') });
    fixture.detectChanges();
    expect(picks).toEqual({ ...emptyMetaDetailedTargetingPicks(), cities: [{ id: '2420379', name: 'Austin, Texas, US', countryCode: 'US' }] });
    expect(query('meta-detailed-targeting-cities-2420379')?.textContent).toContain('Austin, Texas, US (city)');

    query('meta-detailed-targeting-cities-remove-2420379')?.click();
    fixture.detectChanges();
    expect(picks).toEqual(emptyMetaDetailedTargetingPicks());
  });

  it('says why a search failed, under its own box, until the text is shortened', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    searchMetaTargetingOptions.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await searchInterests('open source');
    expect(query('meta-detailed-targeting-interests-error')?.textContent).toContain(META_TARGETING_SEARCH_BUSY_MESSAGE);
    expect(query('meta-detailed-targeting-behaviors-error')).toBeNull();

    // Shortened to one character: the stale failure goes, and nothing is searched.
    call('onSearch', 'interest', { query: 'o', originalEvent: new Event('input') });
    await vi.advanceTimersByTimeAsync(META_TARGETING_SEARCH_DEBOUNCE_MS);
    fixture.detectChanges();
    expect(query('meta-detailed-targeting-interests-error')).toBeNull();
    expect(searchMetaTargetingOptions).toHaveBeenCalledTimes(1);
  });
});
