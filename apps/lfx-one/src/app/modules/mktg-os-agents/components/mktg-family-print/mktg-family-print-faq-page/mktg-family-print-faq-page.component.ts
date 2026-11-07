// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import {
  MKTG_FAMILY_PRINT_COPY,
  MKTG_FAMILY_PRINT_FAQ_LAYOUT,
  MKTG_FAMILY_PRINT_LABELS,
  MKTG_FAMILY_PRINT_SEP,
  MKTG_PORTRAIT_PAGE,
} from '@lfx-one/shared/constants';
import { MktgFamilyPrintFaqEntry, MktgFamilyPrintFaqItem, MktgFamilyPrintFaqPlanGroup } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintFaqSourceLabel, mktgFamilyPrintFill } from '@lfx-one/shared/utils';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../mktg-portrait/mktg-portrait-host';
import { MktgPortraitRectDirective } from '../../mktg-portrait/mktg-portrait-rect.directive';

/**
 * One FAQ page of the family book: the two columns the plan filled by
 * height, each a run of question, answer and source chip under its group's
 * heading (a group split across columns or pages repeats its heading, with
 * the continued mark after it). The
 * first page's intro counts the whole FAQ; a later page's names its groups.
 * Unanswered questions do not print; an internal source label prints no chip.
 */
@Component({
  selector: 'lfx-mktg-family-print-faq-page',
  imports: [MktgPortraitRectDirective],
  templateUrl: './mktg-family-print-faq-page.component.html',
  styleUrl: './mktg-family-print-faq-page.component.scss',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgFamilyPrintFaqPageComponent {
  /** The FAQ as the book prints it (mktgFamilyPrintFaqGroups: the answered questions the plan paginated), for the entries and the counts. */
  public readonly groups = input.required<MktgFamilyPrintFaqPlanGroup[]>();
  /** The plan's two columns for this page: indices into `groups` and their questions, the plan's own index space. */
  public readonly columns = input.required<MktgFamilyPrintFaqItem[][]>();
  /** This page's index among the FAQ pages. */
  public readonly index = input(0);

  public readonly layout = MKTG_FAMILY_PRINT_FAQ_LAYOUT;
  public readonly labels = MKTG_FAMILY_PRINT_LABELS;
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
          if (!group || !entry) return [];
          // The chip's word for the source, as the plan measured it; '' (the run's internal `Notes`) prints no chip.
          // A heading over any question but the group's first repeats one begun in an earlier column or page.
          const heading = item.heading ? group.name : null;
          return [{ key: entry.path, heading, continued: !!heading && item.question > 0, entry, source: mktgFamilyPrintFaqSourceLabel(entry.source) }];
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
        return `${names.join(MKTG_FAMILY_PRINT_SEP)}.`;
      }
      const sizes = groups.map((group) => group.questions.length).filter((size) => size > 0);
      const questions = sizes.reduce((sum, size) => sum + size, 0);
      return mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.faqIntro, { Questions: questions, Groups: sizes.length });
    });
  }
}
