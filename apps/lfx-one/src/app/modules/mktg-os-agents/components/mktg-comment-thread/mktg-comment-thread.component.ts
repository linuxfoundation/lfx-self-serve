// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { MKTG_DOCUMENT_COMMENT_STATUS_LABELS } from '@lfx-one/shared/constants';
import type { MktgDocumentComment, MktgDocumentCommentLabelContext } from '@lfx-one/shared/interfaces';
import { describeMktgRevisionAuthor, describeMktgDocumentCommentField } from '@lfx-one/shared/utils';

@Component({ selector: 'lfx-mktg-comment-thread', imports: [DatePipe], templateUrl: './mktg-comment-thread.component.html' })
export class MktgCommentThreadComponent {
  public readonly comment = input.required<MktgDocumentComment>();
  public readonly fieldLabel = input('');
  public readonly labelContext = input<MktgDocumentCommentLabelContext | null>(null);
  protected readonly field = computed(
    () => this.fieldLabel() || describeMktgDocumentCommentField(this.labelContext()?.agentKey, this.comment().anchor.key, this.labelContext()?.content)
  );
  protected readonly author = computed(() => describeMktgRevisionAuthor(this.comment().author));
  protected readonly status = computed(() => MKTG_DOCUMENT_COMMENT_STATUS_LABELS[this.comment().status]);
}
