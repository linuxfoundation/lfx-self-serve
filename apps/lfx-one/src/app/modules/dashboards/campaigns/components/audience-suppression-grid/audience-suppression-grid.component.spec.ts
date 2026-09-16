// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AudienceSuppressionList } from '@lfx-one/shared/interfaces';

import { AudienceSuppressionGridComponent } from './audience-suppression-grid.component';

function suppression(overrides: Partial<AudienceSuppressionList> = {}): AudienceSuppressionList {
  return {
    key: 'lf_events_gdpr',
    label: 'LF Events GDPR',
    listId: '201',
    name: 'LF Events - GDPR Suppression',
    size: 5000,
    category: 'standard',
    hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/201',
    ...overrides,
  };
}

describe('AudienceSuppressionGridComponent', () => {
  let fixture: ComponentFixture<AudienceSuppressionGridComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AudienceSuppressionGridComponent] }).compileComponents();
    fixture = TestBed.createComponent(AudienceSuppressionGridComponent);
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function render(lists: AudienceSuppressionList[], extra: { loading?: boolean; disabled?: boolean } = {}): void {
    fixture.componentRef.setInput('lists', lists);
    fixture.componentRef.setInput('selectedKeys', new Set<string>());
    fixture.componentRef.setInput('loading', extra.loading ?? false);
    fixture.componentRef.setInput('disabled', extra.disabled ?? false);
    fixture.detectChanges();
  }

  it('cannot tick a hygiene list the portal does not hold', () => {
    // The service returns an unresolved standard term WITH its key and label but an EMPTY
    // listId, so the operator can see it was looked for and not found. Rendering it as
    // tickable stored '', which the controller strips on the way out — so compose proceeded
    // without that exclusion while the grid showed it applied. A regulatory exclusion the
    // UI claims is on and the send does not carry is the worst failure this panel has.
    render([suppression({ key: 'lf_global_optout', label: 'LF Global Opt-Outs', listId: '', name: '', hubspotUrl: '', size: undefined })]);

    const boxes = host().querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes.length, 'the unresolved row should still be VISIBLE, just not selectable').toBe(1);
    expect(boxes[0].disabled, 'an unresolved hygiene row was selectable; ticking it emits an id that is later stripped').toBe(true);

    expect(
      host().querySelector('[data-testid="audience-suppression-grid-unresolved-lf_global_optout"]'),
      'the row must say it cannot be applied'
    ).not.toBeNull();
    expect(host().querySelector('[data-testid="audience-suppression-grid-link-"]'), 'an empty list id must not render a HubSpot link').toBeNull();

    // `name` is empty by contract on an unresolved row, and an aria-label OVERRIDES the visible
    // label — so naming it off `name` alone leaves screen-reader users with a bare "Exclude" and
    // no way to tell which regulatory term could not be applied.
    expect(boxes[0].getAttribute('aria-label'), 'an unresolved row announced no identity to assistive tech').toBe('Exclude LF Global Opt-Outs');
  });

  it('never emits an empty list id from the toggle handler', () => {
    // Belt and braces: the template controls what is clickable, this controls what can ever
    // be emitted. A future template edit must not be able to reintroduce the empty id.
    render([suppression({ key: 'lf_global_optout', listId: '', name: '', hubspotUrl: '' })]);
    const emitted: string[] = [];
    fixture.componentInstance.toggleList.subscribe((key: string) => emitted.push(key));

    // The guard is on the resolved LIST id even though the key is what gets emitted: an
    // unresolved row has a perfectly good key, and emitting it would store a suppression whose
    // list id is empty — the exact state the controller later strips, silently dropping the
    // exclusion while the grid shows it ticked.
    (fixture.componentInstance as unknown as { onToggle(key: string, listId: string): void }).onToggle('lf_global_optout', '');

    expect(emitted, 'the toggle emitted a row whose list id is empty').toEqual([]);
  });

  it('orders groups event-specific first, then brand, then portfolio-wide', () => {
    // The order is a judgement, not alphabetical: a per-event suppression list carried over from a
    // prior edition already bundles that edition's registrant and unsubscribe exclusions, so it is
    // the highest-value pick and must be the one the operator sees first.
    render([
      suppression({ listId: '1', category: 'standard' }),
      suppression({ listId: '2', category: 'event_specific' }),
      suppression({ listId: '3', category: 'brand' }),
    ]);

    const rendered = [...host().querySelectorAll('[data-testid^="audience-suppression-group-"]')].map((element) => element.getAttribute('data-testid'));
    expect(rendered).toEqual(['audience-suppression-group-event_specific', 'audience-suppression-group-brand', 'audience-suppression-group-standard']);
  });

  it('omits a category with no lists instead of rendering an empty group header', () => {
    render([suppression({ category: 'standard' })]);

    expect(host().querySelector('[data-testid="audience-suppression-group-standard"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="audience-suppression-group-brand"]')).toBeNull();
  });

  it('shows loading and empty as distinct states', () => {
    // "No suppression lists found" while the lookup is still in flight would tell the operator to
    // send without suppression -- a GDPR problem, not a cosmetic one.
    render([], { loading: true });
    expect(host().querySelector('[data-testid="audience-suppression-loading"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="audience-suppression-empty"]')).toBeNull();

    render([], { loading: false });
    expect(host().querySelector('[data-testid="audience-suppression-empty"]')).not.toBeNull();
  });

  it('emits the row key on toggle, not the list id', () => {
    // Several standard terms can resolve to the SAME HubSpot list, so the key is the selection
    // identity. Emitting the list id made every row sharing that id tick and untick as one.
    const emitted: string[] = [];
    render([suppression()]);
    fixture.componentInstance.toggleList.subscribe((key) => emitted.push(key));

    host().querySelector<HTMLElement>('[data-testid="audience-suppression-grid-toggle-lf_events_gdpr"]')?.click();

    expect(emitted).toEqual(['lf_events_gdpr']);
  });

  it('ticks only the row the operator chose when two terms share one list', () => {
    // The defect this keying prevents: with selection keyed by list id, checking one of two
    // rows resolving to list 201 rendered BOTH as ticked, overstating which regulatory terms
    // the operator had actually applied.
    render([
      suppression({ key: 'lf_events_gdpr', label: 'LF Events GDPR', listId: '201' }),
      suppression({ key: 'lf_global_optout', label: 'LF Global Opt-Outs', listId: '201' }),
    ]);
    fixture.componentRef.setInput('selectedKeys', new Set(['lf_events_gdpr']));
    fixture.detectChanges();

    const boxes = host().querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes.length, 'fixture precondition: both rows must render').toBe(2);
    expect(
      [...boxes].map((box) => box.checked),
      'a second term sharing the same list id was ticked without the operator choosing it'
    ).toEqual([true, false]);
  });
});
