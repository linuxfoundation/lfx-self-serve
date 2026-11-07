// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import {
  BRAND_KIT_BACK_COVER_NOTICE,
  MKTG_FAMILY_PRINT_COPY,
  MKTG_FAMILY_PRINT_LABELS,
  MKTG_FAMILY_PRINT_STAGE1_KIT_PAGE_TITLES,
} from '@lfx-one/shared/constants';
import {
  MktgFamilyPrintChapter,
  MktgFamilyPrintDocument,
  MktgFamilyPrintPlan,
  MktgFamilyPrintPlanMember,
  MktgFamilyPrintView,
} from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintDate, mktgFamilyPrintFill, mktgFamilyPrintPageRange, mktgFamilyPrintPlan } from '@lfx-one/shared/utils';
import { MktgBrandKitPrintComponent } from '../../../mktg-brand-kit-print/mktg-brand-kit-print.component';
import { MktgFrameworkPrintComponent } from '../../../mktg-framework-print/mktg-framework-print.component';
import { MktgFamilyPrintBoilerplatesPageComponent } from '../mktg-family-print-boilerplates-page/mktg-family-print-boilerplates-page.component';
import { MktgFamilyPrintFaqPageComponent } from '../mktg-family-print-faq-page/mktg-family-print-faq-page.component';
import { MktgFamilyPrintFrameComponent } from '../mktg-family-print-frame/mktg-family-print-frame.component';
import { MktgFamilyPrintSourcesPageComponent } from '../mktg-family-print-sources-page/mktg-family-print-sources-page.component';

/**
 * The family's Download PDF as a portrait book: the plan's frames in order
 * (cover, contents, an opener and its pages per member document, the
 * Sources page, the back cover), each a fixed US Letter page, numbered by
 * one plan over the view. Stage 1: the framework and the brand kit print
 * as main's flowing documents in their chapters' place, counted by the
 * plan as one page per section; their portrait pages replace them.
 */
@Component({
  selector: 'lfx-mktg-family-print',
  imports: [
    MktgFamilyPrintFrameComponent,
    MktgFamilyPrintBoilerplatesPageComponent,
    MktgFamilyPrintFaqPageComponent,
    MktgFamilyPrintSourcesPageComponent,
    MktgFrameworkPrintComponent,
    MktgBrandKitPrintComponent,
  ],
  templateUrl: './mktg-family-print.component.html',
  styleUrl: './mktg-family-print.component.scss',
  host: { class: 'block', 'data-testid': 'family-print-book' },
})
export class MktgFamilyPrintComponent {
  public readonly view = input.required<MktgFamilyPrintView>();
  /** The family's name, the book's title: `Positioning & brand`. */
  public readonly familyName = input.required<string>();

  public readonly labels = MKTG_FAMILY_PRINT_LABELS;
  public readonly copy = MKTG_FAMILY_PRINT_COPY;

  public readonly plan: Signal<MktgFamilyPrintPlan> = this.initPlan();
  public readonly headRight: Signal<string> = this.initHeadRight();
  public readonly footLeft: Signal<string> = this.initFootLeft();
  public readonly printedLabel: Signal<string> = this.initPrintedLabel();
  public readonly coverFootRight: Signal<string> = this.initCoverFootRight();
  public readonly coverPurpose: Signal<string> = this.initCoverPurpose();
  public readonly contentsIntro: Signal<string> = this.initContentsIntro();
  public readonly contentsNote: Signal<string> = this.initContentsNote();
  public readonly contentsColumns: Signal<MktgFamilyPrintChapter[][]> = this.initContentsColumns();
  public readonly backCoverNotice: Signal<string> = this.initBackCoverNotice();

  /** The chapter a page belongs to, for the openers. */
  public chapterOf(agentKey: string | null): MktgFamilyPrintChapter | null {
    return this.plan().chapters.find((chapter) => chapter.document.agentKey === agentKey) ?? null;
  }

  public pageRange(chapter: MktgFamilyPrintChapter): string {
    return mktgFamilyPrintPageRange(chapter.first, chapter.last);
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
            return { document, innerPageTitles: view.kit ? [...MKTG_FAMILY_PRINT_STAGE1_KIT_PAGE_TITLES] : [] };
          case 'boilerplates':
            return { document, boilerplateCount: view.boilerplates?.lengths.filter((row) => row.text.trim()).length ?? 0 };
          default:
            return { document, faqGroupSizes: view.faq?.groups.map((group) => group.questions.length) ?? [] };
        }
      });
      return mktgFamilyPrintPlan(members);
    });
  }

  private initHeadRight(): Signal<string> {
    return computed(() => this.familyName());
  }

  private initFootLeft(): Signal<string> {
    return computed(() => `${this.view().projectName} · ${MKTG_FAMILY_PRINT_LABELS.linuxFoundationProject}`);
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
