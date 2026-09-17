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
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
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
      showClear?: boolean;
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
    fixture.componentRef.setInput('showClear', overrides.showClear ?? false);
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

  // #2588 review (cursor bugbot): PrimeNG's clear icon is gated on [disabled] only, so a
  // readonly-but-not-disabled field with showClear still let the X blank a view-only field.
  // GH-2694: blur's snap-back throws away typed-but-never-selected text — and blur fires before
  // any following click, so the discard happens inside the very gesture that saves (or that picks
  // a suggestion, which is why this is a recorded value consumers pull at their own commit point
  // rather than a blur-time event that would false-fire on every successful mouse selection).
  describe('discarded-text record (GH-2694)', () => {
    const setSearchText = (value: string | object): void => {
      (fixture.componentInstance as unknown as { userSearchForm: FormGroup }).userSearchForm.get('userSearch')?.setValue(value, { emitEvent: false });
    };

    it('records the trimmed typed text when blur snaps back uncommitted text; consuming returns it once', async () => {
      await render();
      fixture.componentRef.setInput('displayValue', '');
      await fixture.whenStable();

      setSearchText('  Nirav  ');
      fixture.componentInstance.onSearchBlur();

      expect(fixture.componentInstance.consumeDiscardedText()).toBe('Nirav');
      // One notice per discard — a consumer that warns and stops can let a repeat action proceed.
      expect(fixture.componentInstance.consumeDiscardedText()).toBeNull();
    });

    it('records nothing when the box just shows the committed label', async () => {
      await render();
      fixture.componentRef.setInput('displayValue', 'Jane Doe (jdoe@example.com)');
      await fixture.whenStable();

      fixture.componentInstance.onSearchBlur();

      expect(fixture.componentInstance.consumeDiscardedText()).toBeNull();
    });

    it('records nothing when blur clears an empty box against a committed label', async () => {
      await render();
      fixture.componentRef.setInput('displayValue', 'Jane Doe (jdoe@example.com)');
      await fixture.whenStable();

      setSearchText('');
      fixture.componentInstance.onSearchBlur();

      expect(fixture.componentInstance.consumeDiscardedText()).toBeNull();
    });

    it('records nothing for a committed selection object still sitting in the control', async () => {
      await render();
      fixture.componentRef.setInput('displayValue', '');
      await fixture.whenStable();

      setSearchText({ displayName: 'Jane Doe (jdoe@example.com)' });
      fixture.componentInstance.onSearchBlur();

      expect(fixture.componentInstance.consumeDiscardedText()).toBeNull();
    });

    it('records nothing for consumers without displayValue — the snap-back itself never runs there', async () => {
      await render();

      setSearchText('typed text');
      fixture.componentInstance.onSearchBlur();

      expect(fixture.componentInstance.consumeDiscardedText()).toBeNull();
    });

    it('a pick supersedes the record — the blur a mouse selection fires first must not leave a stale "not selected" notice', async () => {
      const form = new FormGroup({ ownerUsername: new FormControl<string | null>('') });
      await render({ form });
      fixture.componentRef.setInput('displayValue', '');
      await fixture.whenStable();

      // Mouse-pick sequence: typing, then the pick's own blur (records the text), then the click
      // commits the selection.
      setSearchText('jdo');
      fixture.componentInstance.onSearchBlur();
      fixture.componentInstance.onUserSelected({ value: buildUserSearchResult({ username: 'jdoe' }) } as AutoCompleteSelectEvent);

      expect(fixture.componentInstance.consumeDiscardedText()).toBeNull();
      expect(form.get('ownerUsername')?.value).toBe('jdoe');
    });

    it('a requireLfAccount rejection also supersedes the record — its own "cannot assign" notice is the feedback', async () => {
      await render({ requireLfAccount: true });
      fixture.componentRef.setInput('displayValue', '');
      await fixture.whenStable();

      setSearchText('jdo');
      fixture.componentInstance.onSearchBlur();
      fixture.componentInstance.onUserSelected({ value: buildUserSearchResult({ username: null }) } as AutoCompleteSelectEvent);

      expect(fixture.componentInstance.consumeDiscardedText()).toBeNull();
    });

    it('an explicit clear supersedes the record', async () => {
      await render();
      fixture.componentRef.setInput('displayValue', '');
      await fixture.whenStable();

      setSearchText('jdo');
      fixture.componentInstance.onSearchBlur();
      fixture.componentInstance.onSearchClear();

      expect(fixture.componentInstance.consumeDiscardedText()).toBeNull();
    });

    it('fresh typing supersedes the record', async () => {
      await render();
      fixture.componentRef.setInput('displayValue', '');
      await fixture.whenStable();

      setSearchText('jdo');
      fixture.componentInstance.onSearchBlur();
      fixture.componentInstance.onSearchComplete({ query: 'jan' } as AutoCompleteCompleteEvent);

      expect(fixture.componentInstance.consumeDiscardedText()).toBeNull();
    });
  });

  describe('readonly + showClear interaction', () => {
    it('suppresses the clear icon when readonly, even if showClear is true', async () => {
      await render({ readonly: true, showClear: true });

      expect(queryAutocomplete().showClear()).toBe(false);
    });

    it('still shows the clear icon when showClear is true and not readonly', async () => {
      await render({ readonly: false, showClear: true });

      expect(queryAutocomplete().showClear()).toBe(true);
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
