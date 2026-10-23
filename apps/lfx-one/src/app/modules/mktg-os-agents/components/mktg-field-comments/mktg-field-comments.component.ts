// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterRenderEffect, Component, computed, DestroyRef, ElementRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MKTG_DOCUMENT_COMMENT_MAX_CHARS, MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES } from '@lfx-one/shared/constants';
import { describeMktgDocumentCommentField } from '@lfx-one/shared/utils';
import { MktgDocumentCommentsService } from '@services/mktg-document-comments.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { finalize, take } from 'rxjs';
import { MktgCommentThreadComponent } from '../mktg-comment-thread/mktg-comment-thread.component';

/** Append inside the existing field wrapper; never edit or copy the rendered asset. */
@Component({
  selector: 'lfx-mktg-field-comments',
  imports: [ButtonComponent, TextareaComponent, MktgCommentThreadComponent],
  host: {
    class: 'block min-w-0 text-left font-normal not-italic',
    '[class.hidden]': '!comments.loaded()',
    '[attr.data-mktg-comment-field]': 'field()',
    '[attr.data-testid]': "'mktg-field-comments-' + field()",
  },
  templateUrl: './mktg-field-comments.component.html',
})
export class MktgFieldCommentsComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly comments = inject(MktgDocumentCommentsService);
  public readonly field = input.required<string>();
  protected readonly form = new FormGroup({
    text: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(MKTG_DOCUMENT_COMMENT_MAX_CHARS)] }),
  });
  protected readonly opened = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly announcement = signal('');
  protected readonly maxChars = MKTG_DOCUMENT_COMMENT_MAX_CHARS;
  protected readonly inputId = computed(() => `mktg-comment-${encodeURIComponent(this.field())}`);
  protected readonly validationId = computed(() => `${this.inputId()}-validation`);
  protected readonly threads = computed(() => this.comments.threads().filter((thread) => thread.anchor.key === this.field()));
  protected readonly label = computed(() =>
    describeMktgDocumentCommentField(this.comments.selectedScope()?.agentKey, this.field(), this.comments.labelContent())
  );
  protected readonly countLabel = computed(() => (this.threads().length === 1 ? '1 comment' : `${this.threads().length} comments`));
  private submittedText = '';
  private requestId = '';

  public constructor() {
    afterRenderEffect(() => {
      this.comments.loaded();
      if (this.opened()) this.commentButton()?.setAttribute('aria-controls', `${this.inputId()}-composer`);
    });
    toObservable(this.comments.draftScopeKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.close());
  }
  protected open(): void {
    this.opened.set(true);
    this.announcement.set('');
  }
  protected close(focus = false): void {
    this.form.reset();
    this.opened.set(false);
    this.error.set('');
    this.requestId = '';
    this.submittedText = '';
    this.announcement.set('');
    const button = this.commentButton();
    button?.removeAttribute('aria-controls');
    if (focus) button?.focus();
  }
  protected save(): void {
    const text = this.form.controls.text.value;
    if (!text.trim()) this.form.controls.text.setErrors({ required: true });
    if (this.form.invalid || this.busy() || this.comments.saving() || !isPlatformBrowser(this.platformId)) {
      this.form.markAllAsTouched();
      return;
    }
    if (!this.requestId || text !== this.submittedText) {
      this.requestId = window.crypto.randomUUID();
      this.submittedText = text;
    }
    this.busy.set(true);
    this.error.set('');
    this.comments
      .add({ kind: 'field', key: this.field() }, text, this.requestId)
      .pipe(
        take(1),
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.close(true);
          this.announcement.set('Comment added');
        },
        error: (error: unknown) => this.error.set(extractErrorMessage(error, MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.save)),
      });
  }
  private commentButton(): HTMLButtonElement | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return this.host.nativeElement.querySelector<HTMLButtonElement>('[data-testid="mktg-field-comment-open"] button');
  }
}
