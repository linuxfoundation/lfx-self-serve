// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, model, OnInit, output, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import { GenerateNewsletterResponse, NewsletterEditorMode, NewsletterLayout } from '@lfx-one/shared/interfaces';
import { stripHtml } from '@lfx-one/shared/utils';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { EMPTY, startWith, switchMap } from 'rxjs';

import { NewsletterBlockComposerComponent } from '../newsletter-block-composer/newsletter-block-composer.component';
import { NewsletterGenerateDrawerComponent } from '../newsletter-generate-drawer/newsletter-generate-drawer.component';

/**
 * The wizard's Content step. Hosts two mutually-exclusive body editors the
 * author toggles between:
 *   - blocks: the structured block composer (authors `body_layout`), the
 *     default; the server renders it to `body_html` on save.
 *   - simple: a rich-text editor over `body_html` plus AI generation (the
 *     original pre-composer editor).
 *
 * Switching modes clears the other representation so only one body source is
 * ever authoritative (a confirm guards the discard when the outgoing editor
 * holds content). The mode is inferred on init from whichever representation the
 * loaded draft already carries.
 */
@Component({
  selector: 'lfx-newsletter-content-step',
  imports: [ReactiveFormsModule, InputTextComponent, RichEditorComponent, NewsletterBlockComposerComponent, NewsletterGenerateDrawerComponent, ConfirmDialogModule],
  templateUrl: './newsletter-content-step.component.html',
})
export class NewsletterContentStepComponent implements OnInit {
  // === Services ===
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly form = input.required<FormGroup>();
  // contextType is retained because the AI prompt template references it for
  // tonal cues; the newsletter feature itself is project-only at the API
  // boundary.
  public readonly contextType = input<'foundation' | 'project'>('project');
  public readonly contextName = input<string>('');
  public readonly hasContext = input<boolean>(false);
  public readonly savedLabel = input<string | null>(null);

  // === Outputs ===
  public readonly generated = output<GenerateNewsletterResponse>();

  // === Model signals ===
  public readonly generateDrawerVisible = model<boolean>(false);

  // === Writable signals ===
  // Which body editor is showing. Seeded from the loaded draft in ngOnInit.
  protected readonly editorMode = signal<NewsletterEditorMode>('blocks');

  // === Reactive form mirrors ===
  protected readonly subjectValue: Signal<string> = this.initControlValue('subject');
  protected readonly bodyValue: Signal<string> = this.initControlValue('bodyHtml');
  protected readonly bodyFilled = computed(() => stripHtml(this.bodyValue()).length > 0);
  // Seed the composer from the form's current body_layout so drafts and step
  // revisits rehydrate the canvas. body_layout is the authored source of truth
  // in blocks mode; the server derives body_html from it on save.
  protected readonly initialLayout: Signal<NewsletterLayout | null> = computed(() => (this.form().get('bodyLayout')?.value as NewsletterLayout | null) ?? null);

  public ngOnInit(): void {
    // Infer the editor from the draft: a saved layout means the composer, a
    // saved html body means the simple editor, otherwise the default (blocks).
    const layout = this.form().get('bodyLayout')?.value as NewsletterLayout | null;
    const html = (this.form().get('bodyHtml')?.value as string) ?? '';
    if ((layout?.blocks?.length ?? 0) > 0) {
      this.editorMode.set('blocks');
    } else if (stripHtml(html).length > 0) {
      this.editorMode.set('simple');
    }
  }

  protected onLayoutChange(layout: NewsletterLayout): void {
    this.form().get('bodyLayout')?.setValue(layout);
  }

  /**
   * Switch editors. When the outgoing editor holds content, confirm first — the
   * switch clears the other representation so only one body source stays
   * authoritative (the server would otherwise render body_layout over an
   * authored body_html).
   */
  protected setMode(mode: NewsletterEditorMode): void {
    if (mode === this.editorMode()) return;
    const leavingBlocks = this.editorMode() === 'blocks';
    const outgoingHasContent = leavingBlocks ? (this.initialLayout()?.blocks?.length ?? 0) > 0 : this.bodyFilled();

    if (outgoingHasContent) {
      this.confirmationService.confirm({
        key: 'newsletter-content-step',
        header: 'Switch editor?',
        message: leavingBlocks
          ? 'Switching to the simple editor discards the blocks you have added. Continue?'
          : 'Switching to the block editor discards the body you have written. Continue?',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Switch',
        rejectLabel: 'Keep current',
        acceptButtonStyleClass: 'p-button-sm',
        rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
        accept: () => this.applyMode(mode),
      });
      return;
    }
    this.applyMode(mode);
  }

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

  /** Clear the outgoing editor's representation, then switch. */
  private applyMode(mode: NewsletterEditorMode): void {
    if (mode === 'simple') {
      // Drop the layout so the server uses the authored html rather than
      // rendering blocks over it.
      this.form().get('bodyLayout')?.setValue(null);
    } else {
      // Drop the authored html; blocks become the source and the server
      // re-derives body_html on save.
      this.form().get('bodyHtml')?.setValue('');
    }
    this.editorMode.set(mode);
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
