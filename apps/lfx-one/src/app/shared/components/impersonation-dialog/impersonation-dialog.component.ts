// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { PersonaType, RecentImpersonation } from '@lfx-one/shared/interfaces';
import { ImpersonationService } from '@services/impersonation.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-impersonation-dialog',
  imports: [AutocompleteComponent, InputTextComponent, SelectComponent, ButtonComponent],
  templateUrl: './impersonation-dialog.component.html',
})
export class ImpersonationDialogComponent {
  private readonly impersonationService = inject(ImpersonationService);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected targetUserForm = new FormGroup({
    targetUser: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    personaContext: new FormControl<PersonaType | null>(null),
  });

  protected readonly personaOptions = [
    { label: 'Use their context', value: null },
    { label: 'Executive Director', value: 'executive-director' as PersonaType },
    { label: 'Board Member', value: 'board-member' as PersonaType },
    { label: 'Maintainer', value: 'maintainer' as PersonaType },
    { label: 'Contributor', value: 'contributor' as PersonaType },
  ];

  protected loading = signal(false);
  protected error = signal('');
  protected recentImpersonations = signal<RecentImpersonation[]>(this.impersonationService.getRecentImpersonations());
  protected suggestions = signal<RecentImpersonation[]>(this.recentImpersonations());
  private selectedRecentTargetUser = signal<string | null>(null);

  public constructor() {
    // Drop the auto-restored persona context as soon as the user steers the target away from
    // the recent profile they picked — otherwise submit() would impersonate the new target
    // under the previous profile's lens.
    this.targetUserForm.controls.targetUser.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      const lastSelected = this.selectedRecentTargetUser();
      if (lastSelected && value !== lastSelected) {
        this.selectedRecentTargetUser.set(null);
        this.targetUserForm.controls.personaContext.setValue(null);
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
      .startImpersonation(target, personaContext)
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
          this.dialogRef.close(true);
          window.location.reload();
        },
        error: (err) => {
          this.loading.set(false);
          this.targetUserForm.controls.targetUser.enable();
          this.targetUserForm.controls.personaContext.enable();
          this.error.set(err.error?.error || 'Failed to start impersonation');
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
