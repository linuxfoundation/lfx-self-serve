// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS, AUDIENCE_SPEAKER_SCOPES } from '@lfx-one/shared/constants';
import type { AudienceListSearchResult, AudienceSignal } from '@lfx-one/shared/interfaces';

import { AudienceMissingSignalsComponent } from './audience-missing-signals.component';

function result(overrides: Partial<AudienceListSearchResult> = {}): AudienceListSearchResult {
  return { listId: '501', name: 'Synthetic Summit - Speakers', size: 40, hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/501', ...overrides };
}

describe('AudienceMissingSignalsComponent', () => {
  let fixture: ComponentFixture<AudienceMissingSignalsComponent>;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({ imports: [AudienceMissingSignalsComponent] }).compileComponents();
    fixture = TestBed.createComponent(AudienceMissingSignalsComponent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function render(
    inputs: { missingSignals?: AudienceSignal[]; searchResults?: AudienceListSearchResult[]; searching?: boolean; disabled?: boolean } = {}
  ): void {
    fixture.componentRef.setInput('missingSignals', inputs.missingSignals ?? []);
    fixture.componentRef.setInput('searchResults', inputs.searchResults ?? []);
    fixture.componentRef.setInput('searching', inputs.searching ?? false);
    fixture.componentRef.setInput('selectedIds', new Set<string>());
    fixture.componentRef.setInput('disabled', inputs.disabled ?? false);
    fixture.detectChanges();
  }

  function type(value: string): void {
    const input = host().querySelector<HTMLInputElement>('[data-testid="audience-missing-signals-search-input"]');
    if (input === null) {
      throw new Error('the search input is not rendered');
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('names each missing signal and explains what it would have covered', () => {
    // A bare signal key tells the operator nothing about what the send is now missing. The
    // description is the whole point of the section.
    render({ missingSignals: ['event_speakers', 'page_view'] });

    expect(host().querySelector('[data-testid="audience-missing-signal-event_speakers"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="audience-missing-signal-page_view"]')).not.toBeNull();
    expect((host().textContent ?? '').length).toBeGreaterThan(0);
  });

  it('offers every speaker scope', () => {
    // Picking the wrong scope changes who gets the email -- a "thanks for speaking" note sent to
    // current speakers instead of past ones -- so all three are shown rather than one default.
    render({ missingSignals: ['event_speakers'] });

    for (const scope of AUDIENCE_SPEAKER_SCOPES) {
      expect(host().querySelector(`[data-testid="audience-missing-signals-scope-${scope.key}"]`), `${scope.key} was not offered`).not.toBeNull();
    }
  });

  it('debounces the typeahead into one query per pause, not one per keystroke', () => {
    // Undebounced, every keystroke is a HubSpot list search. The debounce lives in the child that
    // owns the input rather than the container, so this is the component that has to prove it.
    const queries: string[] = [];
    render();
    fixture.componentInstance.search.subscribe((query) => queries.push(query));

    type('sp');
    type('spe');
    type('speakers');
    expect(queries, 'a query escaped before the debounce window closed').toEqual([]);

    vi.advanceTimersByTime(AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS);
    expect(queries).toEqual(['speakers']);
  });

  it('collapses a whitespace-only edit rather than re-querying the same term', () => {
    const queries: string[] = [];
    render();
    fixture.componentInstance.search.subscribe((query) => queries.push(query));

    type('speakers');
    vi.advanceTimersByTime(AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS);
    type('speakers ');
    vi.advanceTimersByTime(AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS);

    expect(queries, 'a trailing space re-issued the same search').toEqual(['speakers']);
  });

  it('emits the picked list and stays silent when disabled', () => {
    const added: AudienceListSearchResult[] = [];
    render({ searchResults: [result()] });
    fixture.componentInstance.addList.subscribe((list) => added.push(list));

    host().querySelector<HTMLElement>('[data-testid="audience-missing-signals-add-501"]')?.click();
    expect(added.map((list) => list.listId)).toEqual(['501']);

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    host().querySelector<HTMLElement>('[data-testid="audience-missing-signals-add-501"]')?.click();
    expect(
      added.map((list) => list.listId),
      'a disabled Add still emitted'
    ).toEqual(['501']);
  });
});
