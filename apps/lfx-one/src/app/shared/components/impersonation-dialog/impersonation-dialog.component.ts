// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { ButtonComponent } from '@components/button/button.component';
import { IMPERSONATION_TRANSITION_MESSAGES } from '@lfx-one/shared/constants';
import { ImpersonationSuggestion, RecentImpersonation } from '@lfx-one/shared/interfaces';
import {
  composeFullName,
  excludeUserSearchIdentities,
  hasLfAccount,
  rankUserSearchResults,
  resolveImpersonationStartErrorMessage,
} from '@lfx-one/shared/utils';
import { ImpersonationService } from '@services/impersonation.service';
import { SearchService } from '@services/search.service';
import { UserService } from '@services/user.service';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { map, Observable, of, Subject, switchMap, take } from 'rxjs';

@Component({
  selector: 'lfx-impersonation-dialog',
  imports: [AutocompleteComponent, ButtonComponent],
  templateUrl: './impersonation-dialog.component.html',
})
export class ImpersonationDialogComponent {
  private readonly impersonationService = inject(ImpersonationService);
  private readonly searchService = inject(SearchService);
  private readonly userService = inject(UserService);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig, { optional: true });

  // True when opened from the impersonation banner to swap the active target rather than start a session.
  protected readonly switching = Boolean(this.dialogConfig?.data?.['switching']);

  protected targetUserForm = new FormGroup({
    targetUser: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected loading = signal(false);
  protected loadingMessage = computed(() => (this.loading() ? IMPERSONATION_TRANSITION_MESSAGES[this.switching ? 'switching' : 'starting'] : ''));
  protected error = signal('');
  // The admin and, while switching, the current target are left out of the recents, as the server leaves them out
  // of the directory results: picking either is pointless, and the target would only be refused as already impersonated.
  protected recentImpersonations = signal<RecentImpersonation[]>(this.withoutOwnIdentities(this.impersonationService.getRecentImpersonations()));

  // Typed text goes through a subject rather than a valueChanges pipeline: PrimeNG's `delay` already
  // coalesces keystrokes before `completeMethod` fires, and its panel only opens for a suggestions
  // change that follows the completion it asked for.
  private readonly searchQuery$ = new Subject<string>();
  protected readonly suggestions = toSignal(this.searchQuery$.pipe(switchMap((query) => this.findSuggestions(query))), {
    initialValue: this.recentImpersonations() as ImpersonationSuggestion[],
  });

  // The person picked from the list — the only thing Start acts on. The field shows their name, which is not what the
  // start request sends, so the pick is kept here and its `targetUser` (the username) is submitted for as long as the
  // field still shows that name. The username and email are listed under the field for context.
  protected readonly picked = signal<ImpersonationSuggestion | null>(null);
  private pickedLabel = '';

  public constructor() {
    // Closing mid-request would drop the loading UI while the change still goes through and reloads the page.
    lockDynamicDialogWhile(this.loading);

    // Typing over or clearing the shown name abandons the pick: the box then holds what the admin typed.
    this.targetUserForm.controls.targetUser.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (this.picked() && value !== this.pickedLabel) {
        this.picked.set(null);
      }
    });
  }

  public submit(): void {
    // Only a picked person can be impersonated: what is typed in the field is a search, never a target.
    const target = this.picked()?.targetUser;
    if (!target) return;

    this.loading.set(true);
    this.error.set('');
    this.targetUserForm.controls.targetUser.disable();

    this.impersonationService
      .startImpersonation(target, this.switching)
      .pipe(take(1))
      .subscribe({
        next: (response) => {
          this.impersonationService.addRecentImpersonation({
            targetUser: target,
            email: response.targetUser.email,
            username: response.targetUser.username,
            name: response.targetUser.name,
            picture: response.targetUser.picture,
          });
          // Left open (still under its loading overlay) until the reload unloads the page: closing it here would
          // drop the loading UI for the whole reload.
          window.location.reload();
        },
        error: (err) => {
          this.loading.set(false);
          this.targetUserForm.controls.targetUser.enable();
          this.error.set(resolveImpersonationStartErrorMessage(err.error?.code));
        },
      });
  }

  public cancel(): void {
    this.dialogRef.close(false);
  }

  // Enter starts the impersonation only once someone is picked; before that it belongs to the suggestion list.
  protected onEnter(): void {
    if (this.picked()) {
      this.submit();
    }
  }

  // Emptying the field must cancel a lookup still in flight (switchMap) and bring the recents back.
  protected onSearchCleared(): void {
    this.searchQuery$.next('');
  }

  protected onSearchComplete(event: AutoCompleteCompleteEvent): void {
    this.searchQuery$.next(event.query ?? '');
  }

  protected onSuggestionSelected(event: AutoCompleteSelectEvent): void {
    // p-autocomplete writes the full option object into the form on select; replace it with
    // the targetUser string so submit() and free-text typing both see a plain string.
    const entry = event.value as ImpersonationSuggestion | null;
    if (!entry || typeof entry !== 'object') return;

    // Name first, falling back to what is known, so the box never shows a blank for a person with no name on record.
    this.pickedLabel = entry.name || entry.username || entry.email;
    this.picked.set(entry);
    this.targetUserForm.controls.targetUser.setValue(this.pickedLabel);
    this.error.set('');
  }

  /**
   * What the picker offers for a typed query: matching recents first, then people from the directory.
   * Fewer than two characters only filters the recents, as the directory search needs a real prefix to
   * answer usefully. The directory is always searched as the signed-in admin (the route that also leaves
   * the admin and the current target out), and only people with an LF account are listed — an
   * impersonation target needs a username. A failed search falls back to the recents alone.
   */
  private findSuggestions(query: string): Observable<ImpersonationSuggestion[]> {
    const term = query.trim().toLowerCase();
    const recents = this.recentImpersonations().filter(
      (entry) =>
        !term ||
        entry.email.toLowerCase().includes(term) ||
        entry.username.toLowerCase().includes(term) ||
        (entry.name?.toLowerCase().includes(term) ?? false) ||
        entry.targetUser.toLowerCase().includes(term)
    );

    if (term.length < 2) {
      return of(recents);
    }

    // The raw text goes to the directory: its exact-email lookup is case-sensitive and retries the lowercased form itself.
    return this.searchService.searchUsers(query.trim(), 'committee_member', true).pipe(
      map((users) => {
        const listed = new Set(recents.map((entry) => entry.username.toLowerCase()));
        const found = rankUserSearchResults(users.filter(hasLfAccount), term)
          .filter((user) => !listed.has((user.username ?? '').toLowerCase()))
          .map(
            (user): ImpersonationSuggestion => ({
              targetUser: user.username as string,
              username: user.username as string,
              email: user.email,
              name: composeFullName(user.first_name, user.last_name) || undefined,
            })
          );

        return [...recents, ...found];
      })
    );
  }

  private withoutOwnIdentities(recents: RecentImpersonation[]): RecentImpersonation[] {
    // Not impersonating, the signed-in user is the admin. While switching it is the current target, and the admin
    // is the impersonator.
    const user = this.userService.user();
    const identities = [{ username: user?.['https://sso.linuxfoundation.org/claims/username'], email: user?.email }];
    if (this.switching) {
      identities.push({ username: undefined, email: this.userService.impersonator()?.email });
    }

    return excludeUserSearchIdentities(recents, identities);
  }
}
