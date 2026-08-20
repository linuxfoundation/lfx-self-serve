// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, input, output, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { UserSearchResult } from '@lfx-one/shared/interfaces';
import { rankUserSearchResults } from '@lfx-one/shared/utils';
import { SearchService } from '@services/search.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { AutocompleteComponent } from '../autocomplete/autocomplete.component';

@Component({
  selector: 'lfx-user-search',
  imports: [AutocompleteComponent, ReactiveFormsModule],
  templateUrl: './user-search.component.html',
})
export class UserSearchComponent {
  private readonly searchService = inject(SearchService);
  private readonly destroyRef = inject(DestroyRef);

  // Required inputs
  public form = input.required<FormGroup>();
  public searchType = input.required<'committee_member' | 'meeting_registrant'>();

  // Optional inputs for form control names
  public emailControl = input<string>();
  public firstNameControl = input<string>();
  public lastNameControl = input<string>();
  public jobTitleControl = input<string>();
  public organizationNameControl = input<string>();
  public organizationWebsiteControl = input<string>();
  public usernameControl = input<string>();

  // Parent-composed committed label (e.g. "Name (email)"). When supplied, this becomes the single
  // source of truth for the input box's text — hydration, selection, and clear all render through
  // it instead of the box blanking itself after a pick. Consumers that don't supply it (e.g.
  // registrant-form) keep today's behavior: seed-from-email on hydrate, blank-on-select.
  public displayValue = input<string | null>(null);
  // Forwarded to lfx-autocomplete's [showClear]. Only meaningful alongside displayValue — without
  // a committed label to restore, an in-field clear icon would just blank the box permanently.
  public showClear = input<boolean>(false);

  // UI customization inputs
  public placeholder = input<string>('Search users...');
  public styleClass = input<string>();
  public inputStyleClass = input<string>();
  public panelStyleClass = input<string>();
  public dataTestId = input<string>('user-search');
  public disabled = input<boolean>(false);
  // Forwarded to the underlying p-autocomplete input so an external <label for> can target it.
  public inputId = input<string>();

  // Outputs
  public readonly onUserSelect = output<UserSearchResult>();
  public readonly onManualEntry = output<void>();
  // Emitted after a clear so consumers can reset controls this component doesn't bind (e.g. a
  // display-name control composed by the parent) in the same tick as the bound-control resets.
  public readonly onClear = output<void>();

  // Internal form for the search input
  protected readonly userSearchForm = new FormGroup({
    userSearch: new FormControl<string>(''),
  });

  // Initialize suggestions as a signal based on search query changes
  protected suggestions: Signal<(UserSearchResult & { displayName: string })[]>;

