// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SearchService } from '@services/search.service';
import { UserSearchResult } from '@lfx-one/shared/interfaces';
import { AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutocompleteComponent } from '../autocomplete/autocomplete.component';
import { UserSearchComponent } from './user-search.component';

function buildUserSearchResult(overrides: Partial<UserSearchResult>): UserSearchResult {
  return {
    uid: 'user:test',
    email: 'jdoe@example.com',
    first_name: 'Jane',
    last_name: 'Doe',
    job_title: null,
    organization: null,
    type: 'committee_member',
    username: 'jdoe',
    ...overrides,
  };
}

describe('UserSearchComponent', () => {
  let fixture: ComponentFixture<UserSearchComponent>;

  afterEach(() => {
    fixture?.destroy();
  });

  const render = async (
    overrides: {
      disabled?: boolean;
      readonly?: boolean;
      requireLfAccount?: boolean;
      showManualEntry?: boolean;
      form?: FormGroup;
    } = {}
  ): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [UserSearchComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: SearchService, useValue: { searchUsers: vi.fn().mockReturnValue(of([])) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserSearchComponent);
    fixture.componentRef.setInput('form', overrides.form ?? new FormGroup({ ownerUsername: new FormControl<string | null>('') }));
    fixture.componentRef.setInput('usernameControl', 'ownerUsername');
    fixture.componentRef.setInput('searchType', 'committee_member');
    fixture.componentRef.setInput('disabled', overrides.disabled ?? false);
    fixture.componentRef.setInput('readonly', overrides.readonly ?? false);
    fixture.componentRef.setInput('requireLfAccount', overrides.requireLfAccount ?? false);
    fixture.componentRef.setInput('showManualEntry', overrides.showManualEntry ?? true);
    fixture.componentRef.setInput('dataTestId', 'user-search-test');
    await fixture.whenStable();
  };

  const query = (): HTMLInputElement | null => fixture.nativeElement.querySelector('[data-testid="user-search-test"] input');
  const queryAutocomplete = (): AutocompleteComponent =>
    fixture.debugElement.query(By.directive(AutocompleteComponent)).componentInstance as AutocompleteComponent;

  // #2583: `disabled` was previously declared but never wired to the underlying control — these
  // two tests exist solely to cover that fix, not to re-test the component's existing
  // search/select/clear behavior.
  it('disables the underlying input when disabled is true', async () => {
    await render({ disabled: true });

    expect(query()?.disabled).toBe(true);
  });

  it('leaves the input enabled by default', async () => {
    await render();

    expect(query()?.disabled).toBe(false);
  });

  // #2588 review: readonly keeps the field focusable/announced by assistive tech, unlike disabled.
  it('marks the underlying input readonly when readonly is true', async () => {
    await render({ readonly: true });

    expect(query()?.readOnly).toBe(true);
    expect(query()?.disabled).toBe(false);
  });

  it('leaves the input non-readonly by default', async () => {
    await render();

    expect(query()?.readOnly).toBe(false);
  });

  describe('requireLfAccount', () => {
    it('rejects a no-account pick without touching bound controls, and emits onRejectedSelection instead of onUserSelect', async () => {
      const form = new FormGroup({ ownerUsername: new FormControl<string | null>('jdoe') });
      await render({ requireLfAccount: true, form });
      const onUserSelect = vi.fn();
      const onRejectedSelection = vi.fn();
      fixture.componentInstance.onUserSelect.subscribe(onUserSelect);
      fixture.componentInstance.onRejectedSelection.subscribe(onRejectedSelection);

      const rejected = buildUserSearchResult({ username: null });
      fixture.componentInstance.onUserSelected({ value: rejected } as AutoCompleteSelectEvent);

      expect(form.get('ownerUsername')?.value).toBe('jdoe');
      expect(onUserSelect).not.toHaveBeenCalled();
      expect(onRejectedSelection).toHaveBeenCalledWith(rejected);
    });

    it('accepts a valid pick normally, emitting onUserSelect and patching the bound control', async () => {
      const form = new FormGroup({ ownerUsername: new FormControl<string | null>('') });
      await render({ requireLfAccount: true, form });
      const onUserSelect = vi.fn();
      const onRejectedSelection = vi.fn();
      fixture.componentInstance.onUserSelect.subscribe(onUserSelect);
      fixture.componentInstance.onRejectedSelection.subscribe(onRejectedSelection);

      const accepted = buildUserSearchResult({ username: 'jdoe' });
      fixture.componentInstance.onUserSelected({ value: accepted } as AutoCompleteSelectEvent);

      expect(form.get('ownerUsername')?.value).toBe('jdoe');
      expect(onUserSelect).toHaveBeenCalledWith(accepted);
      expect(onRejectedSelection).not.toHaveBeenCalled();
    });
  });

  describe('showManualEntry', () => {
    it('registers the manual-entry footer template by default', async () => {
      await render();

      expect(queryAutocomplete().footerTemplate).toBeTruthy();
    });

    it('does not register the manual-entry footer template when showManualEntry is false', async () => {
      await render({ showManualEntry: false });

      expect(queryAutocomplete().footerTemplate).toBeFalsy();
    });
  });
});
