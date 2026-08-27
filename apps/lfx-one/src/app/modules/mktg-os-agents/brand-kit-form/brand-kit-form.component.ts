// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnDestroy, output, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MessageComponent } from '@components/message/message.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { BRAND_KIT_INTAKE, BRAND_KIT_INTAKE_QUESTIONS, MKTG_INTAKE_FORMAT_ERRORS, MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS } from '@lfx-one/shared/constants';
import { BrandKitResultResponse, GithubRepoUrlError } from '@lfx-one/shared/interfaces';
import { githubRepoUrlValidator, trimmedRequired } from '@lfx-one/shared/validators';
import { BrandKitService } from '@services/brand-kit.service';
import { MktgAnswerMemoryService } from '@services/mktg-answer-memory.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { ProjectContextService } from '@services/project-context.service';
import { map } from 'rxjs';

/** Client-side poll cadence and cap for the generation session (~5 min). */
const RESULT_POLL_INTERVAL_MS = 10_000;
const RESULT_POLL_MAX_ATTEMPTS = 30;
/** Consecutive transient poll failures tolerated before giving up. */
const RESULT_POLL_MAX_CONSECUTIVE_ERRORS = 3;

/**
 * One-page Brand Kit intake form (dec-brand-kit-intake-form): all 7 of Paul's
 * questions, open-ended, single submission. Drives a one-shot form-mode agent
 * session via the BFF, polls for the validated document, and renders it with
 * a download option. The BFF persists the validated document server-side
 * (dec-brand-kit-storage-v2); this view renders the document and, when the
 * ready response is missing its persistence receipt, keeps polling a bounded
 * number of extra times so the server retries the idempotent write.
 */
