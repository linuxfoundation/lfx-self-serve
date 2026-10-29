// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, model } from '@angular/core';
import { _IdGenerator } from '@angular/cdk/a11y';
import { ButtonComponent } from '@components/button/button.component';
import { MKTG_DOCUMENT_COMMENT_STATUS_LABELS } from '@lfx-one/shared/constants';
import type { MktgDocumentComment, MktgDocumentCommentLabelContext } from '@lfx-one/shared/interfaces';
import { describeMktgRevisionAuthor, describeMktgDocumentCommentField } from '@lfx-one/shared/utils';

@Component({ selector: 'lfx-mktg-comment-thread', imports: [DatePipe, ButtonComponent], templateUrl: './mktg-comment-thread.component.html' })
export class MktgCommentThreadComponent {
  private readonly ids = inject(_IdGenerator);

  public readonly comment = input.required<MktgDocumentComment>();
  public readonly fieldLabel = input('');
  public readonly labelContext = input<MktgDocumentCommentLabelContext | null>(null);
  public readonly expanded = model(false);
  protected readonly detailsId = this.ids.getId('mktg-comment-details-');
  protected readonly preview = computed(() => this.comment().text.split(/\r?\n/, 1)[0] ?? '');
  protected readonly field = computed(
    () => this.fieldLabel() || describeMktgDocumentCommentField(this.labelContext()?.agentKey, this.comment().anchor.key, this.labelContext()?.content)
  );
  protected readonly author = computed(() => describeMktgRevisionAuthor(this.comment().author));
  protected readonly status = computed(() => MKTG_DOCUMENT_COMMENT_STATUS_LABELS[this.comment().status]);
}
