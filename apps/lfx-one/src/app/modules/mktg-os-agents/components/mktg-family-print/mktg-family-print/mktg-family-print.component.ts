// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import {
  BRAND_KIT_BACK_COVER_NOTICE,
  MKTG_FAMILY_PRINT_COPY,
  MKTG_FAMILY_PRINT_LABELS,
  MKTG_PORTRAIT_PAGE,
  MKTG_PORTRAIT_PRINT_CLASS,
} from '@lfx-one/shared/constants';
import {
  MktgFamilyPrintChapter,
  MktgFamilyPrintDocument,
  MktgFamilyPrintPlan,
  MktgFamilyPrintPlanMember,
  MktgFamilyPrintView,
  MktgPortraitBook,
  MktgPortraitLook,
} from '@lfx-one/shared/interfaces';
import {
  brandKitPortraitPlan,
  mktgFamilyPrintDate,
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
import { MktgPortraitRectDirective } from '../../mktg-portrait/mktg-portrait-rect.directive';
import { MktgFamilyPrintBoilerplatesPageComponent } from '../mktg-family-print-boilerplates-page/mktg-family-print-boilerplates-page.component';
import { MktgFamilyPrintFaqPageComponent } from '../mktg-family-print-faq-page/mktg-family-print-faq-page.component';
import { MktgFamilyPrintSourcesPageComponent } from '../mktg-family-print-sources-page/mktg-family-print-sources-page.component';

/**
 * The family's Download PDF as a portrait book: the plan's frames in order
 * (cover, contents, an opener and its pages per member document, the
 * Sources page, the back cover), each a page of the portrait grammar
 * (`lfx-mktg-portrait-page`), numbered by one plan over the view. Stage 1:
 * the framework and the brand kit print as main's flowing documents in
 * their chapters' place, counted by the kit's own portrait plan and the
 * framework's sections; their portrait pages replace them.
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
  // The portrait grammar's root: a plain block of frames; the print service picks the US Letter setup by its class.
  host: { class: `block ${MKTG_PORTRAIT_PRINT_CLASS}`, 'data-testid': 'family-print-book' },
})
export class MktgFamilyPrintComponent {
  public readonly view = input.required<MktgFamilyPrintView>();
  /** The family's name, the book's title: `Positioning & brand`. */
  public readonly familyName = input.required<string>();

  public readonly labels = MKTG_FAMILY_PRINT_LABELS;
  public readonly geometry = MKTG_PORTRAIT_PAGE;
  /** The cover's and the back cover's inset column: x 72, 672 wide. */
  public readonly inset: readonly [number, number] = [MKTG_PORTRAIT_PAGE.coverInset, MKTG_PORTRAIT_PAGE.width - 2 * MKTG_PORTRAIT_PAGE.coverInset];
  /** The content column: x 56, 704 wide. */
  public readonly column: readonly [number, number] = [MKTG_PORTRAIT_PAGE.margin, MKTG_PORTRAIT_PAGE.contentWidth];

  public readonly plan: Signal<MktgFamilyPrintPlan> = this.initPlan();
  public readonly look: Signal<MktgPortraitLook> = this.initLook();
  public readonly book: Signal<MktgPortraitBook> = this.initBook();
  public readonly printedLabel: Signal<string> = this.initPrintedLabel();
  public readonly coverFootRight: Signal<string> = this.initCoverFootRight();
  public readonly coverPurpose: Signal<string> = this.initCoverPurpose();
  public readonly contentsIntro: Signal<string> = this.initContentsIntro();
  public readonly contentsNote: Signal<string> = this.initContentsNote();
  public readonly contentsColumns: Signal<MktgFamilyPrintChapter[][]> = this.initContentsColumns();
  public readonly backCoverNotice: Signal<string> = this.initBackCoverNotice();

  /** The chapter a page belongs to, for the openers and the inner prints' books. */
  public chapterOf(agentKey: string | null): MktgFamilyPrintChapter | null {
    return this.plan().chapters.find((chapter) => chapter.document.agentKey === agentKey) ?? null;
  }

  public pageRange(chapter: MktgFamilyPrintChapter): string {
    return mktgFamilyPrintPageRange(chapter.first, chapter.last);
  }

  /** The inner document's book: the family's, numbered from the chapter's first page. */
  public innerBook(chapter: MktgFamilyPrintChapter | null): MktgPortraitBook {
    return { ...this.book(), firstPage: chapter?.first ?? this.book().firstPage };
  }

  /** The opener's Approved cell: the date, and the approver's name when the store has it (`6 Nov 2026 · A. Name`). */
  public approvedOf(document: MktgFamilyPrintDocument): string {
    return [document.approvedLabel, document.approvedBy].filter(Boolean).join(' · ');
  }

  /** `V4.0 · 6 Nov 2026` on the cover's document tiles; only what the store gives. */
  public metaOf(document: MktgFamilyPrintDocument): string {
    return [document.versionLabel, document.approvedLabel].filter(Boolean).join(' · ');
  }

  private initPlan(): Signal<MktgFamilyPrintPlan> {
    return computed(() => {
      const view = this.view();
      const members: MktgFamilyPrintPlanMember[] = view.documents.map((document) => {
        switch (document.agentKey) {
          case 'foundation-message':
            return { document, innerPageTitles: view.framework?.sections.map((section) => section.title) ?? [] };
          case 'brand-kit':
            return { document, innerPageTitles: view.kit ? brandKitPortraitPlan(view.kit, { inFamily: true }).map((page) => page.title) : [] };
          case 'boilerplates':
            return { document, boilerplateCount: view.boilerplates?.lengths.filter((row) => row.text.trim()).length ?? 0 };
          default:
            // Unanswered questions do not print: the counts take the answered ones only.
            return { document, faqGroupSizes: view.faq?.groups.map((group) => group.questions.filter((entry) => entry.answered).length) ?? [] };
        }
      });
      return mktgFamilyPrintPlan(members);
    });
  }

  private initLook(): Signal<MktgPortraitLook> {
    return computed(() => mktgPortraitLook(this.view().brand, this.view().kit?.spark ?? null));
  }

  private initBook(): Signal<MktgPortraitBook> {
    return computed(() => ({
      inFamily: true,
      headRight: mktgPortraitDocumentName(this.view().projectName, 'positioning & brand'),
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

  private initContentsColumns(): Signal<MktgFamilyPrintChapter[][]> {
    return computed(() => {
      const chapters = this.plan().chapters;
      const half = Math.ceil(chapters.length / 2);
      return [chapters.slice(0, half), chapters.slice(half)];
    });
  }

  private initBackCoverNotice(): Signal<string> {
    return computed(() => `${BRAND_KIT_BACK_COVER_NOTICE.split('[Project]').join(this.view().projectName)} ${MKTG_FAMILY_PRINT_COPY.backCoverProvenance}`);
  }
}