  public constructor() {
    // Initialize suggestions signal that reacts to search query changes
    const searchResults$ = this.userSearchForm.get('userSearch')!.valueChanges.pipe(
      startWith(''),
      distinctUntilChanged(),
      debounceTime(300),
      switchMap((searchTerm: string | object | null) => {
        const trimmedTerm = typeof searchTerm === 'string' ? searchTerm.trim() : '';

        // Only fetch suggestions when user types at least 2 characters
        if (trimmedTerm.length < 2) {
          return of([]);
        }

        // Use the search type from input, then re-rank so name matches surface
        // first and incidental email/alias matches (upstream over-match) are demoted.
        return this.searchService.searchUsers(trimmedTerm, this.searchType()).pipe(map((users) => rankUserSearchResults(users, trimmedTerm)));
      }),
      map((users: UserSearchResult[]) => {
        // Add displayName field for the autocomplete to show
        return users.map((user) => ({
          ...user,
          displayName: this.formatUserDisplay(user),
        }));
      }),
      catchError((error) => {
        console.error('Error searching users:', error);
        return of([]);
      })
    );

    this.suggestions = toSignal(searchResults$, {
      initialValue: [],
    });

    // Keep the input box in sync with the parent-composed committed label — a non-null label
    // renders it (hydration, a fresh pick, or a revert-to-empty), and consumers that don't supply
    // one (e.g. registrant-form) fall back to seeding the box from the parent form's email control
    // on hydrate, but never clearing it (that consumer's onUserSelected() still blanks the box
    // itself after a pick). toObservable()+subscribe rather than effect(): writing into a
    // FormControl from an effect risks ExpressionChangedAfterItHasBeenCheckedError under zoneless
    // change detection.
    combineLatest([toObservable(this.displayValue), toObservable(this.form), toObservable(this.emailControl)])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([label, parentForm, emailControlName]) => {
        if (label !== null) {
          this.userSearchForm.get('userSearch')?.setValue(label, { emitEvent: false });
          return;
        }

        if (parentForm && emailControlName) {
          const emailControlValue = parentForm.get(emailControlName)?.value;

          if (emailControlValue && emailControlValue.trim()) {
            this.userSearchForm.get('userSearch')?.setValue(emailControlValue, { emitEvent: false });
          }
        }
      });
  }

  public onSearchComplete(event: AutoCompleteCompleteEvent): void {
    // Update the search form value which will trigger the observable
    this.userSearchForm.get('userSearch')?.setValue(event.query);
  }

  public onUserSelected(event: AutoCompleteSelectEvent): void {
    const selectedUser = event.value as UserSearchResult;

    // Update form controls if they are specified
    const parentForm = this.form();

    // Update email control
    const emailControlName = this.emailControl();
    if (emailControlName && parentForm.get(emailControlName)) {
      parentForm.get(emailControlName)?.setValue(selectedUser.email);
    }

    // Update first name control
    const firstNameControlName = this.firstNameControl();
    if (firstNameControlName && parentForm.get(firstNameControlName)) {
      parentForm.get(firstNameControlName)?.setValue(selectedUser.first_name);
    }

    // Update last name control
    const lastNameControlName = this.lastNameControl();
    if (lastNameControlName && parentForm.get(lastNameControlName)) {
      parentForm.get(lastNameControlName)?.setValue(selectedUser.last_name);
    }

    // Update job title control
    const jobTitleControlName = this.jobTitleControl();
    if (jobTitleControlName && parentForm.get(jobTitleControlName)) {
      parentForm.get(jobTitleControlName)?.setValue(selectedUser.job_title);
    }

    // Update organization name control
    const orgNameControlName = this.organizationNameControl();
    if (orgNameControlName && parentForm.get(orgNameControlName)) {
      parentForm.get(orgNameControlName)?.setValue(selectedUser.organization?.name || null);
    }

    // Update organization website control
    const orgWebsiteControlName = this.organizationWebsiteControl();
    if (orgWebsiteControlName && parentForm.get(orgWebsiteControlName)) {
      parentForm.get(orgWebsiteControlName)?.setValue(selectedUser.organization?.website || null);
    }

    // Update username control
    const usernameControlName = this.usernameControl();
    if (usernameControlName && parentForm.get(usernameControlName)) {
      parentForm.get(usernameControlName)?.setValue(selectedUser.username || null);
    }

    // Consumers driving displayValue re-render the box via that input once the parent's controls
    // (patched above) flow back into its computed label — blanking here would just flash empty
    // first. Consumers without displayValue still clear immediately, per today's behavior.
    if (this.displayValue() === null) {
      this.userSearchForm.get('userSearch')?.setValue('', { emitEvent: false });
    }

    // Emit the selected user - parent component will handle showing individual fields
    this.onUserSelect.emit(selectedUser);
  }

  /**
   * Snaps the input box back to the committed `displayValue` on blur.
   *
   * Only meaningful alongside `displayValue`: arbitrary typed text that was never selected (or
   * stale text left after a blur without a pick) shouldn't linger — snap back to the committed
   * label. Consumers without `displayValue` don't get an `onBlur` binding in the template, so
   * this never fires for them.
   */
  public onSearchBlur(): void {
    const label = this.displayValue();
    if (label === null) {
      return;
    }

    const current = this.userSearchForm.get('userSearch')?.value ?? '';
    if (current !== label) {
      this.userSearchForm.get('userSearch')?.setValue(label, { emitEvent: false });
    }
  }

  public onSearchClear(): void {
    this.userSearchForm.get('userSearch')?.setValue('');

    // Clear all form controls if they are specified
    const parentForm = this.form();
    const controlsToClear = [
      this.emailControl(),
      this.firstNameControl(),
      this.lastNameControl(),
      this.jobTitleControl(),
      this.organizationNameControl(),
      this.organizationWebsiteControl(),
      this.usernameControl(),
    ];

    controlsToClear.forEach((controlName) => {
      if (controlName && parentForm.get(controlName)) {
        parentForm.get(controlName)?.setValue(null);
      }
    });

    this.onClear.emit();
  }

  public onEnterManually(): void {
    // Emit event to let parent component handle manual entry
    this.onManualEntry.emit();
  }

  private formatUserDisplay(user: UserSearchResult): string {
    const name = `${user.first_name} ${user.last_name}`;
    const org = user.organization?.name ? ` - ${user.organization.name}` : '';
    const email = ` (${user.email})`;
    return `${name}${org}${email}`;
  }
}
