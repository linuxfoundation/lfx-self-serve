// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import {
  INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR,
  INSIGHTS_TOKEN_ERROR_MESSAGES,
  INSIGHTS_TOKEN_NAME_CONTROL_CHARACTERS,
  INSIGHTS_TOKEN_NAME_MAX_LENGTH,
} from '@lfx-one/shared/constants';
import { CreateInsightsTokenResponse, InsightsTokenErrorCode } from '@lfx-one/shared/interfaces';
import { codePointLength } from '@lfx-one/shared/utils';
import { maxCodePointsValidator } from '@lfx-one/shared/validators';
import { InsightsTokensService } from '@services/insights-tokens.service';
import { extractErrorMessage, isBffValidationError } from '@shared/utils/http-error.utils';
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
  // Code points, not UTF-16 units, to match the BFF and the PAT service's rune count; so no native maxlength either.
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, maxCodePointsValidator(INSIGHTS_TOKEN_NAME_MAX_LENGTH)] }),
  });
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly tooLong = computed(() => codePointLength(this.trimmedName()) > INSIGHTS_TOKEN_NAME_MAX_LENGTH);
  // Same rule the BFF enforces, so a pasted tab or line break is caught here instead of as a 400.
  protected readonly hasControlCharacters = computed(() => INSIGHTS_TOKEN_NAME_CONTROL_CHARACTERS.test(this.trimmedName()));
  protected readonly nameDescribedBy = computed(() => {
    if (this.errorMessage()) return 'insights-token-name-error';
    if (this.tooLong()) return 'insights-token-name-length';
    return this.hasControlCharacters() ? 'insights-token-name-control' : null;
  });
  protected readonly canSubmit = computed(() => this.trimmedName().length > 0 && !this.tooLong() && !this.hasControlCharacters() && !this.submitting());

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
        error: (err: HttpErrorResponse) => this.errorMessage.set(this.createErrorMessage(err)),
      });
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  /** Known PAT/eligibility codes map to fixed copy; the BFF's own name-validation reason is shown as written. */
  private createErrorMessage(err: HttpErrorResponse): string {
    const code: unknown = err?.error?.upstreamCode;
    if (typeof code === 'string' && Object.hasOwn(INSIGHTS_TOKEN_ERROR_MESSAGES, code)) {
      return INSIGHTS_TOKEN_ERROR_MESSAGES[code as InsightsTokenErrorCode];
    }
    return isBffValidationError(err) ? extractErrorMessage(err, INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR) : INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR;
  }
}
