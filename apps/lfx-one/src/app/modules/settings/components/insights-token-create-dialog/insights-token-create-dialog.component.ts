// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR, INSIGHTS_TOKEN_ERROR_MESSAGES, INSIGHTS_TOKEN_NAME_MAX_LENGTH } from '@lfx-one/shared/constants';
import { CreateInsightsTokenResponse, InsightsTokenErrorCode } from '@lfx-one/shared/interfaces';
import { InsightsTokensService } from '@services/insights-tokens.service';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { finalize } from 'rxjs';

/** Name-only create form for an LFX Insights API token. Closes with the `CreateInsightsTokenResponse` on success. */
@Component({
  selector: 'lfx-insights-token-create-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent],
  templateUrl: './insights-token-create-dialog.component.html',
})
export class InsightsTokenCreateDialogComponent {
  /** The opener passes this to `nameDynamicDialog` so the headless dialog is named by its heading. */
  public static readonly headingId = 'insights-token-create-heading';

  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly insightsTokensService = inject(InsightsTokensService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly headingId = InsightsTokenCreateDialogComponent.headingId;
  protected readonly maxLength = INSIGHTS_TOKEN_NAME_MAX_LENGTH;
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(INSIGHTS_TOKEN_NAME_MAX_LENGTH)] }),
  });
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly canSubmit = computed(
    () => this.trimmedName().length > 0 && this.trimmedName().length <= INSIGHTS_TOKEN_NAME_MAX_LENGTH && !this.submitting()
  );

  private readonly nameValue = toSignal(this.form.controls.name.valueChanges, { initialValue: this.form.controls.name.value });
  private readonly trimmedName = computed(() => this.nameValue().trim());

  public constructor() {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('#insights-token-name')?.focus());
    this.form.controls.name.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.errorMessage.set(null));
  }

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    this.insightsTokensService
      .createToken(this.trimmedName())
      .pipe(
        finalize(() => this.submitting.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (created: CreateInsightsTokenResponse) => this.dialogRef.close(created),
        error: (err: HttpErrorResponse) => {
          const code = err?.error?.upstreamCode as InsightsTokenErrorCode | undefined;
          this.errorMessage.set((code && INSIGHTS_TOKEN_ERROR_MESSAGES[code]) || INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR);
        },
      });
  }

  protected cancel(): void {
    this.dialogRef.close();
  }
}
