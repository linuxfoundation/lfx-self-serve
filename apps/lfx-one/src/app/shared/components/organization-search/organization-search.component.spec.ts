// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { OrganizationService } from '@services/organization.service';
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
});
