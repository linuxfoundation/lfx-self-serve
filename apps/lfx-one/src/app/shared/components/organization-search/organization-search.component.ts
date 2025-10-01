// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, output, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { normalizeToUrl, OrganizationSuggestion } from '@lfx-one/shared';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { catchError, debounceTime, distinctUntilChanged, of, startWith, switchMap } from 'rxjs';

import { OrganizationService } from '../../services/organization.service';
import { AutocompleteComponent } from '../autocomplete/autocomplete.component';
import { InputTextComponent } from '../input-text/input-text.component';

@Component({
  selector: 'lfx-organization-search',
  imports: [AutocompleteComponent, ReactiveFormsModule, InputTextComponent, CommonModule],
  templateUrl: './organization-search.component.html',
})
export class OrganizationSearchComponent {
  private readonly organizationService = inject(OrganizationService);

  public form = input.required<FormGroup>();
  public nameControl = input<string>();
  public domainControl = input<string>();
  public placeholder = input<string>('Search organizations...');
  public styleClass = input<string>();
  public inputStyleClass = input<string>();
  public panelStyleClass = input<string>();
  public dataTestId = input<string>('organization-search');
  public disabled = input<boolean>(false);

  public readonly onOrganizationSelect = output<OrganizationSuggestion>();

  // Track manual mode state
  public manualMode = signal<boolean>(false);

  // Internal form for the search input
  protected readonly organizationForm = new FormGroup({
    organizationSearch: new FormControl<string>(''),
  });

  // Initialize suggestions as a signal based on search query changes
  protected suggestions: Signal<OrganizationSuggestion[]>;

  public constructor() {
    // Initialize suggestions signal that reacts to search query changes
    const searchResults$ = this.organizationForm.get('organizationSearch')!.valueChanges.pipe(
      startWith(''),
      distinctUntilChanged(),
      debounceTime(300),
      switchMap((searchTerm: string | null) => {
        const trimmedTerm = searchTerm?.trim() || '';

        // Only fetch suggestions when user types something
        if (!trimmedTerm) {
          return of([]);
        }

        return this.organizationService.searchOrganizations(trimmedTerm);
      }),
      catchError((error) => {
        console.error('Error searching organizations:', error);
        return of([]);
      })
    );

    this.suggestions = toSignal(searchResults$, {
      initialValue: [],
    });

    // Effect to sync the search input with the parent form's name control
    effect(() => {
      const parentForm = this.form();
      const nameControlName = this.nameControl();

      if (parentForm && nameControlName) {
        const nameControlValue = parentForm.get(nameControlName)?.value;

        if (nameControlValue && nameControlValue.trim()) {
          this.organizationForm.get('organizationSearch')?.setValue(nameControlValue, { emitEvent: false });
        }
      }
    });
  }

  public onSearchComplete(event: AutoCompleteCompleteEvent): void {
    // Update the search form value which will trigger the observable
    this.organizationForm.get('organizationSearch')?.setValue(event.query);
  }

  public onOrganizationSelected(event: AutoCompleteSelectEvent): void {
    const selectedOrganization = event.value as OrganizationSuggestion;

    // Update form controls if they are specified
    const parentForm = this.form();
    const nameControlName = this.nameControl();
    const domainControlName = this.domainControl();

    if (nameControlName && parentForm.get(nameControlName)) {
      parentForm.get(nameControlName)?.setValue(selectedOrganization.name);
    }

    // Only update domain control if it's specified (optional for forms that only need org name)
    if (domainControlName && parentForm.get(domainControlName)) {
      // Convert domain to full URL using the normalizeToUrl utility
      const normalizedUrl = normalizeToUrl(selectedOrganization.domain);
      parentForm.get(domainControlName)?.setValue(normalizedUrl);
    }

    this.onOrganizationSelect.emit(selectedOrganization);
  }

  public onSearchClear(): void {
    this.organizationForm.get('organizationSearch')?.setValue('');

    // Clear form controls if they are specified
    const parentForm = this.form();
    const nameControlName = this.nameControl();
    const domainControlName = this.domainControl();

    if (nameControlName && parentForm.get(nameControlName)) {
      parentForm.get(nameControlName)?.setValue(null);
    }

    // Only clear domain control if it's specified (optional for forms that only need org name)
    if (domainControlName && parentForm.get(domainControlName)) {
      parentForm.get(domainControlName)?.setValue(null);
    }
  }

  public switchToManualMode(): void {
    this.manualMode.set(true);

    const nameControlName = this.nameControl();

    if (nameControlName && this.form().get(nameControlName)) {
      this.form().get(nameControlName)?.setValue(this.organizationForm.get('organizationSearch')?.value);
    }

    // Clear search field when switching to manual
    this.organizationForm.get('organizationSearch')?.setValue('');
  }

  public switchToSearchMode(): void {
    this.manualMode.set(false);
    // Clear any touched state on the form controls
    const parentForm = this.form();
    const nameControlName = this.nameControl();
    const domainControlName = this.domainControl();

    if (nameControlName && parentForm.get(nameControlName)) {
      parentForm.get(nameControlName)?.markAsUntouched();
    }

    if (domainControlName && parentForm.get(domainControlName)) {
      parentForm.get(domainControlName)?.markAsUntouched();
    }
  }
}
