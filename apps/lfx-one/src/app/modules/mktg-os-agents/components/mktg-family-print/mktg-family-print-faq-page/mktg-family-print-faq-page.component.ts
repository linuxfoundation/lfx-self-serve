// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { MKTG_FAMILY_PRINT_COPY, MKTG_FAMILY_PRINT_FAQ_LAYOUT, MKTG_FAMILY_PRINT_FAQ_SOURCE_LABELS, MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import { FaqGroupView, FaqQuestionView, MktgFamilyPrintFaqItem } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintFill } from '@lfx-one/shared/utils';
import { MktgPortraitRectDirective } from '../../mktg-portrait/mktg-portrait-rect.directive';

/** One printed entry of the page: the question with its group's heading when it opens the group in its column. */
interface MktgFamilyPrintFaqEntry {
  key: string;
  heading: string | null;
  entry: FaqQuestionView;
  /** The source chip's text: the stored source, by the book's own name for it when it has one ('' prints no chip). */
  source: string;
}

/**
 * One FAQ page of the family book: the two columns the plan filled by
 * height, each a run of question, answer and source chip under its group's
 * heading (a group split across columns or pages repeats its heading). The
 * first page's intro counts the whole FAQ; a later page's names its groups.
 * Unanswered questions do not print.
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
  /** The plan's two columns for this page: indices into `groups` and their questions. */
  public readonly columns = input.required<MktgFamilyPrintFaqItem[][]>();
  /** This page's index among the FAQ pages. */
  public readonly index = input(0);

  public readonly layout = MKTG_FAMILY_PRINT_FAQ_LAYOUT;
  public readonly geometry = MKTG_PORTRAIT_PAGE;
  public readonly column: readonly [number, number] = [MKTG_PORTRAIT_PAGE.margin, MKTG_PORTRAIT_PAGE.contentWidth];

  public readonly shown: Signal<MktgFamilyPrintFaqEntry[][]> = this.initShown();
  public readonly intro: Signal<string> = this.initIntro();

  private initShown(): Signal<MktgFamilyPrintFaqEntry[][]> {
    return computed(() => {
      const groups = this.groups();
      return this.columns().map((items) =>
        items.flatMap((item) => {
          const group = groups[item.group];
          const entry = group?.questions[item.question];
          if (!group || !entry || !entry.answered) return [];
          const source = entry.source.trim();
          return [
            {
              key: entry.path,
              heading: item.heading ? group.name : null,
              entry,
              source: MKTG_FAMILY_PRINT_FAQ_SOURCE_LABELS[source.toLocaleLowerCase()] ?? source,
            },
          ];
        })
      );
    });
  }

  private initIntro(): Signal<string> {
    return computed(() => {
      const groups = this.groups();
      if (this.index() > 0) {
        const names = Array.from(
          new Set(
            this.columns()
              .flat()
              .map((item) => groups[item.group]?.name ?? '')
          )
        ).filter(Boolean);
        return `${names.join(' · ')}.`;
      }
      const sizes = groups.map((group) => group.questions.filter((entry) => entry.answered).length).filter((size) => size > 0);
      const questions = sizes.reduce((sum, size) => sum + size, 0);
      return mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.faqIntro, { Questions: questions, Groups: sizes.length });
    });
  }
}
