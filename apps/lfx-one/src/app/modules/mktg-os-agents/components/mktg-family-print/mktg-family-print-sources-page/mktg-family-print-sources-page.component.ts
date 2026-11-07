// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { MKTG_FAMILY_PRINT_COPY, MKTG_FAMILY_PRINT_LABELS, MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import { MktgFamilyPrintChapter, MktgFamilyPrintConflict, MktgFamilyPrintOpenItem } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintOpenItems } from '@lfx-one/shared/utils';
import { MktgPortraitRectDirective } from '../../mktg-portrait/mktg-portrait-rect.directive';

/**
 * The family book's one cross-document Sources page: the version and
 * approval of each document in the book, where the documents disagree (only
 * what the store names) and what their runs left open. A block with nothing
 * to print is omitted, never filled.
 */
@Component({
  selector: 'lfx-mktg-family-print-sources-page',
  imports: [MktgPortraitRectDirective],
  templateUrl: './mktg-family-print-sources-page.component.html',
  styleUrl: './mktg-family-print-sources-page.component.scss',
})
export class MktgFamilyPrintSourcesPageComponent {
  public readonly chapters = input.required<MktgFamilyPrintChapter[]>();
  public readonly conflicts = input<MktgFamilyPrintConflict[]>([]);

  public readonly labels = MKTG_FAMILY_PRINT_LABELS;
  public readonly intro = MKTG_FAMILY_PRINT_COPY.sourcesIntro;
  public readonly geometry = MKTG_PORTRAIT_PAGE;
  public readonly column: readonly [number, number] = [MKTG_PORTRAIT_PAGE.margin, MKTG_PORTRAIT_PAGE.contentWidth];

  public readonly openItems: Signal<MktgFamilyPrintOpenItem[]> = this.initOpenItems();

  private initOpenItems(): Signal<MktgFamilyPrintOpenItem[]> {
    return computed(() => mktgFamilyPrintOpenItems(this.chapters()));
  }
}
