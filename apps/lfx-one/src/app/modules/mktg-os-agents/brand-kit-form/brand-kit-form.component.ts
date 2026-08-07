// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnDestroy, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MessageComponent } from '@components/message/message.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { BRAND_KIT_INTAKE_QUESTIONS } from '@lfx-one/shared/constants';
import { BrandKitResultResponse } from '@lfx-one/shared/interfaces';
import { BrandKitService } from '@services/brand-kit.service';

/** Client-side poll cadence and cap for the generation session (~5 min). */
const RESULT_POLL_INTERVAL_MS = 10_000;
const RESULT_POLL_MAX_ATTEMPTS = 30;
/** Consecutive transient poll failures tolerated before giving up. */
const RESULT_POLL_MAX_CONSECUTIVE_ERRORS = 3;

/**
 * One-page Brand Kit intake form (dec-brand-kit-intake-form): all 7 of Paul's
 * questions, open-ended, single submission. Drives a one-shot form-mode agent
 * session via the BFF, polls for the validated document, and renders it with
 * a download option. No persistence — the document lives in this view only.
 */
@Component({
  selector: 'lfx-brand-kit-form',
  imports: [ReactiveFormsModule, ButtonComponent, CardComponent, MarkdownRendererComponent, MessageComponent, TextareaComponent],
  templateUrl: './brand-kit-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandKitFormComponent implements OnDestroy {
  private readonly brandKitService = inject(BrandKitService);
  private readonly destroyRef = inject(DestroyRef);

  /** Emitted when the user leaves the form back to the marketplace grid. */
  public readonly back = output<void>();

  // === Constants ===
  protected readonly questions = BRAND_KIT_INTAKE_QUESTIONS;

  // === Forms ===
  protected readonly intakeForm = new FormGroup(
    Object.fromEntries(BRAND_KIT_INTAKE_QUESTIONS.map((q) => [q.key, new FormControl('', { nonNullable: true, validators: [Validators.required] })]))
  );

  // === Signals ===
  protected readonly generating = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly result = signal<BrandKitResultResponse | null>(null);

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  // Generation epoch: incremented on submit/cancel/reset so stale in-flight
  // poll responses (which a cleared timer cannot cancel) are discarded instead
  // of resurrecting a cancelled generation.
  private pollEpoch = 0;

  public ngOnDestroy(): void {
    this.clearPollTimer();
  }

  // === Protected methods ===
  protected onSubmit(): void {
    if (this.generating()) {
      return;
    }
    if (this.intakeForm.invalid) {
      this.intakeForm.markAllAsTouched();
      return;
    }

    const answers = Object.fromEntries(Object.entries(this.intakeForm.getRawValue()).map(([key, value]) => [key, String(value).trim()]));

    this.generating.set(true);
    this.errorMessage.set('');
    this.result.set(null);
    const epoch = ++this.pollEpoch;

    this.brandKitService
      .generate(answers)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (epoch !== this.pollEpoch) {
            return;
          }
          this.pollResult(epoch, response.sessionId, response.ownerToken, 1, 0);
        },
        error: () => {
          if (epoch !== this.pollEpoch) {
            return;
          }
          this.failGeneration('Could not start the Brand Kit generation. Please try again.');
        },
      });
  }

  protected onBack(): void {
    this.pollEpoch++;
    this.clearPollTimer();
    this.back.emit();
  }

  protected onStartOver(): void {
    this.pollEpoch++;
    this.clearPollTimer();
    this.generating.set(false);
    this.errorMessage.set('');
    this.result.set(null);
    this.intakeForm.reset();
  }

  protected onDownload(): void {
    const current = this.result();
    if (!current?.documentMarkdown) {
      return;
    }
    const blob = new Blob([current.documentMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${current.project || 'brand-kit'}-brand-kit-v${current.version || 1}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // === Private methods ===
  private pollResult(epoch: number, sessionId: string, ownerToken: string, attempt: number, consecutiveErrors: number): void {
    this.brandKitService
      .getResult(sessionId, ownerToken)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (epoch !== this.pollEpoch) {
            return;
          }
          if (response.status === 'ready') {
            this.generating.set(false);
            this.result.set(response);
            return;
          }
          if (attempt >= RESULT_POLL_MAX_ATTEMPTS) {
            this.failGeneration('The generation is taking longer than expected. Please try again later.');
            return;
          }
          this.pollTimer = setTimeout(() => this.pollResult(epoch, sessionId, ownerToken, attempt + 1, 0), RESULT_POLL_INTERVAL_MS);
        },
        error: () => {
          if (epoch !== this.pollEpoch) {
            return;
          }
          // Tolerate transient failures — a multi-minute generation should not be
          // lost to a single network blip; the attempt budget still applies.
          if (consecutiveErrors + 1 >= RESULT_POLL_MAX_CONSECUTIVE_ERRORS || attempt >= RESULT_POLL_MAX_ATTEMPTS) {
            this.failGeneration('Could not fetch the generation result. Please try again.');
            return;
          }
          this.pollTimer = setTimeout(() => this.pollResult(epoch, sessionId, ownerToken, attempt + 1, consecutiveErrors + 1), RESULT_POLL_INTERVAL_MS);
        },
      });
  }

  private failGeneration(message: string): void {
    this.clearPollTimer();
    this.generating.set(false);
    this.errorMessage.set(message);
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
