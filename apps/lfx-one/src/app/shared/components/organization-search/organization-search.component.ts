// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { normalizeToUrl, OrganizationResolveResult, OrganizationSuggestion } from '@lfx-one/shared';
import { httpsUrlValidator, trimmedRequired } from '@lfx-one/shared/validators';
import { OrganizationService } from '@services/organization.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, EMPTY, map, merge, Observable, of, startWith, switchMap, take } from 'rxjs';

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
  /** When false, the field keeps the user-selected name instead of being overwritten with the
   *  CDP canonical name returned by /api/organizations/resolve. Defaults to true for backward
   *  compatibility with forms where canonical normalization is desired. */
  public resolveToCdpName = input<boolean>(true);
  /** When true, marks the domain/website field as required (shows asterisk and validation errors). */
  public domainRequired = input<boolean>(false);

  public readonly onOrganizationSelect = output<OrganizationSuggestion>();
  public readonly onOrganizationResolved = output<OrganizationResolveResult>();

  // Track manual mode state
  public manualMode = signal<boolean>(false);

  private domainOriginalValidator: ValidatorFn | null | undefined = undefined;

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

    // Sync the internal search input with the parent form's name control — both on initial render
    // and on any programmatic patchValue(). combineLatest re-subscribes whenever either form()
    // or nameControl() changes so the inner subscription always tracks the live control.
    combineLatest([toObservable(this.form), toObservable(this.nameControl)])
      .pipe(
        switchMap(([parentForm, nameControlName]) => {
          if (!parentForm || !nameControlName) return EMPTY;
          const ctrl = parentForm.get(nameControlName);
          if (!ctrl) return EMPTY;
          return merge(of(ctrl.value as string | null), ctrl.valueChanges);
        }),
        takeUntilDestroyed()
      )
      .subscribe((value) => {
        const trimmedValue = (value ?? '').trim();
        searchControl.setValue(trimmedValue, { emitEvent: false });
        this.searchTerm.set(trimmedValue);
      });
  }

  public onSearchComplete(event: AutoCompleteCompleteEvent): void {
    // Update the search form value which will trigger the observable
    this.organizationForm.get('organizationSearch')?.setValue(event.query);
  }

  public onOrganizationSelected(event: AutoCompleteSelectEvent): void {
    const selectedOrganization = event.value as OrganizationSuggestion;

    // Remember the pick so it stays selectable for the rest of the session,
    // even for flows that store the org as free text (no CDP resolve).
    this.organizationService.registerSessionOrg({
      name: selectedOrganization.name,
      domain: selectedOrganization.domain,
      logo: selectedOrganization.logo,
    });

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
    const domainControlName = this.domainControl();
    const typedName = (this.organizationForm.get('organizationSearch')?.value || this.searchTerm())?.trim();

    if (nameControlName && this.form().get(nameControlName)) {
      this.form().get(nameControlName)?.setValue(typedName);
    }

    // Apply URL validators to the domain control so the website field is validated
    // while in manual/new-org mode. Cleared on exit to avoid validating search-mode state.
    const domainCtrl = domainControlName ? this.form().get(domainControlName) : null;
    if (domainCtrl) {
      this.domainOriginalValidator = domainCtrl.validator;
      const validators = this.domainRequired() ? [Validators.required, trimmedRequired(), httpsUrlValidator()] : [httpsUrlValidator()];
      domainCtrl.setValidators(validators);
      domainCtrl.updateValueAndValidity();
    }

    // Remember the just-created org (free text, no domain) so re-opening the
    // field on the next guest surfaces it instead of forcing re-creation.
    if (typedName) {
      this.organizationService.registerSessionOrg({ name: typedName, domain: '' });
    }

    // Clear search field when switching to manual
    this.organizationForm.get('organizationSearch')?.setValue('');
  }

  public switchToSearchMode(): void {
    this.manualMode.set(false);
    this.clearResolveState();

    const parentForm = this.form();
    const nameControlName = this.nameControl();
    const domainControlName = this.domainControl();

    if (nameControlName && parentForm.get(nameControlName)) {
      parentForm.get(nameControlName)?.markAsUntouched();
    }

    const domainCtrl = domainControlName ? parentForm.get(domainControlName) : null;
    if (domainCtrl) {
      if (this.domainOriginalValidator !== undefined) {
        domainCtrl.setValidators(this.domainOriginalValidator);
        this.domainOriginalValidator = undefined;
      } else {
        domainCtrl.clearValidators();
      }
      domainCtrl.updateValueAndValidity();
      domainCtrl.markAsUntouched();
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

    // Remember the final entry (the manual name may have been edited after switchToManualMode())
    // so it stays selectable for the rest of the session. No-ops when the name is blank.
    this.organizationService.registerSessionOrg({ name: (name || '').trim(), domain: (domain || '').trim() });

    this.resolvingOrg.set(true);

    return this.organizationService.resolveOrganization(name || '', domain || '').pipe(
      take(1),
      map((cdpOrg) => {
        const result: OrganizationResolveResult = {
          id: cdpOrg.id,
          name: cdpOrg.name,
          // Uses cdpOrg.logo unconditionally — this method resolves from form values rather
          // than an autocomplete suggestion, so no suggestion logo is available as a fallback.
          logo: cdpOrg.logo,
          originalName: name || '',
          nameChanged: cdpOrg.name.toLowerCase() !== (name || '').toLowerCase(),
        };
        this.resolvedOrg.set(result);
        this.resolvingOrg.set(false);
        this.onOrganizationResolved.emit(result);

        if (this.resolveToCdpName()) {
          this.applyCdpName(cdpOrg.name);
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
            // When not resolving to CDP canonical, prefer the suggestion's non-empty logo so
            // the displayed logo matches what the user selected rather than the CDP entity's logo.
            // Empty-string suggestion logos fall back to cdpOrg.logo (same as the =true path).
            logo: this.resolveToCdpName() ? cdpOrg.logo : logo || cdpOrg.logo,
            originalName: name,
            nameChanged: cdpOrg.name.toLowerCase() !== name.toLowerCase(),
          };
          this.resolvedOrg.set(result);
          this.resolvingOrg.set(false);
          this.onOrganizationResolved.emit(result);

          if (this.resolveToCdpName()) {
            this.applyCdpName(cdpOrg.name);
          }
        },
        error: () => {
          this.resolvedOrg.set(null);
          this.resolvingOrg.set(false);
        },
      });
  }

  private applyCdpName(name: string): void {
    this.organizationForm.get('organizationSearch')?.setValue(name, { emitEvent: false });
    const nameControlName = this.nameControl();
    if (nameControlName && this.form().get(nameControlName)) {
      this.form().get(nameControlName)?.setValue(name);
    }
  }

  private clearResolveState(): void {
    this.resolvedOrg.set(null);
    this.resolvingOrg.set(false);
  }
}
