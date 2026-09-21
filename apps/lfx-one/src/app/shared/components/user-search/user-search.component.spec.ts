// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SearchService } from '@services/search.service';
import { USER_SEARCH_EMPTY_MESSAGE } from '@lfx-one/shared/constants';
import { UserSearchOption, UserSearchResult } from '@lfx-one/shared/interfaces';
import { AutoComplete, AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
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
  let searchUsersMock: ReturnType<typeof vi.fn>;

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
      candidates?: readonly UserSearchOption[] | null;
      searchUsers?: ReturnType<typeof vi.fn>;
      /** `null` leaves the corpus unbound, to exercise the misconfiguration path. */
      searchType?: 'committee_member' | null;
    } = {}
  ): Promise<void> => {
    TestBed.resetTestingModule();
    searchUsersMock = overrides.searchUsers ?? vi.fn().mockReturnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [UserSearchComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: SearchService, useValue: { searchUsers: searchUsersMock } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserSearchComponent);
    fixture.componentRef.setInput('form', overrides.form ?? new FormGroup({ ownerUsername: new FormControl<string | null>('') }));
    fixture.componentRef.setInput('usernameControl', 'ownerUsername');
    if (overrides.searchType !== null) {
      fixture.componentRef.setInput('searchType', overrides.searchType ?? 'committee_member');
    }
    fixture.componentRef.setInput('disabled', overrides.disabled ?? false);
    fixture.componentRef.setInput('readonly', overrides.readonly ?? false);
    fixture.componentRef.setInput('requireLfAccount', overrides.requireLfAccount ?? false);
    fixture.componentRef.setInput('showManualEntry', overrides.showManualEntry ?? true);
    fixture.componentRef.setInput('showClear', overrides.showClear ?? false);
    fixture.componentRef.setInput('candidates', overrides.candidates ?? null);
    fixture.componentRef.setInput('dataTestId', 'user-search-test');
    await fixture.whenStable();
  };

  const query = (): HTMLInputElement | null => fixture.nativeElement.querySelector('[data-testid="user-search-test"] input');
  const queryAutocomplete = (): AutocompleteComponent =>
    fixture.debugElement.query(By.directive(AutocompleteComponent)).componentInstance as AutocompleteComponent;
  const suggestions = (): (UserSearchOption & { displayName: string; fullName: string })[] =>
    (fixture.componentInstance as unknown as { suggestions: () => (UserSearchOption & { displayName: string; fullName: string })[] }).suggestions();
  // Drives the search the way p-autocomplete does once its own delay elapses: through completeMethod.
  const typeAndSettle = async (text: string): Promise<void> => {
    fixture.componentInstance.onSearchComplete({ query: text } as AutoCompleteCompleteEvent);
    await fixture.whenStable();
  };

  // #2594: local mode — a caller-supplied list (the formation assignee picker's people on the
  // project) searched client-side, with rows that can be listed but not picked.
  describe('candidates (local mode)', () => {
    const sam: UserSearchOption = {
      ...buildUserSearchResult({
        uid: 'sam',
        first_name: 'Sam Chen',
        last_name: '',
        email: 'sam.chen@cascade-data.example',
        username: 'sam.chen',
        type: 'project_member',
      }),
    };
    const pat: UserSearchOption = {
      ...buildUserSearchResult({ uid: 'pat', first_name: 'Pat Lee', last_name: '', email: 'pat@partner.example', username: null, type: 'project_member' }),
      disabled: true,
      note: 'Invite pending',
    };

    it('filters the list by an email fragment without calling the directory', async () => {
      await render({ candidates: [sam, pat] });

      await typeAndSettle('@partner');

      expect(searchUsersMock).not.toHaveBeenCalled();
      expect(suggestions().map((s) => s.uid)).toEqual(['pat']);
      expect(suggestions()[0].fullName).toBe('Pat Lee');
      expect(suggestions()[0].note).toBe('Invite pending');
    });

    it('filters from a single character — no two-character floor for a local list', async () => {
      await render({ candidates: [sam, pat] });

      await typeAndSettle('s');

      expect(suggestions().map((s) => s.uid)).toEqual(['sam']);
    });

    it('composes a whole-name candidate without a trailing space in the committed label', async () => {
      await render({ candidates: [sam] });

      await typeAndSettle('sam');

      expect(suggestions()[0].displayName).toBe('Sam Chen (sam.chen@cascade-data.example)');
    });

    it('never commits a disabled row, and hands it to onRejectedSelection so the consumer can say why', async () => {
      const form = new FormGroup({ ownerUsername: new FormControl<string | null>('') });
      await render({ candidates: [sam, pat], form, requireLfAccount: true });
      const onUserSelect = vi.fn();
      const onRejectedSelection = vi.fn();
      fixture.componentInstance.onUserSelect.subscribe(onUserSelect);
      fixture.componentInstance.onRejectedSelection.subscribe(onRejectedSelection);

      fixture.componentInstance.onUserSelected({ value: pat } as AutoCompleteSelectEvent);

      expect(form.get('ownerUsername')?.value).toBe('');
      expect(onUserSelect).not.toHaveBeenCalled();
      expect(onRejectedSelection).toHaveBeenCalledWith(pat);
    });

    // PrimeNG's option handler ignores optionDisabled: it commits the option and emits the pick on
    // click and on hover-plus-Enter. Drive that handler directly so a PrimeNG upgrade that changes
    // either half of this contract is caught here rather than by a saved pending invitee.
    it("refuses a disabled row even through PrimeNG's own option handler", async () => {
      const form = new FormGroup({ ownerUsername: new FormControl<string | null>('') });
      await render({ candidates: [sam, pat], form });
      const onUserSelect = vi.fn();
      const onRejectedSelection = vi.fn();
      fixture.componentInstance.onUserSelect.subscribe(onUserSelect);
      fixture.componentInstance.onRejectedSelection.subscribe(onRejectedSelection);

      const autocomplete = fixture.debugElement.query(By.directive(AutoComplete)).componentInstance as AutoComplete;
      autocomplete.onOptionSelect(new MouseEvent('click'), pat);

      expect(form.get('ownerUsername')?.value).toBe('');
      expect(onUserSelect).not.toHaveBeenCalled();
      expect(onRejectedSelection).toHaveBeenCalledWith(pat);
    });

    it('forwards the disabled flag to the autocomplete so the row renders as disabled', async () => {
      await render({ candidates: [sam, pat] });

      expect(queryAutocomplete().optionDisabled()).toBe('disabled');
    });

    it('defaults the empty copy to the shared message', async () => {
      await render();

      expect(fixture.componentInstance.emptyMessage()).toBe(USER_SEARCH_EMPTY_MESSAGE);
    });

    it('keeps the directory search when no candidates are supplied', async () => {
      await render();

      await typeAndSettle('sa');

      expect(searchUsersMock).toHaveBeenCalledWith('sa', 'committee_member');
    });

    // The search is driven by completeMethod alone, not by the search control's valueChanges — the
    // fix for a spinner PrimeNG left stuck when a synchronous local answer landed before its
    // `search()` had opened the panel and the de-duplicated completeMethod then had nothing new to
    // emit. These two pin that design against a "why not valueChanges?" cleanup.
    it('does not search when the internal control is written directly — only completeMethod drives a search', async () => {
      await render();

      (fixture.componentInstance as unknown as { userSearchForm: FormGroup }).userSearchForm.get('userSearch')?.setValue('jane');
      await fixture.whenStable();

      expect(searchUsersMock).not.toHaveBeenCalled();
    });

    it('re-runs the search for a repeated identical completeMethod query, so PrimeNG always gets a fresh suggestions emission', async () => {
      await render();

      await typeAndSettle('jane');
      await typeAndSettle('jane');

      expect(searchUsersMock).toHaveBeenCalledTimes(2);
    });

    it('reports a consumer that binds neither searchType nor candidates instead of failing silently', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await render({ searchType: null });

      await typeAndSettle('sa');

      expect(searchUsersMock).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith('[UserSearchComponent] requires either searchType or candidates');
      consoleError.mockRestore();
    });
  });

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
