// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { OrganizationSuggestion } from '@lfx-one/shared';
import { OrganizationService } from '@services/organization.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrganizationSearchComponent } from './organization-search.component';

/**
 * Regression coverage for the typing-over-a-selection bug (PR #2551 review): PrimeNG's
 * onInput() writes `undefined` to the search control on every keystroke (optionValue="name"),
 * which used to bounce through invalidateStaleSelection() and the parent-name mirror and blank
 * the visible input before the debounced resync caught up.
 */
describe('OrganizationSearchComponent', () => {
  let fixture: ComponentFixture<OrganizationSearchComponent>;
  let form: FormGroup;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrganizationSearchComponent],
      providers: [
        {
          provide: OrganizationService,
          useValue: {
            searchOrganizations: () => of([]),
            registerSessionOrg: () => undefined,
          },
        },
      ],
    }).compileComponents();

    form = new FormGroup({
      organization: new FormControl('acme corp'),
      organization_id: new FormControl('org-123'),
    });

    fixture = TestBed.createComponent(OrganizationSearchComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('nameControl', 'organization');
    fixture.componentRef.setInput('idControl', 'organization_id');
    await fixture.whenStable();
  });

  function searchInput(): HTMLInputElement {
    const el = fixture.nativeElement.querySelector('[data-testid="organization-search"] input');
    if (!el) throw new Error('search input not rendered');
    return el as HTMLInputElement;
  }

  it('keeps the typed text visible when typing over a selected organization', async () => {
    // Preload a selection (mirrors an edit-mode/previously-resolved org), matching the input's value.
    await fixture.whenStable();
    expect(searchInput().value).toBe('acme corp');

    // Simulate PrimeNG's onInput(): types over the selection, which — with optionValue="name" —
    // writes `undefined` to the bound control before resyncing via the debounced completeMethod.
    searchInput().value = 'acme corp updated';
    searchInput().dispatchEvent(new Event('input'));
    await fixture.whenStable();

    // The defect: the mirror echoed invalidateStaleSelection's parent-name '' write back into the
    // input, wiping the keystroke. It must retain what the user actually typed.
    expect(searchInput().value).toBe('acme corp updated');
  });

  it('forwards the id, error description and invalid state to the search box so a parent label can name it', async () => {
    fixture.componentRef.setInput('inputId', 'pa-organization');
    fixture.componentRef.setInput('describedBy', 'pa-organization-error');
    fixture.componentRef.setInput('invalid', true);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(searchInput().id).toBe('pa-organization');
    expect(searchInput().getAttribute('aria-describedby')).toBe('pa-organization-error');
    expect(searchInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('renders no aria-required unless the parent marks the field required', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect(searchInput().hasAttribute('aria-required')).toBe(false);
  });

  it('sets aria-required on the search box when the parent marks the field required', async () => {
    fixture.componentRef.setInput('required', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(searchInput().getAttribute('aria-required')).toBe('true');
  });

  it('re-applies aria-required when the search box is rebuilt after a manual-mode round trip', async () => {
    fixture.componentRef.setInput('required', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(searchInput().getAttribute('aria-required')).toBe('true');

    fixture.componentInstance.switchToManualMode();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.switchToSearchMode();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(searchInput().getAttribute('aria-required')).toBe('true');
  });

  it('still invalidates the stale resolved id once the user types past the selection', async () => {
    searchInput().value = 'acme corp updated';
    searchInput().dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(form.get('organization_id')?.value).toBeNull();
  });

  it('clears the parent name control immediately, rather than leaving the stale selection', async () => {
    searchInput().value = 'acme corp updated';
    searchInput().dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(form.get('organization')?.value).toBe('');
  });

  it('routes a domainless CDP pick into manual mode when requireDomainForCdpMatch is set (committee flows)', async () => {
    fixture.componentRef.setInput('requireDomainForCdpMatch', true);
    await fixture.whenStable();

    const domainless: OrganizationSuggestion = { name: 'CDP Only Co', domain: '', id: 'cdp-1' };
    fixture.componentInstance.onOrganizationSelected({ value: domainless } as AutoCompleteSelectEvent);
    await fixture.whenStable();

    expect(fixture.componentInstance.manualMode()).toBe(true);
    expect(form.get('organization_id')?.value).toBeNull();
  });

  it('emits a resolved suggestion directly for a domainless CDP pick when requireDomainForCdpMatch is unset (e.g. work experience)', async () => {
    fixture.componentRef.setInput('domainRequired', true);
    await fixture.whenStable();

    const domainless: OrganizationSuggestion = { name: 'CDP Only Co', domain: '', id: 'cdp-1' };
    fixture.componentInstance.onOrganizationSelected({ value: domainless } as AutoCompleteSelectEvent);
    await fixture.whenStable();

    expect(fixture.componentInstance.manualMode()).toBe(false);
    expect(fixture.componentInstance.resolvedOrg()?.id).toBe('cdp-1');
  });
});

/**
 * resolveOnSelect=false (#5251): the field is a plain name picker. Nothing in it may reach
 * POST /api/organizations/resolve, and typed text that is never picked must still reach the parent
 * control. Uses the real OrganizationService over the HTTP testing backend so the assertions are on
 * the wire, not on a stub.
 */
describe('OrganizationSearchComponent with resolveOnSelect=false', () => {
  const RESOLVE_URL = '/api/organizations/resolve';
  let fixture: ComponentFixture<OrganizationSearchComponent>;
  let form: FormGroup;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrganizationSearchComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    form = new FormGroup({
      organization: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
      organization_id: new FormControl<string | null>('stale-id'),
    });

    fixture = TestBed.createComponent(OrganizationSearchComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('nameControl', 'organization');
    fixture.componentRef.setInput('resolveOnSelect', false);
    await fixture.whenStable();
  });

  function searchInput(): HTMLInputElement {
    const el = fixture.nativeElement.querySelector('[data-testid="organization-search"] input');
    if (!el) throw new Error('search input not rendered');
    return el as HTMLInputElement;
  }

  function type(text: string): void {
    searchInput().value = text;
    searchInput().dispatchEvent(new Event('input', { bubbles: true }));
  }

  function completeSearch(query: string): void {
    fixture.componentInstance.onSearchComplete({ query } as AutoCompleteCompleteEvent);
  }

  function pick(suggestion: OrganizationSuggestion): void {
    fixture.componentInstance.onOrganizationSelected({ value: suggestion } as AutoCompleteSelectEvent);
  }

  it('writes the name and emits the selection for a pick without an id, with no /resolve request', async () => {
    const emitted: OrganizationSuggestion[] = [];
    fixture.componentInstance.onOrganizationSelect.subscribe((org) => emitted.push(org));
    const suggestion: OrganizationSuggestion = { name: 'Acme Motors', domain: 'acme-motors.example' };

    pick(suggestion);
    await fixture.whenStable();

    expect(form.get('organization')?.value).toBe('Acme Motors');
    expect(emitted).toEqual([suggestion]);
    expect(fixture.componentInstance.resolvingOrg()).toBe(false);
    http.expectNone(RESOLVE_URL);
  });

  it('writes the name for a CDP-matched pick (with an id) without emitting a resolved result or calling /resolve', async () => {
    const resolved: unknown[] = [];
    fixture.componentInstance.onOrganizationResolved.subscribe((result) => resolved.push(result));

    pick({ name: 'Vendor Corp', domain: '', id: 'cdp-1' });
    await fixture.whenStable();

    expect(form.get('organization')?.value).toBe('Vendor Corp');
    expect(resolved).toEqual([]);
    http.expectNone(RESOLVE_URL);
  });

  it('does not switch to manual mode for a domainless pick even when requireDomainForCdpMatch is set', async () => {
    fixture.componentRef.setInput('requireDomainForCdpMatch', true);
    await fixture.whenStable();

    pick({ name: 'Vendor Corp', domain: '', id: 'cdp-1' });
    await fixture.whenStable();

    expect(fixture.componentInstance.manualMode()).toBe(false);
    expect(form.get('organization')?.value).toBe('Vendor Corp');
    http.expectNone(RESOLVE_URL);
  });

  it('mirrors typed text into the control once the search settles, clearing the required error', async () => {
    expect(form.get('organization')?.valid).toBe(false);

    type('Acme Motors');
    completeSearch('Acme Motors');
    await fixture.whenStable();

    expect(form.get('organization')?.value).toBe('Acme Motors');
    expect(form.get('organization')?.valid).toBe(true);
    http.expectNone(RESOLVE_URL);
  });

  it('keeps the typed text on blur without waiting for the debounced search, with no snap-back', async () => {
    type('Acme Motors');
    searchInput().dispatchEvent(new Event('blur'));
    await fixture.whenStable();

    expect(form.get('organization')?.value).toBe('Acme Motors');
    expect(form.get('organization')?.valid).toBe(true);
    expect(searchInput().value).toBe('Acme Motors');
    expect(fixture.componentInstance.manualMode()).toBe(false);
    http.expectNone(RESOLVE_URL);
  });

  it('mirrors each keystroke immediately, so a submit inside the search debounce sends the full text', async () => {
    type('Ac');
    type('Acme');
    await fixture.whenStable();

    expect(form.get('organization')?.value).toBe('Acme');
  });

  it('marks the parent control touched on blur so an empty required field shows its error', async () => {
    expect(form.get('organization')?.touched).toBe(false);

    searchInput().dispatchEvent(new Event('blur'));
    await fixture.whenStable();

    expect(form.get('organization')?.touched).toBe(true);
    expect(form.get('organization')?.hasError('required')).toBe(true);
  });

  it('does not trim the visible input while typing a trailing space', async () => {
    type('Acme ');
    completeSearch('Acme ');
    await fixture.whenStable();

    expect(searchInput().value).toBe('Acme ');
    expect(form.get('organization')?.value).toBe('Acme');
  });

  it('does not search again for the picked name, but still searches once the user edits it', async () => {
    const SEARCH_URL = '/api/organizations/search';
    const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 350));
    const searchControl = (fixture.componentInstance as unknown as { organizationForm: FormGroup }).organizationForm.get('organizationSearch')!;

    pick({ name: 'Acme Motors', domain: 'acme-motors.example' });
    // PrimeNG writes the picked name back into the box, which is what used to trigger the extra search.
    searchControl.setValue('Acme Motors');
    await wait();

    http.expectNone((req) => req.url === SEARCH_URL);

    searchControl.setValue('Acme Motors Labs');
    await wait();

    expect(http.match((req) => req.url === SEARCH_URL && req.params.get('query') === 'Acme Motors Labs')).toHaveLength(1);
  });

  it('lets a later pick overwrite typed text', async () => {
    type('Acm');
    completeSearch('Acm');
    pick({ name: 'Acme Motors', domain: 'acme-motors.example' });
    await fixture.whenStable();

    expect(form.get('organization')?.value).toBe('Acme Motors');
    http.expectNone(RESOLVE_URL);
  });

  it('empties the control when the box is cleared', async () => {
    type('Acme Motors');
    completeSearch('Acme Motors');
    await fixture.whenStable();

    type('');
    searchInput().dispatchEvent(new Event('blur'));
    await fixture.whenStable();

    expect(form.get('organization')?.value).toBe('');
    expect(form.get('organization')?.hasError('required')).toBe(true);
    http.expectNone(RESOLVE_URL);
  });

  it('keeps the control a string when the clear handler runs', async () => {
    pick({ name: 'Acme Motors', domain: 'acme-motors.example' });
    fixture.componentInstance.onSearchClear();
    await fixture.whenStable();

    expect(form.get('organization')?.value).toBe('');
  });

  it('resolveCurrentEntry makes no request and returns null', async () => {
    form.get('organization')?.setValue('Acme Motors');
    let result: unknown = 'unset';

    fixture.componentInstance.resolveCurrentEntry().subscribe((value) => (result = value));
    await fixture.whenStable();

    expect(result).toBeNull();
    http.expectNone(RESOLVE_URL);
  });

  it('shows a prefilled name in the box and mirrors an edit of it', async () => {
    form.get('organization')?.setValue('Acme Motors');
    await fixture.whenStable();
    expect(searchInput().value).toBe('Acme Motors');

    type('Acme Motors Ltd');
    searchInput().dispatchEvent(new Event('blur'));
    await fixture.whenStable();

    expect(form.get('organization')?.value).toBe('Acme Motors Ltd');
    http.expectNone(RESOLVE_URL);
  });
});

