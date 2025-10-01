// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, output, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { UserSearchResult } from '@lfx-one/shared/interfaces';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { SearchService } from '../../services/search.service';
import { AutocompleteComponent } from '../autocomplete/autocomplete.component';

@Component({
  selector: 'lfx-user-search',
  imports: [AutocompleteComponent, ReactiveFormsModule, CommonModule],
  templateUrl: './user-search.component.html',
})
export class UserSearchComponent {
  private readonly searchService = inject(SearchService);

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

  // UI customization inputs
  public placeholder = input<string>('Search users...');
  public styleClass = input<string>();
  public inputStyleClass = input<string>();
  public panelStyleClass = input<string>();
  public dataTestId = input<string>('user-search');
  public disabled = input<boolean>(false);

  // Outputs
  public readonly onUserSelect = output<UserSearchResult>();
  public readonly onManualEntry = output<void>();

  // Internal form for the search input
  protected readonly userSearchForm = new FormGroup({
    userSearch: new FormControl<string>(''),
  });

  // Initialize suggestions as a signal based on search query changes
  protected suggestions: Signal<Array<UserSearchResult & { displayName: string }>>;

  public constructor() {
    // Initialize suggestions signal that reacts to search query changes
    const searchResults$ = this.userSearchForm.get('userSearch')!.valueChanges.pipe(
      startWith(''),
      distinctUntilChanged(),
      debounceTime(300),
      switchMap((searchTerm: string | null) => {
        const trimmedTerm = searchTerm?.trim() || '';

        // Only fetch suggestions when user types at least 2 characters
        if (trimmedTerm.length < 2) {
          return of([]);
        }

        // Use the search type from input
        return this.searchService.searchUsers(trimmedTerm, this.searchType());
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

    // Effect to sync the search input with the parent form's email control if provided
    effect(() => {
      const parentForm = this.form();
      const emailControlName = this.emailControl();

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

    // Clear the search field to show that selection is complete
    this.userSearchForm.get('userSearch')?.setValue('', { emitEvent: false });

    // Emit the selected user - parent component will handle showing individual fields
    this.onUserSelect.emit(selectedUser);
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
