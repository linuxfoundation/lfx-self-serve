// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, model, output, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { EditorComponent } from '@components/editor/editor.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { GenerateNewsletterResponse } from '@lfx-one/shared/interfaces';
import { stripHtml } from '@lfx-one/shared/utils';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { EMPTY, startWith, switchMap } from 'rxjs';

import { NewsletterGenerateDrawerComponent } from '../newsletter-generate-drawer/newsletter-generate-drawer.component';

@Component({
  selector: 'lfx-newsletter-content-step',
  imports: [ReactiveFormsModule, EditorComponent, InputTextComponent, NewsletterGenerateDrawerComponent, ConfirmDialogModule],
  templateUrl: './newsletter-content-step.component.html',
})
export class NewsletterContentStepComponent {
  // === Services ===
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly form = input.required<FormGroup>();
  // contextType is retained because the AI prompt template references it for
  // tonal cues; the newsletter feature itself is project-only at the API
  // boundary.
  public readonly contextType = input<'foundation' | 'project'>('project');
  public readonly contextName = input.required<string>();
  public readonly hasContext = input<boolean>(false);
  public readonly savedLabel = input<string | null>(null);

  // === Outputs ===
  public readonly generated = output<GenerateNewsletterResponse>();

  // === Model signals ===
  public readonly generateDrawerVisible = model<boolean>(false);

  // === Reactive form mirrors ===
  protected readonly subjectValue: Signal<string> = this.initControlValue('subject');
  protected readonly bodyValue: Signal<string> = this.initControlValue('bodyHtml');
  protected readonly bodyFilled = computed(() => stripHtml(this.bodyValue()).length > 0);

  protected openGenerateDrawer(): void {
    if (!this.hasContext()) return;
    this.generateDrawerVisible.set(true);
  }

  protected onGenerated(result: GenerateNewsletterResponse): void {
    const hasSubject = this.subjectValue().trim().length > 0;
    const hasBody = this.bodyFilled();
    if (hasSubject || hasBody) {
      this.confirmationService.confirm({
        key: 'newsletter-content-step',
        header: 'Replace existing content?',
        message: 'This will overwrite your current subject and body with the AI-generated newsletter. You can still edit the result before sending.',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Replace',
        rejectLabel: 'Keep current',
        acceptButtonStyleClass: 'p-button-sm',
        rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
        accept: () => this.generated.emit(result),
      });
      return;
    }
    this.generated.emit(result);
  }

  private initControlValue(controlName: string): Signal<string> {
    return toSignal(
      toObservable(this.form).pipe(
        switchMap((fg) => {
          const ctrl = fg.get(controlName);
          if (!ctrl) return EMPTY;
          return ctrl.valueChanges.pipe(startWith(ctrl.value));
        }),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: '' }
    ) as Signal<string>;
  }
}
