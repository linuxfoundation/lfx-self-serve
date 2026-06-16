// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';

import { OSSPREY_INACTIVE_REASON_OPTIONS, OSSPREY_UPDATABLE_STATUS_OPTIONS } from '@lfx-one/shared/constants';
import { OsspreyInactiveReason, OsspreyUpdatableStatus, OsspreyUpdateStatusRequest } from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';

@Component({
  selector: 'lfx-ossprey-status-modal',
  imports: [DialogModule, ReactiveFormsModule, ButtonComponent, SelectComponent, TextareaComponent],
  templateUrl: './ossprey-status-modal.component.html',
})
export class OsspreyStatusModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  public readonly visible = model(false);
  public readonly packageName = input<string | null>(null);
  public readonly loading = input(false);

  public readonly confirm = output<OsspreyUpdateStatusRequest>();

  protected readonly statusOptions = OSSPREY_UPDATABLE_STATUS_OPTIONS;
  protected readonly inactiveReasonOptions = OSSPREY_INACTIVE_REASON_OPTIONS;

  protected readonly selectedStatus = signal<OsspreyUpdatableStatus | null>(null);
  protected readonly requiresInactiveReason = computed(() => this.selectedStatus() === 'inactive');

  protected readonly form = this.formBuilder.nonNullable.group({
    status: '' as OsspreyUpdatableStatus | '',
    inactiveReason: '' as OsspreyInactiveReason | '',
    notes: '',
  });

  public constructor() {
    // Keep the conditional inactiveReason field in sync with the chosen status.
    this.form.controls.status.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.selectedStatus.set(status || null);
      if (status !== 'inactive') {
        this.form.controls.inactiveReason.setValue('');
      }
    });
  }

  protected onCancel(): void {
    this.visible.set(false);
  }

  protected get canSubmit(): boolean {
    const { status, inactiveReason } = this.form.getRawValue();
    if (!status) return false;
    if (status === 'inactive' && !inactiveReason) return false;
    return true;
  }

  protected onConfirm(): void {
    const { status, inactiveReason, notes } = this.form.getRawValue();
    if (!status) return;
    if (status === 'inactive' && !inactiveReason) return;
    this.confirm.emit({
      status,
      inactiveReason: status === 'inactive' ? (inactiveReason as OsspreyInactiveReason) : undefined,
      notes: notes.trim() || undefined,
    });
  }

  protected onShow(): void {
    this.selectedStatus.set(null);
    this.form.reset({ status: '', inactiveReason: '', notes: '' });
  }
}
