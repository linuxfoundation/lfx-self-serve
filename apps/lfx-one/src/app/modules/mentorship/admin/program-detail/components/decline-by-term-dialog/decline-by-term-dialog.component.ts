// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { MENTORSHIP_ADMIN_DECLINE_BY_TERM_MESSAGE, MENTORSHIP_ADMIN_DECLINE_BY_TERM_NO_TERMS_MESSAGE } from '@lfx-one/shared/constants';
import { FilterOption, MentorshipAdminTermOption, MentorshipDeclineByTermDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Decline by Term dialog of the Current Mentees tab. The admin picks one open term; the dialog closes with that
 * term so the caller can confirm and decline its pending applications, or with nothing when dismissed.
 */
@Component({
  selector: 'lfx-mentorship-decline-by-term-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, SelectComponent],
  templateUrl: './decline-by-term-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeclineByTermDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject<DynamicDialogConfig<MentorshipDeclineByTermDialogData>>(DynamicDialogConfig);

  private readonly terms: MentorshipAdminTermOption[] = this.dialogConfig.data?.terms ?? [];
  protected readonly message = MENTORSHIP_ADMIN_DECLINE_BY_TERM_MESSAGE;
  protected readonly noTermsMessage = MENTORSHIP_ADMIN_DECLINE_BY_TERM_NO_TERMS_MESSAGE;
  protected readonly termOptions: FilterOption<string>[] = this.terms.map((term) => ({ label: term.name, value: term.id }));
  protected readonly hasTerms = computed(() => this.termOptions.length > 0);

  protected readonly form = new FormGroup({
    term: new FormControl<string | null>(this.termOptions.length === 1 ? this.termOptions[0].value : null, { validators: [Validators.required] }),
  });

  protected onContinue(): void {
    const termId = this.form.controls.term.value;
    const term = this.terms.find((item) => item.id === termId);
    if (this.form.invalid || !term) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close(term);
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}
