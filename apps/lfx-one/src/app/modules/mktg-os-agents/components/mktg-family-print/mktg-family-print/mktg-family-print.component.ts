// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import {
  BRAND_KIT_BACK_COVER_NOTICE,
  MKTG_FAMILY_EXPORT_KINDS,
  MKTG_FAMILY_PRINT_CONTENTS_LAYOUT,
  MKTG_FAMILY_PRINT_COPY,
  MKTG_FAMILY_PRINT_BOOK_CLASS,
  MKTG_FAMILY_PRINT_HEAD_KIND,
  MKTG_FAMILY_PRINT_LABELS,
  MKTG_PORTRAIT_PAGE,
  MKTG_PORTRAIT_PRINT_CLASS,
} from '@lfx-one/shared/constants';
import {
  MktgFamilyPrintContentsLayout,
  MktgFamilyPrintCoverTile,
  MktgFamilyPrintFaqPlanGroup,
  MktgFamilyPrintFrame,
  MktgFamilyPrintPlan,
  MktgFamilyPrintPlanMember,
  MktgFamilyPrintView,
  MktgPortraitBook,
  MktgPortraitLook,
} from '@lfx-one/shared/interfaces';
import {
  brandKitPortraitPlan,
  frameworkPortraitPlan,
  mktgFamilyPrintContentsLayout,
  mktgFamilyPrintCutNote,
  mktgFamilyPrintDate,
  mktgFamilyPrintFaqGroups,
  mktgFamilyPrintFill,
  mktgFamilyPrintPageRange,
  mktgFamilyPrintPlan,
  mktgPortraitDocumentName,
  mktgPortraitFootLeft,
  mktgPortraitLook,
} from '@lfx-one/shared/utils';
import { MktgBrandKitPrintComponent } from '../../../mktg-brand-kit-print/mktg-brand-kit-print.component';
import { MktgFrameworkPrintComponent } from '../../../mktg-framework-print/mktg-framework-print.component';
import { MktgPortraitBackCoverComponent } from '../../mktg-portrait/mktg-portrait-back-cover/mktg-portrait-back-cover.component';
import { MktgPortraitOpenerComponent } from '../../mktg-portrait/mktg-portrait-opener/mktg-portrait-opener.component';
import { MktgPortraitPageComponent } from '../../mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../mktg-portrait/mktg-portrait-host';
import { MktgPortraitRectDirective } from '../../mktg-portrait/mktg-portrait-rect.directive';
import { MktgFamilyPrintBoilerplatesPageComponent } from '../mktg-family-print-boilerplates-page/mktg-family-print-boilerplates-page.component';
import { MktgFamilyPrintFaqPageComponent } from '../mktg-family-print-faq-page/mktg-family-print-faq-page.component';
import { MktgFamilyPrintSourcesPageComponent } from '../mktg-family-print-sources-page/mktg-family-print-sources-page.component';

/**
 * The family's Download PDF as a portrait book: the plan's frames in order
 * (cover, contents, an opener and its pages per member document, the
 * Sources page, the back cover), each a page of the portrait grammar
 * (`lfx-mktg-portrait-page`), numbered by one plan over the view. The
 * framework and the brand kit print their own portrait pages in their
 * chapters' place, on the family's book and the kit's look, each counted by
 * its own portrait plan.
 */
@Component({
  selector: 'lfx-mktg-family-print',
  imports: [
    MktgPortraitPageComponent,
    MktgPortraitOpenerComponent,
    MktgPortraitBackCoverComponent,
    MktgPortraitRectDirective,
    MktgFamilyPrintBoilerplatesPageComponent,
    MktgFamilyPrintFaqPageComponent,
    MktgFamilyPrintSourcesPageComponent,
    MktgFrameworkPrintComponent,
    MktgBrandKitPrintComponent,
  ],
  templateUrl: './mktg-family-print.component.html',
  styleUrl: './mktg-family-print.component.scss',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
  // The portrait grammar's root: a plain block of frames; the print service picks the page setup by its class. The
  // family's own class carries the one rule it lays over every running head in its book (styles/mktg-family-print.scss).
  host: { class: `block ${MKTG_PORTRAIT_PRINT_CLASS} ${MKTG_FAMILY_PRINT_BOOK_CLASS}`, 'data-testid': 'family-print-book' },
})
export class MktgFamilyPrintComponent {
  public readonly view = input.required<MktgFamilyPrintView>();
  /** The family's name, the book's title: `Positioning & brand`. */
  public readonly familyName = input.required<string>();

  public readonly labels = MKTG_FAMILY_PRINT_LABELS;
  public readonly geometry = MKTG_PORTRAIT_PAGE;
  public readonly contentsLayout = MKTG_FAMILY_PRINT_CONTENTS_LAYOUT;
  /** The cover's and the back cover's inset column: x 72, 672 wide. */
  public readonly inset: readonly [number, number] = [MKTG_PORTRAIT_PAGE.coverInset, MKTG_PORTRAIT_PAGE.width - 2 * MKTG_PORTRAIT_PAGE.coverInset];
  /** The content column: x 56, 704 wide. */
  public readonly column: readonly [number, number] = [MKTG_PORTRAIT_PAGE.margin, MKTG_PORTRAIT_PAGE.contentWidth];

