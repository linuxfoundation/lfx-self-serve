// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { MKTG_FAMILY_PRINT_COPY } from '@lfx-one/shared/constants';
import { FaqGroupView } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintFill } from '@lfx-one/shared/utils';

/**
 * One FAQ page of the family book: the groups the plan gives this page, as
 * a two-column grid of question, answer and source chip. The first page's
 * intro counts the whole FAQ; a later page's names its groups. A question
 * with no answer prints its question only, as the FAQ itself does.
 */
@Component({
  selector: 'lfx-mktg-family-print-faq-page',
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

  public readonly shown: Signal<FaqGroupView[]> = this.initShown();
  public readonly intro: Signal<string> = this.initIntro();

  private initShown(): Signal<FaqGroupView[]> {
    return computed(() => {
      const groups = this.groups();
      return this.pageGroups()
        .map((index) => groups[index])
        .filter((group): group is FaqGroupView => !!group);
    });
  }

  private initIntro(): Signal<string> {
    return computed(() => {
      if (this.index() > 0)
        return `${this.shown()
          .map((group) => group.name)
          .join(' · ')}.`;
      const groups = this.groups().filter((group) => group.questions.length);
      const questions = groups.reduce((sum, group) => sum + group.questions.length, 0);
      return mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.faqIntro, { Questions: questions, Groups: groups.length });
    });
  }
}
