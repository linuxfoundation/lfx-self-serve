// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, OnInit, output, Signal, signal } from '@angular/core';
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
  imports: [
    ReactiveFormsModule,
    InputTextComponent,
    RichEditorComponent,
    NewsletterBlockComposerComponent,
    NewsletterGenerateDrawerComponent,
    ConfirmDialogModule,
  ],
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

  // === Writable signals ===
  // Internal-only drawer visibility (the parent never binds it), so a plain
  // signal, not model(). Two-way [(visible)] to the drawer still works.
  protected readonly generateDrawerVisible = signal<boolean>(false);

  // === Writable signals ===
  // Which body editor is showing. Seeded from the loaded draft in ngOnInit.
  protected readonly editorMode = signal<NewsletterEditorMode>('blocks');

  // === Reactive form mirrors ===
  protected readonly subjectValue: Signal<string> = this.initControlValue('subject');
  protected readonly bodyValue: Signal<string> = this.initControlValue('bodyHtml');
  protected readonly bodyFilled = computed(() => stripHtml(this.bodyValue()).length > 0);
  // Bumped on a mode switch to force `initialLayout` to re-read the live control
  // (a plain `form()`-only computed would freeze at the draft's initial layout —
  // the FormGroup identity never changes and in-session edits arrive via
  // setValue). The composer only reads `initialLayout` at mount, so re-reading on
  // toggle is exactly when it matters; per-keystroke edits need no re-read.
  private readonly layoutSeedVersion = signal<number>(0);
  // Seed the composer from the CURRENT body_layout so drafts, step revisits, and
  // a toggle back to Blocks rehydrate the canvas correctly. Read synchronously
  // (not via toObservable, which would emit a microtask late and seed empty).
  protected readonly initialLayout: Signal<NewsletterLayout | null> = computed(() => {
    this.layoutSeedVersion();
    return (this.form().get('bodyLayout')?.value as NewsletterLayout | null) ?? null;
  });

  public ngOnInit(): void {
    // Infer the editor from the draft: a saved layout means the composer, a
    // saved html body means the simple editor, otherwise the default (blocks).
    const layout = this.form().get('bodyLayout')?.value as NewsletterLayout | null;
    const html = (this.form().get('bodyHtml')?.value as string) ?? '';
    // A PRESENT layout means the composer, even after its last block is removed
    // (an empty-but-present layout is still authoritative upstream). Only a null
    // layout with authored html is the simple editor.
    if (layout !== null) {
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
    // Read the LIVE control, not the memoized signal, so in-session blocks count.
    const currentLayout = this.form().get('bodyLayout')?.value as NewsletterLayout | null;
    const outgoingHasContent = leavingBlocks ? (currentLayout?.blocks?.length ?? 0) > 0 : this.bodyFilled();

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
      // Also clear the derived body_html: it holds the layout's COMPLETE
      // server-rendered emitter email, which — kept as "simple" content with a
      // null layout — the send path would double-wrap in the legacy chrome. The
      // discard was already confirmed, so the simple editor starts empty.
      this.form().get('bodyHtml')?.setValue('');
    } else {
      // Drop the authored html; blocks become the source and the server
      // re-derives body_html on save.
      this.form().get('bodyHtml')?.setValue('');
    }
    // Force initialLayout to re-read the live control so the composer re-seeds
    // from the cleared/current layout rather than the frozen initial value.
    this.layoutSeedVersion.update((v) => v + 1);
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
