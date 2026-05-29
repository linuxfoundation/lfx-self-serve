// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, model, output, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  AI_NEWSLETTER_SYSTEM_PROMPT,
  NEWSLETTER_PROMPT_STORAGE_KEY,
  NEWSLETTER_RAW_CONTENT_MAX_LENGTH,
  NEWSLETTER_SYSTEM_PROMPT_MAX_LENGTH,
} from '@lfx-one/shared/constants';
import { GenerateNewsletterResponse } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { debounceTime, finalize, take } from 'rxjs';

@Component({
  selector: 'lfx-newsletter-generate-drawer',
  imports: [DrawerModule, ReactiveFormsModule, ButtonComponent, TextareaComponent],
  templateUrl: './newsletter-generate-drawer.component.html',
})
export class NewsletterGenerateDrawerComponent {
  // === Services ===
  private readonly newsletterService = inject(NewsletterService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  // contextType is retained to drive AI prompt tone (foundation vs project),
  // independent of where the newsletter is sent from at the API.
  public readonly contextType = input<'foundation' | 'project'>('project');
  public readonly contextName = input.required<string>();

  // === Model Signals (two-way) ===
  public readonly visible = model<boolean>(false);

  // === Outputs ===
  public readonly generated = output<GenerateNewsletterResponse>();

  // === Forms ===
  public readonly form = new FormGroup({
    rawContent: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(NEWSLETTER_RAW_CONTENT_MAX_LENGTH)],
    }),
    systemPrompt: new FormControl<string>(AI_NEWSLETTER_SYSTEM_PROMPT, {
      nonNullable: true,
      validators: [Validators.maxLength(NEWSLETTER_SYSTEM_PROMPT_MAX_LENGTH)],
    }),
  });

  // === Writable Signals ===
  protected readonly generating = signal<boolean>(false);
  protected readonly promptCustomizerOpen = signal<boolean>(false);

  // === Form value mirrors ===
  protected readonly rawContentValue = toSignal(this.form.controls.rawContent.valueChanges, { initialValue: this.form.controls.rawContent.value });
  protected readonly systemPromptValue = toSignal(this.form.controls.systemPrompt.valueChanges, { initialValue: this.form.controls.systemPrompt.value });

  // === Computed ===
  protected readonly rawContentLength: Signal<number> = computed(() => (this.rawContentValue() ?? '').length);
  protected readonly promptIsCustomized: Signal<boolean> = computed(() => (this.systemPromptValue() ?? '').trim() !== AI_NEWSLETTER_SYSTEM_PROMPT.trim());
  protected readonly canGenerate: Signal<boolean> = computed(() => {
    const raw = (this.rawContentValue() ?? '').trim();
    const prompt = this.systemPromptValue() ?? '';
    return raw.length > 0 && raw.length <= NEWSLETTER_RAW_CONTENT_MAX_LENGTH && prompt.length <= NEWSLETTER_SYSTEM_PROMPT_MAX_LENGTH && !this.generating();
  });

  // Exposed for the template's "Reset to default" button.
  protected readonly defaultPrompt = AI_NEWSLETTER_SYSTEM_PROMPT;

  public constructor() {
    // Restore the customized prompt from localStorage on init (browser only).
    if (isPlatformBrowser(this.platformId)) {
      this.restoreCustomPrompt();

      // Persist the customized prompt on change (debounced).
      this.form.controls.systemPrompt.valueChanges.pipe(debounceTime(500), takeUntilDestroyed()).subscribe((value) => {
        this.persistCustomPrompt(value);
      });
    }
  }

  public onClose(): void {
    this.visible.set(false);
  }

  public onTogglePromptCustomizer(): void {
    this.promptCustomizerOpen.update((open) => !open);
  }

  public onResetPrompt(): void {
    this.form.controls.systemPrompt.setValue(AI_NEWSLETTER_SYSTEM_PROMPT);
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.removeItem(NEWSLETTER_PROMPT_STORAGE_KEY);
      } catch {
        // Silently ignore storage errors (private browsing, quota).
      }
    }
  }

  public onGenerate(): void {
    if (!this.canGenerate()) return;
    this.generating.set(true);

    const projectUid = this.projectContextService.activeContextUid();
    if (!projectUid) {
      this.generating.set(false);
      this.messageService.add({
        severity: 'warn',
        summary: 'No project selected',
        detail: 'Switch to a project before generating a newsletter.',
      });
      return;
    }
    this.newsletterService
      .generate(projectUid, {
        rawContent: this.form.controls.rawContent.value.trim(),
        contextType: this.contextType(),
        contextName: this.contextName(),
        systemPromptOverride: this.promptIsCustomized() ? this.form.controls.systemPrompt.value : undefined,
      })
      .pipe(
        take(1),
        finalize(() => this.generating.set(false))
      )
      .subscribe({
        next: (result) => {
          this.generated.emit(result);
          this.form.controls.rawContent.reset('');
          this.visible.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Generation failed',
            detail: err?.error?.message || err?.message || 'Could not generate newsletter. Please try again.',
          });
        },
      });
  }

  private restoreCustomPrompt(): void {
    try {
      const stored = localStorage.getItem(NEWSLETTER_PROMPT_STORAGE_KEY);
      if (stored && typeof stored === 'string') {
        this.form.controls.systemPrompt.setValue(stored, { emitEvent: false });
      }
    } catch {
      // Corrupt or inaccessible; ignore.
    }
  }

  private persistCustomPrompt(value: string): void {
    try {
      if (!value || value.trim() === AI_NEWSLETTER_SYSTEM_PROMPT.trim()) {
        localStorage.removeItem(NEWSLETTER_PROMPT_STORAGE_KEY);
        return;
      }
      localStorage.setItem(NEWSLETTER_PROMPT_STORAGE_KEY, value);
    } catch {
      // Silently ignore storage errors.
    }
  }
}
