// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { MKTG_FAMILY_PRINT_COPY, MKTG_FAMILY_PRINT_LABELS, MKTG_FAMILY_PRINT_SOURCES_LAYOUT, MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import { MktgFamilyPrintChapter, MktgFamilyPrintConflict, MktgFamilyPrintSourcesLayout } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintCutNote, mktgFamilyPrintOpenItems, mktgFamilyPrintSourcesLayout } from '@lfx-one/shared/utils';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../mktg-portrait/mktg-portrait-host';
import { MktgPortraitRectDirective } from '../../mktg-portrait/mktg-portrait-rect.directive';

/**
 * The family book's one cross-document Sources page, the board's three
 * blocks: the version, approval and data date of each document in the book;
 * where the documents disagree (the store's own conflicts and the
 * framework's key numbers read against the other documents' text, each row
 * naming the document to re-run); and what their runs left open. Each list
 * holds the whole rows that fit its block above the footer, nothing added;
 * a block with nothing to print is omitted, never filled. When both lists
 * are empty the intro drops its two-lists clause and one line under the
 * table says so: the documents agree, and nothing is left open (D-27).
 */
@Component({
  selector: 'lfx-mktg-family-print-sources-page',
  imports: [MktgPortraitRectDirective],
  templateUrl: './mktg-family-print-sources-page.component.html',
  styleUrl: './mktg-family-print-sources-page.component.scss',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgFamilyPrintSourcesPageComponent {
  public readonly chapters = input.required<MktgFamilyPrintChapter[]>();
  public readonly conflicts = input<MktgFamilyPrintConflict[]>([]);

  public readonly labels = MKTG_FAMILY_PRINT_LABELS;
  public readonly copy = MKTG_FAMILY_PRINT_COPY;
  public readonly geometry = MKTG_PORTRAIT_PAGE;
  public readonly layout = MKTG_FAMILY_PRINT_SOURCES_LAYOUT;
  public readonly column: readonly [number, number] = [MKTG_PORTRAIT_PAGE.margin, MKTG_PORTRAIT_PAGE.contentWidth];

  public readonly lists: Signal<MktgFamilyPrintSourcesLayout> = this.initLists();
  /** The cut notes under each list (`+2 more in LFX One`); '' when every row printed. */
  public readonly conflictsCutNote: Signal<string> = computed(() => mktgFamilyPrintCutNote(this.lists().conflictsCut));
  public readonly openCutNote: Signal<string> = computed(() => mktgFamilyPrintCutNote(this.lists().openCut));
  /** Both lists empty, no row cut: nothing to disagree about and nothing left open, so the page says so instead of printing two absent blocks. */
  public readonly quiet: Signal<boolean> = computed(() => {
    const shown = this.lists();
    return shown.conflicts.length === 0 && shown.openItems.length === 0 && !shown.conflictsCut && !shown.openCut;
  });
  /** The intro: the standing copy, or without its two-lists clause on a quiet page. */
  public readonly intro: Signal<string> = computed(() => (this.quiet() ? MKTG_FAMILY_PRINT_COPY.sourcesIntroQuiet : MKTG_FAMILY_PRINT_COPY.sourcesIntro));

  private initLists(): Signal<MktgFamilyPrintSourcesLayout> {
    return computed(() => mktgFamilyPrintSourcesLayout(this.conflicts(), mktgFamilyPrintOpenItems(this.chapters())));
  }
}
