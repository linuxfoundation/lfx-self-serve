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

  function expandStandard(): void {
    host().querySelector<HTMLElement>('[data-testid="audience-suppression-standard-expand"]')?.click();
    fixture.detectChanges();
  }

  function checkbox(testId: string): HTMLInputElement | null {
    return host().querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  }

  it('cannot tick a hygiene list the portal does not hold', () => {
    // The service returns an unresolved standard term WITH its key and label but an EMPTY
    // listId, so the operator can see it was looked for and not found. Rendering it as
    // tickable stored '', which the controller strips on the way out — so compose proceeded
    // without that exclusion while the grid showed it applied. A regulatory exclusion the
    // UI claims is on and the send does not carry is the worst failure this panel has.
    render([suppression({ key: 'lf_global_optout', label: 'LF Global Opt-Outs', listId: '', name: '', hubspotUrl: '', size: undefined })]);
    expect(host().querySelector('[data-testid="audience-suppression-standard-unresolved"]')?.textContent).toContain('1 not found');
    expect(checkbox('audience-suppression-grid-toggle-standard')?.disabled, 'nothing resolved, so the standard entry cannot be ticked').toBe(true);

    expandStandard();
    const row = checkbox('audience-suppression-grid-toggle-lf_global_optout');
    expect(row, 'the unresolved row should still be VISIBLE, just not selectable').not.toBeNull();
    expect(row?.disabled, 'an unresolved hygiene row was selectable; ticking it emits an id that is later stripped').toBe(true);
    expect(
      host().querySelector('[data-testid="audience-suppression-grid-unresolved-lf_global_optout"]'),
      'the row must say it cannot be applied'
    ).not.toBeNull();
    expect(host().querySelector('[data-testid="audience-suppression-grid-link-"]'), 'an empty list id must not render a HubSpot link').toBeNull();

    // `name` is empty by contract on an unresolved row, and an aria-label OVERRIDES the visible
    // label — so naming it off `name` alone leaves screen-reader users with a bare "Exclude" and
    // no way to tell which regulatory term could not be applied.
    expect(row?.getAttribute('aria-label'), 'an unresolved row announced no identity to assistive tech').toBe('Exclude LF Global Opt-Outs');
  });

  it('never emits an empty list id from the toggle handler, except for a list the attach creates', () => {
    // Belt and braces: the template controls what is clickable, this controls what can ever
    // be emitted. A future template edit must not be able to reintroduce the empty id.
    render([]);
    const emitted: string[] = [];
    fixture.componentInstance.toggleList.subscribe((key: string) => emitted.push(key));
    const grid = fixture.componentInstance as unknown as { onToggle(list: AudienceSuppressionList): void };

    grid.onToggle(suppression({ key: 'lf_global_optout', listId: '', name: '', hubspotUrl: '' }));
    expect(emitted, 'the toggle emitted a row whose list id is empty').toEqual([]);

    grid.onToggle(suppression({ key: 'current_registrants', listId: '', category: 'current_registrants', willCreate: true }));
    expect(emitted, 'a registrants row whose list the attach creates is tickable').toEqual(['current_registrants']);
  });

  it('links a resolved row to HubSpot only when it has a URL', () => {
    // A blank URL renders href="", which opens this app instead of the list.
    render([suppression({ category: 'brand', key: 'brand_a' }), suppression({ category: 'brand', key: 'brand_b', listId: '202', hubspotUrl: '' })]);

    const link = host().querySelector<HTMLAnchorElement>('[data-testid="audience-suppression-grid-link-201"]');
    expect(link?.getAttribute('href')).toBe('https://app.hubspot.com/contacts/1/objectLists/201');
    expect(host().querySelector('[data-testid="audience-suppression-grid-link-202"]'), 'a blank URL rendered a link back to this app').toBeNull();
  });

  it('orders groups current registrants first, then event-specific, brand and the standard entry', () => {
    render([
      suppression({ key: 's', listId: '1', category: 'standard' }),
      suppression({ key: 'e', listId: '2', category: 'event_specific' }),
      suppression({ key: 'b', listId: '3', category: 'brand' }),
      suppression({ key: 'r', listId: '4', category: 'current_registrants' }),
    ]);

    const rendered = [...host().querySelectorAll('[data-testid^="audience-suppression-group-"]')].map((element) => element.getAttribute('data-testid'));
    expect(rendered).toEqual([
      'audience-suppression-group-current_registrants',
      'audience-suppression-group-event_specific',
      'audience-suppression-group-brand',
      'audience-suppression-group-standard',
    ]);
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
    render([suppression({ category: 'brand', key: 'brand_opt_outs' })]);
    fixture.componentInstance.toggleList.subscribe((key) => emitted.push(key));

    checkbox('audience-suppression-grid-toggle-brand_opt_outs')?.click();

    expect(emitted).toEqual(['brand_opt_outs']);
  });

  it('shows the standard lists as one entry that ticks or unticks every resolved row', () => {
    render([
      suppression({ key: 'lf_events_gdpr', listId: '201' }),
      suppression({ key: 'lf_global_optout', listId: '202' }),
      suppression({ key: 'kernel', listId: '', name: '', hubspotUrl: '' }),
    ]);
    const emitted: { keys: readonly string[]; selected: boolean }[] = [];
    fixture.componentInstance.toggleStandard.subscribe((change) => emitted.push(change));

    expect(checkbox('audience-suppression-grid-toggle-lf_events_gdpr'), 'members are collapsed into the one entry').toBeNull();
    checkbox('audience-suppression-grid-toggle-standard')?.click();
    expect(emitted.at(-1)).toEqual({ keys: ['lf_events_gdpr', 'lf_global_optout'], selected: true });

    fixture.componentRef.setInput('selectedKeys', new Set(['lf_events_gdpr', 'lf_global_optout']));
    fixture.detectChanges();
    expect(checkbox('audience-suppression-grid-toggle-standard')?.checked).toBe(true);
    expect(host().querySelector('[data-testid="audience-suppression-standard-count"]')?.textContent?.trim()).toBe('2 of 2');
    checkbox('audience-suppression-grid-toggle-standard')?.click();
    expect(emitted.at(-1)).toEqual({ keys: ['lf_events_gdpr', 'lf_global_optout'], selected: false });
  });

  it('says a partial standard selection is applied list by list', () => {
    render([suppression({ key: 'lf_events_gdpr', listId: '201' }), suppression({ key: 'lf_global_optout', listId: '202' })]);
    fixture.componentRef.setInput('selectedKeys', new Set(['lf_events_gdpr']));
    fixture.detectChanges();

    expect(checkbox('audience-suppression-grid-toggle-standard')?.indeterminate).toBe(true);
    expect(host().querySelector('[data-testid="audience-suppression-standard-partial"]')).not.toBeNull();
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
    expandStandard();

    expect(
      [checkbox('audience-suppression-grid-toggle-lf_events_gdpr')?.checked, checkbox('audience-suppression-grid-toggle-lf_global_optout')?.checked],
      'a second term sharing the same list id was ticked without the operator choosing it'
    ).toEqual([true, false]);
  });

  it('marks a current-registrants row whose list does not exist yet as created on attach', () => {
    render([
      suppression({
        key: 'current_registrants',
        label: 'Current registrants - Synthetic Summit 2026',
        listId: '',
        name: 'Synthetic Summit 2026 - Current Registrants',
        category: 'current_registrants',
        hubspotUrl: '',
        willCreate: true,
      }),
    ]);

    expect(checkbox('audience-suppression-grid-toggle-current_registrants')?.disabled).toBe(false);
    expect(host().querySelector('[data-testid="audience-suppression-grid-will-create-current_registrants"]')).not.toBeNull();
  });

  it('warns that a current-registrants row the portal could not resolve cannot be applied', () => {
    render([
      suppression({
        key: 'current_registrants',
        label: 'Current registrants',
        listId: '',
        name: '',
        hubspotUrl: '',
        size: undefined,
        category: 'current_registrants',
      }),
    ]);

    expect(host().querySelector('[data-testid="audience-suppression-grid-unresolved-current_registrants"]')).not.toBeNull();
    expect(checkbox('audience-suppression-grid-toggle-current_registrants')?.disabled).toBe(true);
  });

  it('describes the standing list, not one-by-one, when an unticked term shares a ticked list id', () => {
    // Two terms resolve to list 201. Unticking one leaves the row checkbox indeterminate, yet every
    // resolved LIST is still excluded, so upstream still applies the standing list.
    fixture.componentRef.setInput('lists', [suppression(), suppression({ key: 'lf_events_gdpr_alias', label: 'GDPR alias' })]);
    fixture.componentRef.setInput('selectedKeys', new Set(['lf_events_gdpr']));
    fixture.componentRef.setInput('standardList', null);
    fixture.detectChanges();

    expect(checkbox('audience-suppression-grid-toggle-standard')?.indeterminate).toBe(true);
    expect(host().querySelector('[data-testid="audience-suppression-standard-partial"]'), 'promised one-by-one exclusions').toBeNull();
    expect(host().querySelector('[data-testid="audience-suppression-standard-will-create"]')).not.toBeNull();
  });
});