describe('OrganizationSearchComponent default resolveOnSelect', () => {
  it('still resolves a pick without an id and leaves a typed-only entry out of the parent control', async () => {
    const resolveCalls: string[] = [];
    await TestBed.configureTestingModule({
      imports: [OrganizationSearchComponent],
      providers: [
        {
          provide: OrganizationService,
          useValue: {
            searchOrganizations: () => of([]),
            registerSessionOrg: () => undefined,
            resolveOrganization: (name: string) => {
              resolveCalls.push(name);
              return of({ id: 'cdp-9', name, logo: '' });
            },
          },
        },
      ],
    }).compileComponents();
    const form = new FormGroup({ organization: new FormControl<string>('') });
    const fixture = TestBed.createComponent(OrganizationSearchComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('nameControl', 'organization');
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('[data-testid="organization-search"] input') as HTMLInputElement;
    input.value = 'typed only';
    input.dispatchEvent(new Event('input'));
    fixture.componentInstance.onSearchComplete({ query: 'typed only' } as AutoCompleteCompleteEvent);
    input.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(form.get('organization')?.value).toBe('');
    expect(resolveCalls).toEqual([]);

    fixture.componentInstance.onOrganizationSelected({ value: { name: 'Acme Motors', domain: 'acme-motors.example' } } as AutoCompleteSelectEvent);
    await fixture.whenStable();
    expect(resolveCalls).toEqual(['Acme Motors']);
  });
});
