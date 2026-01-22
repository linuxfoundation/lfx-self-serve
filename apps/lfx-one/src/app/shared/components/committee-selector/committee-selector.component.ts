// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { Committee, CommitteeReference, CommitteeSelectorOption, VOTING_STATUSES } from '@lfx-one/shared';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { catchError, combineLatest, filter, map, of, startWith, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-committee-selector',
  imports: [ReactiveFormsModule, AutocompleteComponent, ButtonModule],
  templateUrl: './committee-selector.component.html',
  styleUrl: './committee-selector.component.scss',
})
export class CommitteeSelectorComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly projectContextService = inject(ProjectContextService);

  // Form inputs
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();

  // Configuration
  public readonly multiple = input<boolean>(true);
  public readonly required = input<boolean>(false);
  public readonly label = input<string>('');
  public readonly description = input<string>('');
  public readonly placeholder = input<string>('Search...');
  public readonly testIdPrefix = input<string>('committee-selector');

  // Events
  public readonly selectionChange = output<CommitteeSelectorOption | CommitteeSelectorOption[] | null>();

  // Internal form for autocomplete
  public readonly searchForm = new FormGroup({
    search: new FormControl(''),
  });

  // Loading state
  public readonly committeesLoading = signal<boolean>(true);

  // Committee options loaded from API
  public readonly committeeOptions: Signal<CommitteeSelectorOption[]> = this.initCommitteeOptions();

  // Internal state for filtered suggestions
  public readonly filteredSuggestions = signal<CommitteeSelectorOption[]>([]);

  // Selected items derived from form control value and committee options
  public readonly displayedSelectedItems: Signal<CommitteeSelectorOption[]> = this.initSelectedItems();

  /**
   * Handle autocomplete search/filter
   */
  public onSearch(event: AutoCompleteCompleteEvent): void {
    const query = event.query.toLowerCase().trim();
    const selected = this.displayedSelectedItems();
    const allOptions = this.committeeOptions();

    // Filter out already selected items
    const availableOptions = allOptions.filter((option) => !selected.some((s) => s.id === option.id));

    if (!query) {
      // Show all available options when no query
      this.filteredSuggestions.set(availableOptions);
      return;
    }

    // Filter by search query
    const filtered = availableOptions.filter((option) => option.name.toLowerCase().includes(query));

    this.filteredSuggestions.set(filtered);
  }

  /**
   * Handle option selection from autocomplete
   */
  public onSelect(event: AutoCompleteSelectEvent): void {
    const option = event.value as CommitteeSelectorOption;
    const current = this.displayedSelectedItems();

    if (this.multiple()) {
      // Multi-select mode: add to selection
      const updated = [...current, option];
      this.updateFormControl(updated);
      this.selectionChange.emit(updated);
      // Clear the autocomplete input for multi-select
      this.searchForm.get('search')?.setValue('');
    } else {
      // Single-select mode: replace selection and show in input
      this.updateFormControl([option]);
      this.selectionChange.emit(option);
      // Set the input to show the selected item's name
      this.searchForm.get('search')?.setValue(option.name);
    }
  }

  /**
   * Handle autocomplete clear
   */
  public onClear(): void {
    this.filteredSuggestions.set([]);

    // For single-select mode, clear the form control when input is cleared
    if (!this.multiple()) {
      this.updateFormControl([]);
      this.selectionChange.emit(null);
    }
  }

  /**
   * Remove a selected option
   */
  public removeOption(option: CommitteeSelectorOption): void {
    const current = this.displayedSelectedItems();
    const updated = current.filter((item) => item.id !== option.id);

    if (this.multiple()) {
      this.updateFormControl(updated);
      this.selectionChange.emit(updated);
    } else {
      this.updateFormControl([]);
      this.selectionChange.emit(null);
    }
  }

  /**
   * Fetches committee options from API reactively based on project context
   */
  private initCommitteeOptions(): Signal<CommitteeSelectorOption[]> {
    const projectUid = computed(() => this.projectContextService.selectedProject()?.uid || this.projectContextService.selectedFoundation()?.uid || '');

    return toSignal(
      toObservable(projectUid).pipe(
        tap(() => this.committeesLoading.set(true)),
        filter((uid) => !!uid),
        switchMap((uid) =>
          this.committeeService.getCommitteesByProject(uid).pipe(
            map((committees) => this.mapCommitteesToOptions(committees)),
            tap((options) => {
              this.committeesLoading.set(false);
              this.filteredSuggestions.set(options);
            }),
            catchError(() => {
              console.error('Failed to load committees for project', uid);
              this.committeesLoading.set(false);
              return of([]);
            })
          )
        )
      ),
      { initialValue: [] }
    );
  }

  /**
   * Initialize selected items signal reactively from form control and committee options
   * Combines form value changes with loaded options to derive selected items
   */
  private initSelectedItems(): Signal<CommitteeSelectorOption[]> {
    const formControl$ = toObservable(computed(() => this.form().get(this.control())));
    const options$ = toObservable(this.committeeOptions);

    return toSignal(
      combineLatest([formControl$, options$]).pipe(
        switchMap(([formControl, options]) => {
          if (!formControl) {
            return of([]);
          }

          return formControl.valueChanges.pipe(
            startWith(formControl.value as CommitteeReference | CommitteeReference[] | null),
            map((value: CommitteeReference | CommitteeReference[] | null) => this.mapFormValueToSelectedItems(value, options))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  /**
   * Map form control value to selected items
   * Handles both single CommitteeReference object and array of CommitteeReference objects
   * Enriches with member count from options
   */
  private mapFormValueToSelectedItems(value: CommitteeReference | CommitteeReference[] | null, options: CommitteeSelectorOption[]): CommitteeSelectorOption[] {
    if (!value) {
      return [];
    }

    // Normalize to array - handle both single object and array values
    const items = Array.isArray(value) ? value : [value];

    return items.map((item) => {
      // Try to find the option to get member count
      const option = options.find((o) => o.id === item.uid);
      return {
        id: item.uid,
        name: item.name || option?.name || '',
        memberCount: option?.memberCount,
      };
    });
  }

  /**
   * Map Committee entities to CommitteeSelectorOption format
   */
  private mapCommitteesToOptions(committees: Committee[]): CommitteeSelectorOption[] {
    return committees.map((committee) => ({
      id: committee.uid,
      name: committee.name,
      memberCount: committee.total_members,
    }));
  }

  /**
   * Update the form control value
   * Converts CommitteeSelectorOption array to CommitteeReference format
   */
  private updateFormControl(selectedOptions: CommitteeSelectorOption[]): void {
    const formControl = this.form().get(this.control());
    if (!formControl) {
      return;
    }

    if (this.multiple()) {
      const formValue: CommitteeReference[] = selectedOptions.map((option) => ({
        uid: option.id,
        name: option.name,
        allowed_voting_statuses: VOTING_STATUSES.map((status) => status.value),
      }));
      formControl.setValue(formValue);
    } else {
      const option = selectedOptions[0];
      formControl.setValue(option ? { uid: option.id, name: option.name } : null);
    }

    formControl.markAsDirty();
  }
}
