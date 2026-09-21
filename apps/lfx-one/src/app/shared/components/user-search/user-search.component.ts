// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, input, output, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { USER_SEARCH_EMPTY_MESSAGE } from '@lfx-one/shared/constants';
import { UserSearchOption, UserSearchResult, UserSearchType } from '@lfx-one/shared/interfaces';
import { composeFullName, filterUserSearchCandidates, formatUserLabel, hasLfAccount, rankUserSearchResults } from '@lfx-one/shared/utils';
import { SearchService } from '@services/search.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { catchError, combineLatest, map, Observable, of, startWith, Subject, switchMap } from 'rxjs';

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
  // The query-index corpus to search. Required unless `candidates` is supplied, in which case
  // the directory is never called and this is ignored.
  public searchType = input<UserSearchType>();

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
  // Forwarded to the underlying p-autocomplete's native [readonly] attribute (not [disabled]) —
  // keeps the field focusable and announced by assistive tech, unlike `disabled`, which removes
  // it from the tab order entirely. Use this for a "view-only, but still perceivable" state; use
  // `disabled` for a control that should be skipped altogether.
  public readonly = input<boolean>(false);
  // Forwarded to the underlying p-autocomplete input so an external <label for> can target it.
  public inputId = input<string>();
  // When true, a pick without a resolvable LF account (`username` blank/whitespace) is rejected
  // before any bound control is touched — `onUserSelect` doesn't fire and `onRejectedSelection`
  // does instead. Consumers that don't require an LF account (e.g. meeting-details' organizer,
  // which supports manual entry for non-committee organizers) leave this at the default `false`.
  public requireLfAccount = input<boolean>(false);
  // Hides the "Enter details manually" footer. Consumers with `requireLfAccount` set typically also
  // set this `false` — manual entry can never satisfy the LF-account requirement, so offering it is
  // a guaranteed-failure affordance.
  public showManualEntry = input<boolean>(true);
  /**
   * Local mode: a caller-supplied list to search instead of the directory (#2594 — the formation
   * assignee picker offers the people on the project, the only population upstream will accept as
   * an assignee, rather than a global corpus that fails at save). Filtered client-side by name,
   * email or username substring from the first character; a row with `disabled` set is listed but
   * cannot be picked, and its `note` renders under the name. `null` (the default) keeps the
   * directory search, which then needs `searchType`.
   */
  public candidates = input<readonly UserSearchOption[] | null>(null);
  // The dropdown's no-results copy — local-mode consumers name the remedy (e.g. invite first).
  public emptyMessage = input<string>(USER_SEARCH_EMPTY_MESSAGE);

  // Outputs
  public readonly onUserSelect = output<UserSearchOption>();
  // Fired instead of `onUserSelect` when a pick is refused — by `requireLfAccount`, or because a
  // local candidate is `disabled` (its `note` then says why) — none of this component's bound
  // controls were touched, so consumers don't need to restore anything, only react (e.g. a toast)
  // to the rejection itself.
  public readonly onRejectedSelection = output<UserSearchOption>();
  public readonly onManualEntry = output<void>();
  // Emitted after a clear so consumers can reset controls this component doesn't bind (e.g. a
  // display-name control composed by the parent) in the same tick as the bound-control resets.
  public readonly onClear = output<void>();
  /**
   * Typed-but-never-selected text the most recent blur snap-back discarded (GH-2694). Typed text
   * only ever commits through a dropdown pick, and blur fires before any following click — so text
   * the user believes they "entered" vanishes silently in the same gesture that clicks Save, and
   * the save's diff sees nothing. The observed production repro: a formation assignee the picker's
   * corpus can't surface (#2594) can never be picked, so the typed name was discarded on every
   * attempt with no feedback anywhere. RECORDED here rather than emitted at blur time, because
   * blur equally precedes a dropdown pick's own click (the overlay list is click-focusable, and
   * with `appendTo="body"` no focus restoration runs) — a blur-time notice would false-fire on
   * every successful mouse selection. Consumers read it at their own commit point via
   * {@link consumeDiscardedText}; a later pick (accepted or rejected), a clear, or fresh typing
   * supersedes it as the user's latest intent and resets it. Only ever set for `displayValue`
   * consumers — the snap-back itself is scoped to them.
   */
  private discardedSearchText: string | null = null;

  // Internal form for the search input
  protected readonly userSearchForm = new FormGroup({
    userSearch: new FormControl<string>(''),
  });

  /**
   * The search trigger — fed only by p-autocomplete's `completeMethod` (and a clear), never by the
   * search control's own valueChanges. PrimeNG writes the typed text into that control through
   * its value accessor the moment a key lands, *before* its `delay` elapses and `search()` flips
   * its loading state; it then only opens the panel for a suggestions change that arrives while
   * loading. A valueChanges-driven pipeline could therefore answer before the dropdown was
   * listening, and the `completeMethod` that followed for the same text — de-duplicated away —
   * left the spinner stuck. Network latency hid that on the directory path (a round-trip always
   * lands after `search()`); a synchronous local candidate list (#2594) surfaced it every time.
   * PrimeNG's own `delay` already coalesces keystrokes, so no debounce is layered on top.
   */
  private readonly searchQuery$ = new Subject<string>();

  // Initialize suggestions as a signal based on search query changes. `fullName` is precomposed
  // here (never in the template) so a local candidate carrying the whole name in `first_name`
  // renders without a stray trailing space.
  protected suggestions: Signal<(UserSearchOption & { displayName: string; fullName: string })[]>;

  public constructor() {
    // Initialize suggestions signal that reacts to search query changes
    const searchResults$ = this.searchQuery$.pipe(
      startWith(''),
      switchMap((searchTerm: string): Observable<UserSearchOption[]> => {
        const trimmedTerm = searchTerm.trim();

        // Local mode: no request and no length floor — the list is small, so a single character
        // narrows it usefully, and an empty query lists everyone.
        const candidates = this.candidates();
        if (candidates !== null) {
          return of(filterUserSearchCandidates(candidates, trimmedTerm));
        }

        // Only fetch suggestions when user types at least 2 characters
        const searchType = this.searchType();
        if (trimmedTerm.length < 2 || !searchType) {
          return of([]);
        }

        // Use the search type from input, then re-rank so name matches surface
        // first and incidental alias matches (upstream over-match) are demoted.
        return this.searchService.searchUsers(trimmedTerm, searchType).pipe(map((users) => rankUserSearchResults(users, trimmedTerm)));
      }),
      map((users: UserSearchOption[]) => {
        // Add the display fields the autocomplete and the item template show
        return users.map((user) => ({
          ...user,
          displayName: this.formatUserDisplay(user),
          fullName: composeFullName(user.first_name, user.last_name),
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

    // `disabled` was previously declared but never wired to anything — the underlying
    // p-autocomplete binds `[formControlName]` directly (see AutocompleteComponent), so a plain
    // [disabled] attribute would just be re-overridden by the forms directive's own
    // setDisabledState on every CD cycle. The control itself must carry the disabled state.
    // toObservable()+subscribe rather than effect(): disabling a FormControl is a side effect on
    // non-signal state, and belongs in a subscription rather than a signal-graph effect.
    toObservable(this.disabled)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isDisabled) => {
        const searchControl = this.userSearchForm.get('userSearch');
        if (isDisabled) {
          searchControl?.disable({ emitEvent: false });
        } else {
          searchControl?.enable({ emitEvent: false });
        }
      });
  }

  public onSearchComplete(event: AutoCompleteCompleteEvent): void {
    // Fresh typing supersedes any earlier discarded text as the user's latest intent (GH-2694).
    this.discardedSearchText = null;
    // The value accessor has already written the text into the search control; this only runs the search.
    this.searchQuery$.next(event.query);
  }

  public onUserSelected(event: AutoCompleteSelectEvent): void {
    // A pick — accepted or rejected below — resolves whatever typed text preceded it (GH-2694): a
    // mouse pick's own blur fires first and records that text as discarded, and leaving the record
    // standing would warn "not selected" about a selection that just happened (or double-toast a
    // requireLfAccount rejection on top of its own "Cannot assign").
    this.discardedSearchText = null;
    const selectedUser = event.value as UserSearchOption;

    // A disabled local candidate is the one thing this handler must never commit — and this guard
    // is what prevents it, not `optionDisabled`: PrimeNG (20.4) styles a disabled option and marks
    // it aria-disabled, but its own option handler still commits the value and emits the pick, on
    // click and on hover-plus-Enter (`focusOnHover` is on by default). By the time the pick lands
    // here PrimeNG has already closed the panel and written the option into the box, so snap the
    // box back and let the consumer say why — the row's `note` rides on the rejected option.
    if (selectedUser.disabled) {
      this.userSearchForm.get('userSearch')?.setValue(this.displayValue() ?? '', { emitEvent: false });
      this.onRejectedSelection.emit(selectedUser);
      return;
    }

    // Reject before touching any bound control — the box's own text already shows the rejected
    // pick's optionLabel at this point (PrimeNG writes it before firing onSelect), so snap it back
    // to whatever's actually committed (or blank, for consumers without displayValue) rather than
    // leaving the rejected name on screen until a later blur.
    if (this.requireLfAccount() && !hasLfAccount(selectedUser)) {
      const label = this.displayValue();
      this.userSearchForm.get('userSearch')?.setValue(label ?? '', { emitEvent: false });
      this.onRejectedSelection.emit(selectedUser);
      return;
    }

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
      // A non-string `current` is a committed selection object (p-autocomplete writes the picked
      // object into the control; the displayValue sync rewrites it as the label a tick later) —
      // nothing was discarded there. Only string text the user typed and never picked counts.
      if (typeof current === 'string' && current.trim() !== '' && current.trim() !== label.trim()) {
        this.discardedSearchText = current.trim();
      }
    }
  }

  /**
   * Returns the typed-but-unselected text the most recent blur discarded, and clears it — one
   * notice per discard, so a caller that warns on it and stops can let a deliberate repeat of the
   * same action proceed. `null` means the last blur had nothing uncommitted. See
   * {@link discardedSearchText} for why this is a pull at the consumer's commit point rather than a
   * blur-time event.
   */
  public consumeDiscardedText(): string | null {
    const text = this.discardedSearchText;
    this.discardedSearchText = null;
    return text;
  }

  public onSearchClear(): void {
    // An explicit clear is the user abandoning whatever they had typed — not a silent discard to
    // warn about later (GH-2694).
    this.discardedSearchText = null;
    this.userSearchForm.get('userSearch')?.setValue('');
    this.searchQuery$.next('');

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

  /**
   * The text the box shows for a picked option (`optionLabel`) — the same "Name (email)" that
   * consumers' committed labels compose with `formatUserLabel`, so a pick never flashes an
   * organization suffix for the tick before the committed label replaces it. The organization
   * still shows on the dropdown row itself, beside the name.
   */
  private formatUserDisplay(user: UserSearchResult): string {
    return formatUserLabel(composeFullName(user.first_name, user.last_name), user.email);
  }
}