  /** The FAQ as the book prints it: the answered questions the plan paginates and the FAQ pages print, one index space. */
  public readonly faqGroups: Signal<MktgFamilyPrintFaqPlanGroup[]> = computed(() => mktgFamilyPrintFaqGroups(this.view().faq?.groups ?? []));
  public readonly plan: Signal<MktgFamilyPrintPlan> = this.initPlan();
  public readonly frames: Signal<MktgFamilyPrintFrame[]> = this.initFrames();
  public readonly coverTiles: Signal<MktgFamilyPrintCoverTile[]> = this.initCoverTiles();
  public readonly look: Signal<MktgPortraitLook> = this.initLook();
  public readonly book: Signal<MktgPortraitBook> = this.initBook();
  public readonly printedLabel: Signal<string> = this.initPrintedLabel();
  public readonly coverFootRight: Signal<string> = this.initCoverFootRight();
  public readonly coverPurpose: Signal<string> = this.initCoverPurpose();
  public readonly contentsIntro: Signal<string> = this.initContentsIntro();
  public readonly contentsNote: Signal<string> = this.initContentsNote();
  /** The contents page's two columns, filled by height (a chapter continues under a repeated row; a cut is counted, never clipped). */
  public readonly contents: Signal<MktgFamilyPrintContentsLayout> = computed(() => mktgFamilyPrintContentsLayout(this.plan().chapters));
  /** The note under the last contents block when the page could not hold every entry: `+3 more in LFX One`; '' when all fit. */
  public readonly contentsCutNote: Signal<string> = computed(() => mktgFamilyPrintCutNote(this.contents().cut));
  public readonly backCoverNotice: Signal<string> = this.initBackCoverNotice();

  private initPlan(): Signal<MktgFamilyPrintPlan> {
    return computed(() => {
      const view = this.view();
      const members: MktgFamilyPrintPlanMember[] = view.documents.map((document) => {
        switch (MKTG_FAMILY_EXPORT_KINDS[document.agentKey]) {
          case 'framework':
            return { document, innerPageTitles: view.framework ? frameworkPortraitPlan(view.framework, { inFamily: true }).map((page) => page.title) : [] };
          case 'kit':
            return { document, innerPageTitles: view.kit ? brandKitPortraitPlan(view.kit, { inFamily: true }).map((page) => page.title) : [] };
          case 'boilerplates':
            return { document, boilerplateCount: view.boilerplates?.lengths.filter((row) => row.text.trim()).length ?? 0 };
          case 'faq':
            return { document, faqGroups: this.faqGroups() };
        }
      });
      return mktgFamilyPrintPlan(members, view.conflicts.length);
    });
  }

  private initFrames(): Signal<MktgFamilyPrintFrame[]> {
    return computed(() => {
      const plan = this.plan();
      const book = this.book();
      return plan.pages.map((page) => {
        const chapter = plan.chapters.find((entry) => entry.document.agentKey === page.agentKey) ?? null;
        return {
          page,
          chapter,
          range: chapter ? mktgFamilyPrintPageRange(chapter.first, chapter.last) : '',
          innerBook: { ...book, firstPage: chapter?.first ?? book.firstPage },
          faqPage: page.kind === 'faq' ? (plan.faqPages[page.index] ?? null) : null,
        };
      });
    });
  }

  private initCoverTiles(): Signal<MktgFamilyPrintCoverTile[]> {
    return computed(() =>
      this.plan().chapters.map((chapter) => ({
        document: chapter.document,
        meta: [chapter.document.versionLabel, chapter.document.approvedLabel].filter(Boolean).join(' · '),
      }))
    );
  }

  private initLook(): Signal<MktgPortraitLook> {
    return computed(() => mktgPortraitLook(this.view().brand, this.view().kit?.spark ?? null));
  }

  private initBook(): Signal<MktgPortraitBook> {
    return computed(() => ({
      inFamily: true,
      // The running head names the family as the grammar names a document, by the grammar's own kind for it.
      headRight: mktgPortraitDocumentName(this.view().projectName, MKTG_FAMILY_PRINT_HEAD_KIND),
      footLeft: mktgPortraitFootLeft(this.view().projectName),
      firstPage: 1,
    }));
  }

  private initPrintedLabel(): Signal<string> {
    return computed(() => mktgFamilyPrintDate(this.view().printedAt));
  }

  private initCoverFootRight(): Signal<string> {
    return computed(() => [this.view().websiteLabel, this.printedLabel()].filter(Boolean).join(' · '));
  }

  private initCoverPurpose(): Signal<string> {
    return computed(() => mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.coverPurpose, { Project: this.view().projectName }));
  }

  private initContentsIntro(): Signal<string> {
    return computed(() => {
      const plan = this.plan();
      return mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.contentsIntro, { Documents: plan.chapters.length, Pages: plan.total });
    });
  }

  private initContentsNote(): Signal<string> {
    return computed(() => mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.contentsNote, { Date: this.printedLabel() }));
  }

  private initBackCoverNotice(): Signal<string> {
    return computed(() => `${BRAND_KIT_BACK_COVER_NOTICE.split('[Project]').join(this.view().projectName)} ${MKTG_FAMILY_PRINT_COPY.backCoverProvenance}`);
  }
}
