// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { IMPERSONATION_SEARCH_NO_ACCOUNT_MESSAGE, IMPERSONATION_TRANSITION_MESSAGES } from '@lfx-one/shared/constants';
import { PersonaType, RecentImpersonation, UserSearchOption } from '@lfx-one/shared/interfaces';
import { composeFullName, resolveImpersonationStartErrorMessage } from '@lfx-one/shared/utils';
import { ImpersonationService } from '@services/impersonation.service';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-impersonation-dialog',
  imports: [AutocompleteComponent, InputTextComponent, SelectComponent, ButtonComponent, UserSearchComponent],
  templateUrl: './impersonation-dialog.component.html',
})
export class ImpersonationDialogComponent {
  private readonly impersonationService = inject(ImpersonationService);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig, { optional: true });

  // True when opened from the impersonation banner to swap the active target rather than start a session.
  protected readonly switching = Boolean(this.dialogConfig?.data?.['switching']);

  protected targetUserForm = new FormGroup({
    targetUser: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    personaContext: new FormControl<PersonaType | null>(null),
  });

  // Deliberately empty: lfx-user-search nulls every control bound to its parent form whenever its
  // text empties (PrimeNG emits onClear on a backspace to blank), so targetUser must not live here.
  protected readonly nameSearchForm = new FormGroup({});

  protected readonly personaOptions = [
    { label: 'Use their context', value: null },
    { label: 'Executive Director', value: 'executive-director' as PersonaType },
    { label: 'Board Member', value: 'board-member' as PersonaType },
    { label: 'Maintainer', value: 'maintainer' as PersonaType },
    { label: 'Contributor', value: 'contributor' as PersonaType },
  ];

  protected loading = signal(false);
  protected loadingMessage = computed(() => (this.loading() ? IMPERSONATION_TRANSITION_MESSAGES[this.switching ? 'switching' : 'starting'] : ''));
  protected error = signal('');
  protected recentImpersonations = signal<RecentImpersonation[]>(this.impersonationService.getRecentImpersonations());
  protected suggestions = signal<RecentImpersonation[]>(this.recentImpersonations());
  // The name lfx-user-search keeps showing after a pick; '' (not null) puts the picker in its
  // committed-label mode, where it no longer blanks itself on select.
  protected nameSearchLabel = signal('');
  private selectedRecentTargetUser = signal<string | null>(null);
  private nameSearchPickedUsername = signal<string | null>(null);

  public constructor() {
    // Closing mid-request would drop the loading UI while the change still goes through and reloads the page.
    lockDynamicDialogWhile(this.loading);

    // Drop the auto-restored persona context as soon as the user steers the target away from
    // the recent profile they picked — otherwise submit() would impersonate the new target
    // under the previous profile's lens.
    this.targetUserForm.controls.targetUser.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      const lastSelected = this.selectedRecentTargetUser();
      if (lastSelected && value !== lastSelected) {
        this.selectedRecentTargetUser.set(null);
        this.targetUserForm.controls.personaContext.setValue(null);
      }

      // The shown name belongs to the username it was picked for — once the target is edited to
      // something else, drop the name rather than leave it beside a different person's username.
      const pickedUsername = this.nameSearchPickedUsername();
      if (pickedUsername && value !== pickedUsername) {
        this.nameSearchPickedUsername.set(null);
        this.nameSearchLabel.set('');
      }
    });
  }

  public submit(): void {
    const target = this.targetUserForm.controls.targetUser.value.trim();
    if (!target) return;

    const personaContext = this.targetUserForm.controls.personaContext.value;

    this.loading.set(true);
    this.error.set('');
    this.targetUserForm.controls.targetUser.disable();
    this.targetUserForm.controls.personaContext.disable();

    this.impersonationService
      .startImpersonation(target, personaContext, this.switching)
      .pipe(take(1))
      .subscribe({
        next: (response) => {
          this.impersonationService.addRecentImpersonation({
            targetUser: target,
            email: response.targetUser.email,
            username: response.targetUser.username,
            name: response.targetUser.name,
            picture: response.targetUser.picture,
            personaContext,
          });
          // Left open (still under its loading overlay) until the reload unloads the page: closing it here would
          // drop the loading UI for the whole reload.
          window.location.reload();
        },
        error: (err) => {
          this.loading.set(false);
          this.targetUserForm.controls.targetUser.enable();
          this.targetUserForm.controls.personaContext.enable();
          this.error.set(resolveImpersonationStartErrorMessage(err.error?.code));
        },
      });
  }

  public cancel(): void {
    this.dialogRef.close(false);
  }

  protected onSearchComplete(event: AutoCompleteCompleteEvent): void {
    const query = (event.query ?? '').trim().toLowerCase();
    const entries = this.recentImpersonations();

    if (!query) {
      this.suggestions.set([...entries]);
      return;
    }

    this.suggestions.set(
      entries.filter(
        (r) =>
          r.email.toLowerCase().includes(query) ||
          r.username?.toLowerCase().includes(query) ||
          (r.name?.toLowerCase().includes(query) ?? false) ||
          r.targetUser.toLowerCase().includes(query)
      )
    );
  }

  protected onNameSearchSelected(user: UserSearchOption): void {
    // requireLfAccount guarantees a username on every pick that reaches this handler.
    const username = user.username?.trim() ?? '';

    // Record the pick before writing the target so the valueChanges guard above sees them match.
    this.nameSearchPickedUsername.set(username);
    this.nameSearchLabel.set(composeFullName(user.first_name, user.last_name) || username);
    this.targetUserForm.controls.targetUser.setValue(username);
    this.error.set('');
  }

  protected onNameSearchTyped(text: string): void {
    // Whatever is typed is the target as typed: the directory only indexes committee members and matches
    // names, not emails, so a pasted email or username may never surface as a result. The exchange resolves
    // it exactly and a missing user fails there with a message. Emptying the box leaves the target alone,
    // the same as the clear icon (onNameSearchCleared).
    const term = text.trim();
    if (!term) return;

    // Record the label before writing the target so the valueChanges guard sees them match and keeps the text.
    this.nameSearchPickedUsername.set(term);
    this.nameSearchLabel.set(text);
    this.targetUserForm.controls.targetUser.setValue(term);
    this.error.set('');
  }

  protected onNameSearchCleared(): void {
    // Only the shown name goes; the target keeps whatever it holds until the admin changes it.
    this.nameSearchPickedUsername.set(null);
    this.nameSearchLabel.set('');
  }

  protected onNameSearchRejected(): void {
    // Empty the target as well as showing the message: otherwise an earlier target stays armed
    // behind the alert and Start would impersonate that person while the pick appears to have
    // failed. The valueChanges guard in the constructor drops the stale shown name with it.
    this.targetUserForm.controls.targetUser.setValue('');
    this.error.set(IMPERSONATION_SEARCH_NO_ACCOUNT_MESSAGE);
  }

  protected onSuggestionSelected(event: AutoCompleteSelectEvent): void {
    // p-autocomplete writes the full option object into the form on select; replace it with
    // the targetUser string so submit() and free-text typing both see a plain string.
    const entry = event.value as RecentImpersonation | null;
    if (!entry || typeof entry !== 'object') return;

    this.selectedRecentTargetUser.set(entry.targetUser);
    this.targetUserForm.controls.targetUser.setValue(entry.targetUser);
    this.targetUserForm.controls.personaContext.setValue(entry.personaContext ?? null);
  }
}
