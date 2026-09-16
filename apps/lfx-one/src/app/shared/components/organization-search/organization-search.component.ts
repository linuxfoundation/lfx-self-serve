// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
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
  /** Name of the parent form control that holds the resolved org id. Cleared when entering manual
   *  mode so a stale id from a prior selection does not survive as resolution evidence. */
  public idControl = input<string>();

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

  // Bumped on every new selection or state reset so a resolveOrg() callback from a
  // superseded selection can recognize it's stale and discard itself instead of
  // overwriting a newer selection's result.
  private selectionToken = 0;

  // Name of the currently selected suggestion, so onSearchComplete can tell a live re-type
  // (query no longer matches what was picked) from PrimeNG echoing the selection back.
  private selectedName: string | null = null;

  // True once the typed query has diverged from selectedName and been synced to the parent
  // form as free text. Kept separate from the string comparison in onSearchComplete so a
  // revert back to the exact selectedName text (without reselecting) still re-syncs instead
  // of being mistaken for the original, still-resolved selection.
  private selectionInvalidated = false;

  // Set while invalidateStaleSelection() writes the parent name control, so the mirror below
  // doesn't echo that write back into the search input and wipe the text being typed.
  private syncingParentFromSelf = false;

  // Internal form for the search input
  protected readonly organizationForm = new FormGroup({
    organizationSearch: new FormControl<string>(''),
  });

  // Initialize suggestions as a signal based on search query changes
  protected suggestions: Signal<OrganizationSuggestion[]>;

  public constructor() {
    const searchControl = this.organizationForm.get('organizationSearch')!;

    // Track search term for footer display. Skip PrimeNG's per-keystroke `undefined` write (see
    // the divergence-detection subscription below) so the footer's "create" button doesn't
    // flicker away and back while the debounced resync catches up.
    searchControl.valueChanges.pipe(startWith('')).subscribe((value: string | null | undefined) => {
      if (value === undefined) return;
      this.searchTerm.set(value?.trim() || '');
    });

    // Invalidate as soon as this control changes, not after onSearchComplete's ~300ms debounce, so Save can't close the dialog with a stale resolved id/name.
    // Skipped in manual mode — that's a programmatic reset, not user divergence. With
    // optionValue="name" set, PrimeNG's onInput() writes `undefined` here synchronously on every
    // keystroke, before resyncing the real typed text through the debounced completeMethod /
    // onSearchComplete() below — treat that `undefined` itself as the divergence signal and
    // invalidate immediately, rather than waiting for the resync. Waiting would leave the stale
    // selection's name/domain/id submittable for the length of PrimeNG's own delay. The parent
    // name control holds '' until onSearchComplete's resync lands; the mirror below is guarded
    // (syncingParentFromSelf) so that '' write doesn't echo back and blank the visible input.
    searchControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((value: string | null | undefined) => {
      if (this.manualMode() || this.selectedName === null) return;
      if (value === undefined) {
        this.invalidateStaleSelection('');
        return;
      }
      const trimmedQuery = (value ?? '').trim();
      const divergesFromSelection = trimmedQuery.toLowerCase() !== this.selectedName.trim().toLowerCase();
      if (this.selectionInvalidated || divergesFromSelection) {
        this.invalidateStaleSelection(value ?? '');
      }
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
        if (this.syncingParentFromSelf) return;
        const trimmedValue = (value ?? '').trim();
        searchControl.setValue(trimmedValue, { emitEvent: false });
        this.searchTerm.set(trimmedValue);

        // A name arriving here wasn't picked through this component instance — it's an
        // edit-mode preload (resolved or untouched-legacy). Track it as the selection so a
        // later retype without reselecting is still recognized as diverging from it.
        if (trimmedValue && this.selectedName === null) {
          this.selectedName = trimmedValue;
        }
      });

    // Disable every editable surface (search input, and manual-mode name/domain, which bind
    // directly to the parent form and bypass the staleness-invalidation listener above) while a
    // resolve is in flight. Without this, editing the org during a pending resolveOrg()/
    // resolveCurrentEntry() call lets its stale result land on whatever is now displayed.
    toObservable(this.resolvingOrg)
      .pipe(takeUntilDestroyed())
      .subscribe((isResolving) => {
        const parentForm = this.form();
        const nameControlName = this.nameControl();
        const domainControlName = this.domainControl();

        const toggle = (ctrl: AbstractControl | null | undefined): void => {
          if (!ctrl) return;
          if (isResolving) {
            ctrl.disable({ emitEvent: false });
          } else {
            ctrl.enable({ emitEvent: false });
          }
        };

        toggle(searchControl);
        toggle(nameControlName ? parentForm.get(nameControlName) : null);
        toggle(domainControlName ? parentForm.get(domainControlName) : null);
      });
  }

  public onSearchComplete(event: AutoCompleteCompleteEvent): void {
    // optionValue="name" makes onInput() write undefined here every keystroke — resync the real query or searchResults$ freezes.
    // Guard against a stale callback (selection doesn't cancel PrimeNG's debounce) by checking the input's current live value.
    const liveValue = (event.originalEvent?.target as HTMLInputElement | null)?.value;
    if (liveValue !== undefined && liveValue !== event.query) {
      return;
    }

    this.organizationForm.get('organizationSearch')?.setValue(event.query);
  }

  public onOrganizationSelected(event: AutoCompleteSelectEvent): void {
    const selectedOrganization = event.value as OrganizationSuggestion;

    // Invalidate any resolve still in flight from a previous selection and clear the id
    // control up front, before the new selection resolves — otherwise a stale id (from a
    // resolve that later fails, or one that is still pending when a newer pick lands) can
    // survive and get treated as proof this selection was resolved.
    this.clearResolveState();
    this.clearIdControl();
    this.selectedName = selectedOrganization.name;
    this.selectionInvalidated = false;
    const selectionId = this.selectionToken;

    // Remember the pick so it stays selectable for the rest of the session,
    // even for flows that store the org as free text (no CDP resolve). Keep `id` so a
    // domainless CDP-only org re-selected from the session cache can skip straight to
    // emitCdpResolvedSuggestion() below instead of falling through to /resolve with an
    // empty domain.
    this.organizationService.registerSessionOrg({
      name: selectedOrganization.name,
      domain: selectedOrganization.domain,
      logo: selectedOrganization.logo,
      id: selectedOrganization.id,
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

    // A domain-required flow (e.g. committee add-member/invite) needs a website
    // committee-service can store. A domainless CDP match has none, so — rather than
    // leaving organization_url silently empty until the user hits submit — treat it like a
    // typed-but-unresolved name and prompt for a website via manual mode.
    if (this.domainRequired() && selectedOrganization.id && !selectedOrganization.domain) {
      this.switchToManualMode();
      return;
    }

    // A suggestion sourced from an exact CDP match already carries its resolved id — skip the
    // resolve round-trip and emit the result directly rather than re-deriving the same id.
    if (selectedOrganization.id) {
      this.emitCdpResolvedSuggestion(selectedOrganization);
      return;
    }

    // Resolve the organization via CDP
    this.resolveOrg(selectedOrganization.name, selectedOrganization.domain, selectionId, selectedOrganization.logo);
  }

  public onSearchClear(): void {
    this.organizationForm.get('organizationSearch')?.setValue('');
    this.clearResolveState();
    this.selectedName = null;
    this.selectionInvalidated = false;

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
    this.selectedName = null;
    this.selectionInvalidated = false;

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
      if (this.domainOriginalValidator === undefined) {
        this.domainOriginalValidator = domainCtrl.validator;
      }
      // Clear stale URL before manual mode — the parent's name-change sub is manualMode()-guarded
      // and won't reset it, so Org A's URL would otherwise validate a newly created Org B.
      domainCtrl.setValue(null);
      this.clearIdControl();
      const validators = this.domainRequired() ? [Validators.required, trimmedRequired(), httpsUrlValidator()] : [httpsUrlValidator()];
      domainCtrl.setValidators(validators);
      domainCtrl.updateValueAndValidity();
      // Mark touched immediately so the required-URL error is visible from the start,
      // which explains why the Send Invites button is disabled without needing a submit attempt.
      domainCtrl.markAsTouched();
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
    this.selectedName = null;
    this.selectionInvalidated = false;

    const parentForm = this.form();
    const nameControlName = this.nameControl();
    const domainControlName = this.domainControl();

    // Clear search input + parent name/URL so empty UI matches form state — prevents
    // orgInvalid() from seeing a stale name with no org-id and blocking submit.
    this.organizationForm.get('organizationSearch')?.setValue('');
    if (nameControlName && parentForm.get(nameControlName)) {
      parentForm.get(nameControlName)?.setValue(null);
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
      domainCtrl.setValue(null);
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

    // Captured like resolveOrg()'s selectionId: if the user changes the selection (or switches
    // mode) before this submit-time resolve completes, discard the stale result instead of
    // emitting it or handing it back to the caller to close the dialog with.
    const selectionId = this.selectionToken;

    this.resolvingOrg.set(true);

    return this.organizationService.resolveOrganization(name || '', domain || '').pipe(
      take(1),
      map((cdpOrg) => {
        if (selectionId !== this.selectionToken) {
          return null;
        }
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
        if (selectionId !== this.selectionToken) {
          return of(null);
        }
        this.resolvingOrg.set(false);
        this.resolvedOrg.set(null);
        return of(null);
      })
    );
  }

  private resolveOrg(name: string, domain: string, selectionId: number, logo?: string): void {
    this.resolvingOrg.set(true);
    this.resolvedOrg.set(null);

    this.organizationService
      .resolveOrganization(name, domain, logo)
      .pipe(take(1))
      .subscribe({
        next: (cdpOrg) => {
          // A newer selection (or a manual/search-mode switch) started since this resolve
          // began — discard the now-stale result instead of overwriting whatever the user
          // picked next.
          if (selectionId !== this.selectionToken) {
            return;
          }
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
          if (selectionId !== this.selectionToken) {
            return;
          }
          this.resolvedOrg.set(null);
          this.resolvingOrg.set(false);
        },
      });
  }

  /** Emits an already-resolved result for a suggestion sourced from an exact CDP match, so the
   *  parent's onOrganizationResolved handler stores the id exactly as it would for a real
   *  resolve() response — no separate write to idControl needed here. */
  private emitCdpResolvedSuggestion(suggestion: OrganizationSuggestion): void {
    const result: OrganizationResolveResult = {
      id: suggestion.id || null,
      name: suggestion.name,
      logo: suggestion.logo || '',
      originalName: suggestion.name,
      nameChanged: false,
    };
    this.resolvedOrg.set(result);
    this.onOrganizationResolved.emit(result);
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
    // Bumping this invalidates any resolveOrg() callback still in flight from a superseded
    // selection, manual-mode switch, or search-mode switch.
    this.selectionToken += 1;
  }

  private clearIdControl(): void {
    const idControlName = this.idControl();
    if (idControlName) {
      this.form().get(idControlName)?.setValue(null);
    }
  }

  /** A stale pick's resolved id must not survive once the user types past it — otherwise submit
   *  can take the "already resolved" fast path, or resolveCurrentEntry() can re-resolve the
   *  parent's leftover name/domain, and save the old selection while a different, unselected
   *  query is displayed. Syncing the parent name control to the typed query (and clearing domain,
   *  now unknown for free text) keeps a pre-reselection submit consistent with what's on screen.
   *  Deliberately leaves selectedName as-is (not nulled) and instead sets selectionInvalidated,
   *  so onSearchComplete keeps re-syncing on every subsequent keystroke — including a revert back
   *  to the exact selectedName text — until a real selection is made again. */
  private invalidateStaleSelection(query: string): void {
    this.clearResolveState();
    this.clearIdControl();
    this.selectionInvalidated = true;

    const parentForm = this.form();
    const nameControlName = this.nameControl();
    const domainControlName = this.domainControl();
    const trimmedQuery = query.trim();

    this.syncingParentFromSelf = true;
    try {
      if (nameControlName && parentForm.get(nameControlName)) {
        parentForm.get(nameControlName)?.setValue(trimmedQuery);
      }
      if (domainControlName && parentForm.get(domainControlName)) {
        parentForm.get(domainControlName)?.setValue(null);
      }
    } finally {
      this.syncingParentFromSelf = false;
    }
  }
}
