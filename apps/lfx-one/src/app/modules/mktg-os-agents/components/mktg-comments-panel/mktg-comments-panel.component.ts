// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import type { MktgDocumentCommentScope } from '@lfx-one/shared/interfaces';
import { MktgDocumentCommentsService } from '@services/mktg-document-comments.service';
import { MktgCommentThreadComponent } from '../mktg-comment-thread/mktg-comment-thread.component';

@Component({ selector: 'lfx-mktg-comments-panel', imports: [ButtonComponent, MktgCommentThreadComponent], templateUrl: './mktg-comments-panel.component.html' })
export class MktgCommentsPanelComponent {
  private readonly destroyRef = inject(DestroyRef);
  protected readonly comments = inject(MktgDocumentCommentsService);
  public readonly scope = input.required<MktgDocumentCommentScope>();
  public readonly content = input<unknown>(null);
  protected readonly labelContext = computed(() => ({ agentKey: this.scope().agentKey, content: this.content() }));
  public constructor() {
    toObservable(computed(() => ({ scope: this.scope(), content: this.content() })))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ scope, content }) => {
        this.comments.select(scope);
        this.comments.setLabelContent(content);
      });
    this.destroyRef.onDestroy(() => this.comments.select(null));
  }
  protected refresh(): void {
    this.comments.refresh();
  }
}
