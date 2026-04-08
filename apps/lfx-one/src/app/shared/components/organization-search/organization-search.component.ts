// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, effect, inject, input, output, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { normalizeToUrl, OrganizationResolveResult, OrganizationSuggestion } from '@lfx-one/shared';
import { OrganizationService } from '@services/organization.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { catchError, debounceTime, distinctUntilChanged, map, Observable, of, startWith, switchMap, take } from 'rxjs';

import { AutocompleteComponent } from '../autocomplete/autocomplete.component';
import { InputTextComponent } from '../input-text/input-text.component';

@Component({
  selector: 'lfx-organization-search',
  imports: [AutocompleteComponent, ReactiveFormsModule, InputTextComponent],
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
  public readonly onOrganizationResolved = output<OrganizationResolveResult>();

  // Track manual mode state
  public manualMode = signal<boolean>(false);

  // Resolve state signals
  public resolvingOrg = signal(false);
  public resolvedOrg = signal<OrganizationResolveResult | null>(null);

  // Search term signal for footer "create" button
  public searchTerm = signal('');

  // Internal form for the search input
  protected readonly organizationForm = new FormGroup({
    organizationSearch: new FormControl<string>(''),
  });

  // Initialize suggestions as a signal based on search query changes
  protected suggestions: Signal<OrganizationSuggestion[]>;

  public constructor() {
    const searchControl = this.organizationForm.get('organizationSearch')!;

    // Track search term for footer display
    searchControl.valueChanges.pipe(startWith('')).subscribe((value: string | null) => {
      this.searchTerm.set(value?.trim() || '');
    });

    // Initialize suggestions signal that reacts to search query changes
    const searchResults$ = searchControl.valueChanges.pipe(
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
      catchError(() => of([]))
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
          searchControl.setValue(nameControlValue, { emitEvent: false });
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

    // Resolve the organization via CDP
    this.resolveOrg(selectedOrganization.name, selectedOrganization.domain, selectedOrganization.logo);
  }

  public onSearchClear(): void {
    this.organizationForm.get('organizationSearch')?.setValue('');
    this.clearResolveState();

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
    this.clearResolveState();

    const nameControlName = this.nameControl();

    if (nameControlName && this.form().get(nameControlName)) {
      this.form()
        .get(nameControlName)
        ?.setValue(this.organizationForm.get('organizationSearch')?.value || this.searchTerm());
    }

    // Clear search field when switching to manual
    this.organizationForm.get('organizationSearch')?.setValue('');
  }

  public switchToSearchMode(): void {
    this.manualMode.set(false);
    this.clearResolveState();

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

  /**
   * Resolve the current entry (for use by parent components on submit)
   * Returns an Observable so the parent can subscribe and wait for the result
   */
  public resolveCurrentEntry(): Observable<OrganizationResolveResult | null> {
    const parentForm = this.form();
    const nameControlName = this.nameControl();
    const domainControlName = this.domainControl();

    const name = nameControlName ? parentForm.get(nameControlName)?.value : '';
    const domain = domainControlName ? parentForm.get(domainControlName)?.value : '';

    if (!name && !domain) {
      return of(null);
    }

    this.resolvingOrg.set(true);

    return this.organizationService.resolveOrganization(name || '', domain || '').pipe(
      take(1),
      map((cdpOrg) => {
        const result: OrganizationResolveResult = {
          id: cdpOrg.id,
          name: cdpOrg.name,
          logo: cdpOrg.logo,
          originalName: name || '',
          nameChanged: cdpOrg.name.toLowerCase() !== (name || '').toLowerCase(),
        };
        this.resolvedOrg.set(result);
        this.resolvingOrg.set(false);
        this.onOrganizationResolved.emit(result);

        // Update field text to the resolved name
        this.organizationForm.get('organizationSearch')?.setValue(cdpOrg.name, { emitEvent: false });
        const nameCtrl = this.nameControl();
        if (nameCtrl && this.form().get(nameCtrl)) {
          this.form().get(nameCtrl)?.setValue(cdpOrg.name);
        }
        return result;
      }),
      catchError(() => {
        this.resolvingOrg.set(false);
        this.resolvedOrg.set(null);
        return of(null);
      })
    );
  }

  private resolveOrg(name: string, domain: string, logo?: string): void {
    this.resolvingOrg.set(true);
    this.resolvedOrg.set(null);

    this.organizationService
      .resolveOrganization(name, domain, logo)
      .pipe(take(1))
      .subscribe({
        next: (cdpOrg) => {
          const result: OrganizationResolveResult = {
            id: cdpOrg.id,
            name: cdpOrg.name,
            logo: cdpOrg.logo,
            originalName: name,
            nameChanged: cdpOrg.name.toLowerCase() !== name.toLowerCase(),
          };
          this.resolvedOrg.set(result);
          this.resolvingOrg.set(false);
          this.onOrganizationResolved.emit(result);

          // Update field text to the resolved name
          this.organizationForm.get('organizationSearch')?.setValue(cdpOrg.name, { emitEvent: false });
          const nameControlName = this.nameControl();
          if (nameControlName && this.form().get(nameControlName)) {
            this.form().get(nameControlName)?.setValue(cdpOrg.name);
          }
        },
        error: () => {
          this.resolvedOrg.set(null);
          this.resolvingOrg.set(false);
        },
      });
  }

  private clearResolveState(): void {
    this.resolvedOrg.set(null);
    this.resolvingOrg.set(false);
  }
}
