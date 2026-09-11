// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AUDIENCE_SIGNAL_INFO } from '@lfx-one/shared/constants';
import type { AudienceCardBucket, AudienceDiscoveredList } from '@lfx-one/shared/interfaces';

import { AudienceCardGridComponent } from './audience-card-grid.component';

function list(overrides: Partial<AudienceDiscoveredList> = {}): AudienceDiscoveredList {
  return {
    listId: '101',
    name: 'Synthetic Summit 2026 - Registrants',
    signal: 'event_registration',
    size: 1200,
    reason: 'Name matches the event and the filter selects on registration.',
    listType: 'DYNAMIC',
    hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/101',
    ...overrides,
  };
}

function bucket(signal: AudienceCardBucket['signal'], lists: AudienceDiscoveredList[]): AudienceCardBucket {
  return {
    signal,
    label: AUDIENCE_SIGNAL_INFO[signal].label,
    description: AUDIENCE_SIGNAL_INFO[signal].description,
    accentClass: AUDIENCE_SIGNAL_INFO[signal].accentClass,
    lists,
  };
}

describe('AudienceCardGridComponent', () => {
  let fixture: ComponentFixture<AudienceCardGridComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AudienceCardGridComponent] }).compileComponents();
    fixture = TestBed.createComponent(AudienceCardGridComponent);
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function render(buckets: AudienceCardBucket[], extra: { selectedIds?: ReadonlySet<string>; disabled?: boolean } = {}): void {
    fixture.componentRef.setInput('buckets', buckets);
    fixture.componentRef.setInput('selectedIds', extra.selectedIds ?? new Set<string>());
    fixture.componentRef.setInput('disabled', extra.disabled ?? false);
    fixture.detectChanges();
  }

  it('hides buckets that classified nothing rather than rendering nine empty cards', () => {
    // The container always builds all nine buckets from AUDIENCE_SIGNAL_ORDER, so filtering to the
    // populated ones is this component's job. Without it, a discovery that found two lists renders
    // seven empty cards and the two real results are lost in them.
    render([bucket('event_registration', [list()]), bucket('page_view', []), bucket('uncertain', [])]);

    expect(host().querySelector('[data-testid="audience-bucket-event_registration"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="audience-bucket-page_view"]'), 'an empty bucket was rendered').toBeNull();
  });

  it('shows the empty state when every bucket is empty', () => {
    render([bucket('event_registration', []), bucket('uncertain', [])]);

    expect(host().querySelector('[data-testid="audience-card-grid-empty"]')).not.toBeNull();
  });

  it('renders `uncertain` as a real bucket instead of dropping it', () => {
    // `uncertain` is the classifier's fallback. Hiding it would silently discard lists the
    // classifier could not place -- exactly the lists that need an operator's eyes.
    render([bucket('uncertain', [list({ listId: '999', signal: 'uncertain', name: 'Synthetic - Ambiguous' })])]);

    expect(host().querySelector('[data-testid="audience-bucket-uncertain"]')).not.toBeNull();
  });

  it('emits the list id on toggle and stays silent when disabled', () => {
    const emitted: string[] = [];
    render([bucket('event_registration', [list()])]);
    fixture.componentInstance.toggleList.subscribe((id) => emitted.push(id));

    const toggle = host().querySelector<HTMLElement>('[data-testid="audience-card-grid-toggle-101"]');
    toggle?.click();
    expect(emitted).toEqual(['101']);

    // Degraded mode disables every write action; a toggle that still emitted would let the
    // container build a selection it cannot compose.
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    toggle?.click();
    expect(emitted, 'a disabled toggle still emitted').toEqual(['101']);
  });

  it('renders "size unknown" rather than "0 contacts" for a list with no reported size', () => {
    // HubSpot omits size on some search results. "0 contacts" reads as "this list is empty",
    // which is the opposite of what an absent size means.
    render([bucket('event_registration', [list({ size: undefined })])]);

    const text = host().textContent ?? '';
    expect(text).toContain('size unknown');
    expect(text).not.toContain('0 contacts');
  });
});