@Component({
  selector: 'lfx-brand-kit-form',
  imports: [ReactiveFormsModule, ButtonComponent, CardComponent, MarkdownRendererComponent, MessageComponent, TextareaComponent],
  templateUrl: './brand-kit-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandKitFormComponent implements OnDestroy {
  private readonly answerMemory = inject(MktgAnswerMemoryService);
  private readonly brandKitService = inject(BrandKitService);
  private readonly dependencyService = inject(MktgDependencyService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContext = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Emitted when the user leaves the form back to the marketplace grid. */
  public readonly back = output<void>();

  // === Constants ===
  protected readonly questions = BRAND_KIT_INTAKE_QUESTIONS;

  // === Forms ===
  // Validators come from the SHARED intake definition, so this standalone form
  // and the form-first run shell enforce the same rules on the same questions —
  // a repo URL refused on one surface can't sail through the other.
  protected readonly intakeForm = new FormGroup(
    Object.fromEntries(
      BRAND_KIT_INTAKE_QUESTIONS.map((q) => [
        q.key,
        new FormControl('', { nonNullable: true, validators: [Validators.required, trimmedRequired(), ...this.formatValidators(q.key)] }),
      ])
    )
  );

  // === Computed ===
  private readonly intakeValue = toSignal(this.intakeForm.valueChanges, { initialValue: this.intakeForm.getRawValue() });
  private readonly intakeValid = toSignal(this.intakeForm.statusChanges.pipe(map((status) => status === 'VALID')), { initialValue: this.intakeForm.valid });
  /** Submission is inert until every answer is present AND usable — a refused repo URL blocks the run, it is not warned about. */
  protected readonly submitDisabled = computed(() => !this.intakeValid());
  /**
   * Blocking format-error copy per question key for the value currently typed
   * (e.g. an organization URL where a repository URL is required). The control
   * carries the validator, so this is only the message — the submit button is
   * already inert through the form's validity.
   */
  protected readonly fieldFormatErrors = computed<Record<string, string>>(() => {
    // Depend on the form's value so the message follows every keystroke;
    // Angular re-runs the validators before valueChanges emits.
    this.intakeValue();
    const messages: Record<string, string> = {};
    for (const field of BRAND_KIT_INTAKE.fields) {
      const error = this.intakeForm.controls[field.key]?.errors?.['githubRepoUrl'] as GithubRepoUrlError | undefined;
      if (field.format && error) {
        messages[field.key] = MKTG_INTAKE_FORMAT_ERRORS[field.format][error.reason];
      }
    }
    return messages;
  });

  // === Signals ===
  protected readonly generating = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly result = signal<BrandKitResultResponse | null>(null);

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  // Generation epoch: incremented on submit/cancel/reset so stale in-flight
  // poll responses (which a cleared timer cannot cancel) are discarded instead
  // of resurrecting a cancelled generation.
  private pollEpoch = 0;
  /**
   * Active project uid captured AT SUBMIT — the scope the BFF persists the
   * ready document under (writer-entitled, server-resolved). Captured once
   * rather than read per poll so a project switch mid-generation can never
   * redirect this run's write into another project's partition. Empty when no
   * project is selected: the document is still shown, just not persisted.
   */
  private runProjectUid = '';

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
    this.runProjectUid = this.projectContext.activeContextUid();
    // Remember the answers for this project so the NEXT agent's intake can
    // offer back what the user typed here (e.g. the repository URL) instead of
    // re-asking for it. Same memory the form-first run shell writes.
    this.answerMemory.remember(this.runProjectUid, BRAND_KIT_INTAKE.agentId, answers);
    const epoch = ++this.pollEpoch;

    this.brandKitService
      .generate(answers)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (epoch !== this.pollEpoch) {
            return;
          }
          this.pollResult(epoch, response.sessionId, response.ownerToken, 1, 0, 0);
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
    // Routed standalone (no parent binds `back`) — return to the marketplace
    // grid the same way the agent run shell does.
    this.router.navigate(['..'], { relativeTo: this.route, queryParamsHandling: 'preserve' });
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
    // SSR guard: Blob/URL/document are browser-only (ssr-safety rule).
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
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
    // Defer revocation — some browsers start the blob: download asynchronously,
    // so a synchronous revoke can abort it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // === Private methods ===
  /** The shared intake's format rule for a question, as validators (empty when it has none). */
  private formatValidators(key: string): ValidatorFn[] {
    const format = BRAND_KIT_INTAKE.fields.find((field) => field.key === key)?.format;
    return format === 'github-repo-url' ? [githubRepoUrlValidator()] : [];
  }

  private pollResult(epoch: number, sessionId: string, ownerToken: string, attempt: number, consecutiveErrors: number, persistRetries: number): void {
    this.brandKitService
      .getResult(sessionId, ownerToken, this.runProjectUid || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (epoch !== this.pollEpoch) {
            return;
          }
          if (response.status === 'ready') {
            // Show the validated document immediately — persistence is
            // best-effort and never blocks the user.
            this.generating.set(false);
            this.result.set(response);
            if (response.persistence) {
              // The project now has a SERVER-persisted Brand Kit — the copy
              // dependency gating reads. Announce it so the marketplace stops
              // showing dependents as locked over a document that exists
              // (dec-agent-dependency-gating). Gated on the receipt because
              // this surface stores no browser-side run: without the server
              // copy there is nothing for a re-resolve to find.
              this.dependencyService.notifyDocumentsChanged(this.runProjectUid);
              return;
            }
            if (persistRetries >= MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS) {
              return;
            }
            // Missing receipt: each extra poll re-triggers the server-side
            // content-addressed write, recovering from transient storage
            // outages without changing what the user sees.
            this.pollTimer = setTimeout(() => this.pollResult(epoch, sessionId, ownerToken, attempt + 1, 0, persistRetries + 1), RESULT_POLL_INTERVAL_MS);
            return;
          }
          if (this.result()) {
            // A non-ready payload while the document is already displayed can
            // only be a background persistence-retry poll — it must never
            // surface a timeout error over the rendered document or spin until
            // the attempt budget. Spend the bounded persist-retry budget
            // instead, mirroring the error branch below. (Once the document is
            // displayed, `attempt` is never consulted again on any branch.)
            if (persistRetries < MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS) {
              this.pollTimer = setTimeout(() => this.pollResult(epoch, sessionId, ownerToken, attempt + 1, 0, persistRetries + 1), RESULT_POLL_INTERVAL_MS);
            }
            return;
          }
          if (attempt >= RESULT_POLL_MAX_ATTEMPTS) {
            this.failGeneration('The generation is taking longer than expected. Please try again later.');
            return;
          }
          this.pollTimer = setTimeout(() => this.pollResult(epoch, sessionId, ownerToken, attempt + 1, 0, persistRetries), RESULT_POLL_INTERVAL_MS);
        },
        error: () => {
          if (epoch !== this.pollEpoch) {
            return;
          }
          if (this.result()) {
            // The document is already displayed — a failed background
            // persistence-retry poll must not surface an error or clear it.
            // Spend the remaining retry budget instead of abandoning it on a
            // single transient failure; the same cap bounds both paths.
            if (persistRetries < MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS) {
              this.pollTimer = setTimeout(() => this.pollResult(epoch, sessionId, ownerToken, attempt + 1, 0, persistRetries + 1), RESULT_POLL_INTERVAL_MS);
            }
            return;
          }
          // Tolerate transient failures — a multi-minute generation should not be
          // lost to a single network blip; the attempt budget still applies.
          if (consecutiveErrors + 1 > RESULT_POLL_MAX_CONSECUTIVE_ERRORS || attempt >= RESULT_POLL_MAX_ATTEMPTS) {
            this.failGeneration('Could not fetch the generation result. Please try again.');
            return;
          }
          this.pollTimer = setTimeout(
            () => this.pollResult(epoch, sessionId, ownerToken, attempt + 1, consecutiveErrors + 1, persistRetries),
            RESULT_POLL_INTERVAL_MS
          );
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
