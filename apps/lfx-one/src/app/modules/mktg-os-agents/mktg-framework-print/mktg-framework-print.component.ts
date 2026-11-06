// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MKTG_PRINT_FRAMEWORK_COVER_TITLE_SIZE } from '@lfx-one/shared/constants';
import { FoundationMessagePrintView, MktgPrintFrameworkCover, MktgPrintFrameworkPageItem, MktgPrintPageLook } from '@lfx-one/shared/interfaces';
import { buildFrameworkPrintPages, mktgPrintFrameworkCover, mktgPrintFrameworkSectionOf, mktgPrintPageLook } from '@lfx-one/shared/utils';
import { MktgPrintService } from '@services/mktg-print.service';
import { distinctUntilChanged, filter } from 'rxjs';
import { MktgPrintCoverComponent } from '../components/mktg-print-cover/mktg-print-cover.component';
import { MktgPrintPageComponent } from '../components/mktg-print-page/mktg-print-page.component';

/**
 * The Messaging Framework as Download PDF prints it: the deck's pages
 * (marketing-os-agents `agents/slides-export` framework-print.ts), one
 * landscape page per slide, in the deck's order with its headings — the cover
 * (the eyebrow, the title, the tagline, the sections), then 01 Framework, 02
 * ICPs, 03 Message house and 04 Key numbers (`buildFrameworkPrintPages`, the
 * shared page plan the Slides export builds from), each on the page shell
 * (`lfx-mktg-print-page`) in the project's brand. The deck has no back cover
 * for the framework, so neither has this. Inside a larger document (the
 * family PDF) `firstPage` numbers the cover. The framework's data path is
 * unchanged: the view comes in as before, and the brand's typeface is loaded
 * through the print service. On screen the framework is its app page
 * (lfx-mktg-framework-view), which holds this document in a print-only
 * wrapper and prints it with Download PDF.
 */
@Component({
  selector: 'lfx-mktg-framework-print',
  imports: [MktgPrintCoverComponent, MktgPrintPageComponent],
  templateUrl: './mktg-framework-print.component.html',
  styleUrl: './mktg-framework-print.component.scss',
})
export class MktgFrameworkPrintComponent {
  // === Injections ===
  private readonly printService = inject(MktgPrintService);

  // === Inputs ===
  /** The framework as the print lays it out, with the brand it is set in. */
  public readonly view = input.required<FoundationMessagePrintView>();
  /** Family document number; the deck's pages carry none, so it is accepted and not drawn. */
  public readonly number = input('');
  /** The page number of the cover in the document that holds the framework (1 when it prints alone). */
  public readonly firstPage = input(1);

  // === The pages ===
  protected readonly look = computed<MktgPrintPageLook>(() => mktgPrintPageLook(this.view().brand));
  protected readonly cover = computed<MktgPrintFrameworkCover>(() => mktgPrintFrameworkCover(this.view(), this.look()));
  private readonly options = computed(() => ({ firstPage: this.firstPage() }));
  /** Each content page with the section its running head names, computed once with the pages. */
  protected readonly pages = computed<MktgPrintFrameworkPageItem[]>(() =>
    buildFrameworkPrintPages(this.view(), this.options()).map((page) => ({ page, section: mktgPrintFrameworkSectionOf(page) }))
  );
  /** The cover and the content pages, counted from the built pages (mktgPrintFrameworkPageCount builds them again). */
  protected readonly pageCount = computed(() => 1 + this.pages().length);
  protected readonly coverTitleSize = MKTG_PRINT_FRAMEWORK_COVER_TITLE_SIZE;

  public constructor() {
    // The typeface comes from Google Fonts, loaded once per stylesheet (the
    // print service shares the link with the brand kit book).
    toObservable(computed(() => this.view().brand.fontUrl))
      .pipe(
        filter((url): url is string => !!url),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((url) => this.printService.ensureFontStylesheet(url));
  }
}
