// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { MKTG_FAMILY_PRINT_COPY, MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import { FaqGroupView } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintFill } from '@lfx-one/shared/utils';
import { MktgPortraitRectDirective } from '../../mktg-portrait/mktg-portrait-rect.directive';

/**
 * One FAQ page of the family book: the groups the plan gives this page, as
 * a two-column grid of question, answer and source chip. The first page's
 * intro counts the whole FAQ; a later page's names its groups. Unanswered
 * questions do not print, and a group left with none is not printed.
 */
@Component({
  selector: 'lfx-mktg-family-print-faq-page',
  imports: [MktgPortraitRectDirective],
  templateUrl: './mktg-family-print-faq-page.component.html',
  styleUrl: './mktg-family-print-faq-page.component.scss',
})
export class MktgFamilyPrintFaqPageComponent {
  /** The whole FAQ, for the counts. */
  public readonly groups = input.required<FaqGroupView[]>();
  /** Indices into `groups` of the groups this page prints. */
  public readonly pageGroups = input.required<number[]>();
  /** This page's index among the FAQ pages. */
  public readonly index = input(0);

  public readonly geometry = MKTG_PORTRAIT_PAGE;
  public readonly column: readonly [number, number] = [MKTG_PORTRAIT_PAGE.margin, MKTG_PORTRAIT_PAGE.contentWidth];

  public readonly shown: Signal<FaqGroupView[]> = this.initShown();
  public readonly intro: Signal<string> = this.initIntro();

  private initShown(): Signal<FaqGroupView[]> {
    return computed(() => {
      const groups = this.groups();
      return this.pageGroups()
        .map((index) => groups[index])
        .filter((group): group is FaqGroupView => !!group)
        .map((group) => ({ ...group, questions: group.questions.filter((entry) => entry.answered) }))
        .filter((group) => group.questions.length > 0);
    });
  }

  private initIntro(): Signal<string> {
    return computed(() => {
      if (this.index() > 0)
        return `${this.shown()
          .map((group) => group.name)
          .join(' · ')}.`;
      const sizes = this.groups()
        .map((group) => group.questions.filter((entry) => entry.answered).length)
        .filter((size) => size > 0);
      const questions = sizes.reduce((sum, size) => sum + size, 0);
      return mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.faqIntro, { Questions: questions, Groups: sizes.length });
    });
  }
}
