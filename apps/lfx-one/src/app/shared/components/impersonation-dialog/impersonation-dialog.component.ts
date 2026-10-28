// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { ButtonComponent } from '@components/button/button.component';
import { IMPERSONATION_TRANSITION_MESSAGES } from '@lfx-one/shared/constants';
import { ImpersonationSuggestion, RecentImpersonation } from '@lfx-one/shared/interfaces';
import { composeFullName, hasLfAccount, rankUserSearchResults, resolveImpersonationStartErrorMessage } from '@lfx-one/shared/utils';
import { ImpersonationService } from '@services/impersonation.service';
import { SearchService } from '@services/search.service';
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
  protected recentImpersonations = signal<RecentImpersonation[]>(this.impersonationService.getRecentImpersonations());

  // Typed text goes through a subject rather than a valueChanges pipeline: PrimeNG's `delay` already
  // coalesces keystrokes before `completeMethod` fires, and its panel only opens for a suggestions
  // change that follows the completion it asked for.
  private readonly searchQuery$ = new Subject<string>();
  protected readonly suggestions = toSignal(this.searchQuery$.pipe(switchMap((query) => this.findSuggestions(query))), {
    initialValue: this.recentImpersonations() as ImpersonationSuggestion[],
  });

  public constructor() {
    // Closing mid-request would drop the loading UI while the change still goes through and reloads the page.
    lockDynamicDialogWhile(this.loading);
  }

  public submit(): void {
    const value = this.targetUserForm.controls.targetUser.value;
    const target = typeof value === 'string' ? value.trim() : '';
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

  protected onSearchComplete(event: AutoCompleteCompleteEvent): void {
    this.searchQuery$.next(event.query ?? '');
  }

  protected onSuggestionSelected(event: AutoCompleteSelectEvent): void {
    // p-autocomplete writes the full option object into the form on select; replace it with
    // the targetUser string so submit() and free-text typing both see a plain string.
    const entry = event.value as ImpersonationSuggestion | null;
    if (!entry || typeof entry !== 'object') return;

    this.targetUserForm.controls.targetUser.setValue(entry.targetUser);
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

    return this.searchService.searchUsers(term, 'committee_member', true).pipe(
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
}
